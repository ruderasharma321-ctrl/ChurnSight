import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  AnalyticsSummary,
  BatchScoreResult,
  CustomerValueConfig,
  ModelEvaluationResult,
  PredictionPipelineStatus,
  SatisfactionScale,
  StagedDatasetImport,
  TicketAggregationSummary,
} from '../src/types/churn.ts';
import type { StoredDataset, TrainedModelArtifact } from './mlEngine.ts';
import {
  isRemoteStoreConfigured,
  remoteGetJson,
  remoteSetJson,
} from './remoteStore.ts';

export interface StagedDatasetRecord {
  meta: StagedDatasetImport;
  rows: Record<string, string>[];
  validRowsOnly?: Record<string, string>[];
  ticketRows?: Record<string, string>[];
  rejectedRowsCsv?: string;
  rawByteSize: number;
}

export interface CompanyWorkspaceState {
  activeDataset: StoredDataset | null;
  activeAnalytics: AnalyticsSummary | null;
  activeModelArtifact: TrainedModelArtifact | null;
  modelHistory: ModelEvaluationResult[];
  batchScores: BatchScoreResult[];
  stagedImport: StagedDatasetRecord | null;
  automationStatus: PredictionPipelineStatus | null;
  valueConfig?: CustomerValueConfig;
  satisfactionScale?: SatisfactionScale;
  ticketAggregation?: TicketAggregationSummary | null;
  storageBytesUsed: number;
}

const DATA_ROOT =
  process.env.CHURNSIGHT_DATA_DIR ||
  (process.env.VERCEL ? path.join(os.tmpdir(), 'churnsight-data') : path.resolve(process.cwd(), '.data'));
const WORKSPACES_DIR = path.join(DATA_ROOT, 'workspaces');

// Strictly keyed by authenticated companyId
const companyWorkspaces = new Map<string, CompanyWorkspaceState>();
const workspaceHydratedAt = new Map<string, number>();
const pendingWorkspaceWrites = new Map<string, Promise<void>>();

function sanitizeCompanyId(companyId: string): string {
  return companyId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getWorkspaceFilePath(companyId: string): string {
  return path.join(WORKSPACES_DIR, `${sanitizeCompanyId(companyId)}.json`);
}

function getRemoteWorkspaceKey(companyId: string): string {
  return `churnsight:ws:${sanitizeCompanyId(companyId)}`;
}

function buildEmptyWorkspace(): CompanyWorkspaceState {
  return {
    activeDataset: null,
    activeAnalytics: null,
    activeModelArtifact: null,
    modelHistory: [],
    batchScores: [],
    stagedImport: null,
    automationStatus: null,
    valueConfig: undefined,
    satisfactionScale: '1-5',
    ticketAggregation: null,
    storageBytesUsed: 0,
  };
}

function normalizeWorkspaceData(
  parsed: Partial<CompanyWorkspaceState> | null | undefined,
  bytes = 0
): CompanyWorkspaceState {
  return {
    activeDataset: parsed?.activeDataset ?? null,
    activeAnalytics: parsed?.activeAnalytics ?? null,
    activeModelArtifact: parsed?.activeModelArtifact ?? null,
    modelHistory: Array.isArray(parsed?.modelHistory) ? parsed.modelHistory : [],
    batchScores: Array.isArray(parsed?.batchScores) ? parsed.batchScores : [],
    stagedImport: null, // Staging previews are transient until confirmed
    automationStatus: parsed?.automationStatus ?? null,
    valueConfig: parsed?.valueConfig,
    satisfactionScale: parsed?.satisfactionScale || '1-5',
    ticketAggregation: parsed?.ticketAggregation ?? null,
    storageBytesUsed: bytes,
  };
}

function loadWorkspaceFromDisk(companyId: string): CompanyWorkspaceState | null {
  try {
    const filePath = getWorkspaceFilePath(companyId);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CompanyWorkspaceState>;
    const stats = fs.statSync(filePath);
    return normalizeWorkspaceData(parsed, stats.size);
  } catch {
    return null;
  }
}

export async function ensureWorkspaceHydrated(companyId: string): Promise<void> {
  if (!isRemoteStoreConfigured() || !companyId) return;
  const lastAt = workspaceHydratedAt.get(companyId) || 0;
  if (Date.now() - lastAt <= 2000 && companyWorkspaces.has(companyId)) return;
  try {
    const pending = pendingWorkspaceWrites.get(companyId);
    if (pending) await pending;
    const remote = await remoteGetJson<Partial<CompanyWorkspaceState>>(
      getRemoteWorkspaceKey(companyId)
    );
    if (remote) {
      const jsonSize = Buffer.byteLength(JSON.stringify(remote), 'utf-8');
      const existing = companyWorkspaces.get(companyId);
      const ws = normalizeWorkspaceData(remote, jsonSize);
      if (existing?.stagedImport) ws.stagedImport = existing.stagedImport;
      companyWorkspaces.set(companyId, ws);
    }
    workspaceHydratedAt.set(companyId, Date.now());
  } catch (err) {
    console.error(`Failed to hydrate workspace for ${companyId}:`, err);
  }
}

export async function flushAllPendingWorkspaceWrites(): Promise<void> {
  const tasks = Array.from(pendingWorkspaceWrites.values());
  if (tasks.length > 0) {
    await Promise.allSettled(tasks);
  }
}

export function getCompanyWorkspace(companyId: string): CompanyWorkspaceState {
  let ws = companyWorkspaces.get(companyId);
  if (!ws) {
    ws = loadWorkspaceFromDisk(companyId) ?? buildEmptyWorkspace();
    companyWorkspaces.set(companyId, ws);
  }
  return ws;
}

export function persistCompanyWorkspace(companyId: string, ws: CompanyWorkspaceState): void {
  const serializable = {
    activeDataset: ws.activeDataset,
    activeAnalytics: ws.activeAnalytics,
    activeModelArtifact: ws.activeModelArtifact,
    modelHistory: ws.modelHistory,
    batchScores: ws.batchScores.slice(0, 10),
    automationStatus: ws.automationStatus,
    valueConfig: ws.valueConfig,
    satisfactionScale: ws.satisfactionScale,
    ticketAggregation: ws.ticketAggregation,
  };
  const json = JSON.stringify(serializable);
  ws.storageBytesUsed = Buffer.byteLength(json, 'utf-8');

  try {
    if (!fs.existsSync(WORKSPACES_DIR)) {
      fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
    }
    const filePath = getWorkspaceFilePath(companyId);
    const tmpFile = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFile, json, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmpFile, filePath);
  } catch (err) {
    console.error(`Failed to persist workspace for ${companyId}:`, err);
  }

  if (isRemoteStoreConfigured()) {
    const snapshot = JSON.parse(json);
    const prev = pendingWorkspaceWrites.get(companyId) || Promise.resolve();
    const task = prev
      .catch(() => undefined)
      .then(() => remoteSetJson(getRemoteWorkspaceKey(companyId), snapshot))
      .then(() => {
        workspaceHydratedAt.set(companyId, Date.now());
      })
      .catch((err) => {
        console.error(`Failed to persist workspace to KV for ${companyId}:`, err);
      });
    pendingWorkspaceWrites.set(companyId, task);
  }
}
