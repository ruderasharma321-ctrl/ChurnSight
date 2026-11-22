import fs from 'fs';
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
  UploadPathway,
  UploadedDatasetSummary,
} from '../src/types/churn.ts';
import { ensurePgSchema, pgQuery, pgWithTransaction } from './database.ts';
import type { StoredDataset, TrainedModelArtifact } from './mlEngine.ts';
import {
  isDiskPersistenceAllowed,
  isKvConfigured,
  isPostgresConfigured,
  remoteDeleteKey,
  remoteGetJson,
  remoteSetAdd,
  remoteSetJson,
  remoteSetMembers,
  remoteSetRemove,
} from './remoteStore.ts';

export interface StagedDatasetRecord {
  meta: StagedDatasetImport;
  rows: Record<string, string>[];
  validRowsOnly?: Record<string, string>[];
  ticketRows?: Record<string, string>[];
  rejectedRowsCsv?: string;
  rawByteSize: number;
}

export interface UploadedDatasetEntry {
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

export interface CompanyWorkspaceState {
  activeDataset: StoredDataset | null;
  uploadedDatasets: UploadedDatasetEntry[];
  /**
   * Parallel array to activeDataset.rows listing which datasetId(s) contributed each row.
   * Stored out-of-band so customer row objects & ML feature columns remain unpolluted.
   */
  rowDatasetLineage: string[][];
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

function getWorkspacesDir(): string | null {
  if (!isDiskPersistenceAllowed()) return null;
  const custom = (process.env.CHURNSIGHT_DATA_DIR || '').trim();
  const root = custom ? path.resolve(custom) : path.resolve(process.cwd(), '.data');
  return path.join(root, 'workspaces');
}

const companyWorkspaces = new Map<string, CompanyWorkspaceState>();
const workspaceHydratedAt = new Map<string, number>();
const pendingWorkspaceWrites = new Map<string, Promise<void>>();

function sanitizeCompanyId(companyId: string): string {
  return companyId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getWorkspaceFilePath(companyId: string): string | null {
  const dir = getWorkspacesDir();
  return dir ? path.join(dir, `${sanitizeCompanyId(companyId)}.json`) : null;
}

function getLegacyKvWorkspaceKey(companyId: string): string {
  return `churnsight:ws:${sanitizeCompanyId(companyId)}`;
}

function getKvWorkspaceMetaKey(companyId: string): string {
  return `churnsight:ws_meta:${sanitizeCompanyId(companyId)}`;
}

function getKvDatasetIdsKey(companyId: string): string {
  return `churnsight:ws_ds_ids:${sanitizeCompanyId(companyId)}`;
}

function getKvDatasetKey(companyId: string, datasetId: string): string {
  return `churnsight:ds:${sanitizeCompanyId(companyId)}:${datasetId}`;
}

function getKvStagedKey(companyId: string): string {
  return `churnsight:stg:${sanitizeCompanyId(companyId)}`;
}

function buildEmptyWorkspace(): CompanyWorkspaceState {
  return {
    activeDataset: null,
    uploadedDatasets: [],
    rowDatasetLineage: [],
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

function backfillUploadedDatasetsIfNeeded(ws: CompanyWorkspaceState): void {
  if (ws.activeDataset && ws.uploadedDatasets.length === 0) {
    const st = ws.activeDataset.state;
    const errCount = st.rowValidation?.errorCount || 0;
    ws.uploadedDatasets = [
      {
        datasetId: st.datasetId,
        fileName: st.fileName,
        sourceFormat: st.sourceFormat || 'csv',
        uploadPathway: st.uploadPathway,
        uploadMode: 'customer',
        uploadedAt: st.uploadedAt,
        customerCount: ws.activeDataset.rows.length,
        ticketCount: st.ticketAggregation?.ticketRowsCount || 0,
        importStatus: errCount > 0 ? 'Partial (Errors Excluded)' : 'Active',
        isSample: st.isSample,
        dataset: ws.activeDataset,
      },
    ];
    ws.rowDatasetLineage = ws.activeDataset.rows.map(() => [st.datasetId]);
  }
  if (ws.activeDataset && ws.rowDatasetLineage.length !== ws.activeDataset.rows.length) {
    const fallbackId = ws.activeDataset.state.datasetId;
    ws.rowDatasetLineage = ws.activeDataset.rows.map(
      (_, idx) => ws.rowDatasetLineage[idx] || [fallbackId]
    );
  }
}

function normalizeWorkspaceData(
  parsed: Partial<CompanyWorkspaceState> | null | undefined,
  bytes = 0
): CompanyWorkspaceState {
  const ws: CompanyWorkspaceState = {
    activeDataset: parsed?.activeDataset ?? null,
    uploadedDatasets: Array.isArray(parsed?.uploadedDatasets) ? parsed.uploadedDatasets : [],
    rowDatasetLineage: Array.isArray(parsed?.rowDatasetLineage) ? parsed.rowDatasetLineage : [],
    activeAnalytics: parsed?.activeAnalytics ?? null,
    activeModelArtifact: parsed?.activeModelArtifact ?? null,
    modelHistory: Array.isArray(parsed?.modelHistory) ? parsed.modelHistory : [],
    batchScores: Array.isArray(parsed?.batchScores) ? parsed.batchScores : [],
    stagedImport: parsed?.stagedImport ?? null,
    automationStatus: parsed?.automationStatus ?? null,
    valueConfig: parsed?.valueConfig,
    satisfactionScale: parsed?.satisfactionScale || '1-5',
    ticketAggregation: parsed?.ticketAggregation ?? null,
    storageBytesUsed: bytes,
  };
  backfillUploadedDatasetsIfNeeded(ws);
  return ws;
}

export function listUploadedDatasetSummaries(ws: CompanyWorkspaceState): UploadedDatasetSummary[] {
  const activeId = ws.activeDataset?.state.datasetId || null;
  return [...ws.uploadedDatasets]
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    .map((d) => ({
      datasetId: d.datasetId,
      fileName: d.fileName,
      sourceFormat: d.sourceFormat,
      uploadPathway: d.uploadPathway,
      uploadMode: d.uploadMode || 'customer',
      uploadedAt: d.uploadedAt,
      customerCount: d.customerCount,
      ticketCount: d.ticketCount,
      importStatus: d.importStatus,
      isActive: activeId === d.datasetId,
      isSample: d.isSample,
    }));
}

function loadWorkspaceFromDisk(companyId: string): CompanyWorkspaceState | null {
  const filePath = getWorkspaceFilePath(companyId);
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CompanyWorkspaceState>;
    const stats = fs.statSync(filePath);
    return normalizeWorkspaceData(parsed, stats.size);
  } catch {
    return null;
  }
}

export async function ensureWorkspaceHydrated(companyId: string, force = false): Promise<void> {
  if (!companyId) return;

  if (isPostgresConfigured()) {
    const lastAt = workspaceHydratedAt.get(companyId) || 0;
    if (!force && Date.now() - lastAt <= 2000 && companyWorkspaces.has(companyId)) return;
    try {
      const pending = pendingWorkspaceWrites.get(companyId);
      if (pending) await pending;
      await ensurePgSchema();

      const [wsRes, dsRes] = await Promise.all([
        pgQuery(`SELECT payload, storage_bytes_used FROM company_workspaces WHERE company_id = $1`, [
          companyId,
        ]),
        pgQuery(
          `SELECT dataset_id, file_name, source_format, upload_pathway, upload_mode,
                  customer_count, ticket_count, import_status, is_active, state, rows, ticket_rows, uploaded_at
           FROM uploaded_datasets
           WHERE company_id = $1
           ORDER BY uploaded_at DESC`,
          [companyId]
        ),
      ]);

      const metaPayload = (wsRes.rows[0]?.payload || {}) as Partial<CompanyWorkspaceState>;
      const bytes = Number(wsRes.rows[0]?.storage_bytes_used || 0);

      const uploadedDatasets: UploadedDatasetEntry[] = dsRes.rows.map((r) => ({
        datasetId: String(r.dataset_id),
        fileName: String(r.file_name),
        sourceFormat: (r.source_format === 'xlsx' ? 'xlsx' : 'csv') as 'csv' | 'xlsx',
        uploadPathway: r.upload_pathway || undefined,
        uploadMode: r.upload_mode || 'customer',
        uploadedAt:
          r.uploaded_at instanceof Date ? r.uploaded_at.toISOString() : String(r.uploaded_at),
        customerCount: Number(r.customer_count || 0),
        ticketCount: Number(r.ticket_count || 0),
        importStatus: (r.import_status || 'Imported') as UploadedDatasetEntry['importStatus'],
        isSample: Boolean(r.state?.isSample),
        dataset: {
          state: r.state,
          rows: Array.isArray(r.rows) ? r.rows : [],
        },
        ticketRows: Array.isArray(r.ticket_rows) ? r.ticket_rows : undefined,
      }));

      const ws = normalizeWorkspaceData(
        {
          ...metaPayload,
          ...(uploadedDatasets.length > 0 ? { uploadedDatasets } : {}),
        },
        bytes
      );

      companyWorkspaces.set(companyId, ws);
      workspaceHydratedAt.set(companyId, Date.now());
    } catch (err) {
      console.error(`Failed to hydrate PostgreSQL workspace for ${companyId}:`, err);
    }
    return;
  }

  if (isKvConfigured()) {
    const lastAt = workspaceHydratedAt.get(companyId) || 0;
    if (!force && Date.now() - lastAt <= 2000 && companyWorkspaces.has(companyId)) return;
    try {
      const pending = pendingWorkspaceWrites.get(companyId);
      if (pending) await pending;

      const [meta, dsIds, staged] = await Promise.all([
        remoteGetJson<Partial<CompanyWorkspaceState>>(getKvWorkspaceMetaKey(companyId)),
        remoteSetMembers(getKvDatasetIdsKey(companyId)),
        remoteGetJson<StagedDatasetRecord>(getKvStagedKey(companyId)),
      ]);

      if (meta || dsIds.length > 0) {
        const dsEntriesRaw = await Promise.all(
          dsIds.map((dsId) => remoteGetJson<UploadedDatasetEntry>(getKvDatasetKey(companyId, dsId)))
        );
        const uploadedDatasets = dsEntriesRaw.filter((d): d is UploadedDatasetEntry => Boolean(d));
        const combined = {
          ...(meta || {}),
          uploadedDatasets,
          stagedImport: staged ?? null,
        };
        const jsonSize = Buffer.byteLength(JSON.stringify(combined), 'utf-8');
        const ws = normalizeWorkspaceData(combined, jsonSize);
        companyWorkspaces.set(companyId, ws);
      } else {
        // Legacy fallback read
        const legacy = await remoteGetJson<Partial<CompanyWorkspaceState>>(
          getLegacyKvWorkspaceKey(companyId)
        );
        if (legacy) {
          const jsonSize = Buffer.byteLength(JSON.stringify(legacy), 'utf-8');
          const ws = normalizeWorkspaceData(
            { ...legacy, stagedImport: staged ?? legacy.stagedImport ?? null },
            jsonSize
          );
          companyWorkspaces.set(companyId, ws);
        } else if (staged) {
          const existing = companyWorkspaces.get(companyId) || buildEmptyWorkspace();
          existing.stagedImport = staged;
          companyWorkspaces.set(companyId, existing);
        }
      }
      workspaceHydratedAt.set(companyId, Date.now());
    } catch (err) {
      console.error(`Failed to hydrate KV workspace for ${companyId}:`, err);
    }
  }
}

export async function flushAllPendingWorkspaceWrites(): Promise<void> {
  const tasks = Array.from(pendingWorkspaceWrites.values());
  if (tasks.length > 0) {
    await Promise.all(tasks);
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

export function persistStagedImport(companyId: string, staged: StagedDatasetRecord | null): void {
  const ws = getCompanyWorkspace(companyId);
  ws.stagedImport = staged;

  if (isPostgresConfigured()) {
    const prev = pendingWorkspaceWrites.get(companyId) || Promise.resolve();
    const task = prev
      .catch(() => undefined)
      .then(async () => {
        await ensurePgSchema();
        const existingRes = await pgQuery(
          `SELECT payload, storage_bytes_used FROM company_workspaces WHERE company_id = $1`,
          [companyId]
        );
        const currentPayload = (existingRes.rows[0]?.payload || {}) as Record<string, any>;
        const nextPayload = { ...currentPayload, stagedImport: staged };
        await pgQuery(
          `INSERT INTO company_workspaces (company_id, payload, storage_bytes_used, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (company_id) DO UPDATE SET
             payload = EXCLUDED.payload,
             updated_at = NOW()`,
          [companyId, JSON.stringify(nextPayload), Number(existingRes.rows[0]?.storage_bytes_used || 0)]
        );
      });
    pendingWorkspaceWrites.set(companyId, task);
    return;
  }

  if (isKvConfigured()) {
    const prev = pendingWorkspaceWrites.get(companyId) || Promise.resolve();
    const task = prev
      .catch(() => undefined)
      .then(() =>
        staged
          ? remoteSetJson(getKvStagedKey(companyId), staged, 3600)
          : remoteDeleteKey(getKvStagedKey(companyId))
      );
    pendingWorkspaceWrites.set(companyId, task);
    return;
  }

  persistCompanyWorkspace(companyId, ws);
}

export function persistCompanyWorkspace(
  companyId: string,
  ws: CompanyWorkspaceState,
  options?: { deletedDatasetId?: string }
): void {
  backfillUploadedDatasetsIfNeeded(ws);

  const serializableFull = {
    activeDataset: ws.activeDataset,
    uploadedDatasets: ws.uploadedDatasets,
    rowDatasetLineage: ws.rowDatasetLineage,
    activeAnalytics: ws.activeAnalytics,
    activeModelArtifact: ws.activeModelArtifact,
    modelHistory: ws.modelHistory,
    batchScores: ws.batchScores.slice(0, 10),
    stagedImport: ws.stagedImport,
    automationStatus: ws.automationStatus,
    valueConfig: ws.valueConfig,
    satisfactionScale: ws.satisfactionScale,
    ticketAggregation: ws.ticketAggregation,
  };
  const json = JSON.stringify(serializableFull);
  ws.storageBytesUsed = Buffer.byteLength(json, 'utf-8');

  const filePath = getWorkspaceFilePath(companyId);
  if (filePath && !isPostgresConfigured() && !isKvConfigured()) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpFile = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmpFile, json, { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmpFile, filePath);
    } catch (err) {
      console.error(`Failed to persist workspace to disk for ${companyId}:`, err);
    }
  }

  if (isPostgresConfigured()) {
    const metaOnly = {
      activeDataset: ws.activeDataset,
      rowDatasetLineage: ws.rowDatasetLineage,
      activeAnalytics: ws.activeAnalytics,
      activeModelArtifact: ws.activeModelArtifact,
      modelHistory: ws.modelHistory,
      batchScores: ws.batchScores.slice(0, 10),
      stagedImport: ws.stagedImport,
      automationStatus: ws.automationStatus,
      valueConfig: ws.valueConfig,
      satisfactionScale: ws.satisfactionScale,
      ticketAggregation: ws.ticketAggregation,
    };
    const datasetsSnapshot = JSON.parse(JSON.stringify(ws.uploadedDatasets)) as UploadedDatasetEntry[];
    const activeId = ws.activeDataset?.state.datasetId || null;
    const prev = pendingWorkspaceWrites.get(companyId) || Promise.resolve();
    const task = prev
      .catch(() => undefined)
      .then(async () => {
        await pgWithTransaction(async (client) => {
          await client.query(
            `INSERT INTO company_workspaces (company_id, payload, storage_bytes_used, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (company_id) DO UPDATE SET
               payload = EXCLUDED.payload,
               storage_bytes_used = EXCLUDED.storage_bytes_used,
               updated_at = NOW()`,
            [companyId, JSON.stringify(metaOnly), ws.storageBytesUsed]
          );

          if (options?.deletedDatasetId) {
            await client.query(
              `DELETE FROM uploaded_datasets WHERE company_id = $1 AND dataset_id = $2`,
              [companyId, options.deletedDatasetId]
            );
          }

          for (const d of datasetsSnapshot) {
            await client.query(
              `INSERT INTO uploaded_datasets (
                dataset_id, company_id, file_name, source_format, upload_pathway, upload_mode,
                customer_count, ticket_count, import_status, is_active, state, rows, ticket_rows, uploaded_at
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
              ON CONFLICT (dataset_id) DO UPDATE SET
                file_name = EXCLUDED.file_name,
                customer_count = EXCLUDED.customer_count,
                ticket_count = EXCLUDED.ticket_count,
                import_status = EXCLUDED.import_status,
                is_active = EXCLUDED.is_active,
                state = EXCLUDED.state,
                rows = EXCLUDED.rows,
                ticket_rows = EXCLUDED.ticket_rows`,
              [
                d.datasetId,
                companyId,
                d.fileName,
                d.sourceFormat,
                d.uploadPathway ?? null,
                d.uploadMode || 'customer',
                d.customerCount,
                d.ticketCount,
                d.importStatus,
                activeId === d.datasetId,
                JSON.stringify(d.dataset.state),
                JSON.stringify(d.dataset.rows),
                d.ticketRows ? JSON.stringify(d.ticketRows) : null,
                d.uploadedAt,
              ]
            );
          }
        });
        workspaceHydratedAt.set(companyId, Date.now());
      });
    pendingWorkspaceWrites.set(companyId, task);
    return;
  }

  if (isKvConfigured()) {
    const metaOnly = {
      activeDataset: ws.activeDataset,
      rowDatasetLineage: ws.rowDatasetLineage,
      activeAnalytics: ws.activeAnalytics,
      activeModelArtifact: ws.activeModelArtifact,
      modelHistory: ws.modelHistory,
      batchScores: ws.batchScores.slice(0, 10),
      automationStatus: ws.automationStatus,
      valueConfig: ws.valueConfig,
      satisfactionScale: ws.satisfactionScale,
      ticketAggregation: ws.ticketAggregation,
    };
    const datasetsSnapshot = JSON.parse(JSON.stringify(ws.uploadedDatasets)) as UploadedDatasetEntry[];
    const stagedSnapshot = ws.stagedImport ? JSON.parse(JSON.stringify(ws.stagedImport)) : null;

    const prev = pendingWorkspaceWrites.get(companyId) || Promise.resolve();
    const task = prev
      .catch(() => undefined)
      .then(async () => {
        const ops: Promise<unknown>[] = [
          remoteSetJson(getKvWorkspaceMetaKey(companyId), metaOnly),
          stagedSnapshot
            ? remoteSetJson(getKvStagedKey(companyId), stagedSnapshot, 3600)
            : remoteDeleteKey(getKvStagedKey(companyId)),
        ];

        for (const d of datasetsSnapshot) {
          ops.push(remoteSetJson(getKvDatasetKey(companyId, d.datasetId), d));
          ops.push(remoteSetAdd(getKvDatasetIdsKey(companyId), d.datasetId));
        }

        if (options?.deletedDatasetId) {
          ops.push(remoteDeleteKey(getKvDatasetKey(companyId, options.deletedDatasetId)));
          ops.push(remoteSetRemove(getKvDatasetIdsKey(companyId), options.deletedDatasetId));
        }

        await Promise.all(ops);
        workspaceHydratedAt.set(companyId, Date.now());
      });
    pendingWorkspaceWrites.set(companyId, task);
  }
}
