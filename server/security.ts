import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import type { AuditLogEntry, UserRole } from '../src/types/churn.ts';
import {
  isRemoteStoreConfigured,
  remoteGetJson,
  remoteSetJson,
} from './remoteStore.ts';

const DATA_DIR =
  process.env.CHURNSIGHT_DATA_DIR ||
  (process.env.VERCEL ? path.join(os.tmpdir(), 'churnsight-data') : path.resolve(process.cwd(), '.data'));
const AUDIT_FILE = path.join(DATA_DIR, 'audit_logs.json');
const REMOTE_AUDIT_KEY = 'churnsight:audit:v1';
const MAX_AUDIT_ENTRIES = 2500;

let auditLogs: AuditLogEntry[] = loadAuditLogs();
let lastAuditHydratedAt = 0;
let pendingAuditWrite: Promise<void> | null = null;

function loadAuditLogs(): AuditLogEntry[] {
  try {
    if (fs.existsSync(AUDIT_FILE)) {
      const raw = fs.readFileSync(AUDIT_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    // ignore corrupted read
  }
  return [];
}

export async function ensureAuditLogsHydrated(): Promise<void> {
  if (!isRemoteStoreConfigured()) return;
  if (Date.now() - lastAuditHydratedAt <= 5000 && auditLogs.length > 0) return;
  try {
    if (pendingAuditWrite) await pendingAuditWrite;
    const remote = await remoteGetJson<AuditLogEntry[]>(REMOTE_AUDIT_KEY);
    if (Array.isArray(remote)) {
      auditLogs = remote.slice(0, MAX_AUDIT_ENTRIES);
    }
    lastAuditHydratedAt = Date.now();
  } catch {
    // ignore non-critical audit hydration failure
  }
}

export async function flushPendingAuditWrites(): Promise<void> {
  if (pendingAuditWrite) {
    await pendingAuditWrite;
  }
}

function saveAuditLogs(): void {
  const sliced = auditLogs.slice(0, MAX_AUDIT_ENTRIES);
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmp = `${AUDIT_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(sliced, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    fs.renameSync(tmp, AUDIT_FILE);
  } catch (err) {
    console.error('Failed to persist audit logs:', err);
  }

  if (isRemoteStoreConfigured()) {
    const prev = pendingAuditWrite || Promise.resolve();
    pendingAuditWrite = prev
      .catch(() => undefined)
      .then(() => remoteSetJson(REMOTE_AUDIT_KEY, sliced))
      .then(() => {
        lastAuditHydratedAt = Date.now();
      })
      .catch(() => undefined);
  }
}

export function recordAuditEvent(input: {
  companyId: string;
  actorId: string;
  actorEmail: string;
  actorRole: UserRole;
  action: string;
  resource: string;
  details: string;
}): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: `aud_${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    companyId: input.companyId,
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    actorRole: input.actorRole,
    action: input.action,
    resource: input.resource,
    details: input.details,
  };
  auditLogs.unshift(entry);
  if (auditLogs.length > MAX_AUDIT_ENTRIES) {
    auditLogs = auditLogs.slice(0, MAX_AUDIT_ENTRIES);
  }
  saveAuditLogs();
  return entry;
}

export function listCompanyAuditLogs(companyId: string, limit = 100): AuditLogEntry[] {
  return auditLogs.filter((e) => e.companyId === companyId).slice(0, limit);
}

export function listPlatformAuditLogs(limit = 150): AuditLogEntry[] {
  return auditLogs.slice(0, limit);
}

// Sliding-window in-memory rate limiter for auth & heavy compute endpoints
const rateBuckets = new Map<string, number[]>();

export function createRateLimiter(options: {
  keyPrefix: string;
  windowMs: number;
  maxRequests: number;
  message?: string;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${options.keyPrefix}:${ip}`;
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const timestamps = (rateBuckets.get(key) || []).filter((t) => t > cutoff);

    if (timestamps.length >= options.maxRequests) {
      res.status(429).json({
        error:
          options.message ||
          'Too many requests from this address. Please wait briefly before trying again.',
      });
      return;
    }

    timestamps.push(now);
    rateBuckets.set(key, timestamps);
    next();
  };
}
