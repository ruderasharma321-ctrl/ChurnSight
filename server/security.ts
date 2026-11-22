import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import type { AuditLogEntry, UserRole } from '../src/types/churn.ts';
import { ensurePgSchema, pgQuery } from './database.ts';
import {
  isDiskPersistenceAllowed,
  isKvConfigured,
  isPostgresConfigured,
  remoteGetJson,
  remoteSetJson,
} from './remoteStore.ts';

function getLocalAuditFile(): string | null {
  if (!isDiskPersistenceAllowed()) return null;
  const custom = (process.env.CHURNSIGHT_DATA_DIR || '').trim();
  const dir = custom ? path.resolve(custom) : path.resolve(process.cwd(), '.data');
  return path.join(dir, 'audit_logs.json');
}

const REMOTE_AUDIT_KEY = 'churnsight:audit:v1';
const MAX_AUDIT_ENTRIES = 2500;

let auditLogs: AuditLogEntry[] = loadAuditLogsFromDisk();
let lastAuditHydratedAt = 0;
let pendingAuditWrite: Promise<void> | null = null;

function loadAuditLogsFromDisk(): AuditLogEntry[] {
  const file = getLocalAuditFile();
  if (!file) return [];
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    // ignore corrupted read
  }
  return [];
}

export async function ensureAuditLogsHydrated(force = false): Promise<void> {
  if (isPostgresConfigured()) {
    if (!force && Date.now() - lastAuditHydratedAt <= 5000 && auditLogs.length > 0) return;
    try {
      if (pendingAuditWrite) await pendingAuditWrite;
      await ensurePgSchema();
      const res = await pgQuery(
        `SELECT id, company_id, actor_id, actor_email, actor_role, action, resource, details, timestamp
         FROM audit_logs
         ORDER BY timestamp DESC
         LIMIT $1`,
        [MAX_AUDIT_ENTRIES]
      );
      auditLogs = res.rows.map((r) => ({
        id: String(r.id),
        companyId: String(r.company_id),
        actorId: String(r.actor_id),
        actorEmail: String(r.actor_email),
        actorRole: String(r.actor_role) as UserRole,
        action: String(r.action),
        resource: String(r.resource),
        details: String(r.details),
        timestamp:
          r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
      }));
      lastAuditHydratedAt = Date.now();
    } catch (err) {
      console.error('Failed to hydrate audit logs from PostgreSQL:', err);
    }
    return;
  }

  if (isKvConfigured()) {
    if (!force && Date.now() - lastAuditHydratedAt <= 5000 && auditLogs.length > 0) return;
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
}

export async function flushPendingAuditWrites(): Promise<void> {
  if (pendingAuditWrite) {
    const current = pendingAuditWrite;
    try {
      await current;
    } finally {
      if (pendingAuditWrite === current) {
        pendingAuditWrite = null;
      }
    }
  }
}

function saveAuditLogs(newEntry?: AuditLogEntry): void {
  const sliced = auditLogs.slice(0, MAX_AUDIT_ENTRIES);
  const file = getLocalAuditFile();
  if (file && !isPostgresConfigured() && !isKvConfigured()) {
    try {
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(sliced, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('Failed to persist audit logs to disk:', err);
    }
  }

  if (isPostgresConfigured() && newEntry) {
    const prev = pendingAuditWrite || Promise.resolve();
    pendingAuditWrite = prev
      .catch(() => undefined)
      .then(async () => {
        await pgQuery(
          `INSERT INTO audit_logs (
            id, company_id, actor_id, actor_email, actor_role, action, resource, details, timestamp
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (id) DO NOTHING`,
          [
            newEntry.id,
            newEntry.companyId,
            newEntry.actorId,
            newEntry.actorEmail,
            newEntry.actorRole,
            newEntry.action,
            newEntry.resource,
            newEntry.details,
            newEntry.timestamp,
          ]
        );
        lastAuditHydratedAt = Date.now();
      })
      .catch((err) => {
        console.error('Failed to persist audit log to PostgreSQL:', err);
      });
  } else if (isKvConfigured()) {
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
  saveAuditLogs(entry);
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
