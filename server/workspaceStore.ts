import fs from 'fs';
import path from 'path';
import type {
  AnalyticsSummary,
  BatchScoreResult,
  ModelEvaluationResult,
  PredictionPipelineStatus,
  StagedDatasetImport,
} from '../src/types/churn.ts';
import type { StoredDataset, TrainedModelArtifact } from './mlEngine.ts';

export interface StagedDatasetRecord {
  meta: StagedDatasetImport;
  rows: Record<string, string>[];
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
  storageBytesUsed: number;
}

const WORKSPACES_DIR = path.resolve(process.cwd(), '.data', 'workspaces');

// Strictly keyed by authenticated companyId
const companyWorkspaces = new Map<string, CompanyWorkspaceState>();

function sanitizeCompanyId(companyId: string): string {
  return companyId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getWorkspaceFilePath(companyId: string): string {
  return path.join(WORKSPACES_DIR, `${sanitizeCompanyId(companyId)}.json`);
}

function loadWorkspaceFromDisk(companyId: string): CompanyWorkspaceState | null {
  try {
    const filePath = getWorkspaceFilePath(companyId);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CompanyWorkspaceState>;
    const stats = fs.statSync(filePath);
    return {
      activeDataset: parsed.activeDataset ?? null,
      activeAnalytics: parsed.activeAnalytics ?? null,
      activeModelArtifact: parsed.activeModelArtifact ?? null,
      modelHistory: Array.isArray(parsed.modelHistory) ? parsed.modelHistory : [],
      batchScores: Array.isArray(parsed.batchScores) ? parsed.batchScores : [],
      stagedImport: null, // Staging previews are transient until confirmed
      automationStatus: parsed.automationStatus ?? null,
      storageBytesUsed: stats.size,
    };
  } catch {
    return null;
  }
}

export function getCompanyWorkspace(companyId: string): CompanyWorkspaceState {
  let ws = companyWorkspaces.get(companyId);
  if (!ws) {
    ws = loadWorkspaceFromDisk(companyId) ?? {
      activeDataset: null,
      activeAnalytics: null,
      activeModelArtifact: null,
      modelHistory: [],
      batchScores: [],
      stagedImport: null,
      automationStatus: null,
      storageBytesUsed: 0,
    };
    companyWorkspaces.set(companyId, ws);
  }
  return ws;
}

export function persistCompanyWorkspace(companyId: string, ws: CompanyWorkspaceState): void {
  try {
    if (!fs.existsSync(WORKSPACES_DIR)) {
      fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
    }
    const filePath = getWorkspaceFilePath(companyId);
    const serializable = {
      activeDataset: ws.activeDataset,
      activeAnalytics: ws.activeAnalytics,
      activeModelArtifact: ws.activeModelArtifact,
      modelHistory: ws.modelHistory,
      batchScores: ws.batchScores.slice(0, 10),
      automationStatus: ws.automationStatus,
    };
    const json = JSON.stringify(serializable);
    ws.storageBytesUsed = Buffer.byteLength(json, 'utf-8');
    const tmpFile = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFile, json, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmpFile, filePath);
  } catch (err) {
    console.error(`Failed to persist workspace for ${companyId}:`, err);
  }
}
