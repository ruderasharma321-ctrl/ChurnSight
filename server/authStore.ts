import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  BusinessModel,
  BusinessType,
  ChurnDefinition,
  CompanyWorkspaceInfo,
  CustomerRelationshipType,
  DataPrivacySettings,
  IndustryKey,
  LoginRequest,
  RegisterCompanyRequest,
  SatisfactionScale,
  SubscriptionPlanTier,
  UserAccount,
  UserPermissions,
  UserRole,
} from '../src/types/churn.ts';
import {
  buildDefaultChurnDefinition,
  buildDefaultPrivacySettings,
  getDefaultRelationshipForIndustry,
  INDUSTRY_PROFILES,
} from '../src/utils/industryConfig.ts';
import { getSubscriptionPlanSpec } from '../src/utils/subscriptionPlans.ts';
import { ensurePgSchema, pgQuery, pgWithTransaction } from './database.ts';
import {
  getPersistenceStatus,
  isDiskPersistenceAllowed,
  isKvConfigured,
  isPostgresConfigured,
  remoteDeleteKey,
  remoteGetJson,
  remoteMGetJson,
  remoteSetAdd,
  remoteSetJson,
  remoteSetMembers,
} from './remoteStore.ts';

export interface StoredCompany {
  id: string;
  name: string;
  email: string;
  registrationNumber: string | null;
  logoDataUrl: string | null;
  industry?: IndustryKey;
  customIndustryName?: string | null;
  country?: string;
  businessType?: BusinessType;
  businessModel?: BusinessModel;
  customerRelationshipType?: CustomerRelationshipType;
  subscriptionPlan?: SubscriptionPlanTier;
  satisfactionScale?: SatisfactionScale;
  churnDefinition?: ChurnDefinition;
  privacySettings?: DataPrivacySettings;
  createdAt: string;
}

export interface StoredUser {
  id: string;
  companyId: string;
  fullName: string;
  email: string; // normalized lowercase
  passwordHash: string; // salt:scryptHex
  role: UserRole;
  isActive: boolean;
  avatarDataUrl: string | null;
  permissions: UserPermissions;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface StoredSession {
  tokenHash: string; // sha256 of opaque cookie token
  userId: string;
  companyId: string;
  rememberMe: boolean;
  createdAt: string;
  expiresAt: string;
}

interface AuthDatabase {
  companies: StoredCompany[];
  users: StoredUser[];
  sessions: StoredSession[];
}

export type AuthErrorCode =
  | 'ACCOUNT_ALREADY_EXISTS'
  | 'COMPANY_ALREADY_EXISTS'
  | 'ACCOUNT_NOT_FOUND'
  | 'INVALID_PASSWORD'
  | 'ACCOUNT_DEACTIVATED'
  | 'DATABASE_NOT_CONFIGURED'
  | 'VALIDATION_ERROR';

export class AuthServiceError extends Error {
  code: AuthErrorCode;
  statusCode: number;

  constructor(message: string, code: AuthErrorCode, statusCode = 400) {
    super(message);
    this.name = 'AuthServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface AuthContext {
  tokenHash: string;
  user: UserAccount;
  company: CompanyWorkspaceInfo;
  expiresAt: string;
  rememberMe: boolean;
}

function getLocalDataDir(): string | null {
  if (!isDiskPersistenceAllowed()) return null;
  const custom = (process.env.CHURNSIGHT_DATA_DIR || '').trim();
  return custom ? path.resolve(custom) : path.resolve(process.cwd(), '.data');
}

function getDbFilePath(): string | null {
  const dir = getLocalDataDir();
  return dir ? path.join(dir, 'churnsight_auth.json') : null;
}

const REMOTE_LEGACY_AUTH_KEY = 'churnsight:auth:v1';
const KV_CMP_IDS_KEY = 'churnsight:cmp_ids';
const KV_USR_IDS_KEY = 'churnsight:usr_ids';
const kvCompanyKey = (companyId: string) => `churnsight:cmp:${companyId}`;
const kvUserKey = (userId: string) => `churnsight:usr:${userId}`;
const kvSessionKey = (tokenHash: string) => `churnsight:sess:${tokenHash}`;
const kvEmailIndexKey = (emailLower: string) => `churnsight:idx:email:${emailLower}`;

const SESSION_SHORT_MS = 8 * 60 * 60 * 1000; // 8 hours
const SESSION_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_IMAGE_DATA_URL_LENGTH = 750_000; // ~550KB image limit

let lastDiskMtimeMs = 0;
let loadedDiskFile: string | null = null;
let db: AuthDatabase = loadDbFromDisk();
let lastRemoteHydratedAt = 0;
let pendingRemoteWrite: Promise<void> | null = null;

function sanitizeLoadedDb(parsed: Partial<AuthDatabase> | null | undefined): AuthDatabase {
  const now = Date.now();
  return {
    companies: Array.isArray(parsed?.companies) ? parsed.companies : [],
    users: Array.isArray(parsed?.users) ? parsed.users : [],
    sessions: Array.isArray(parsed?.sessions)
      ? parsed.sessions.filter((s) => new Date(s.expiresAt).getTime() > now)
      : [],
  };
}

function loadDbFromDisk(): AuthDatabase {
  const dbFile = getDbFilePath();
  if (!dbFile) {
    return { companies: [], users: [], sessions: [] };
  }
  try {
    if (fs.existsSync(dbFile)) {
      const stat = fs.statSync(dbFile);
      const raw = fs.readFileSync(dbFile, 'utf-8');
      if (!raw.trim()) {
        return { companies: [], users: [], sessions: [] };
      }
      const parsed = JSON.parse(raw) as Partial<AuthDatabase>;
      lastDiskMtimeMs = stat.mtimeMs;
      loadedDiskFile = dbFile;
      return sanitizeLoadedDb(parsed);
    }
  } catch (err) {
    console.error('Failed to read auth store from disk:', err);
  }
  return { companies: [], users: [], sessions: [] };
}

function syncDbFromDiskIfNewer(): void {
  if (isPostgresConfigured() || isKvConfigured()) return;
  const dbFile = getDbFilePath();
  if (!dbFile) return;
  try {
    if (!fs.existsSync(dbFile)) {
      if (loadedDiskFile && loadedDiskFile !== dbFile) {
        db = { companies: [], users: [], sessions: [] };
        lastDiskMtimeMs = 0;
        loadedDiskFile = dbFile;
      }
      return;
    }
    const stat = fs.statSync(dbFile);
    if (loadedDiskFile !== dbFile || stat.mtimeMs > lastDiskMtimeMs) {
      const raw = fs.readFileSync(dbFile, 'utf-8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw) as Partial<AuthDatabase>;
      db = sanitizeLoadedDb(parsed);
      lastDiskMtimeMs = stat.mtimeMs;
      loadedDiskFile = dbFile;
    }
  } catch (err) {
    console.error('Failed to sync auth store from disk:', err);
  }
}

export function assertPersistenceConfigured(): void {
  const status = getPersistenceStatus();
  if (!status.persistent) {
    throw new AuthServiceError(
      status.message,
      'DATABASE_NOT_CONFIGURED',
      503
    );
  }
}

function enqueueRemoteWrite(taskFn: () => Promise<void>): void {
  const prev = pendingRemoteWrite || Promise.resolve();
  const next = prev.catch(() => undefined).then(taskFn);
  pendingRemoteWrite = next;
}

function upsertCachedCompany(company: StoredCompany): void {
  const idx = db.companies.findIndex((c) => c.id === company.id);
  if (idx >= 0) db.companies[idx] = company;
  else db.companies.push(company);
}

function upsertCachedUser(user: StoredUser): void {
  const idx = db.users.findIndex((u) => u.id === user.id);
  if (idx >= 0) db.users[idx] = user;
  else db.users.push(user);
}

function upsertCachedSession(session: StoredSession): void {
  const idx = db.sessions.findIndex((s) => s.tokenHash === session.tokenHash);
  if (idx >= 0) db.sessions[idx] = session;
  else db.sessions.push(session);
}

function mapPgCompanyRow(r: Record<string, any>): StoredCompany {
  return {
    id: String(r.id),
    name: String(r.name),
    email: String(r.email),
    registrationNumber: r.registration_number ? String(r.registration_number) : null,
    logoDataUrl: r.logo_data_url ? String(r.logo_data_url) : null,
    industry: (r.industry || 'telecommunications') as IndustryKey,
    customIndustryName: r.custom_industry_name ? String(r.custom_industry_name) : null,
    country: r.country ? String(r.country) : 'Malaysia',
    businessType: (r.business_type || 'B2C') as BusinessType,
    businessModel: (r.business_model || 'Subscription / Recurring') as BusinessModel,
    customerRelationshipType: r.customer_relationship_type || undefined,
    subscriptionPlan: (r.subscription_plan || 'free_trial') as SubscriptionPlanTier,
    satisfactionScale: (r.satisfaction_scale || '1-5') as SatisfactionScale,
    churnDefinition: r.churn_definition || undefined,
    privacySettings: r.privacy_settings || undefined,
    createdAt:
      r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

function mapPgUserRow(r: Record<string, any>): StoredUser {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    fullName: String(r.full_name),
    email: normalizeEmail(String(r.email)),
    passwordHash: String(r.password_hash),
    role: String(r.role) as UserRole,
    isActive: Boolean(r.is_active),
    avatarDataUrl: r.avatar_data_url ? String(r.avatar_data_url) : null,
    permissions: r.permissions || { canUploadAndAnalyse: true, canGeneratePredictions: true },
    createdAt:
      r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    lastLoginAt: r.last_login_at
      ? r.last_login_at instanceof Date
        ? r.last_login_at.toISOString()
        : String(r.last_login_at)
      : null,
  };
}

function mapPgSessionRow(r: Record<string, any>): StoredSession {
  return {
    tokenHash: String(r.token_hash),
    userId: String(r.user_id),
    companyId: String(r.company_id),
    rememberMe: Boolean(r.remember_me),
    createdAt:
      r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    expiresAt:
      r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at),
  };
}

async function pgUpsertCompany(company: StoredCompany): Promise<void> {
  await pgQuery(
    `INSERT INTO companies (
      id, name, name_lower, email, registration_number, logo_data_url, industry,
      custom_industry_name, country, business_type, business_model, customer_relationship_type,
      subscription_plan, satisfaction_scale, churn_definition, privacy_settings, created_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      name_lower = EXCLUDED.name_lower,
      email = EXCLUDED.email,
      registration_number = EXCLUDED.registration_number,
      logo_data_url = EXCLUDED.logo_data_url,
      industry = EXCLUDED.industry,
      custom_industry_name = EXCLUDED.custom_industry_name,
      country = EXCLUDED.country,
      business_type = EXCLUDED.business_type,
      business_model = EXCLUDED.business_model,
      customer_relationship_type = EXCLUDED.customer_relationship_type,
      subscription_plan = EXCLUDED.subscription_plan,
      satisfaction_scale = EXCLUDED.satisfaction_scale,
      churn_definition = EXCLUDED.churn_definition,
      privacy_settings = EXCLUDED.privacy_settings`,
    [
      company.id,
      company.name,
      company.name.trim().toLowerCase(),
      company.email,
      company.registrationNumber,
      company.logoDataUrl,
      company.industry || 'telecommunications',
      company.customIndustryName ?? null,
      company.country || 'Malaysia',
      company.businessType || 'B2C',
      company.businessModel || 'Subscription / Recurring',
      company.customerRelationshipType ?? null,
      company.subscriptionPlan || 'free_trial',
      company.satisfactionScale || '1-5',
      company.churnDefinition ? JSON.stringify(company.churnDefinition) : null,
      company.privacySettings ? JSON.stringify(company.privacySettings) : null,
      company.createdAt,
    ]
  );
}

async function pgUpsertUser(user: StoredUser): Promise<void> {
  await pgQuery(
    `INSERT INTO users (
      id, company_id, full_name, email, email_lower, password_hash, role,
      is_active, avatar_data_url, permissions, created_at, last_login_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
    )
    ON CONFLICT (id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      email_lower = EXCLUDED.email_lower,
      password_hash = EXCLUDED.password_hash,
      role = EXCLUDED.role,
      is_active = EXCLUDED.is_active,
      avatar_data_url = EXCLUDED.avatar_data_url,
      permissions = EXCLUDED.permissions,
      last_login_at = EXCLUDED.last_login_at`,
    [
      user.id,
      user.companyId,
      user.fullName,
      user.email,
      normalizeEmail(user.email),
      user.passwordHash,
      user.role,
      user.isActive,
      user.avatarDataUrl,
      JSON.stringify(user.permissions),
      user.createdAt,
      user.lastLoginAt,
    ]
  );
}

async function kvPersistCompany(company: StoredCompany): Promise<void> {
  await Promise.all([
    remoteSetJson(kvCompanyKey(company.id), company),
    remoteSetAdd(KV_CMP_IDS_KEY, company.id),
  ]);
}

async function kvPersistUser(user: StoredUser): Promise<void> {
  await Promise.all([
    remoteSetJson(kvUserKey(user.id), user),
    remoteSetAdd(KV_USR_IDS_KEY, user.id),
    remoteSetJson(kvEmailIndexKey(normalizeEmail(user.email)), user.id),
  ]);
}

async function kvPersistSession(session: StoredSession): Promise<void> {
  const ttlSec = Math.max(60, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
  await remoteSetJson(kvSessionKey(session.tokenHash), session, ttlSec);
}

async function hydrateFromPostgres(): Promise<void> {
  await ensurePgSchema();
  const [cmpRes, usrRes, sessRes] = await Promise.all([
    pgQuery('SELECT * FROM companies ORDER BY created_at ASC'),
    pgQuery('SELECT * FROM users ORDER BY created_at ASC'),
    pgQuery('SELECT * FROM sessions WHERE expires_at > NOW()'),
  ]);
  db = {
    companies: cmpRes.rows.map(mapPgCompanyRow),
    users: usrRes.rows.map(mapPgUserRow),
    sessions: sessRes.rows.map(mapPgSessionRow),
  };
  lastRemoteHydratedAt = Date.now();
}

async function hydrateFromKv(): Promise<void> {
  const [cmpIds, usrIds] = await Promise.all([
    remoteSetMembers(KV_CMP_IDS_KEY),
    remoteSetMembers(KV_USR_IDS_KEY),
  ]);

  if (cmpIds.length === 0 && usrIds.length === 0) {
    // Seamless read migration from legacy single-key KV blob if present
    const legacy = await remoteGetJson<Partial<AuthDatabase>>(REMOTE_LEGACY_AUTH_KEY);
    if (legacy && ((legacy.companies?.length || 0) > 0 || (legacy.users?.length || 0) > 0)) {
      const cleaned = sanitizeLoadedDb(legacy);
      db = cleaned;
      await Promise.all([
        ...cleaned.companies.map(kvPersistCompany),
        ...cleaned.users.map(kvPersistUser),
        ...cleaned.sessions.map(kvPersistSession),
      ]);
      lastRemoteHydratedAt = Date.now();
      return;
    }
  }

  const [companiesRaw, usersRaw] = await Promise.all([
    cmpIds.length > 0 ? remoteMGetJson<StoredCompany>(cmpIds.map(kvCompanyKey)) : Promise.resolve([]),
    usrIds.length > 0 ? remoteMGetJson<StoredUser>(usrIds.map(kvUserKey)) : Promise.resolve([]),
  ]);

  const companies = companiesRaw.filter((c): c is StoredCompany => Boolean(c));
  const users = usersRaw.filter((u): u is StoredUser => Boolean(u));

  // Keep valid in-memory sessions and merge cleanly
  const now = Date.now();
  const validExistingSessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);

  db = {
    companies,
    users,
    sessions: validExistingSessions,
  };
  lastRemoteHydratedAt = Date.now();
}

export async function ensureAuthHydrated(force = false): Promise<void> {
  if (isPostgresConfigured()) {
    const stale = Date.now() - lastRemoteHydratedAt > 2000;
    if (!force && !stale && db.users.length > 0) return;
    if (pendingRemoteWrite) {
      await pendingRemoteWrite;
    }
    await hydrateFromPostgres();
    return;
  }

  if (isKvConfigured()) {
    const stale = Date.now() - lastRemoteHydratedAt > 2000;
    if (!force && !stale && db.users.length > 0) return;
    if (pendingRemoteWrite) {
      await pendingRemoteWrite;
    }
    await hydrateFromKv();
    return;
  }

  syncDbFromDiskIfNewer();
}

/**
 * Direct session lookup across serverless instances by SHA-256 token hash.
 * Ensures a session created on Instance A is immediately recognized on Instance B.
 */
export async function hydrateSessionByToken(rawToken: string | undefined): Promise<AuthContext | null> {
  if (!rawToken) return null;
  const tokenHash = hashSessionToken(rawToken);

  if (isPostgresConfigured()) {
    if (pendingRemoteWrite) {
      await pendingRemoteWrite;
    }
    await ensurePgSchema();
    const res = await pgQuery(
      `SELECT
         s.token_hash, s.user_id, s.company_id, s.remember_me, s.created_at AS s_created_at, s.expires_at,
         u.full_name, u.email AS u_email, u.password_hash, u.role, u.is_active, u.avatar_data_url, u.permissions, u.created_at AS u_created_at, u.last_login_at,
         c.name AS c_name, c.email AS c_email, c.registration_number, c.logo_data_url, c.industry, c.custom_industry_name,
         c.country, c.business_type, c.business_model, c.customer_relationship_type, c.subscription_plan,
         c.satisfaction_scale, c.churn_definition, c.privacy_settings, c.created_at AS c_created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id AND u.company_id = s.company_id
       JOIN companies c ON c.id = s.company_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.is_active = TRUE
       LIMIT 1`,
      [tokenHash]
    );
    if (res.rows.length === 0) {
      db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
      return null;
    }
    const r = res.rows[0];
    const company = mapPgCompanyRow({
      id: r.company_id,
      name: r.c_name,
      email: r.c_email,
      registration_number: r.registration_number,
      logo_data_url: r.logo_data_url,
      industry: r.industry,
      custom_industry_name: r.custom_industry_name,
      country: r.country,
      business_type: r.business_type,
      business_model: r.business_model,
      customer_relationship_type: r.customer_relationship_type,
      subscription_plan: r.subscription_plan,
      satisfaction_scale: r.satisfaction_scale,
      churn_definition: r.churn_definition,
      privacy_settings: r.privacy_settings,
      created_at: r.c_created_at,
    });
    const user = mapPgUserRow({
      id: r.user_id,
      company_id: r.company_id,
      full_name: r.full_name,
      email: r.u_email,
      password_hash: r.password_hash,
      role: r.role,
      is_active: r.is_active,
      avatar_data_url: r.avatar_data_url,
      permissions: r.permissions,
      created_at: r.u_created_at,
      last_login_at: r.last_login_at,
    });
    const session = mapPgSessionRow({
      token_hash: r.token_hash,
      user_id: r.user_id,
      company_id: r.company_id,
      remember_me: r.remember_me,
      created_at: r.s_created_at,
      expires_at: r.expires_at,
    });
    upsertCachedCompany(company);
    upsertCachedUser(user);
    upsertCachedSession(session);
    return {
      tokenHash,
      user: toPublicUser(user),
      company: toPublicCompany(company),
      expiresAt: session.expiresAt,
      rememberMe: session.rememberMe,
    };
  }

  if (isKvConfigured()) {
    if (pendingRemoteWrite) {
      await pendingRemoteWrite;
    }
    const sess = await remoteGetJson<StoredSession>(kvSessionKey(tokenHash));
    if (!sess || new Date(sess.expiresAt).getTime() <= Date.now()) {
      // Fallback to legacy blob check in case session existed before upgrade
      const legacy = await remoteGetJson<Partial<AuthDatabase>>(REMOTE_LEGACY_AUTH_KEY);
      const legacySess = legacy?.sessions?.find((s) => s.tokenHash === tokenHash);
      if (legacySess && new Date(legacySess.expiresAt).getTime() > Date.now()) {
        const legacyUser = legacy?.users?.find((u) => u.id === legacySess.userId);
        const legacyCmp = legacy?.companies?.find((c) => c.id === legacySess.companyId);
        if (legacyUser && legacyCmp && legacyUser.isActive) {
          upsertCachedCompany(legacyCmp);
          upsertCachedUser(legacyUser);
          upsertCachedSession(legacySess);
          await Promise.all([
            kvPersistCompany(legacyCmp),
            kvPersistUser(legacyUser),
            kvPersistSession(legacySess),
          ]);
          return {
            tokenHash,
            user: toPublicUser(legacyUser),
            company: toPublicCompany(legacyCmp),
            expiresAt: legacySess.expiresAt,
            rememberMe: Boolean(legacySess.rememberMe),
          };
        }
      }
      db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
      return null;
    }

    const [user, company] = await Promise.all([
      remoteGetJson<StoredUser>(kvUserKey(sess.userId)),
      remoteGetJson<StoredCompany>(kvCompanyKey(sess.companyId)),
    ]);
    if (!user || !company || !user.isActive) {
      await remoteDeleteKey(kvSessionKey(tokenHash)).catch(() => undefined);
      db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
      return null;
    }
    upsertCachedCompany(company);
    upsertCachedUser(user);
    upsertCachedSession(sess);
    return {
      tokenHash,
      user: toPublicUser(user),
      company: toPublicCompany(company),
      expiresAt: sess.expiresAt,
      rememberMe: Boolean(sess.rememberMe),
    };
  }

  syncDbFromDiskIfNewer();
  return getSessionContext(rawToken);
}

export async function flushPendingAuthWrites(): Promise<void> {
  if (pendingRemoteWrite) {
    const current = pendingRemoteWrite;
    try {
      await current;
    } finally {
      if (pendingRemoteWrite === current) {
        pendingRemoteWrite = null;
      }
    }
  }
}

function saveDbToDiskOnly(): void {
  const dir = getLocalDataDir();
  const dbFile = getDbFilePath();
  if (!dir || !dbFile) return;
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpFile = `${dbFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmpFile, dbFile);
    lastDiskMtimeMs = fs.statSync(dbFile).mtimeMs;
    loadedDiskFile = dbFile;
  } catch (err) {
    console.error('Failed to persist auth store to local disk:', err);
  }
}

function persistDiskIfLocal(): void {
  if (!isPostgresConfigured() && !isKvConfigured()) {
    saveDbToDiskOnly();
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePasswordStrength(password: string): string | null {
  if (!password || typeof password !== 'string') {
    return 'Password is required.';
  }
  if (password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (password.length > 128) {
    return 'Password must be 128 characters or fewer.';
  }
  return null;
}

export function validateImageDataUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error('Invalid image payload.');
  }
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    throw new Error('Image must be a valid PNG, JPG, WEBP, or GIF file.');
  }
  if (value.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error('Image file is too large. Please upload an image under 500 KB.');
  }
  return value;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function isPlatformOwnerEmail(email: string): boolean {
  const envRaw = process.env.PLATFORM_OWNER_EMAIL || '';
  if (!envRaw.trim()) return false;
  const allowed = envRaw
    .split(',')
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
  return allowed.includes(normalizeEmail(email));
}

function resolveEffectiveRole(u: StoredUser): UserRole {
  if (isPlatformOwnerEmail(u.email)) return 'PLATFORM_OWNER';
  return u.role;
}

function toPublicUser(u: StoredUser): UserAccount {
  const effectiveRole = resolveEffectiveRole(u);
  return {
    id: u.id,
    companyId: u.companyId,
    fullName: u.fullName,
    email: u.email,
    role: effectiveRole,
    isActive: u.isActive,
    avatarDataUrl: u.avatarDataUrl,
    permissions:
      effectiveRole === 'FIRM_ADMIN' || effectiveRole === 'PLATFORM_OWNER'
        ? { canUploadAndAnalyse: true, canGeneratePredictions: true }
        : { ...u.permissions },
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}

function toPublicCompany(c: StoredCompany): CompanyWorkspaceInfo {
  const industry: IndustryKey =
    c.industry && INDUSTRY_PROFILES[c.industry] ? c.industry : 'telecommunications';
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    registrationNumber: c.registrationNumber,
    logoDataUrl: c.logoDataUrl,
    industry,
    customIndustryName: c.customIndustryName ?? null,
    country: c.country || 'Malaysia',
    businessType: c.businessType || 'B2C',
    businessModel: c.businessModel || 'Subscription / Recurring',
    customerRelationshipType:
      c.customerRelationshipType || getDefaultRelationshipForIndustry(industry),
    subscriptionPlan: c.subscriptionPlan || 'professional',
    satisfactionScale: c.satisfactionScale || '1-5',
    churnDefinition: c.churnDefinition || buildDefaultChurnDefinition(industry),
    privacySettings: c.privacySettings || buildDefaultPrivacySettings(),
    createdAt: c.createdAt,
  };
}

function pruneExpiredSessionsInMemory(): void {
  const now = Date.now();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
  if (db.sessions.length !== before) {
    persistDiskIfLocal();
  }
}

export function registerCompanyAndAdmin(input: RegisterCompanyRequest): {
  company: CompanyWorkspaceInfo;
  user: UserAccount;
} {
  assertPersistenceConfigured();

  const companyName = (input.companyName || '').trim();
  const companyEmail = normalizeEmail(input.companyEmail || '');
  const registrationNumber = (input.registrationNumber || '').trim() || null;
  const industry: IndustryKey =
    input.industry && INDUSTRY_PROFILES[input.industry] ? input.industry : 'telecommunications';
  const customIndustryName =
    industry === 'other' ? (input.customIndustryName || '').trim() || null : null;
  const country = (input.country || '').trim() || 'Malaysia';
  const businessType: BusinessType = input.businessType || 'B2C';
  const businessModel: BusinessModel = input.businessModel || 'Subscription / Recurring';
  const customerRelationshipType: CustomerRelationshipType =
    input.customerRelationshipType || getDefaultRelationshipForIndustry(industry);

  const adminFullName = (input.adminFullName || '').trim();
  const adminEmail = normalizeEmail(input.adminEmail || '');
  const password = input.password || '';
  const confirmPassword = input.confirmPassword || '';

  if (companyName.length < 2) {
    throw new Error('Company name must be at least 2 characters long.');
  }
  if (!isValidEmail(companyEmail)) {
    throw new Error('Please provide a valid company email address.');
  }
  if (industry === 'other' && !customIndustryName) {
    throw new Error('Please specify your custom industry name.');
  }
  if (adminFullName.length < 2) {
    throw new Error('Administrator full name must be at least 2 characters long.');
  }
  if (!isValidEmail(adminEmail)) {
    throw new Error('Please provide a valid administrator email address.');
  }

  const pwError = validatePasswordStrength(password);
  if (pwError) {
    throw new Error(pwError);
  }
  if (password !== confirmPassword) {
    throw new Error('Password and confirmation password do not match.');
  }

  syncDbFromDiskIfNewer();

  if (
    db.users.some(
      (u) => normalizeEmail(u.email) === adminEmail || normalizeEmail(u.email) === companyEmail
    ) ||
    db.companies.some(
      (c) => normalizeEmail(c.email) === companyEmail || normalizeEmail(c.email) === adminEmail
    )
  ) {
    throw new AuthServiceError(
      'This email is already registered. Please log in.',
      'ACCOUNT_ALREADY_EXISTS',
      409
    );
  }
  if (db.companies.some((c) => c.name.trim().toLowerCase() === companyName.toLowerCase())) {
    throw new AuthServiceError(
      'A company workspace with this name is already registered.',
      'COMPANY_ALREADY_EXISTS',
      409
    );
  }

  const now = new Date().toISOString();
  const company: StoredCompany = {
    id: `cmp_${crypto.randomUUID()}`,
    name: companyName,
    email: companyEmail,
    registrationNumber,
    logoDataUrl: null,
    industry,
    customIndustryName,
    country,
    businessType,
    businessModel,
    customerRelationshipType,
    subscriptionPlan: 'free_trial',
    satisfactionScale: '1-5',
    churnDefinition: buildDefaultChurnDefinition(industry),
    privacySettings: buildDefaultPrivacySettings(),
    createdAt: now,
  };

  const adminUser: StoredUser = {
    id: `usr_${crypto.randomUUID()}`,
    companyId: company.id,
    fullName: adminFullName,
    email: adminEmail,
    passwordHash: hashPassword(password),
    role: 'FIRM_ADMIN',
    isActive: true,
    avatarDataUrl: null,
    permissions: { canUploadAndAnalyse: true, canGeneratePredictions: true },
    createdAt: now,
    lastLoginAt: null,
  };

  db.companies.push(company);
  db.users.push(adminUser);
  persistDiskIfLocal();

  if (isPostgresConfigured()) {
    enqueueRemoteWrite(async () => {
      await pgWithTransaction(async (client) => {
        await client.query(
          `INSERT INTO companies (
            id, name, name_lower, email, registration_number, logo_data_url, industry,
            custom_industry_name, country, business_type, business_model, customer_relationship_type,
            subscription_plan, satisfaction_scale, churn_definition, privacy_settings, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            company.id,
            company.name,
            company.name.trim().toLowerCase(),
            company.email,
            company.registrationNumber,
            company.logoDataUrl,
            company.industry,
            company.customIndustryName ?? null,
            company.country,
            company.businessType,
            company.businessModel,
            company.customerRelationshipType ?? null,
            company.subscriptionPlan,
            company.satisfactionScale,
            JSON.stringify(company.churnDefinition),
            JSON.stringify(company.privacySettings),
            company.createdAt,
          ]
        );
        await client.query(
          `INSERT INTO users (
            id, company_id, full_name, email, email_lower, password_hash, role,
            is_active, avatar_data_url, permissions, created_at, last_login_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            adminUser.id,
            adminUser.companyId,
            adminUser.fullName,
            adminUser.email,
            normalizeEmail(adminUser.email),
            adminUser.passwordHash,
            adminUser.role,
            adminUser.isActive,
            adminUser.avatarDataUrl,
            JSON.stringify(adminUser.permissions),
            adminUser.createdAt,
            adminUser.lastLoginAt,
          ]
        );
      });
      lastRemoteHydratedAt = Date.now();
    });
  } else if (isKvConfigured()) {
    enqueueRemoteWrite(async () => {
      await Promise.all([kvPersistCompany(company), kvPersistUser(adminUser)]);
      lastRemoteHydratedAt = Date.now();
    });
  }

  return {
    company: toPublicCompany(company),
    user: toPublicUser(adminUser),
  };
}

export function hasAnyRegisteredUsers(): boolean {
  syncDbFromDiskIfNewer();
  return db.users.length > 0;
}

function issueSessionForStoredUser(
  user: StoredUser,
  company: StoredCompany,
  rememberMe: boolean
): {
  rawToken: string;
  rememberMe: boolean;
  maxAgeSeconds: number | null;
  context: AuthContext;
} {
  pruneExpiredSessionsInMemory();

  const nowMs = Date.now();
  const ttlMs = rememberMe ? SESSION_REMEMBER_MS : SESSION_SHORT_MS;
  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  user.lastLoginAt = new Date(nowMs).toISOString();

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  const newSession: StoredSession = {
    tokenHash,
    userId: user.id,
    companyId: company.id,
    rememberMe,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt,
  };

  db.sessions.push(newSession);
  persistDiskIfLocal();

  if (isPostgresConfigured()) {
    enqueueRemoteWrite(async () => {
      await pgWithTransaction(async (client) => {
        await client.query(`UPDATE users SET last_login_at = $1 WHERE id = $2`, [
          user.lastLoginAt,
          user.id,
        ]);
        await client.query(
          `INSERT INTO sessions (token_hash, user_id, company_id, remember_me, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            newSession.tokenHash,
            newSession.userId,
            newSession.companyId,
            newSession.rememberMe,
            newSession.createdAt,
            newSession.expiresAt,
          ]
        );
        await client.query(`DELETE FROM sessions WHERE expires_at <= NOW()`);
      });
    });
  } else if (isKvConfigured()) {
    enqueueRemoteWrite(async () => {
      await Promise.all([kvPersistUser(user), kvPersistSession(newSession)]);
    });
  }

  return {
    rawToken,
    rememberMe,
    maxAgeSeconds: rememberMe ? Math.floor(SESSION_REMEMBER_MS / 1000) : null,
    context: {
      tokenHash,
      user: toPublicUser(user),
      company: toPublicCompany(company),
      expiresAt,
      rememberMe,
    },
  };
}

export function createSessionForUser(
  userId: string,
  rememberMe = true
): {
  rawToken: string;
  rememberMe: boolean;
  maxAgeSeconds: number | null;
  context: AuthContext;
} {
  assertPersistenceConfigured();
  syncDbFromDiskIfNewer();
  const user = db.users.find((u) => u.id === userId);
  if (!user || !user.isActive) {
    throw new Error('User account is unavailable.');
  }
  const company = db.companies.find((c) => c.id === user.companyId);
  if (!company) {
    throw new Error('Associated company workspace was not found.');
  }
  return issueSessionForStoredUser(user, company, rememberMe);
}

export function authenticateUser(input: LoginRequest): {
  rawToken: string;
  rememberMe: boolean;
  maxAgeSeconds: number | null;
  context: AuthContext;
} {
  assertPersistenceConfigured();
  syncDbFromDiskIfNewer();
  pruneExpiredSessionsInMemory();

  const email = normalizeEmail(input.email || '');
  const password = input.password || '';
  const rememberMe = input.rememberMe !== undefined ? Boolean(input.rememberMe) : true;

  if (!isValidEmail(email)) {
    throw new AuthServiceError('Please enter a valid email address.', 'VALIDATION_ERROR', 400);
  }
  if (!password) {
    throw new AuthServiceError('Please enter your password.', 'VALIDATION_ERROR', 400);
  }

  const user = db.users.find((u) => normalizeEmail(u.email) === email);
  if (!user) {
    throw new AuthServiceError(
      'Account not found. Please register first.',
      'ACCOUNT_NOT_FOUND',
      401
    );
  }
  if (!verifyPassword(password, user.passwordHash)) {
    throw new AuthServiceError(
      'Incorrect password. Please check your password and try again.',
      'INVALID_PASSWORD',
      401
    );
  }

  if (!user.isActive) {
    throw new AuthServiceError(
      'This account has been deactivated. Please contact your company administrator.',
      'ACCOUNT_DEACTIVATED',
      403
    );
  }

  const company = db.companies.find((c) => c.id === user.companyId);
  if (!company) {
    throw new AuthServiceError(
      'Associated company workspace was not found.',
      'ACCOUNT_NOT_FOUND',
      401
    );
  }

  return issueSessionForStoredUser(user, company, rememberMe);
}

const REMEMBER_SLIDING_THRESHOLD_MS = 25 * 24 * 60 * 60 * 1000;
const SHORT_SLIDING_THRESHOLD_MS = 4 * 60 * 60 * 1000;

export function getSessionContext(rawToken: string | undefined): AuthContext | null {
  syncDbFromDiskIfNewer();
  if (!rawToken) return null;
  const tokenHash = hashSessionToken(rawToken);
  const session = db.sessions.find((s) => s.tokenHash === tokenHash);
  if (!session) return null;

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
    persistDiskIfLocal();
    return null;
  }

  const user = db.users.find((u) => u.id === session.userId && u.companyId === session.companyId);
  const company = db.companies.find((c) => c.id === session.companyId);
  if (!user || !company || !user.isActive) {
    db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
    persistDiskIfLocal();
    return null;
  }

  return {
    tokenHash,
    user: toPublicUser(user),
    company: toPublicCompany(company),
    expiresAt: session.expiresAt,
    rememberMe: Boolean(session.rememberMe),
  };
}

export function refreshSessionIfNeeded(
  rawToken: string | undefined,
  forceExtend = false
): {
  refreshed: boolean;
  maxAgeSeconds: number | null;
  context: AuthContext;
} | null {
  syncDbFromDiskIfNewer();
  if (!rawToken) return null;
  const tokenHash = hashSessionToken(rawToken);
  const session = db.sessions.find((s) => s.tokenHash === tokenHash);
  if (!session) return null;

  const nowMs = Date.now();
  const expiresMs = new Date(session.expiresAt).getTime();
  if (expiresMs <= nowMs) {
    db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
    persistDiskIfLocal();
    if (isPostgresConfigured()) {
      enqueueRemoteWrite(() => pgQuery(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]).then(() => undefined));
    } else if (isKvConfigured()) {
      enqueueRemoteWrite(() => remoteDeleteKey(kvSessionKey(tokenHash)));
    }
    return null;
  }

  const user = db.users.find((u) => u.id === session.userId && u.companyId === session.companyId);
  const company = db.companies.find((c) => c.id === session.companyId);
  if (!user || !company || !user.isActive) {
    db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
    persistDiskIfLocal();
    return null;
  }

  const remainingMs = expiresMs - nowMs;
  const thresholdMs = session.rememberMe
    ? REMEMBER_SLIDING_THRESHOLD_MS
    : SHORT_SLIDING_THRESHOLD_MS;
  const ttlMs = session.rememberMe ? SESSION_REMEMBER_MS : SESSION_SHORT_MS;

  let refreshed = false;
  if (forceExtend || remainingMs < thresholdMs) {
    session.expiresAt = new Date(nowMs + ttlMs).toISOString();
    persistDiskIfLocal();
    if (isPostgresConfigured()) {
      enqueueRemoteWrite(() =>
        pgQuery(`UPDATE sessions SET expires_at = $1 WHERE token_hash = $2`, [
          session.expiresAt,
          tokenHash,
        ]).then(() => undefined)
      );
    } else if (isKvConfigured()) {
      enqueueRemoteWrite(() => kvPersistSession(session));
    }
    refreshed = true;
  }

  return {
    refreshed,
    maxAgeSeconds: session.rememberMe ? Math.floor(SESSION_REMEMBER_MS / 1000) : null,
    context: {
      tokenHash,
      user: toPublicUser(user),
      company: toPublicCompany(company),
      expiresAt: session.expiresAt,
      rememberMe: Boolean(session.rememberMe),
    },
  };
}

export function revokeSession(rawToken: string | undefined): void {
  if (!rawToken) return;
  const tokenHash = hashSessionToken(rawToken);
  db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
  persistDiskIfLocal();

  if (isPostgresConfigured()) {
    enqueueRemoteWrite(() =>
      pgQuery(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]).then(() => undefined)
    );
  } else if (isKvConfigured()) {
    enqueueRemoteWrite(() => remoteDeleteKey(kvSessionKey(tokenHash)));
  }
}

export function revokeUserSessions(userId: string, exceptTokenHash?: string): void {
  const removedHashes = db.sessions
    .filter((s) => s.userId === userId && (!exceptTokenHash || s.tokenHash !== exceptTokenHash))
    .map((s) => s.tokenHash);
  db.sessions = db.sessions.filter(
    (s) => s.userId !== userId || (exceptTokenHash && s.tokenHash === exceptTokenHash)
  );
  persistDiskIfLocal();

  if (isPostgresConfigured()) {
    enqueueRemoteWrite(async () => {
      if (exceptTokenHash) {
        await pgQuery(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, [
          userId,
          exceptTokenHash,
        ]);
      } else {
        await pgQuery(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
      }
    });
  } else if (isKvConfigured() && removedHashes.length > 0) {
    enqueueRemoteWrite(async () => {
      await Promise.all(removedHashes.map((h) => remoteDeleteKey(kvSessionKey(h))));
    });
  }
}

export function checkEmailRegisteredForReset(emailInput: string): boolean {
  assertPersistenceConfigured();
  syncDbFromDiskIfNewer();
  const email = normalizeEmail(emailInput || '');
  if (!isValidEmail(email)) {
    throw new Error('Please enter a valid email address.');
  }
  return db.users.some((u) => normalizeEmail(u.email) === email);
}

export function updateOwnProfile(
  userId: string,
  updates: { fullName?: string; avatarDataUrl?: string | null }
): UserAccount {
  assertPersistenceConfigured();
  syncDbFromDiskIfNewer();
  const user = db.users.find((u) => u.id === userId);
  if (!user) throw new Error('User account not found.');

  if (updates.fullName !== undefined) {
    const trimmed = updates.fullName.trim();
    if (trimmed.length < 2) {
      throw new Error('Full name must be at least 2 characters long.');
    }
    user.fullName = trimmed;
  }

  if (updates.avatarDataUrl !== undefined) {
    user.avatarDataUrl = validateImageDataUrl(updates.avatarDataUrl);
  }

  persistDiskIfLocal();
  if (isPostgresConfigured()) {
    enqueueRemoteWrite(() => pgUpsertUser(user));
  } else if (isKvConfigured()) {
    enqueueRemoteWrite(() => kvPersistUser(user));
  }
  return toPublicUser(user);
}

export function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  confirmNewPassword: string,
  currentTokenHash?: string
): void {
  assertPersistenceConfigured();
  syncDbFromDiskIfNewer();
  const user = db.users.find((u) => u.id === userId);
  if (!user) throw new Error('User account not found.');

  if (!currentPassword) {
    throw new Error('Current password is required.');
  }
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    throw new Error('Current password is incorrect.');
  }

  const pwError = validatePasswordStrength(newPassword);
  if (pwError) {
    throw new Error(pwError);
  }
  if (newPassword !== confirmNewPassword) {
    throw new Error('New password and confirmation password do not match.');
  }
  if (newPassword === currentPassword) {
    throw new Error('New password must be different from your current password.');
  }

  user.passwordHash = hashPassword(newPassword);
  persistDiskIfLocal();

  if (isPostgresConfigured()) {
    enqueueRemoteWrite(() => pgUpsertUser(user));
  } else if (isKvConfigured()) {
    enqueueRemoteWrite(() => kvPersistUser(user));
  }
  revokeUserSessions(userId, currentTokenHash);
}

export function updateCompanyProfile(
  companyId: string,
  updates: {
    name?: string;
    email?: string;
    registrationNumber?: string | null;
    logoDataUrl?: string | null;
    industry?: IndustryKey;
    customIndustryName?: string | null;
    country?: string;
    businessType?: BusinessType;
    businessModel?: BusinessModel;
    customerRelationshipType?: CustomerRelationshipType;
    subscriptionPlan?: SubscriptionPlanTier;
    satisfactionScale?: SatisfactionScale;
    churnDefinition?: ChurnDefinition;
    privacySettings?: Partial<DataPrivacySettings>;
  }
): CompanyWorkspaceInfo {
  assertPersistenceConfigured();
  syncDbFromDiskIfNewer();
  const company = db.companies.find((c) => c.id === companyId);
  if (!company) throw new Error('Company workspace not found.');

  if (updates.name !== undefined) {
    const trimmed = updates.name.trim();
    if (trimmed.length < 2) {
      throw new Error('Company name must be at least 2 characters long.');
    }
    const conflict = db.companies.some(
      (c) => c.id !== companyId && c.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (conflict) {
      throw new Error('Another company workspace already uses that name.');
    }
    company.name = trimmed;
  }

  if (updates.email !== undefined) {
    const norm = normalizeEmail(updates.email);
    if (!isValidEmail(norm)) {
      throw new Error('Please provide a valid company email address.');
    }
    const conflict = db.companies.some((c) => c.id !== companyId && c.email === norm);
    if (conflict) {
      throw new Error('Another company workspace already uses that email.');
    }
    company.email = norm;
  }

  if (updates.registrationNumber !== undefined) {
    company.registrationNumber = updates.registrationNumber
      ? updates.registrationNumber.trim() || null
      : null;
  }

  if (updates.logoDataUrl !== undefined) {
    company.logoDataUrl = validateImageDataUrl(updates.logoDataUrl);
  }

  if (updates.industry !== undefined && INDUSTRY_PROFILES[updates.industry]) {
    company.industry = updates.industry;
    if (updates.industry !== 'other') {
      company.customIndustryName = null;
    }
  }

  if (updates.customIndustryName !== undefined) {
    company.customIndustryName = updates.customIndustryName
      ? updates.customIndustryName.trim() || null
      : null;
  }

  if (updates.country !== undefined) {
    const cTrim = updates.country.trim();
    if (cTrim) company.country = cTrim;
  }

  if (updates.businessType !== undefined) {
    company.businessType = updates.businessType;
  }

  if (updates.businessModel !== undefined) {
    company.businessModel = updates.businessModel;
  }

  if (updates.customerRelationshipType !== undefined) {
    company.customerRelationshipType = updates.customerRelationshipType;
  }

  if (updates.subscriptionPlan !== undefined) {
    company.subscriptionPlan = updates.subscriptionPlan;
  }

  if (updates.satisfactionScale !== undefined) {
    company.satisfactionScale = updates.satisfactionScale;
  }

  if (updates.churnDefinition !== undefined) {
    company.churnDefinition = {
      ...updates.churnDefinition,
      confirmedAt: updates.churnDefinition.confirmedByUser
        ? updates.churnDefinition.confirmedAt || new Date().toISOString()
        : null,
    };
  }

  if (updates.privacySettings !== undefined) {
    const basePrivacy = company.privacySettings || buildDefaultPrivacySettings();
    const allowShared =
      updates.privacySettings.allowSharedModelContribution !== undefined
        ? Boolean(updates.privacySettings.allowSharedModelContribution)
        : basePrivacy.allowSharedModelContribution;
    const optInBaseline =
      updates.privacySettings.optInCrossCompanyBaseline !== undefined
        ? Boolean(updates.privacySettings.optInCrossCompanyBaseline)
        : basePrivacy.optInCrossCompanyBaseline;

    company.privacySettings = {
      ...basePrivacy,
      allowSharedModelContribution: allowShared,
      optInCrossCompanyBaseline: optInBaseline,
      crossCompanyValidationStatus:
        allowShared || optInBaseline
          ? 'unvalidated_architecture_only'
          : 'awaiting_opt_in_and_validation',
      consentUpdatedAt: new Date().toISOString(),
    };
  }

  persistDiskIfLocal();
  if (isPostgresConfigured()) {
    enqueueRemoteWrite(() => pgUpsertCompany(company));
  } else if (isKvConfigured()) {
    enqueueRemoteWrite(() => kvPersistCompany(company));
  }
  return toPublicCompany(company);
}

export function getCompanyById(companyId: string): CompanyWorkspaceInfo | null {
  syncDbFromDiskIfNewer();
  const company = db.companies.find((c) => c.id === companyId);
  return company ? toPublicCompany(company) : null;
}

export function listAllCompanies(): CompanyWorkspaceInfo[] {
  syncDbFromDiskIfNewer();
  return db.companies.map(toPublicCompany).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function listCompanyUsers(companyId: string): UserAccount[] {
  syncDbFromDiskIfNewer();
  return db.users
    .filter((u) => u.companyId === companyId)
    .map(toPublicUser)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function createCompanyUser(
  companyId: string,
  input: {
    fullName: string;
    email: string;
    password: string;
    role: UserRole;
    permissions?: Partial<UserPermissions>;
  }
): UserAccount {
  assertPersistenceConfigured();
  syncDbFromDiskIfNewer();
  const company = db.companies.find((c) => c.id === companyId);
  if (!company) {
    throw new Error('Company workspace not found.');
  }

  const planSpec = getSubscriptionPlanSpec(company.subscriptionPlan);
  const existingUsers = db.users.filter((u) => u.companyId === companyId);
  if (existingUsers.length >= planSpec.maxUsers) {
    throw new Error(
      `User limit reached (${existingUsers.length}/${planSpec.maxUsers} users on ${planSpec.name} plan). Upgrade the workspace subscription plan to invite more team members.`
    );
  }

  const fullName = (input.fullName || '').trim();
  const email = normalizeEmail(input.email || '');
  const password = input.password || '';
  const role: UserRole = input.role === 'FIRM_ADMIN' ? 'FIRM_ADMIN' : 'ANALYST';

  if (fullName.length < 2) {
    throw new Error('Full name must be at least 2 characters long.');
  }
  if (!isValidEmail(email)) {
    throw new Error('Please enter a valid email address.');
  }
  const pwError = validatePasswordStrength(password);
  if (pwError) {
    throw new Error(pwError);
  }
  if (db.users.some((u) => normalizeEmail(u.email) === email)) {
    throw new Error('An account with this email address already exists.');
  }

  const permissions: UserPermissions =
    role === 'FIRM_ADMIN'
      ? { canUploadAndAnalyse: true, canGeneratePredictions: true }
      : {
          canUploadAndAnalyse:
            input.permissions?.canUploadAndAnalyse !== undefined
              ? Boolean(input.permissions.canUploadAndAnalyse)
              : true,
          canGeneratePredictions:
            input.permissions?.canGeneratePredictions !== undefined
              ? Boolean(input.permissions.canGeneratePredictions)
              : true,
        };

  const user: StoredUser = {
    id: `usr_${crypto.randomUUID()}`,
    companyId,
    fullName,
    email,
    passwordHash: hashPassword(password),
    role,
    isActive: true,
    avatarDataUrl: null,
    permissions,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };

  db.users.push(user);
  persistDiskIfLocal();
  if (isPostgresConfigured()) {
    enqueueRemoteWrite(() => pgUpsertUser(user));
  } else if (isKvConfigured()) {
    enqueueRemoteWrite(() => kvPersistUser(user));
  }
  return toPublicUser(user);
}

export function updateCompanyUser(
  companyId: string,
  actingUserId: string,
  targetUserId: string,
  updates: {
    role?: UserRole;
    isActive?: boolean;
    permissions?: Partial<UserPermissions>;
    newPassword?: string;
  }
): UserAccount {
  assertPersistenceConfigured();
  syncDbFromDiskIfNewer();
  const user = db.users.find((u) => u.id === targetUserId && u.companyId === companyId);
  if (!user) {
    throw new Error('User not found in your company workspace.');
  }

  const activeAdmins = db.users.filter(
    (u) => u.companyId === companyId && u.role === 'FIRM_ADMIN' && u.isActive
  );

  let sessionsInvalidated = false;

  if (updates.isActive !== undefined && !updates.isActive) {
    if (user.id === actingUserId) {
      throw new Error('You cannot deactivate your own active administrator account.');
    }
    if (user.role === 'FIRM_ADMIN' && activeAdmins.length <= 1) {
      throw new Error('At least one active Firm Admin must remain in the company workspace.');
    }
    user.isActive = false;
    sessionsInvalidated = true;
  } else if (updates.isActive === true) {
    user.isActive = true;
  }

  if (updates.role !== undefined) {
    const nextRole: UserRole = updates.role === 'FIRM_ADMIN' ? 'FIRM_ADMIN' : 'ANALYST';
    if (
      user.role === 'FIRM_ADMIN' &&
      nextRole === 'ANALYST' &&
      activeAdmins.length <= 1 &&
      user.isActive
    ) {
      throw new Error('At least one active Firm Admin must remain in the company workspace.');
    }
    user.role = nextRole;
    if (nextRole === 'FIRM_ADMIN') {
      user.permissions = { canUploadAndAnalyse: true, canGeneratePredictions: true };
    }
  }

  if (updates.permissions && user.role === 'ANALYST') {
    user.permissions = {
      canUploadAndAnalyse:
        updates.permissions.canUploadAndAnalyse !== undefined
          ? Boolean(updates.permissions.canUploadAndAnalyse)
          : user.permissions.canUploadAndAnalyse,
      canGeneratePredictions:
        updates.permissions.canGeneratePredictions !== undefined
          ? Boolean(updates.permissions.canGeneratePredictions)
          : user.permissions.canGeneratePredictions,
    };
  }

  if (updates.newPassword !== undefined && updates.newPassword !== '') {
    const pwError = validatePasswordStrength(updates.newPassword);
    if (pwError) {
      throw new Error(pwError);
    }
    user.passwordHash = hashPassword(updates.newPassword);
    sessionsInvalidated = true;
  }

  persistDiskIfLocal();
  if (isPostgresConfigured()) {
    enqueueRemoteWrite(() => pgUpsertUser(user));
  } else if (isKvConfigured()) {
    enqueueRemoteWrite(() => kvPersistUser(user));
  }
  if (sessionsInvalidated) {
    revokeUserSessions(user.id);
  }
  return toPublicUser(user);
}
