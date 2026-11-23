import type {
  AnalyticsSummary,
  AuditLogEntry,
  BatchScoreResult,
  ChurnDefinition,
  CompanyWorkspaceInfo,
  CustomerValueConfig,
  DataPrivacySettings,
  ModelEvaluationResult,
  PredictionPipelineStatus,
  SatisfactionScale,
  StagedDatasetImport,
  TicketAggregationSummary,
  UploadPathway,
  UploadedDatasetSummary,
  UserAccount,
  UserPermissions,
  UserRole,
} from '../types/churn';
import type { StoredDataset, TrainedModelArtifact } from '../../server/mlEngine';
import { DEFAULT_CUSTOMER_VALUE_CONFIG } from '../../server/valueEngine';
import {
  buildDefaultChurnDefinition,
  buildDefaultPrivacySettings,
  getDefaultRelationshipForIndustry,
} from '../utils/industryConfig';

export const DEMO_DB_NAME = 'churnsight_demo_db';
export const DEMO_DB_VERSION = 1;
export const DEMO_PREFS_STORAGE_KEY = 'churnsight_demo_prefs';

export const DEFAULT_DEMO_EMAIL = 'demo@churnsight.app';
export const DEFAULT_DEMO_PASSWORD = 'DemoUser2026!';
export const DEFAULT_DEMO_COMPANY_ID = 'cmp_demo_horizon';
export const DEFAULT_DEMO_USER_ID = 'usr_demo_admin';

export interface DemoUserRecord {
  id: string;
  companyId: string;
  fullName: string;
  email: string;
  passwordSalt: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  avatarDataUrl: string | null;
  permissions: UserPermissions;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface DemoSessionRecord {
  token: string;
  userId: string;
  companyId: string;
  rememberMe: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface DemoStagedDatasetRecord {
  meta: StagedDatasetImport;
  rows: Record<string, string>[];
  validRowsOnly?: Record<string, string>[];
  ticketRows?: Record<string, string>[];
  rejectedRowsCsv?: string;
  rawByteSize: number;
}

export interface DemoUploadedDatasetEntry {
  datasetId: string;
  fileName: string;
  sourceFormat: 'csv' | 'xlsx';
  uploadPathway?: UploadPathway;
  uploadMode?: 'customer' | 'tickets';
  uploadedAt: string;
  customerCount: number;
  ticketCount: number;
  importStatus: 'Active' | 'Imported' | 'Partial (Errors Excluded)';
  isSample?: boolean;
  dataset: StoredDataset;
  ticketRows?: Record<string, string>[];
}

export interface DemoWorkspaceRecord {
  companyId: string;
  activeDataset: StoredDataset | null;
  uploadedDatasets: DemoUploadedDatasetEntry[];
  rowDatasetLineage: string[][];
  activeAnalytics: AnalyticsSummary | null;
  activeModelArtifact: TrainedModelArtifact | null;
  modelHistory: ModelEvaluationResult[];
  batchScores: BatchScoreResult[];
  stagedImport: DemoStagedDatasetRecord | null;
  automationStatus: PredictionPipelineStatus | null;
  valueConfig: CustomerValueConfig;
  satisfactionScale: SatisfactionScale;
  ticketAggregation: TicketAggregationSummary | null;
  storageBytesUsed: number;
}

export interface DemoAuditLogRecord extends AuditLogEntry {
  companyId: string;
}

interface DemoMetaRecord {
  key: string;
  value: unknown;
}

export interface DemoPreferences {
  lastDemoEmail?: string;
  seededAt?: string;
}

interface DemoMemoryCache {
  hydrated: boolean;
  companies: Map<string, CompanyWorkspaceInfo>;
  users: Map<string, DemoUserRecord>;
  sessions: Map<string, DemoSessionRecord>;
  workspaces: Map<string, DemoWorkspaceRecord>;
  auditLogs: Map<string, DemoAuditLogRecord>;
  meta: Map<string, unknown>;
}

const cache: DemoMemoryCache = {
  hydrated: false,
  companies: new Map(),
  users: new Map(),
  sessions: new Map(),
  workspaces: new Map(),
  auditLogs: new Map(),
  meta: new Map(),
};

let initPromise: Promise<void> | null = null;
let idbAvailableCache: boolean | null = null;

export function deepClone<T>(val: T): T {
  if (val === null || val === undefined) return val;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(val);
    } catch {
      // Fallback to JSON roundtrip
    }
  }
  return JSON.parse(JSON.stringify(val)) as T;
}

export function utf8ByteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return text.length * 2;
}

export function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function generateSaltHex(bytes = 12): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`.slice(0, bytes * 2);
}

// Pure JS fallback SHA-256 for environments without crypto.subtle (e.g., plain HTTP)
function fallbackSha256Hex(message: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const withOne = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  withOne.set(bytes);
  withOne[bytes.length] = 0x80;
  const dv = new DataView(withOne.buffer);
  dv.setUint32(withOne.length - 4, bitLen >>> 0, false);
  dv.setUint32(withOne.length - 8, Math.floor(bitLen / 0x100000000), false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < withOne.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
      const s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
}

export async function hashPasswordWithSalt(password: string, salt: string): Promise<string> {
  const input = `${salt}:churnsight_demo:${password}`;
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback below
    }
  }
  return fallbackSha256Hex(input);
}

export async function verifyPasswordHash(
  password: string,
  salt: string,
  expectedHash: string
): Promise<boolean> {
  const actual = await hashPasswordWithSalt(password, salt);
  if (actual.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}

export function getDemoPreferences(): DemoPreferences {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(DEMO_PREFS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DemoPreferences) : {};
  } catch {
    return {};
  }
}

export function updateDemoPreferences(patch: Partial<DemoPreferences>): void {
  if (typeof window === 'undefined') return;
  try {
    const next = { ...getDemoPreferences(), ...patch };
    window.localStorage.setItem(DEMO_PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
}

function hasIndexedDb(): boolean {
  if (idbAvailableCache !== null) return idbAvailableCache;
  try {
    idbAvailableCache = typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    idbAvailableCache = false;
  }
  return idbAvailableCache;
}

const STORES = ['companies', 'users', 'sessions', 'workspaces', 'auditLogs', 'meta'] as const;
type StoreName = (typeof STORES)[number];

function openDemoIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DEMO_DB_NAME, DEMO_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('companies')) {
        db.createObjectStore('companies', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'token' });
      }
      if (!db.objectStoreNames.contains('workspaces')) {
        db.createObjectStore('workspaces', { keyPath: 'companyId' });
      }
      if (!db.objectStoreNames.contains('auditLogs')) {
        db.createObjectStore('auditLogs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

function readAllFromStore<T>(db: IDBDatabase, storeName: StoreName): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []) as T[]);
    req.onerror = () => reject(req.error || new Error(`Failed reading ${storeName}`));
  });
}

async function idbPut(storeName: StoreName, value: unknown): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openDemoIndexedDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(deepClone(value));
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // Gracefully fallback to memory cache if IDB write fails
  }
}

async function idbDelete(storeName: StoreName, key: string): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openDemoIndexedDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // Gracefully fallback to memory cache
  }
}

async function idbClearAllStores(): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openDemoIndexedDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([...STORES], 'readwrite');
      for (const s of STORES) {
        tx.objectStore(s).clear();
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // Ignore IDB clear failure
  }
}

export function createEmptyWorkspaceRecord(companyId: string): DemoWorkspaceRecord {
  return {
    companyId,
    activeDataset: null,
    uploadedDatasets: [],
    rowDatasetLineage: [],
    activeAnalytics: null,
    activeModelArtifact: null,
    modelHistory: [],
    batchScores: [],
    stagedImport: null,
    automationStatus: null,
    valueConfig: deepClone(DEFAULT_CUSTOMER_VALUE_CONFIG),
    satisfactionScale: '1-5',
    ticketAggregation: null,
    storageBytesUsed: 0,
  };
}

export function recomputeWorkspaceStorageBytes(ws: DemoWorkspaceRecord): number {
  const bytes = utf8ByteLength(JSON.stringify(ws));
  ws.storageBytesUsed = bytes;
  return bytes;
}

async function seedInitialDemoWorkspaceIfEmpty(): Promise<void> {
  const alreadySeeded = cache.meta.get('seeded') === true;
  if (alreadySeeded || cache.users.size > 0) {
    return;
  }

  const now = new Date().toISOString();
  const demoCompany: CompanyWorkspaceInfo = {
    id: DEFAULT_DEMO_COMPANY_ID,
    name: 'Horizon Telecom (Demo)',
    email: DEFAULT_DEMO_EMAIL,
    registrationNumber: 'DEMO-2026-01',
    logoDataUrl: null,
    industry: 'telecommunications',
    customIndustryName: null,
    country: 'Malaysia',
    businessType: 'B2C',
    businessModel: 'Subscription / Recurring',
    customerRelationshipType: getDefaultRelationshipForIndustry('telecommunications'),
    subscriptionPlan: 'professional',
    satisfactionScale: '1-5',
    churnDefinition: {
      ...buildDefaultChurnDefinition('telecommunications'),
      confirmedByUser: true,
      confirmedAt: now,
    },
    privacySettings: buildDefaultPrivacySettings(),
    createdAt: now,
  };

  const salt = generateSaltHex();
  const pwHash = await hashPasswordWithSalt(DEFAULT_DEMO_PASSWORD, salt);
  const demoUser: DemoUserRecord = {
    id: DEFAULT_DEMO_USER_ID,
    companyId: demoCompany.id,
    fullName: 'Alex Tan (Demo Admin)',
    email: DEFAULT_DEMO_EMAIL,
    passwordSalt: salt,
    passwordHash: pwHash,
    role: 'FIRM_ADMIN',
    isActive: true,
    avatarDataUrl: null,
    permissions: { canUploadAndAnalyse: true, canGeneratePredictions: true },
    createdAt: now,
    lastLoginAt: null,
  };

  const demoWs = createEmptyWorkspaceRecord(demoCompany.id);
  recomputeWorkspaceStorageBytes(demoWs);

  cache.companies.set(demoCompany.id, demoCompany);
  cache.users.set(demoUser.id, demoUser);
  cache.workspaces.set(demoCompany.id, demoWs);
  cache.meta.set('seeded', true);

  await Promise.all([
    idbPut('companies', demoCompany),
    idbPut('users', demoUser),
    idbPut('workspaces', demoWs),
    idbPut('meta', { key: 'seeded', value: true } satisfies DemoMetaRecord),
  ]);

  updateDemoPreferences({
    lastDemoEmail: DEFAULT_DEMO_EMAIL,
    seededAt: now,
  });
}

export async function ensureDemoDbInitialized(): Promise<void> {
  if (cache.hydrated) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (hasIndexedDb()) {
      try {
        const db = await openDemoIndexedDb();
        const [companies, users, sessions, workspaces, auditLogs, meta] = await Promise.all([
          readAllFromStore<CompanyWorkspaceInfo>(db, 'companies'),
          readAllFromStore<DemoUserRecord>(db, 'users'),
          readAllFromStore<DemoSessionRecord>(db, 'sessions'),
          readAllFromStore<DemoWorkspaceRecord>(db, 'workspaces'),
          readAllFromStore<DemoAuditLogRecord>(db, 'auditLogs'),
          readAllFromStore<DemoMetaRecord>(db, 'meta'),
        ]);
        db.close();

        cache.companies.clear();
        for (const c of companies) cache.companies.set(c.id, c);

        cache.users.clear();
        for (const u of users) cache.users.set(u.id, u);

        const nowMs = Date.now();
        cache.sessions.clear();
        for (const s of sessions) {
          if (new Date(s.expiresAt).getTime() > nowMs) {
            cache.sessions.set(s.token, s);
          } else {
            void idbDelete('sessions', s.token);
          }
        }

        cache.workspaces.clear();
        for (const w of workspaces) cache.workspaces.set(w.companyId, w);

        cache.auditLogs.clear();
        for (const l of auditLogs) cache.auditLogs.set(l.id, l);

        cache.meta.clear();
        for (const m of meta) cache.meta.set(m.key, m.value);
      } catch {
        // Continue with in-memory stores if IndexedDB fails
      }
    }

    await seedInitialDemoWorkspaceIfEmpty();
    cache.hydrated = true;
  })().finally(() => {
    initPromise = null;
  });

  return initPromise;
}

/**
 * Simulates a fresh page reload during tests by dropping the in-memory mirror
 * while leaving IndexedDB intact so the next call re-hydrates purely from IndexedDB.
 */
export function resetInMemoryDemoCacheForTests(): void {
  cache.hydrated = false;
  cache.companies.clear();
  cache.users.clear();
  cache.sessions.clear();
  cache.workspaces.clear();
  cache.auditLogs.clear();
  cache.meta.clear();
  initPromise = null;
}

export function listAllDemoCompanies(): CompanyWorkspaceInfo[] {
  return Array.from(cache.companies.values()).map((c) => deepClone(c));
}

export function getDemoCompany(companyId: string): CompanyWorkspaceInfo | null {
  const found = cache.companies.get(companyId);
  return found ? deepClone(found) : null;
}

export async function saveDemoCompany(company: CompanyWorkspaceInfo): Promise<void> {
  const copy = deepClone(company);
  cache.companies.set(copy.id, copy);
  await idbPut('companies', copy);
}

export function listDemoUsersForCompany(companyId: string): DemoUserRecord[] {
  return Array.from(cache.users.values())
    .filter((u) => u.companyId === companyId)
    .map((u) => deepClone(u));
}

export function listAllDemoUsers(): DemoUserRecord[] {
  return Array.from(cache.users.values()).map((u) => deepClone(u));
}

export function findDemoUserByEmail(email: string): DemoUserRecord | null {
  const norm = email.trim().toLowerCase();
  for (const u of cache.users.values()) {
    if (u.email.trim().toLowerCase() === norm) {
      return deepClone(u);
    }
  }
  return null;
}

export function getDemoUserById(userId: string): DemoUserRecord | null {
  const u = cache.users.get(userId);
  return u ? deepClone(u) : null;
}

export async function saveDemoUser(user: DemoUserRecord): Promise<void> {
  const copy = deepClone(user);
  cache.users.set(copy.id, copy);
  await idbPut('users', copy);
}

export function toPublicUserAccount(user: DemoUserRecord): UserAccount {
  return {
    id: user.id,
    companyId: user.companyId,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    avatarDataUrl: user.avatarDataUrl,
    permissions: deepClone(user.permissions),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export function getDemoSession(token: string): DemoSessionRecord | null {
  const sess = cache.sessions.get(token);
  if (!sess) return null;
  if (new Date(sess.expiresAt).getTime() <= Date.now()) {
    cache.sessions.delete(token);
    void idbDelete('sessions', token);
    return null;
  }
  return deepClone(sess);
}

export async function saveDemoSession(session: DemoSessionRecord): Promise<void> {
  const copy = deepClone(session);
  cache.sessions.set(copy.token, copy);
  await idbPut('sessions', copy);
}

export async function deleteDemoSession(token: string): Promise<void> {
  cache.sessions.delete(token);
  await idbDelete('sessions', token);
}

export function getDemoWorkspace(companyId: string): DemoWorkspaceRecord {
  const existing = cache.workspaces.get(companyId);
  if (existing) return deepClone(existing);
  const created = createEmptyWorkspaceRecord(companyId);
  cache.workspaces.set(companyId, deepClone(created));
  return created;
}

export async function saveDemoWorkspace(ws: DemoWorkspaceRecord): Promise<void> {
  const copy = deepClone(ws);
  recomputeWorkspaceStorageBytes(copy);
  cache.workspaces.set(copy.companyId, copy);
  await idbPut('workspaces', copy);
}

export function listDemoAuditLogsForCompany(companyId: string, limit = 100): AuditLogEntry[] {
  return Array.from(cache.auditLogs.values())
    .filter((l) => l.companyId === companyId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit)
    .map((entry) => deepClone(entry));
}

export function listAllDemoAuditLogs(limit = 150): AuditLogEntry[] {
  return Array.from(cache.auditLogs.values())
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit)
    .map((entry) => deepClone(entry));
}

export async function appendDemoAuditLog(entry: Omit<DemoAuditLogRecord, 'id' | 'timestamp'>): Promise<void> {
  const full: DemoAuditLogRecord = {
    ...entry,
    id: generateId('aud'),
    timestamp: new Date().toISOString(),
  };
  cache.auditLogs.set(full.id, full);
  await idbPut('auditLogs', full);
}

export async function clearCompanyAuditLogs(companyId: string): Promise<void> {
  const toDelete: string[] = [];
  for (const [id, entry] of cache.auditLogs.entries()) {
    if (entry.companyId === companyId) {
      toDelete.push(id);
    }
  }
  for (const id of toDelete) {
    cache.auditLogs.delete(id);
  }
  await Promise.all(toDelete.map((id) => idbDelete('auditLogs', id)));
}

export function isDefaultSampleSeeded(): boolean {
  return cache.meta.get('default_sample_seeded') === true;
}

export async function markDefaultSampleSeeded(): Promise<void> {
  cache.meta.set('default_sample_seeded', true);
  await idbPut('meta', { key: 'default_sample_seeded', value: true } satisfies DemoMetaRecord);
}

export function listDemoUploadedDatasetSummaries(ws: DemoWorkspaceRecord): UploadedDatasetSummary[] {
  const activeDatasetId = ws.activeDataset?.state.datasetId;
  return (ws.uploadedDatasets || []).map((d) => ({
    datasetId: d.datasetId,
    fileName: d.fileName,
    sourceFormat: d.sourceFormat,
    uploadPathway: d.uploadPathway,
    uploadMode: d.uploadMode || 'customer',
    uploadedAt: d.uploadedAt,
    customerCount: d.customerCount,
    ticketCount: d.ticketCount,
    importStatus: d.importStatus,
    isActive: activeDatasetId ? d.datasetId === activeDatasetId : d.importStatus === 'Active',
    isSample: d.isSample,
  }));
}

export async function resetEntireDemoDatabase(): Promise<void> {
  cache.companies.clear();
  cache.users.clear();
  cache.sessions.clear();
  cache.workspaces.clear();
  cache.auditLogs.clear();
  cache.meta.clear();
  await idbClearAllStores();
  await seedInitialDemoWorkspaceIfEmpty();
  cache.hydrated = true;
}

export function buildWorkspaceBackupJson(companyId: string): {
  fileName: string;
  json: string;
} {
  const company = getDemoCompany(companyId);
  const ws = getDemoWorkspace(companyId);
  const users = listDemoUsersForCompany(companyId).map(toPublicUserAccount);
  const auditLogs = listDemoAuditLogsForCompany(companyId, 250);
  const payload = {
    exportedAt: new Date().toISOString(),
    mode: 'DEMO_MODE_LOCAL_BROWSER',
    company,
    users,
    workspace: {
      activeDataset: ws.activeDataset,
      uploadedDatasets: listDemoUploadedDatasetSummaries(ws),
      activeAnalytics: ws.activeAnalytics,
      activeModelEvaluation: ws.activeModelArtifact?.evaluation || null,
      modelHistory: ws.modelHistory,
      batchScores: ws.batchScores,
      automationStatus: ws.automationStatus,
      valueConfig: ws.valueConfig,
      satisfactionScale: ws.satisfactionScale,
      ticketAggregation: ws.ticketAggregation,
      storageBytesUsed: ws.storageBytesUsed,
    },
    auditLogs,
  };
  const safeSlug = (company?.name || 'workspace')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return {
    fileName: `churnsight_${safeSlug || 'demo'}_workspace_backup.json`,
    json: JSON.stringify(payload, null, 2),
  };
}
