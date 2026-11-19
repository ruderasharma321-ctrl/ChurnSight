import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import type { AuditLogEntry, UserRole } from '../src/types/churn.ts';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const AUDIT_FILE = path.join(DATA_DIR, 'audit_logs.json');
const MAX_AUDIT_ENTRIES = 2500;

let auditLogs: AuditLogEntry[] = loadAuditLogs();

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

function saveAuditLogs(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmp = `${AUDIT_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(auditLogs.slice(0, MAX_AUDIT_ENTRIES), null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    fs.renameSync(tmp, AUDIT_FILE);
  } catch (err) {
    console.error('Failed to persist audit logs:', err);
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
