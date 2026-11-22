import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
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
import {
  isRemoteStoreConfigured,
  remoteGetJson,
  remoteSetJson,
} from './remoteStore.ts';

interface StoredCompany {
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

interface StoredUser {
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

interface StoredSession {
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

const DATA_DIR =
  process.env.CHURNSIGHT_DATA_DIR ||
  (process.env.VERCEL ? path.join(os.tmpdir(), 'churnsight-data') : path.resolve(process.cwd(), '.data'));
const DB_FILE = path.join(DATA_DIR, 'churnsight_auth.json');

const REMOTE_AUTH_KEY = 'churnsight:auth:v1';
const SESSION_SHORT_MS = 8 * 60 * 60 * 1000; // 8 hours
const SESSION_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_IMAGE_DATA_URL_LENGTH = 750_000; // ~550KB image limit

let lastDiskMtimeMs = 0;
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
  try {
    if (fs.existsSync(DB_FILE)) {
      const stat = fs.statSync(DB_FILE);
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      if (!raw.trim()) {
        return { companies: [], users: [], sessions: [] };
      }
      const parsed = JSON.parse(raw) as Partial<AuthDatabase>;
      lastDiskMtimeMs = stat.mtimeMs;
      return sanitizeLoadedDb(parsed);
    }
  } catch (err) {
    console.error('Failed to read auth store from disk:', err);
  }
  return { companies: [], users: [], sessions: [] };
}

function syncDbFromDiskIfNewer(): void {
  if (isRemoteStoreConfigured()) return;
  try {
    if (!fs.existsSync(DB_FILE)) return;
    const stat = fs.statSync(DB_FILE);
    if (stat.mtimeMs > lastDiskMtimeMs) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw) as Partial<AuthDatabase>;
      db = sanitizeLoadedDb(parsed);
      lastDiskMtimeMs = stat.mtimeMs;
    }
  } catch (err) {
    console.error('Failed to sync auth store from disk:', err);
  }
}

export async function ensureAuthHydrated(force = false): Promise<void> {
  if (!isRemoteStoreConfigured()) {
    syncDbFromDiskIfNewer();
    return;
  }
  // On serverless instances, re-hydrate periodically or when memory is empty so concurrent instances stay consistent
  const stale = Date.now() - lastRemoteHydratedAt > 2000;
  if (!force && !stale && db.users.length > 0) {
    return;
  }
  try {
    if (pendingRemoteWrite) {
      await pendingRemoteWrite;
    }
    const remote = await remoteGetJson<Partial<AuthDatabase>>(REMOTE_AUTH_KEY);
    if (remote) {
      db = sanitizeLoadedDb(remote);
      saveDbToDiskOnly();
    }
    lastRemoteHydratedAt = Date.now();
  } catch (err) {
    console.error('Failed to hydrate auth store from remote KV:', err);
  }
}

export async function flushPendingAuthWrites(): Promise<void> {
  if (pendingRemoteWrite) {
    await pendingRemoteWrite;
  }
}

function saveDbToDiskOnly(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${DB_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmpFile, DB_FILE);
    lastDiskMtimeMs = fs.statSync(DB_FILE).mtimeMs;
  } catch (err) {
    console.error('Failed to persist auth store:', err);
  }
}

function saveDbToDisk(): void {
  saveDbToDiskOnly();
  if (isRemoteStoreConfigured()) {
    const snapshot = JSON.parse(JSON.stringify(db)) as AuthDatabase;
    const writeTask = (pendingRemoteWrite || Promise.resolve())
      .catch(() => undefined)
      .then(() => remoteSetJson(REMOTE_AUTH_KEY, snapshot))
      .then(() => {
        lastRemoteHydratedAt = Date.now();
      })
      .catch((err) => {
        console.error('Failed to persist auth store to remote KV:', err);
      });
    pendingRemoteWrite = writeTask;
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

function pruneExpiredSessions(): void {
  const now = Date.now();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
  if (db.sessions.length !== before) {
    saveDbToDisk();
  }
}

export function registerCompanyAndAdmin(input: RegisterCompanyRequest): {
  company: CompanyWorkspaceInfo;
  user: UserAccount;
} {
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
    db.users.some((u) => normalizeEmail(u.email) === adminEmail || normalizeEmail(u.email) === companyEmail) ||
    db.companies.some((c) => normalizeEmail(c.email) === companyEmail || normalizeEmail(c.email) === adminEmail)
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
  saveDbToDisk();

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
  pruneExpiredSessions();

  const nowMs = Date.now();
  const ttlMs = rememberMe ? SESSION_REMEMBER_MS : SESSION_SHORT_MS;
  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  user.lastLoginAt = new Date(nowMs).toISOString();

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);

  db.sessions.push({
    tokenHash,
    userId: user.id,
    companyId: company.id,
    rememberMe,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt,
  });
  saveDbToDisk();

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
  syncDbFromDiskIfNewer();
  pruneExpiredSessions();

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

const REMEMBER_SLIDING_THRESHOLD_MS = 25 * 24 * 60 * 60 * 1000; // renew if < 25 days left
const SHORT_SLIDING_THRESHOLD_MS = 4 * 60 * 60 * 1000; // renew if < 4 hours left

export function getSessionContext(rawToken: string | undefined): AuthContext | null {
  syncDbFromDiskIfNewer();
  if (!rawToken) return null;
  const tokenHash = hashSessionToken(rawToken);
  const session = db.sessions.find((s) => s.tokenHash === tokenHash);
  if (!session) return null;

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
    saveDbToDisk();
    return null;
  }

  const user = db.users.find((u) => u.id === session.userId && u.companyId === session.companyId);
  const company = db.companies.find((c) => c.id === session.companyId);
  if (!user || !company || !user.isActive) {
    db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
    saveDbToDisk();
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
    saveDbToDisk();
    return null;
  }

  const user = db.users.find((u) => u.id === session.userId && u.companyId === session.companyId);
  const company = db.companies.find((c) => c.id === session.companyId);
  if (!user || !company || !user.isActive) {
    db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
    saveDbToDisk();
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
    saveDbToDisk();
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
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
  if (db.sessions.length !== before) {
    saveDbToDisk();
  }
}

export function revokeUserSessions(userId: string, exceptTokenHash?: string): void {
  const before = db.sessions.length;
  db.sessions = db.sessions.filter(
    (s) => s.userId !== userId || (exceptTokenHash && s.tokenHash === exceptTokenHash)
  );
  if (db.sessions.length !== before) {
    saveDbToDisk();
  }
}

export function checkEmailRegisteredForReset(emailInput: string): boolean {
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

  saveDbToDisk();
  return toPublicUser(user);
}

export function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  confirmNewPassword: string,
  currentTokenHash?: string
): void {
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
  saveDbToDisk();
  // Invalidate any other active sessions for this user
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
      // Always reflect honest validation reality: no unvalidated pre-trained cross-company weights exist yet
      crossCompanyValidationStatus:
        allowShared || optInBaseline
          ? 'unvalidated_architecture_only'
          : 'awaiting_opt_in_and_validation',
      consentUpdatedAt: new Date().toISOString(),
    };
  }

  saveDbToDisk();
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
  syncDbFromDiskIfNewer();
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
  saveDbToDisk();
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
  const user = db.users.find((u) => u.id === targetUserId && u.companyId === companyId);
  if (!user) {
    throw new Error('User not found in your company workspace.');
  }

  const activeAdmins = db.users.filter(
    (u) => u.companyId === companyId && u.role === 'FIRM_ADMIN' && u.isActive
  );

  if (updates.isActive !== undefined && !updates.isActive) {
    if (user.id === actingUserId) {
      throw new Error('You cannot deactivate your own active administrator account.');
    }
    if (user.role === 'FIRM_ADMIN' && activeAdmins.length <= 1) {
      throw new Error('At least one active Firm Admin must remain in the company workspace.');
    }
    user.isActive = false;
    revokeUserSessions(user.id);
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
    revokeUserSessions(user.id);
  }

  saveDbToDisk();
  return toPublicUser(user);
}
