import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  AnalyticsFilters,
  AnalyticsSummary,
  BusinessModel,
  BusinessType,
  ChurnDefinition,
  ColumnMapping,
  CompanyWorkspaceInfo,
  CustomerRelationshipType,
  CustomerValueConfig,
  DataPrivacySettings,
  DatasetState,
  DuplicateCustomerConflictSummary,
  DuplicateIdHandlingMode,
  IndustryKey,
  LoginRequest,
  MLModelType,
  PlatformCompanySummary,
  PredictionPipelineStatus,
  PredictionPipelineStep,
  RegisterCompanyRequest,
  RowValidationReport,
  SatisfactionScale,
  SplitStrategy,
  StagedDatasetImport,
  SubscriptionPlanTier,
  TicketAggregationSummary,
  TrainModelRequest,
  UploadPathway,
  UserPermissions,
  UserRole,
  WorkspaceUsageSummary,
} from './src/types/churn.ts';
import {
  authenticateUser,
  AuthServiceError,
  changeOwnPassword,
  checkEmailRegisteredForReset,
  createCompanyUser,
  createSessionForUser,
  ensureAuthHydrated,
  flushPendingAuthWrites,
  getCompanyById,
  getSessionContext,
  hasAnyRegisteredUsers,
  hydrateSessionByToken,
  listAllCompanies,
  listCompanyUsers,
  refreshSessionIfNeeded,
  registerCompanyAndAdmin,
  revokeSession,
  updateCompanyProfile,
  updateCompanyUser,
  updateOwnProfile,
  type AuthContext,
} from './server/authStore.ts';
import {
  assessDataReadiness,
  autoDetectMapping,
  buildMappingRationales,
  computeAnalytics,
  computeDatasetQualityStats,
  detectPositiveClass,
  evaluateChurnReadiness,
  extractCustomerNameFromRow,
  getUniqueColumnValues,
  isMissingValue,
  parseSpreadsheetUpload,
  predictSingleCustomer,
  profileColumns,
  scoreBatchRecords,
  trainAndEvaluateModel,
  validateDataset,
} from './server/mlEngine.ts';
import {
  generateIndustryTemplateExport,
  generatePredictionInputTemplateExport,
  normalizeTemplateMode,
  type LegacyCompatibleTemplateMode,
  type TemplateFormat,
} from './server/industryTemplates.ts';
import {
  aggregateTicketsByCustomer,
  checkModelCompatibility,
  mergeTicketsIntoCustomerRows,
  parseMultiSheetSpreadsheetUpload,
  validateCustomerImportRows,
} from './server/importEngine.ts';
import {
  computeCustomerValueIntelligence,
  DEFAULT_CUSTOMER_VALUE_CONFIG,
  normalizeValueConfig,
} from './server/valueEngine.ts';
import {
  classifyPredictedRiskLabel,
  detectStatusColumnHints,
  resolveCustomerStatusRecord,
} from './server/customerStatusEngine.ts';
import { generateSampleIndustryCsv } from './server/sampleDataset.ts';
import { pgHealthCheck } from './server/database.ts';
import {
  getPersistenceStatus,
  isKvConfigured,
  isPostgresConfigured,
  kvPing,
} from './server/remoteStore.ts';
import {
  createRateLimiter,
  ensureAuditLogsHydrated,
  flushPendingAuditWrites,
  listCompanyAuditLogs,
  listPlatformAuditLogs,
  recordAuditEvent,
} from './server/security.ts';
import {
  ensureWorkspaceHydrated,
  flushAllPendingWorkspaceWrites,
  getCompanyWorkspace,
  listUploadedDatasetSummaries,
  persistCompanyWorkspace,
  persistStagedImport,
  type CompanyWorkspaceState,
  type UploadedDatasetEntry,
} from './server/workspaceStore.ts';
import {
  buildDefaultChurnDefinition,
  getIndustryDataTemplateColumns,
  INDUSTRY_PROFILES,
} from './src/utils/industryConfig.ts';
import {
  formatBytes,
  getSubscriptionPlanSpec,
  SUBSCRIPTION_PLAN_LIST,
} from './src/utils/subscriptionPlans.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_COOKIE_NAME = 'churnsight_session';

function buildUsageSummary(
  company: CompanyWorkspaceInfo,
  ws: CompanyWorkspaceState
): WorkspaceUsageSummary {
  const plan = getSubscriptionPlanSpec(company.subscriptionPlan);
  const userCount = listCompanyUsers(company.id).length;
  return {
    plan,
    userCount,
    recordCount: ws.activeDataset?.state.rowCount || 0,
    storageBytesUsed: ws.storageBytesUsed || 0,
    trainedModelsCount: ws.modelHistory.length,
    datasetUploaded: Boolean(ws.activeDataset),
  };
}

function buildWorkspaceAnalytics(
  company: CompanyWorkspaceInfo,
  ws: CompanyWorkspaceState,
  filters: AnalyticsFilters = {}
): AnalyticsSummary | null {
  if (!ws.activeDataset) return null;
  const ds = ws.activeDataset;
  let valueRiskTotals:
    | {
        highValueAtRiskCount: number | null;
        highValueAtRiskRevenue: number | null;
      }
    | undefined;

  if (ws.activeModelArtifact) {
    try {
      const valueSummary = computeCustomerValueIntelligence({
        dataset: ds,
        activeArtifact: ws.activeModelArtifact,
        batchScores: ws.batchScores,
        valueConfig: ws.valueConfig || DEFAULT_CUSTOMER_VALUE_CONFIG,
      });
      valueRiskTotals = {
        highValueAtRiskCount: valueSummary.highValueAtRiskCount,
        highValueAtRiskRevenue: valueSummary.highValueAtRiskRevenue,
      };
    } catch {
      valueRiskTotals = undefined;
    }
  }

  return computeAnalytics(
    ds.state.columns,
    ds.rows,
    ds.state.mapping,
    filters,
    company.churnDefinition,
    ws.activeModelArtifact,
    valueRiskTotals
  );
}

function serializeActiveModelEvaluation(ws: CompanyWorkspaceState) {
  if (!ws.activeModelArtifact) return null;
  const evaluation = ws.activeModelArtifact.evaluation;
  const ds = ws.activeDataset;
  if (!ds || ds.rows.length === 0) return evaluation;

  const idCol = ds.state.mapping.idColumn;
  const nameByCustomerId = new Map<string, string>();
  const rowByCustomerId = new Map<string, { row: Record<string, string>; rowIndex: number }>();
  ds.rows.forEach((row, idx) => {
    const rawId =
      idCol && row[idCol] ? row[idCol].trim() : `CUST-${String(idx + 1).padStart(4, '0')}`;
    const name = extractCustomerNameFromRow(row);
    if (rawId) {
      rowByCustomerId.set(rawId.toLowerCase(), { row, rowIndex: idx + 1 });
      if (name) {
        nameByCustomerId.set(rawId.toLowerCase(), name);
      }
    }
  });

  const statusHints = detectStatusColumnHints(ds.state.columns, ds.state.mapping);

  return {
    ...evaluation,
    predictions: evaluation.predictions.map((p) => {
      const idKey = (p.customerId || '').trim().toLowerCase();
      const matchedRowEntry =
        (p.rowIndex >= 1 && p.rowIndex <= ds.rows.length
          ? { row: ds.rows[p.rowIndex - 1], rowIndex: p.rowIndex }
          : null) ||
        rowByCustomerId.get(idKey) ||
        null;

      const resolved = matchedRowEntry
        ? resolveCustomerStatusRecord(
            matchedRowEntry.row,
            matchedRowEntry.rowIndex,
            statusHints,
            ds.state.churnDefinition
          )
        : null;

      const actualStatus =
        resolved && resolved.actualStatus !== 'Unknown'
          ? resolved.actualStatus
          : p.actualStatus || (p.actualChurn === 'Churned' ? 'Churned' : 'Active');
      const statusConflictReason = resolved?.conflictReason ?? p.statusConflictReason ?? null;
      const riskApplicable = actualStatus !== 'Churned' && actualStatus !== 'Inconsistent';
      const predictedRiskLabel = riskApplicable
        ? classifyPredictedRiskLabel(p.riskCategory)
        : 'Not Applicable';

      const matchedName =
        resolved?.customerName ||
        nameByCustomerId.get(idKey) ||
        extractCustomerNameFromRow(p.attributes) ||
        p.customerName;

      return {
        ...p,
        ...(matchedName ? { customerName: matchedName } : {}),
        actualStatus,
        statusConflictReason,
        riskApplicable,
        predictedRiskLabel,
      };
    }),
  };
}

function enforceDatasetPlanQuota(
  company: CompanyWorkspaceInfo,
  rowCount: number,
  rawByteSize: number
): void {
  const plan = getSubscriptionPlanSpec(company.subscriptionPlan);
  if (rowCount > plan.maxRecords) {
    throw new Error(
      `Dataset contains ${rowCount.toLocaleString()} rows, which exceeds the ${plan.maxRecords.toLocaleString()} record limit on your ${plan.name} plan. Upgrade your subscription plan in Company Settings to process larger datasets.`
    );
  }
  if (rawByteSize > plan.maxStorageBytes) {
    throw new Error(
      `Uploaded file (${formatBytes(rawByteSize)}) exceeds the ${formatBytes(plan.maxStorageBytes)} workspace storage quota on your ${plan.name} plan.`
    );
  }
}

function isRemotePersistenceActive(): boolean {
  return isPostgresConfigured() || isKvConfigured();
}

function commitRowsIntoWorkspace(
  company: CompanyWorkspaceInfo,
  ws: CompanyWorkspaceState,
  params: {
    fileName: string;
    sourceFormat: 'csv' | 'xlsx';
    uploadPathway?: UploadPathway;
    satisfactionScale?: SatisfactionScale;
    headers: string[];
    rows: Record<string, string>[];
    mapping?: ColumnMapping;
    churnDefinition?: ChurnDefinition;
    rowValidation?: RowValidationReport;
    ticketAggregation?: TicketAggregationSummary | null;
    ticketRows?: Record<string, string>[];
    duplicateStrategy?: DuplicateIdHandlingMode;
    preserveModelArtifact?: boolean;
    isSample?: boolean;
  }
): {
  dataset: DatasetState;
  analytics: AnalyticsSummary;
} {
  const {
    fileName,
    sourceFormat,
    uploadPathway,
    satisfactionScale,
    headers: incomingHeaders,
    rows: incomingRows,
    rowValidation,
    ticketAggregation = null,
    ticketRows,
    duplicateStrategy = 'replace',
    preserveModelArtifact = false,
    isSample = false,
  } = params;

  const newDatasetId = `ds_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const nowIso = new Date().toISOString();

  // Build snapshot state for the newly uploaded file itself
  const incomingColumns = profileColumns(incomingHeaders, incomingRows);
  const incomingStats = computeDatasetQualityStats(incomingHeaders, incomingRows);
  const baseMapping =
    params.mapping ||
    autoDetectMapping(incomingColumns, incomingRows, company.industry, uploadPathway);
  const churnDef = params.churnDefinition || company.churnDefinition;
  const incomingTargetUnique = baseMapping.targetColumn
    ? getUniqueColumnValues(incomingRows, baseMapping.targetColumn)
    : [];
  const incomingVal = validateDataset(incomingColumns, incomingRows, baseMapping);
  const incomingLabelReadiness = evaluateChurnReadiness(
    incomingColumns,
    incomingRows,
    baseMapping,
    churnDef
  );
  const incomingReadiness = assessDataReadiness({
    columns: incomingColumns,
    rows: incomingRows,
    mapping: baseMapping,
    churnDefinition: churnDef,
    industry: company.industry,
  });

  const uploadedEntryState: DatasetState = {
    datasetId: newDatasetId,
    fileName,
    sourceFormat,
    uploadPathway,
    satisfactionScale:
      satisfactionScale || ws.satisfactionScale || company.satisfactionScale || '1-5',
    isSample,
    uploadedAt: nowIso,
    rowCount: incomingRows.length,
    columnCount: incomingColumns.length,
    duplicateCount: incomingStats.duplicateCount,
    missingCellCount: incomingStats.missingCellCount,
    invalidDateCount: incomingColumns.reduce((acc, c) => acc + (c.invalidDateCount || 0), 0),
    inconsistentCategoryCount: incomingColumns.reduce(
      (acc, c) => acc + (c.inconsistentCategoryCount || 0),
      0
    ),
    columns: incomingColumns,
    mapping: baseMapping,
    mappingRationales: buildMappingRationales(incomingColumns, baseMapping, company.industry),
    targetUniqueValues: incomingTargetUnique,
    issues: incomingVal.issues,
    isValid: incomingVal.isValid,
    hasValidChurnLabels: incomingLabelReadiness.hasValidChurnLabels,
    churnReadinessMessage: incomingLabelReadiness.churnReadinessMessage,
    readiness: incomingReadiness,
    churnDefinition: churnDef,
    rowValidation,
    ticketAggregation,
    previewRows: incomingRows.slice(0, 15),
  };

  // Mark previous entries inactive unless merged into active
  ws.uploadedDatasets = ws.uploadedDatasets.map((entry) => ({
    ...entry,
    importStatus: entry.importStatus === 'Active' ? 'Imported' : entry.importStatus,
  }));

  const hasErrorsExcluded = (rowValidation?.errorCount || 0) > 0 && incomingRows.length < (rowValidation?.totalRows || incomingRows.length);
  const entryStatus: UploadedDatasetEntry['importStatus'] = hasErrorsExcluded
    ? 'Partial (Errors Excluded)'
    : 'Active';

  ws.uploadedDatasets.unshift({
    datasetId: newDatasetId,
    fileName,
    sourceFormat,
    uploadPathway,
    uploadMode: 'customer',
    uploadedAt: nowIso,
    customerCount: incomingRows.length,
    ticketCount: ticketAggregation?.ticketRowsCount ?? ticketRows?.length ?? 0,
    importStatus: entryStatus,
    isSample,
    dataset: { state: uploadedEntryState, rows: incomingRows },
    ticketRows,
  });

  // Merge or replace active workspace rows with out-of-band lineage tracking
  let finalHeaders = incomingHeaders;
  let finalRows = incomingRows;
  let finalLineage: string[][] = incomingRows.map(() => [newDatasetId]);

  if (
    ws.activeDataset &&
    (duplicateStrategy === 'skip' || duplicateStrategy === 'update')
  ) {
    const existingRows = ws.activeDataset.rows;
    const existingHeaders = ws.activeDataset.state.columns.map((c) => c.name);
    finalHeaders = Array.from(new Set([...existingHeaders, ...incomingHeaders]));
    const existingIdCol = ws.activeDataset.state.mapping.idColumn || baseMapping.idColumn;
    const incomingIdCol = baseMapping.idColumn || existingIdCol;

    const mergedRows: Record<string, string>[] = existingRows.map((r) => {
      const copy: Record<string, string> = {};
      for (const h of finalHeaders) copy[h] = r[h] ?? '';
      return copy;
    });
    const mergedLineage: string[][] = existingRows.map((_, idx) => [
      ...(ws.rowDatasetLineage[idx] || [ws.activeDataset!.state.datasetId]),
    ]);

    const indexById = new Map<string, number>();
    if (existingIdCol) {
      mergedRows.forEach((r, idx) => {
        const key = (r[existingIdCol] || '').trim().toLowerCase();
        if (key) indexById.set(key, idx);
      });
    }

    for (const rawRow of incomingRows) {
      const normalizedIncoming: Record<string, string> = {};
      for (const h of finalHeaders) normalizedIncoming[h] = rawRow[h] ?? '';
      const idKey = incomingIdCol
        ? (rawRow[incomingIdCol] || '').trim().toLowerCase()
        : '';

      if (idKey && indexById.has(idKey)) {
        if (duplicateStrategy === 'update') {
          const idx = indexById.get(idKey)!;
          mergedRows[idx] = { ...mergedRows[idx], ...normalizedIncoming };
          if (!mergedLineage[idx].includes(newDatasetId)) {
            mergedLineage[idx].push(newDatasetId);
          }
        }
        // If 'skip', leave existing row untouched
      } else {
        mergedRows.push(normalizedIncoming);
        mergedLineage.push([newDatasetId]);
      }
    }

    finalRows = mergedRows;
    finalLineage = mergedLineage;
  }

  const columns =
    finalRows === incomingRows ? incomingColumns : profileColumns(finalHeaders, finalRows);
  const { duplicateCount, missingCellCount } =
    finalRows === incomingRows ? incomingStats : computeDatasetQualityStats(finalHeaders, finalRows);
  const mapping =
    finalRows === incomingRows
      ? baseMapping
      : params.mapping || autoDetectMapping(columns, finalRows, company.industry, uploadPathway);
  const targetUniqueValues = mapping.targetColumn
    ? getUniqueColumnValues(finalRows, mapping.targetColumn)
    : [];
  const { issues, isValid } =
    finalRows === incomingRows ? incomingVal : validateDataset(columns, finalRows, mapping);
  const labelReadiness =
    finalRows === incomingRows
      ? incomingLabelReadiness
      : evaluateChurnReadiness(columns, finalRows, mapping, churnDef);
  const readiness =
    finalRows === incomingRows
      ? incomingReadiness
      : assessDataReadiness({
          columns,
          rows: finalRows,
          mapping,
          churnDefinition: churnDef,
          industry: company.industry,
        });
  const mappingRationales = buildMappingRationales(columns, mapping, company.industry);
  const invalidDateCount = columns.reduce((acc, c) => acc + (c.invalidDateCount || 0), 0);
  const inconsistentCategoryCount = columns.reduce(
    (acc, c) => acc + (c.inconsistentCategoryCount || 0),
    0
  );

  const state: DatasetState = {
    datasetId: newDatasetId,
    fileName,
    sourceFormat,
    uploadPathway,
    satisfactionScale:
      satisfactionScale || ws.satisfactionScale || company.satisfactionScale || '1-5',
    isSample,
    uploadedAt: nowIso,
    rowCount: finalRows.length,
    columnCount: columns.length,
    duplicateCount,
    missingCellCount,
    invalidDateCount,
    inconsistentCategoryCount,
    columns,
    mapping,
    mappingRationales,
    targetUniqueValues,
    issues,
    isValid,
    hasValidChurnLabels: labelReadiness.hasValidChurnLabels,
    churnReadinessMessage: labelReadiness.churnReadinessMessage,
    readiness,
    churnDefinition: churnDef,
    rowValidation,
    ticketAggregation,
    previewRows: finalRows.slice(0, 15),
  };

  ws.activeDataset = { state, rows: finalRows };
  ws.rowDatasetLineage = finalLineage;
  ws.ticketAggregation = ticketAggregation;
  if (!preserveModelArtifact) {
    ws.activeModelArtifact = null;
  }
  ws.activeAnalytics =
    buildWorkspaceAnalytics(company, ws) ||
    computeAnalytics(columns, finalRows, mapping, {}, churnDef);
  ws.stagedImport = null;

  persistCompanyWorkspace(company.id, ws);

  return { dataset: state, analytics: ws.activeAnalytics };
}

function buildPipelineSteps(params: {
  datasetFileName: string;
  rowCount: number;
  missingCellCount: number;
  duplicateCount: number;
  featureCount: number;
  validationOk: boolean;
  labelsOk: boolean;
  modelBuilt: boolean;
  qualityOk: boolean;
  modelName?: string;
  splitLabel?: string;
  qualityDetail?: string;
  errorDetail?: string;
}): PredictionPipelineStep[] {
  const {
    datasetFileName,
    rowCount,
    missingCellCount,
    duplicateCount,
    featureCount,
    validationOk,
    labelsOk,
    modelBuilt,
    qualityOk,
    modelName,
    splitLabel,
    qualityDetail,
    errorDetail,
  } = params;

  return [
    {
      key: 'uploaded',
      label: 'Dataset uploaded.',
      status: 'completed',
      detail: `${datasetFileName} (${rowCount.toLocaleString()} customer records)`,
    },
    {
      key: 'validated',
      label: 'Data validation complete.',
      status: validationOk ? 'completed' : 'warning',
      detail: validationOk
        ? `${duplicateCount} duplicate rows, ${missingCellCount} missing cells checked`
        : errorDetail || 'Dataset validation found required field issues',
    },
    {
      key: 'prepared',
      label: 'Preparing customer data.',
      status: labelsOk ? 'completed' : 'warning',
      detail: labelsOk
        ? `Prepared ${featureCount} customer attributes (imputation, encoding, standardization)`
        : 'Waiting for valid historical churn outcomes before preparing model features',
    },
    {
      key: 'built',
      label: 'Building prediction model.',
      status: !labelsOk ? 'pending' : modelBuilt ? 'completed' : 'failed',
      detail: !labelsOk
        ? 'Paused — requires historical churn labels'
        : modelBuilt && modelName
          ? `Automated selection trained ${modelName} (${splitLabel || 'stratified hold-out'})`
          : errorDetail || 'Model build could not complete',
    },
    {
      key: 'quality',
      label: 'Checking prediction quality.',
      status: !labelsOk ? 'pending' : !modelBuilt ? 'pending' : qualityOk ? 'completed' : 'warning',
      detail: !labelsOk
        ? 'Awaiting sufficient historical outcomes'
        : qualityOk
          ? qualityDetail || 'Passed hold-out validation checks'
          : qualityDetail || 'Did not pass minimum prediction quality checks',
    },
  ];
}

function runAutomatedPredictionSetup(
  company: CompanyWorkspaceInfo,
  ws: CompanyWorkspaceState,
  options?: { allowModelExecution?: boolean; actor?: { id: string; email: string; role: UserRole } }
): PredictionPipelineStatus {
  const now = new Date().toISOString();
  const ds = ws.activeDataset;
  if (!ds) {
    ws.activeModelArtifact = null;
    ws.automationStatus = null;
    persistCompanyWorkspace(company.id, ws);
    return {
      stage: 'setup_failed',
      headline: 'No dataset loaded.',
      summary: 'Upload a CSV or Excel customer file in Data Management to begin.',
      predictionAvailable: false,
      needsRefresh: false,
      refreshNotice: null,
      failureReason: 'No customer dataset is loaded in this workspace.',
      recommendedAction: 'Upload a CSV or Excel dataset in Data Management.',
      selectedAlgorithmReason: null,
      updatedAt: now,
      steps: [],
    };
  }

  const state = ds.state;
  const plan = getSubscriptionPlanSpec(company.subscriptionPlan);
  const missingCells = state.missingCellCount ?? 0;
  const dupCount = state.duplicateCount ?? 0;
  const featureCount = state.mapping.featureColumns.length;
  const readiness =
    state.readiness ||
    assessDataReadiness({
      columns: state.columns,
      rows: ds.rows,
      mapping: state.mapping,
      churnDefinition: company.churnDefinition,
      industry: company.industry,
    });
  state.readiness = readiness;

  // Step 1-4: Validate structural integrity, churn definition confirmation & statistical label sufficiency
  if (!state.isValid || !readiness.predictionReady.ready) {
    const reason =
      readiness.predictionReady.blockers[0] ||
      state.churnReadinessMessage ||
      state.issues.find((i) => i.severity === 'error')?.message ||
      'Historical churn outcomes (both churned and retained) are incomplete for predictive training.';

    ws.activeModelArtifact = null;
    const isColdStartMonitoring = readiness.behaviourMonitoringReady.ready;
    const status: PredictionPipelineStatus = {
      stage: 'more_historical_data_required',
      headline: isColdStartMonitoring
        ? 'Behaviour monitoring active — awaiting churn outcomes.'
        : 'More historical data required.',
      summary: isColdStartMonitoring
        ? 'Your dataset is live for descriptive analytics and rule-based behaviour monitoring. Supervised churn prediction will unlock automatically once sufficient churned and retained outcomes are observed or uploaded.'
        : 'Your customer data is available for descriptive analytics, but ChurnSight withheld predictive scoring because required churn labels or structural checks are incomplete.',
      predictionAvailable: false,
      needsRefresh: true,
      refreshNotice:
        readiness.moreDataRequired.collectionGuidance[0] ||
        'Confirm your churn definition and ensure both churned and retained historical outcomes are present to activate predictions.',
      failureReason: reason,
      recommendedAction:
        readiness.moreDataRequired.collectionGuidance[0] ||
        'Open Data Management to map your historical churn column, record observed outcomes, or confirm your churn definition.',
      selectedAlgorithmReason: null,
      updatedAt: now,
      steps: buildPipelineSteps({
        datasetFileName: state.fileName,
        rowCount: state.rowCount,
        missingCellCount: missingCells,
        duplicateCount: dupCount,
        featureCount,
        validationOk: state.isValid,
        labelsOk: false,
        modelBuilt: false,
        qualityOk: false,
        errorDetail: reason,
      }),
    };
    ws.automationStatus = status;
    persistCompanyWorkspace(company.id, ws);
    return status;
  }

  if (options?.allowModelExecution === false) {
    const status: PredictionPipelineStatus = {
      stage: 'preparing_customer_data',
      headline: 'Customer data ready for prediction setup.',
      summary:
        'Data validation and preparation succeeded, but your current role only permits data upload and analysis.',
      predictionAvailable: Boolean(ws.activeModelArtifact),
      needsRefresh: !ws.activeModelArtifact,
      refreshNotice:
        'Ask your Firm Administrator or an authorised analyst to build or refresh predictions.',
      failureReason: null,
      recommendedAction: 'Request prediction permissions from your Firm Administrator.',
      selectedAlgorithmReason: null,
      updatedAt: now,
      steps: buildPipelineSteps({
        datasetFileName: state.fileName,
        rowCount: state.rowCount,
        missingCellCount: missingCells,
        duplicateCount: dupCount,
        featureCount,
        validationOk: true,
        labelsOk: true,
        modelBuilt: false,
        qualityOk: false,
      }),
    };
    ws.automationStatus = status;
    persistCompanyWorkspace(company.id, ws);
    return status;
  }

  // Step 5-7: Automatically select best split & supported algorithm for this company
  try {
    const canUseChronological =
      readiness.predictionReady.recommendedValidationStrategy === 'chronological' &&
      Boolean(state.mapping.dateColumn) &&
      plan.allowChronologicalSplit;
    const chosenSplit: SplitStrategy = canUseChronological ? 'chronological' : 'stratified';
    const splitLabel = canUseChronological
      ? `chronological hold-out on ${state.mapping.dateColumn}`
      : 'stratified 80/20 hold-out';

    const maxPrevVersion = ws.modelHistory.reduce((max, m) => {
      const num = Number((m.version || '').replace(/^v/i, ''));
      return Number.isFinite(num) ? Math.max(max, num) : max;
    }, 0);
    const nextVersion = Math.max(ws.modelHistory.length + 1, maxPrevVersion + 1);

    let chosenArtifact: ReturnType<typeof trainAndEvaluateModel>;
    let selectionReason: string;

    if (ds.rows.length <= 4000) {
      const candidates: MLModelType[] = ['logistic_regression', 'decision_tree'];
      if (plan.allowedModels.includes('random_forest')) {
        candidates.push('random_forest');
      }

      const evaluated = candidates.map((mType) =>
        trainAndEvaluateModel(
          ds,
          {
            modelType: mType,
            testSplitRatio: 0.2,
            maxDepth: mType === 'random_forest' ? 5 : 4,
            nEstimators: 25,
            splitStrategy: chosenSplit,
          },
          nextVersion
        )
      );

      evaluated.sort((a, b) => {
        const scoreA = a.evaluation.f1Score * 1.2 + a.evaluation.recall * 0.4 + a.evaluation.accuracy * 0.2;
        const scoreB = b.evaluation.f1Score * 1.2 + b.evaluation.recall * 0.4 + b.evaluation.accuracy * 0.2;
        return scoreB - scoreA;
      });

      chosenArtifact = evaluated[0];
      selectionReason = `Automatically evaluated ${candidates.length} supported model families on your ${ds.rows.length.toLocaleString()}-record dataset using ${splitLabel} and selected ${chosenArtifact.evaluation.modelName} for the strongest held-out churn detection balance.`;
    } else {
      const fastModel: MLModelType = plan.allowedModels.includes('random_forest')
        ? 'random_forest'
        : 'logistic_regression';
      chosenArtifact = trainAndEvaluateModel(
        ds,
        {
          modelType: fastModel,
          testSplitRatio: 0.2,
          maxDepth: 5,
          nEstimators: 25,
          splitStrategy: chosenSplit,
        },
        nextVersion
      );
      selectionReason = `Automatically selected ${chosenArtifact.evaluation.modelName} (${splitLabel}) optimized for larger datasets (${ds.rows.length.toLocaleString()} records).`;
    }

    const ev = chosenArtifact.evaluation;
    const failedQualityCheck =
      ev.testCount < 3 ||
      !Number.isFinite(ev.accuracy) ||
      (ev.testChurnRate > 0 && ev.recall === 0 && ev.f1Score === 0);

    if (failedQualityCheck) {
      const qualityReason =
        ev.testCount < 3
          ? 'Not enough held-out test records were available to reliably verify prediction quality.'
          : 'Validation check detected 0% churn recall on held-out historical outcomes, meaning the model could not distinguish churned customers from retained ones yet.';

      ws.activeModelArtifact = null;
      const status: PredictionPipelineStatus = {
        stage: 'more_historical_data_required',
        headline: 'More historical data required.',
        summary:
          'ChurnSight built a candidate model, but withheld predictions because it did not pass minimum hold-out quality checks.',
        predictionAvailable: false,
        needsRefresh: true,
        refreshNotice: qualityReason,
        failureReason: qualityReason,
        recommendedAction:
          'Add more historical customer records with clear churned examples, or verify that relevant customer behavior columns (usage, tenure, billing, or plan) are mapped in Data Management.',
        selectedAlgorithmReason: selectionReason,
        updatedAt: now,
        steps: buildPipelineSteps({
          datasetFileName: state.fileName,
          rowCount: state.rowCount,
          missingCellCount: missingCells,
          duplicateCount: dupCount,
          featureCount,
          validationOk: true,
          labelsOk: true,
          modelBuilt: true,
          qualityOk: false,
          modelName: ev.modelName,
          splitLabel,
          qualityDetail: qualityReason,
        }),
      };
      ws.automationStatus = status;
      persistCompanyWorkspace(company.id, ws);
      return status;
    }

    ws.activeModelArtifact = chosenArtifact;
    ws.modelHistory = [ev, ...ws.modelHistory.slice(0, 9)];

    const hasLeakageWarning = (ev.leakageWarnings?.length || 0) > 0;
    const belowBaseline = ev.accuracy < ev.majorityBaselineAccuracy && ev.f1Score < 35;
    const needsRefresh = hasLeakageWarning || belowBaseline;
    const refreshNotice = hasLeakageWarning
      ? 'Potential post-churn columns were detected in your features. Review Data Management mappings and refresh your prediction model if needed.'
      : belowBaseline
        ? 'Prediction reliability is modest on the current dataset. Adding more behavioral history and refreshing the prediction model is recommended.'
        : null;

    const status: PredictionPipelineStatus = {
      stage: 'predictions_ready',
      headline: 'Predictions ready.',
      summary: `${ev.modelName} passed hold-out validation (${ev.accuracy.toFixed(1)}% accuracy on ${ev.testCount.toLocaleString()} unseen records) and churn predictions are active across your workspace.`,
      predictionAvailable: true,
      needsRefresh,
      refreshNotice,
      failureReason: null,
      recommendedAction: needsRefresh ? refreshNotice : null,
      selectedAlgorithmReason: selectionReason,
      updatedAt: now,
      steps: buildPipelineSteps({
        datasetFileName: state.fileName,
        rowCount: state.rowCount,
        missingCellCount: missingCells,
        duplicateCount: dupCount,
        featureCount,
        validationOk: true,
        labelsOk: true,
        modelBuilt: true,
        qualityOk: true,
        modelName: ev.modelName,
        splitLabel,
        qualityDetail: `${ev.accuracy.toFixed(1)}% accuracy, ${ev.recall.toFixed(1)}% churn recall on ${ev.testCount} held-out records`,
      }),
    };

    ws.automationStatus = status;
    ws.activeAnalytics = buildWorkspaceAnalytics(company, ws) || ws.activeAnalytics;
    persistCompanyWorkspace(company.id, ws);

    if (options?.actor) {
      recordAuditEvent({
        companyId: company.id,
        actorId: options.actor.id,
        actorEmail: options.actor.email,
        actorRole: options.actor.role,
        action: 'MANAGED_PREDICTION_READY',
        resource: 'model',
        details: `Managed setup selected ${ev.modelName} ${ev.version} (${ev.splitStrategy}, acc=${ev.accuracy}%, f1=${ev.f1Score}%)`,
      });
    }

    return status;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Automated prediction build failed.';
    ws.activeModelArtifact = null;
    const status: PredictionPipelineStatus = {
      stage: 'setup_failed',
      headline: 'Prediction setup could not be completed.',
      summary: 'Your data is saved for visual exploration, but automated prediction setup encountered an issue.',
      predictionAvailable: false,
      needsRefresh: true,
      refreshNotice: errMsg,
      failureReason: errMsg,
      recommendedAction:
        'Check your target churn column and feature selections in Data Management, then click Build prediction model.',
      selectedAlgorithmReason: null,
      updatedAt: now,
      steps: buildPipelineSteps({
        datasetFileName: state.fileName,
        rowCount: state.rowCount,
        missingCellCount: missingCells,
        duplicateCount: dupCount,
        featureCount,
        validationOk: true,
        labelsOk: true,
        modelBuilt: false,
        qualityOk: false,
        errorDetail: errMsg,
      }),
    };
    ws.automationStatus = status;
    persistCompanyWorkspace(company.id, ws);
    return status;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return req.secure || forwardedProto === 'https';
}

function isEmbeddedOrCrossSiteRequest(req: Request): boolean {
  const embeddedHeader = String(req.headers['x-churnsight-embedded'] || '').trim();
  const fetchSite = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
  return embeddedHeader === '1' || fetchSite === 'cross-site';
}

function setSessionCookie(
  req: Request,
  res: Response,
  token: string,
  maxAgeSeconds: number | null
): void {
  const https = isHttpsRequest(req);
  const embedded = isEmbeddedOrCrossSiteRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    https && embedded ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (maxAgeSeconds !== null) {
    parts.push(`Max-Age=${maxAgeSeconds}`);
    parts.push(`Expires=${new Date(Date.now() + maxAgeSeconds * 1000).toUTCString()}`);
  }
  if (https) {
    parts.push('Secure');
    if (embedded) {
      parts.push('Partitioned');
    }
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const https = isHttpsRequest(req);
  const expired = 'Expires=Thu, 01 Jan 1970 00:00:00 GMT';
  const cookies = [
    [
      `${SESSION_COOKIE_NAME}=`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=0',
      expired,
      ...(https ? ['Secure'] : []),
    ].join('; '),
  ];
  if (https) {
    cookies.push(
      [
        `${SESSION_COOKIE_NAME}=`,
        'Path=/',
        'HttpOnly',
        'SameSite=None',
        'Max-Age=0',
        expired,
        'Secure',
        'Partitioned',
      ].join('; ')
    );
  }
  res.setHeader('Set-Cookie', cookies);
}

function extractSessionToken(req: Request): string | undefined {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  return undefined;
}

interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractSessionToken(req);
  const ctx = getSessionContext(token);
  if (!ctx) {
    res.status(401).json({ error: 'Authentication required. Please sign in to continue.' });
    return;
  }
  req.auth = ctx;
  next();
}

function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.auth.user.role)) {
      res.status(403).json({
        error: allowedRoles.includes('PLATFORM_OWNER') && allowedRoles.length === 1
          ? 'Access denied. Platform Owner privileges are required.'
          : 'Access denied. Firm Administrator privileges are required for this action.',
      });
      return;
    }
    next();
  };
}

function requirePermission(perm: keyof UserPermissions) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (req.auth.user.role === 'FIRM_ADMIN' || req.auth.user.role === 'PLATFORM_OWNER') {
      next();
      return;
    }
    if (!req.auth.user.permissions[perm]) {
      res.status(403).json({
        error:
          perm === 'canUploadAndAnalyse'
            ? 'Your Analyst account does not have permission to upload or modify datasets.'
            : 'Your Analyst account does not have permission to train models or generate predictions.',
      });
      return;
    }
    next();
  };
}

function escapeCsvCell(val: string): string {
  const safe = /^[=+\-@]/.test(val) ? `'${val}` : val;
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function createApiApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '25mb' }));

  // Support optional cross-origin requests when frontend is on Vercel and backend is hosted separately
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    const allowedEnv = [
      ...(process.env.ALLOWED_ORIGINS || '').split(','),
      process.env.APP_URL || '',
    ]
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean);

    if (origin && (allowedEnv.length === 0 || allowedEnv.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type,Authorization,X-ChurnSight-Embedded'
      );
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', async (_req, res) => {
    const persistence = getPersistenceStatus();
    if (!persistence.persistent) {
      res.status(503).json({
        status: 'unconfigured',
        storagePersistent: false,
        storageMode: persistence.mode,
        provider: persistence.provider,
        message: persistence.message,
      });
      return;
    }

    let dbHealthy = true;
    if (isPostgresConfigured()) {
      dbHealthy = await pgHealthCheck();
    } else if (isKvConfigured()) {
      dbHealthy = await kvPing();
    }

    res.status(dbHealthy ? 200 : 503).json({
      status: dbHealthy ? 'ok' : 'degraded',
      storagePersistent: dbHealthy,
      storageMode: persistence.mode,
      provider: persistence.provider,
      message: dbHealthy
        ? persistence.message
        : `Database connectivity check failed for ${persistence.provider || persistence.mode}.`,
    });
  });

  const authLimiter = createRateLimiter({
    keyPrefix: 'auth',
    windowMs: 5 * 60 * 1000,
    maxRequests: 40,
    message: 'Too many authentication attempts. Please wait a few minutes and try again.',
  });

  const computeLimiter = createRateLimiter({
    keyPrefix: 'compute',
    windowMs: 5 * 60 * 1000,
    maxRequests: 80,
    message: 'Rate limit exceeded for data processing or model training requests.',
  });

  // Prevent caching of any API or auth responses (protects against back-button replay after logout)
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // Hydrate persistent stores on serverless cold starts & flush remote writes before response completes
  app.use('/api', async (req, res, next) => {
    if (req.path === '/health') {
      next();
      return;
    }
    try {
      const persistence = getPersistenceStatus();
      const token = extractSessionToken(req);

      if (persistence.persistent) {
        await Promise.all([ensureAuthHydrated(), ensureAuditLogsHydrated()]);
        let ctx = getSessionContext(token);
        if (token && (!ctx || isRemotePersistenceActive())) {
          const freshCtx = await hydrateSessionByToken(token);
          if (freshCtx) ctx = freshCtx;
        }
        if (ctx) {
          await ensureWorkspaceHydrated(ctx.company.id, isRemotePersistenceActive());
        }
      }

      if (isRemotePersistenceActive() && req.method !== 'GET' && req.method !== 'HEAD') {
        const origJson = res.json.bind(res);
        res.json = ((body: unknown) => {
          Promise.all([
            flushPendingAuthWrites(),
            flushAllPendingWorkspaceWrites(),
            flushPendingAuditWrites(),
          ])
            .then(() => {
              origJson(body);
            })
            .catch((err) => {
              console.error('Failed to flush persistent writes before response:', err);
              if (!res.headersSent) {
                res.status(503);
              }
              origJson({
                error:
                  err instanceof Error
                    ? err.message
                    : 'Database write failed. Please try again.',
                code: 'DATABASE_WRITE_FAILED',
              });
            });
          return res;
        }) as Response['json'];
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------------------
  // Authentication & Registration Routes
  // ---------------------------------------------------------------------------
  app.get('/api/auth/status', async (_req, res) => {
    const persistence = getPersistenceStatus();
    if (persistence.persistent && isRemotePersistenceActive()) {
      await ensureAuthHydrated(true).catch(() => undefined);
    }
    res.json({
      hasRegisteredWorkspaces: persistence.persistent ? hasAnyRegisteredUsers() : false,
      storagePersistent: persistence.persistent,
      storageMode: persistence.mode,
      provider: persistence.provider,
      message: persistence.message,
    });
  });

  app.post('/api/auth/register-company', authLimiter, async (req, res) => {
    try {
      if (isRemotePersistenceActive()) {
        await ensureAuthHydrated(true);
      }
      const body = (req.body || {}) as RegisterCompanyRequest;
      const result = registerCompanyAndAdmin(body);
      const session = createSessionForUser(result.user.id, true);
      setSessionCookie(req, res, session.rawToken, session.maxAgeSeconds);

      recordAuditEvent({
        companyId: result.company.id,
        actorId: result.user.id,
        actorEmail: result.user.email,
        actorRole: result.user.role,
        action: 'COMPANY_REGISTERED',
        resource: 'company',
        details: `Registered workspace "${result.company.name}" (${result.company.industry}, ${result.company.country})`,
      });

      await Promise.all([flushPendingAuthWrites(), flushPendingAuditWrites()]);

      res.status(201).json({
        company: session.context.company,
        user: session.context.user,
        expiresAt: session.context.expiresAt,
        rememberMe: session.rememberMe,
        sessionToken: session.rawToken,
        message: 'Company workspace and administrator account created.',
      });
    } catch (err: unknown) {
      if (err instanceof AuthServiceError) {
        res.status(err.statusCode).json({
          error: err.message,
          code: err.code,
        });
        return;
      }
      const message = err instanceof Error ? err.message : 'Registration failed.';
      const isDuplicate = /already exists|already registered/i.test(message);
      res.status(isDuplicate ? 409 : 400).json({
        error: message,
        ...(isDuplicate ? { code: 'ACCOUNT_ALREADY_EXISTS' } : {}),
      });
    }
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
      if (isRemotePersistenceActive()) {
        await ensureAuthHydrated(true);
      }
      const body = (req.body || {}) as LoginRequest;
      const { rawToken, rememberMe, maxAgeSeconds, context } = authenticateUser(body);
      setSessionCookie(req, res, rawToken, maxAgeSeconds);

      recordAuditEvent({
        companyId: context.company.id,
        actorId: context.user.id,
        actorEmail: context.user.email,
        actorRole: context.user.role,
        action: 'USER_LOGIN',
        resource: 'session',
        details: `Signed in to ${context.company.name}`,
      });

      await Promise.all([flushPendingAuthWrites(), flushPendingAuditWrites()]);

      res.json({
        user: context.user,
        company: context.company,
        expiresAt: context.expiresAt,
        rememberMe,
        sessionToken: rawToken,
      });
    } catch (err: unknown) {
      if (err instanceof AuthServiceError) {
        res.status(err.statusCode).json({
          error: err.message,
          code: err.code,
        });
        return;
      }
      const message = err instanceof Error ? err.message : 'Sign in failed.';
      res.status(401).json({ error: message });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    const token = extractSessionToken(req);
    const ctx = (await hydrateSessionByToken(token)) || getSessionContext(token);
    if (ctx) {
      recordAuditEvent({
        companyId: ctx.company.id,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        actorRole: ctx.user.role,
        action: 'USER_LOGOUT',
        resource: 'session',
        details: 'Signed out cleanly',
      });
    }
    revokeSession(token);
    await Promise.all([flushPendingAuthWrites(), flushPendingAuditWrites()]);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', async (req, res) => {
    const persistence = getPersistenceStatus();
    if (!persistence.persistent) {
      res.status(503).json({
        error: persistence.message,
        code: 'DATABASE_NOT_CONFIGURED',
      });
      return;
    }
    const token = extractSessionToken(req);
    if (token && isRemotePersistenceActive()) {
      await hydrateSessionByToken(token).catch(() => undefined);
    }
    const refreshed = refreshSessionIfNeeded(token, false);
    if (!refreshed) {
      clearSessionCookie(req, res);
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    if (refreshed.refreshed && token) {
      setSessionCookie(req, res, token, refreshed.maxAgeSeconds);
      await flushPendingAuthWrites();
    }
    res.json({
      user: refreshed.context.user,
      company: refreshed.context.company,
      expiresAt: refreshed.context.expiresAt,
      rememberMe: refreshed.context.rememberMe,
    });
  });

  app.post('/api/auth/refresh', async (req, res) => {
    const token = extractSessionToken(req);
    if (token && isRemotePersistenceActive()) {
      await hydrateSessionByToken(token).catch(() => undefined);
    }
    const refreshed = refreshSessionIfNeeded(token, true);
    if (!refreshed || !token) {
      clearSessionCookie(req, res);
      res.status(401).json({ error: 'Session expired. Please sign in again.' });
      return;
    }
    setSessionCookie(req, res, token, refreshed.maxAgeSeconds);
    await flushPendingAuthWrites();
    res.json({
      user: refreshed.context.user,
      company: refreshed.context.company,
      expiresAt: refreshed.context.expiresAt,
      rememberMe: refreshed.context.rememberMe,
    });
  });

  app.post('/api/auth/forgot-password', authLimiter, (req, res) => {
    try {
      const { email } = (req.body || {}) as { email?: string };
      checkEmailRegisteredForReset(email || '');
      res.json({
        emailConfigured: false,
        message:
          'Automated password reset email delivery is not configured on this server (no SMTP or transactional email service is connected). Please contact your Company Firm Administrator to reset your account password from Manage Users.',
      });
    } catch (err: unknown) {
      if (err instanceof AuthServiceError) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
      }
      const message = err instanceof Error ? err.message : 'Invalid email address.';
      res.status(400).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // User Profile & Password Management (Authenticated)
  // ---------------------------------------------------------------------------
  app.patch('/api/auth/profile', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const { fullName, avatarDataUrl } = (req.body || {}) as {
        fullName?: string;
        avatarDataUrl?: string | null;
      };
      const user = updateOwnProfile(req.auth!.user.id, { fullName, avatarDataUrl });
      res.json({ user });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update profile.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/auth/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const { currentPassword, newPassword, confirmNewPassword } = (req.body || {}) as {
        currentPassword?: string;
        newPassword?: string;
        confirmNewPassword?: string;
      };
      changeOwnPassword(
        req.auth!.user.id,
        currentPassword || '',
        newPassword || '',
        confirmNewPassword || '',
        req.auth!.tokenHash
      );

      recordAuditEvent({
        companyId: req.auth!.company.id,
        actorId: req.auth!.user.id,
        actorEmail: req.auth!.user.email,
        actorRole: req.auth!.user.role,
        action: 'PASSWORD_CHANGED',
        resource: 'user',
        details: 'User updated account password',
      });

      res.json({ ok: true, message: 'Your password has been updated successfully.' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to change password.';
      res.status(400).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // Company Settings, Churn Definition, Usage & User Management (Company-Isolated)
  // ---------------------------------------------------------------------------
  app.put(
    '/api/company',
    requireAuth,
    requireRole('FIRM_ADMIN', 'PLATFORM_OWNER'),
    (req: AuthenticatedRequest, res) => {
      try {
        const body = (req.body || {}) as {
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
          churnDefinition?: ChurnDefinition;
        };

        const company = updateCompanyProfile(req.auth!.company.id, body);
        const ws = getCompanyWorkspace(company.id);

        let updatedDataset: DatasetState | null = ws.activeDataset?.state || null;
        let updatedAnalytics: AnalyticsSummary | null = ws.activeAnalytics;

        if ((body.churnDefinition || body.industry) && ws.activeDataset) {
          const labelReadiness = evaluateChurnReadiness(
            ws.activeDataset.state.columns,
            ws.activeDataset.rows,
            ws.activeDataset.state.mapping,
            company.churnDefinition
          );
          const readiness = assessDataReadiness({
            columns: ws.activeDataset.state.columns,
            rows: ws.activeDataset.rows,
            mapping: ws.activeDataset.state.mapping,
            churnDefinition: company.churnDefinition,
            industry: company.industry,
          });
          ws.activeDataset.state = {
            ...ws.activeDataset.state,
            churnDefinition: company.churnDefinition,
            hasValidChurnLabels: labelReadiness.hasValidChurnLabels,
            churnReadinessMessage: labelReadiness.churnReadinessMessage,
            readiness,
          };
          ws.activeAnalytics =
            buildWorkspaceAnalytics(company, ws) ||
            computeAnalytics(
              ws.activeDataset.state.columns,
              ws.activeDataset.rows,
              ws.activeDataset.state.mapping,
              {},
              company.churnDefinition
            );
          persistCompanyWorkspace(company.id, ws);
          runAutomatedPredictionSetup(company, ws, {
            allowModelExecution:
              req.auth!.user.role !== 'ANALYST' || req.auth!.user.permissions.canGeneratePredictions,
            actor: {
              id: req.auth!.user.id,
              email: req.auth!.user.email,
              role: req.auth!.user.role,
            },
          });
          updatedDataset = ws.activeDataset.state;
          updatedAnalytics = ws.activeAnalytics;
        }

        recordAuditEvent({
          companyId: company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'COMPANY_SETTINGS_UPDATED',
          resource: 'company',
          details: `Updated workspace profile (${company.industry}, ${company.subscriptionPlan} plan)`,
        });

        res.json({
          company,
          dataset: updatedDataset,
          analytics: updatedAnalytics,
          activeModel: serializeActiveModelEvaluation(ws),
          modelHistory: ws.modelHistory,
          automationStatus: ws.automationStatus,
          usage: buildUsageSummary(company, ws),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to update company settings.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.put(
    '/api/company/churn-definition',
    requireAuth,
    requirePermission('canUploadAndAnalyse'),
    (req: AuthenticatedRequest, res) => {
      try {
        const incoming = (req.body || {}) as ChurnDefinition;
        const company = updateCompanyProfile(req.auth!.company.id, {
          churnDefinition: incoming,
        });
        const ws = getCompanyWorkspace(company.id);

        if (ws.activeDataset) {
          const labelReadiness = evaluateChurnReadiness(
            ws.activeDataset.state.columns,
            ws.activeDataset.rows,
            ws.activeDataset.state.mapping,
            company.churnDefinition
          );
          const readiness = assessDataReadiness({
            columns: ws.activeDataset.state.columns,
            rows: ws.activeDataset.rows,
            mapping: ws.activeDataset.state.mapping,
            churnDefinition: company.churnDefinition,
            industry: company.industry,
          });
          ws.activeDataset.state = {
            ...ws.activeDataset.state,
            churnDefinition: company.churnDefinition,
            hasValidChurnLabels: labelReadiness.hasValidChurnLabels,
            churnReadinessMessage: labelReadiness.churnReadinessMessage,
            readiness,
          };
          ws.activeAnalytics =
            buildWorkspaceAnalytics(company, ws) ||
            computeAnalytics(
              ws.activeDataset.state.columns,
              ws.activeDataset.rows,
              ws.activeDataset.state.mapping,
              {},
              company.churnDefinition
            );
          persistCompanyWorkspace(company.id, ws);
          runAutomatedPredictionSetup(company, ws, {
            allowModelExecution:
              req.auth!.user.role !== 'ANALYST' || req.auth!.user.permissions.canGeneratePredictions,
            actor: {
              id: req.auth!.user.id,
              email: req.auth!.user.email,
              role: req.auth!.user.role,
            },
          });
        }

        recordAuditEvent({
          companyId: company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'CHURN_DEFINITION_UPDATED',
          resource: 'churn_definition',
          details: `Configured ${company.churnDefinition.triggerType} (${company.churnDefinition.reportingPeriod}, confirmed=${company.churnDefinition.confirmedByUser})`,
        });

        res.json({
          company,
          dataset: ws.activeDataset ? ws.activeDataset.state : null,
          analytics: ws.activeAnalytics,
          activeModel: serializeActiveModelEvaluation(ws),
          modelHistory: ws.modelHistory,
          automationStatus: ws.automationStatus,
          usage: buildUsageSummary(company, ws),
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Failed to update churn definition.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.put(
    '/api/company/privacy',
    requireAuth,
    requireRole('FIRM_ADMIN', 'PLATFORM_OWNER'),
    (req: AuthenticatedRequest, res) => {
      try {
        const body = (req.body || {}) as Partial<DataPrivacySettings>;
        const company = updateCompanyProfile(req.auth!.company.id, {
          privacySettings: {
            allowSharedModelContribution: body.allowSharedModelContribution,
            optInCrossCompanyBaseline: body.optInCrossCompanyBaseline,
          },
        });

        recordAuditEvent({
          companyId: company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'DATA_PRIVACY_SETTINGS_UPDATED',
          resource: 'privacy',
          details: `Updated consent flags (sharedContribution=${company.privacySettings?.allowSharedModelContribution}, crossCompanyOptIn=${company.privacySettings?.optInCrossCompanyBaseline})`,
        });

        res.json({ company });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Failed to update privacy settings.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.get('/api/workspace/usage', requireAuth, (req: AuthenticatedRequest, res) => {
    const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
    const ws = getCompanyWorkspace(company.id);
    res.json({
      usage: buildUsageSummary(company, ws),
      plans: SUBSCRIPTION_PLAN_LIST,
    });
  });

  app.get(
    '/api/audit-logs',
    requireAuth,
    requireRole('FIRM_ADMIN', 'PLATFORM_OWNER'),
    (req: AuthenticatedRequest, res) => {
      const plan = getSubscriptionPlanSpec(req.auth!.company.subscriptionPlan);
      if (!plan.allowAuditLogs && req.auth!.user.role !== 'PLATFORM_OWNER') {
        res.status(403).json({
          error: `Workspace audit logs require Professional or Enterprise tier (current plan: ${plan.name}).`,
        });
        return;
      }
      res.json({ auditLogs: listCompanyAuditLogs(req.auth!.company.id, 100) });
    }
  );

  app.get(
    '/api/users',
    requireAuth,
    requireRole('FIRM_ADMIN', 'PLATFORM_OWNER'),
    (req: AuthenticatedRequest, res) => {
      const users = listCompanyUsers(req.auth!.company.id);
      const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
      const ws = getCompanyWorkspace(company.id);
      res.json({ users, usage: buildUsageSummary(company, ws) });
    }
  );

  app.post(
    '/api/users',
    requireAuth,
    requireRole('FIRM_ADMIN', 'PLATFORM_OWNER'),
    (req: AuthenticatedRequest, res) => {
      try {
        const body = (req.body || {}) as {
          fullName?: string;
          email?: string;
          password?: string;
          role?: UserRole;
          permissions?: Partial<UserPermissions>;
        };
        const user = createCompanyUser(req.auth!.company.id, {
          fullName: body.fullName || '',
          email: body.email || '',
          password: body.password || '',
          role: body.role === 'FIRM_ADMIN' ? 'FIRM_ADMIN' : 'ANALYST',
          permissions: body.permissions,
        });

        recordAuditEvent({
          companyId: req.auth!.company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'USER_CREATED',
          resource: 'user',
          details: `Created ${user.role} account for ${user.email}`,
        });

        res.status(201).json({ user });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to create user.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.patch(
    '/api/users/:userId',
    requireAuth,
    requireRole('FIRM_ADMIN', 'PLATFORM_OWNER'),
    (req: AuthenticatedRequest, res) => {
      try {
        const userId = String(req.params.userId || '');
        const body = (req.body || {}) as {
          role?: UserRole;
          isActive?: boolean;
          permissions?: Partial<UserPermissions>;
          newPassword?: string;
        };
        const user = updateCompanyUser(req.auth!.company.id, req.auth!.user.id, userId, body);

        recordAuditEvent({
          companyId: req.auth!.company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'USER_UPDATED',
          resource: 'user',
          details: `Updated account ${user.email} (active=${user.isActive}, role=${user.role})`,
        });

        res.json({ user });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to update user.';
        res.status(400).json({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Protected, Company-Isolated ChurnSight Data & ML Routes
  // ---------------------------------------------------------------------------

  // 1. Get current company workspace application state
  app.get('/api/state', requireAuth, (req: AuthenticatedRequest, res) => {
    const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
    const ws = getCompanyWorkspace(company.id);
    const plan = getSubscriptionPlanSpec(company.subscriptionPlan);
    const canSeeLogs =
      (req.auth!.user.role === 'FIRM_ADMIN' || req.auth!.user.role === 'PLATFORM_OWNER') &&
      (plan.allowAuditLogs || req.auth!.user.role === 'PLATFORM_OWNER');

    if (
      ws.activeDataset &&
      (!ws.activeAnalytics ||
        !ws.activeAnalytics.historicalPerformance ||
        (ws.activeModelArtifact && !ws.activeAnalytics.activeRiskSummary))
    ) {
      ws.activeAnalytics = buildWorkspaceAnalytics(company, ws) || ws.activeAnalytics;
    }

    res.json({
      company,
      dataset: ws.activeDataset ? ws.activeDataset.state : null,
      uploadedDatasets: listUploadedDatasetSummaries(ws),
      analytics: ws.activeAnalytics,
      activeModel: serializeActiveModelEvaluation(ws),
      modelHistory: ws.modelHistory,
      batchScores: ws.batchScores || [],
      automationStatus: ws.automationStatus || null,
      usage: buildUsageSummary(company, ws),
      auditLogs: canSeeLogs ? listCompanyAuditLogs(company.id, 50) : [],
    });
  });

  // 2. Load industry-aware demonstration dataset (company-isolated)
  app.post(
    '/api/dataset/load-sample',
    requireAuth,
    requirePermission('canUploadAndAnalyse'),
    (req: AuthenticatedRequest, res) => {
      try {
        const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
        const ws = getCompanyWorkspace(company.id);
        const sample = generateSampleIndustryCsv(company.industry, 250);
        const { headers, rows, sourceFormat } = parseSpreadsheetUpload({
          fileName: sample.fileName,
          csvText: sample.csvText,
        });

        const confirmedChurnDef: ChurnDefinition = {
          ...(company.churnDefinition || buildDefaultChurnDefinition(company.industry)),
          confirmedByUser: true,
          confirmedAt: company.churnDefinition?.confirmedAt || new Date().toISOString(),
        };

        const result = commitRowsIntoWorkspace(company, ws, {
          fileName: sample.fileName,
          sourceFormat,
          headers,
          rows,
          churnDefinition: confirmedChurnDef,
          duplicateStrategy: 'replace',
          isSample: true,
        });

        const automationStatus = runAutomatedPredictionSetup(company, ws, {
          allowModelExecution:
            req.auth!.user.role !== 'ANALYST' || req.auth!.user.permissions.canGeneratePredictions,
          actor: {
            id: req.auth!.user.id,
            email: req.auth!.user.email,
            role: req.auth!.user.role,
          },
        });

        recordAuditEvent({
          companyId: company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'SAMPLE_DATASET_LOADED',
          resource: 'dataset',
          details: `Loaded ${sample.fileName} (${rows.length} rows)`,
        });

        res.json({
          ...result,
          uploadedDatasets: listUploadedDatasetSummaries(ws),
          usage: buildUsageSummary(company, ws),
          activeModel: serializeActiveModelEvaluation(ws),
          modelHistory: ws.modelHistory,
          automationStatus,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load sample dataset.';
        res.status(400).json({ error: message });
      }
    }
  );

  // 3. Download industry-appropriate sample CSV file
  app.get('/api/dataset/sample-csv', requireAuth, (req: AuthenticatedRequest, res) => {
    const sample = generateSampleIndustryCsv(req.auth!.company.industry, 250);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${sample.fileName}"`);
    res.send(sample.csvText);
  });

  // 3b. Download industry-specific CSV or Excel (.xlsx) onboarding, comprehensive, ticket, or prediction template
  app.get('/api/dataset/template', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
      const requestedIndustry = String(req.query.industry || company.industry) as IndustryKey;
      const industry: IndustryKey = INDUSTRY_PROFILES[requestedIndustry]
        ? requestedIndustry
        : company.industry;
      const format: TemplateFormat =
        String(req.query.format || 'csv').toLowerCase() === 'xlsx' ? 'xlsx' : 'csv';
      const rawMode = String(req.query.mode || 'established_historical').toLowerCase();
      const rawScope = String(req.query.scope || '').toLowerCase();
      const scope: 'comprehensive' | 'tickets' | 'pathway' =
        rawScope === 'tickets' || rawMode === 'tickets'
          ? 'tickets'
          : rawScope === 'pathway'
            ? 'pathway'
            : 'comprehensive';

      if (rawMode === 'prediction_input') {
        const ws = getCompanyWorkspace(company.id);
        if (!ws.activeModelArtifact) {
          res.status(400).json({
            error:
              'A validated prediction model is required before downloading the Current Customer Prediction Template. Upload historical churn data or collect sufficient observed outcomes first.',
          });
          return;
        }
        const exported = generatePredictionInputTemplateExport({
          industry: company.industry,
          format,
          artifact: ws.activeModelArtifact,
          customIndustryName: company.customIndustryName,
        });
        res.setHeader('Content-Type', exported.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${exported.fileName}"`);
        res.send(exported.body);
        return;
      }

      const mode: LegacyCompatibleTemplateMode = normalizeTemplateMode(rawMode);
      const exported = generateIndustryTemplateExport({
        industry,
        format,
        mode,
        scope,
        customIndustryName: company.customIndustryName,
      });

      res.setHeader('Content-Type', exported.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${exported.fileName}"`);
      res.send(exported.body);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate template.';
      res.status(400).json({ error: message });
    }
  });

  // 3b-ii. Model-driven Current Customer Prediction Input Template (meta preview or CSV/XLSX download)
  app.get('/api/dataset/prediction-template', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
      const ws = getCompanyWorkspace(company.id);
      const wantMeta = String(req.query.meta || '') === '1';

      if (wantMeta) {
        if (!ws.activeModelArtifact) {
          res.json({
            available: false,
            modelVersion: null,
            modelName: null,
            columns: [],
            reason:
              'No validated prediction model is active in this workspace yet. Upload historical data with churn outcomes or record enough outcomes to unlock prediction templates.',
          });
          return;
        }
        const preview = generatePredictionInputTemplateExport({
          industry: company.industry,
          format: 'csv',
          artifact: ws.activeModelArtifact,
          customIndustryName: company.customIndustryName,
        });
        res.json({
          available: true,
          modelVersion: ws.activeModelArtifact.evaluation.version,
          modelName: ws.activeModelArtifact.evaluation.modelName,
          columns: preview.columns,
          reason: null,
        });
        return;
      }

      if (!ws.activeModelArtifact) {
        res.status(400).json({
          error:
            'No validated prediction model is active yet. Upload historical data with confirmed churn outcomes or collect enough observed outcomes first.',
        });
        return;
      }

      const format: TemplateFormat =
        String(req.query.format || 'csv').toLowerCase() === 'xlsx' ? 'xlsx' : 'csv';
      const exported = generatePredictionInputTemplateExport({
        industry: company.industry,
        format,
        artifact: ws.activeModelArtifact,
        customIndustryName: company.customIndustryName,
      });

      res.setHeader('Content-Type', exported.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${exported.fileName}"`);
      res.send(exported.body);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to build current customer prediction template.';
      res.status(400).json({ error: message });
    }
  });

  // 3c. Current workspace data readiness assessment & schema template guide
  app.get('/api/dataset/readiness', requireAuth, (req: AuthenticatedRequest, res) => {
    const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
    const ws = getCompanyWorkspace(company.id);
    const modeParam = normalizeTemplateMode(String(req.query.mode || 'established_historical'));
    const templateColumns = getIndustryDataTemplateColumns(company.industry, modeParam);
    let readiness = ws.activeDataset?.state.readiness || null;
    if (ws.activeDataset && !readiness) {
      readiness = assessDataReadiness({
        columns: ws.activeDataset.state.columns,
        rows: ws.activeDataset.rows,
        mapping: ws.activeDataset.state.mapping,
        churnDefinition: company.churnDefinition,
        industry: company.industry,
      });
    }
    res.json({
      readiness,
      templateColumns,
      privacySettings: company.privacySettings,
    });
  });

  // 4a. Stage CSV or Excel upload for schema profiling, multi-sheet ticket linking, validation & preview
  app.post(
    '/api/dataset/stage',
    requireAuth,
    requirePermission('canUploadAndAnalyse'),
    computeLimiter,
    (req: AuthenticatedRequest, res) => {
      try {
        const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
        const ws = getCompanyWorkspace(company.id);
        const {
          fileName,
          csvText,
          fileBase64,
          uploadPathway: rawPathway,
          uploadMode: rawUploadMode,
          satisfactionScale: rawScale,
        } = (req.body || {}) as {
          fileName?: string;
          csvText?: string;
          fileBase64?: string;
          uploadPathway?: UploadPathway;
          uploadMode?: 'customer' | 'tickets';
          satisfactionScale?: SatisfactionScale;
        };

        const uploadPathway: UploadPathway | undefined =
          rawPathway === 'new_business' ||
          rawPathway === 'established_historical' ||
          rawPathway === 'current_prediction' ||
          rawPathway === 'existing_custom'
            ? rawPathway
            : undefined;

        const satisfactionScale: SatisfactionScale =
          rawScale === '1-5' || rawScale === '1-10' || rawScale === '0-100' || rawScale === 'nps'
            ? rawScale
            : ws.satisfactionScale || company.satisfactionScale || '1-5';

        const safeName = (fileName || 'uploaded_customers.csv').trim();
        const rawByteSize = csvText
          ? Buffer.byteLength(csvText, 'utf-8')
          : fileBase64
            ? Math.ceil((fileBase64.length * 3) / 4)
            : 0;

        const parsed = parseMultiSheetSpreadsheetUpload({
          fileName: safeName,
          csvText,
          fileBase64,
          requestedUploadMode: rawUploadMode,
        });

        let headers = parsed.headers;
        let rows = parsed.rows;
        const sourceFormat = parsed.sourceFormat;
        const uploadMode = parsed.detectedUploadMode;
        let ticketAggregation: TicketAggregationSummary | null = null;
        let duplicateTicketIds = 0;

        enforceDatasetPlanQuota(company, rows.length, rawByteSize);

        // Standalone ticket history upload mode
        if (uploadMode === 'tickets') {
          const activeValidCustomerIds = new Set<string>();
          if (ws.activeDataset) {
            const activeIdCol = ws.activeDataset.state.mapping.idColumn;
            if (activeIdCol) {
              for (const r of ws.activeDataset.rows) {
                const cid = String(r[activeIdCol] || '').trim();
                if (cid) activeValidCustomerIds.add(cid.toLowerCase());
              }
            }
          }

          const agg = aggregateTicketsByCustomer(parsed.ticketSheetRows, parsed.ticketSheetHeaders, {
            validCustomerIds: activeValidCustomerIds.size > 0 ? activeValidCustomerIds : undefined,
          });
          duplicateTicketIds = agg.duplicateTicketIds;
          if (!ws.activeDataset) {
            ticketAggregation = {
              source: 'standalone_ticket_upload',
              ticketRowsCount: parsed.ticketSheetRows.length,
              validTicketRows: agg.validTicketRows,
              warningTicketRows: agg.warningTicketRows,
              errorTicketRows: agg.errorTicketRows,
              duplicateTicketIds: agg.duplicateTicketIds,
              invalidTicketRows: agg.invalidTicketRows,
              matchedCustomersCount: 0,
              unmatchedTicketCount: agg.byCustomerId.size,
              unmatchedTicketRowsCount: parsed.ticketSheetRows.length,
              doubleCountingPrevented: true,
              ticketIssues: agg.ticketRowIssues.slice(0, 50),
              note: 'No active customer dataset loaded yet. Upload your Customer_Data file first before linking standalone Ticket_Data.',
            };
          } else {
            const activeHeaders = ws.activeDataset.state.columns.map((c) => c.name);
            const previewMerge = mergeTicketsIntoCustomerRows({
              source: 'standalone_ticket_upload',
              customerHeaders: activeHeaders,
              customerRows: ws.activeDataset.rows,
              ticketHeaders: parsed.ticketSheetHeaders,
              ticketRows: parsed.ticketSheetRows,
              idColumnHint: ws.activeDataset.state.mapping.idColumn,
            });
            ticketAggregation = previewMerge.summary;
          }

          const columns = profileColumns(headers, rows);
          const { duplicateCount, missingCellCount } = computeDatasetQualityStats(headers, rows);
          const suggestedMapping = autoDetectMapping(columns, rows, company.industry, 'new_business');
          const suggestedChurnDefinition =
            company.churnDefinition || buildDefaultChurnDefinition(company.industry);
          const stagedId = `stg_${Date.now()}`;

          const ticketIssues = !ws.activeDataset
            ? [
                {
                  severity: 'warning' as const,
                  message:
                    'Upload customer master records first so Ticket_Data can link to Customer_IDs.',
                },
              ]
            : [];

          if (ticketAggregation.unmatchedTicketRowsCount && ticketAggregation.unmatchedTicketRowsCount > 0 && ws.activeDataset) {
            ticketIssues.push({
              severity: 'warning' as const,
              message: `${ticketAggregation.unmatchedTicketRowsCount} ticket row(s) reference a Customer_ID not found in the active Customer_Data table.`,
            });
          }

          const ticketIssuesSummary: { label: string; count: number; severity: 'warning' | 'error' }[] = [];
          if (agg.duplicateTicketIds > 0) {
            ticketIssuesSummary.push({
              label: 'Duplicate Ticket_ID',
              count: agg.duplicateTicketIds,
              severity: 'error',
            });
          }
          if (agg.unmatchedTicketRowsCount > 0) {
            ticketIssuesSummary.push({
              label: 'Unmatched Customer_ID in Ticket_Data',
              count: agg.unmatchedTicketRowsCount,
              severity: 'warning',
            });
          }
          if (agg.warningTicketRows > 0 && agg.warningTicketRows > agg.unmatchedTicketRowsCount) {
            ticketIssuesSummary.push({
              label: 'Ticket Date / Duration Warnings',
              count: agg.warningTicketRows - agg.unmatchedTicketRowsCount,
              severity: 'warning',
            });
          }

          const meta: StagedDatasetImport = {
            stagedId,
            fileName: safeName,
            sourceFormat,
            uploadPathway,
            uploadMode: 'tickets',
            satisfactionScale,
            isSample: false,
            uploadedAt: new Date().toISOString(),
            rowCount: rows.length,
            columnCount: columns.length,
            duplicateCount,
            missingCellCount,
            columns,
            suggestedMapping,
            suggestedChurnDefinition,
            targetUniqueValues: [],
            previewRows: rows.slice(0, 12),
            issues: ticketIssues,
            isValid: Boolean(ws.activeDataset),
            hasValidChurnLabels: false,
            churnReadinessMessage:
              ticketAggregation.note,
            ticketAggregation,
            rowValidation: {
              totalRows: rows.length,
              validCount: agg.validTicketRows,
              warningCount: agg.warningTicketRows,
              errorCount: agg.errorTicketRows,
              duplicateCustomerIds: 0,
              duplicateTicketIds: agg.duplicateTicketIds,
              missingValuesCount: missingCellCount,
              mappedFieldsCount: headers.length,
              unmappedColumns: [],
              issuesSummary: ticketIssuesSummary,
              rowErrors: agg.ticketRowIssues,
              previewRecords: [],
              hasRejectedRowsCsv: false,
            },
          };

          const stagedPayload = {
            meta,
            rows,
            ticketRows: parsed.ticketSheetRows,
            rawByteSize,
          };
          persistStagedImport(company.id, stagedPayload);

          res.json({ stagedImport: meta });
          return;
        }

        // If multi-sheet .xlsx contains Ticket_Data alongside Customer_Data, aggregate tickets cleanly without double-counting
        if (parsed.ticketSheetRows.length > 0) {
          const merged = mergeTicketsIntoCustomerRows({
            source: 'embedded_sheet',
            customerHeaders: headers,
            customerRows: rows,
            ticketHeaders: parsed.ticketSheetHeaders,
            ticketRows: parsed.ticketSheetRows,
          });
          headers = merged.headers;
          rows = merged.rows;
          ticketAggregation = merged.summary;
          duplicateTicketIds = merged.duplicateTicketIds;
        }

        const columns = profileColumns(headers, rows);
        const { duplicateCount, missingCellCount } = computeDatasetQualityStats(headers, rows);
        const suggestedMapping = autoDetectMapping(
          columns,
          rows,
          company.industry,
          uploadPathway,
          company.churnDefinition
        );
        const mappingRationales = buildMappingRationales(
          columns,
          suggestedMapping,
          company.industry
        );
        const suggestedChurnDefinition =
          company.churnDefinition || buildDefaultChurnDefinition(company.industry);
        const targetUniqueValues = suggestedMapping.targetColumn
          ? getUniqueColumnValues(rows, suggestedMapping.targetColumn)
          : [];
        const { issues, isValid } = validateDataset(columns, rows, suggestedMapping);
        if (ticketAggregation) {
          if (
            (ticketAggregation.errorTicketRows ?? 0) > 0 ||
            (ticketAggregation.warningTicketRows ?? 0) > 0 ||
            (ticketAggregation.unmatchedTicketRowsCount ?? 0) > 0
          ) {
            issues.push({
              severity: (ticketAggregation.errorTicketRows ?? 0) > 0 ? 'warning' : 'info',
              message: `Ticket_Data sheet validated separately: ${ticketAggregation.validTicketRows ?? 0} clean, ${ticketAggregation.warningTicketRows ?? 0} warning(s), ${ticketAggregation.errorTicketRows ?? 0} error(s)${
                (ticketAggregation.unmatchedTicketRowsCount ?? 0) > 0
                  ? `, ${ticketAggregation.unmatchedTicketRowsCount} ticket row(s) with Customer_ID not found in Customer_Data`
                  : ''
              }.`,
            });
          }
        }
        const labelReadiness = evaluateChurnReadiness(
          columns,
          rows,
          suggestedMapping,
          suggestedChurnDefinition
        );
        const readiness = assessDataReadiness({
          columns,
          rows,
          mapping: suggestedMapping,
          churnDefinition: suggestedChurnDefinition,
          industry: company.industry,
        });
        const invalidDateCount = columns.reduce((acc, c) => acc + (c.invalidDateCount || 0), 0);
        const inconsistentCategoryCount = columns.reduce(
          (acc, c) => acc + (c.inconsistentCategoryCount || 0),
          0
        );

        const mappedKeySet = new Set(
          [
            suggestedMapping.targetColumn,
            suggestedMapping.idColumn,
            suggestedMapping.contractColumn,
            suggestedMapping.tenureColumn,
            suggestedMapping.monthlyChargesColumn,
            suggestedMapping.dateColumn,
            suggestedMapping.observationDateColumn,
            suggestedMapping.registrationDateColumn,
            suggestedMapping.churnDateColumn,
            suggestedMapping.statusColumn,
            suggestedMapping.frequencyColumn,
            ...suggestedMapping.featureColumns,
          ].filter(Boolean)
        );
        const unmappedColumns = headers.filter((h) => !mappedKeySet.has(h));

        const {
          report: rowValidation,
          validRowsOnly,
          rejectedRowsCsv,
        } = validateCustomerImportRows({
          headers,
          rows,
          mapping: suggestedMapping,
          uploadPathway,
          uploadMode: 'customer',
          satisfactionScale,
          unmappedColumns,
          duplicateTicketIds,
        });

        // Detect overlapping Customer_IDs against currently active workspace dataset
        let duplicateConflict: DuplicateCustomerConflictSummary | null = null;
        if (ws.activeDataset && ws.activeDataset.rows.length > 0 && suggestedMapping.idColumn) {
          const existingIdCol = ws.activeDataset.state.mapping.idColumn || suggestedMapping.idColumn;
          const existingIds = new Set<string>();
          for (const er of ws.activeDataset.rows) {
            const val = (er[existingIdCol] || '').trim();
            if (val) existingIds.add(val.toLowerCase());
          }
          const matchedDuplicates: string[] = [];
          let conflictCount = 0;
          for (const nr of rows) {
            const val = (nr[suggestedMapping.idColumn] || '').trim();
            if (val && existingIds.has(val.toLowerCase())) {
              conflictCount++;
              if (matchedDuplicates.length < 8 && !matchedDuplicates.includes(val)) {
                matchedDuplicates.push(val);
              }
            }
          }
          if (conflictCount > 0) {
            duplicateConflict = {
              existingCount: ws.activeDataset.rows.length,
              conflictCount,
              sampleDuplicateIds: matchedDuplicates,
              existingDatasetFileName: ws.activeDataset.state.fileName,
            };
          }
        }

        const modelCompatibility =
          uploadPathway === 'current_prediction' || ws.activeModelArtifact
            ? checkModelCompatibility(headers, ws.activeModelArtifact)
            : null;

        const stagedId = `stg_${Date.now()}`;
        const meta: StagedDatasetImport = {
          stagedId,
          fileName: safeName,
          sourceFormat,
          uploadPathway,
          uploadMode: 'customer',
          satisfactionScale,
          isSample: false,
          uploadedAt: new Date().toISOString(),
          rowCount: rows.length,
          columnCount: columns.length,
          duplicateCount,
          missingCellCount,
          invalidDateCount,
          inconsistentCategoryCount,
          columns,
          suggestedMapping,
          mappingRationales,
          suggestedChurnDefinition,
          targetUniqueValues,
          previewRows: rows.slice(0, 12),
          issues,
          isValid,
          hasValidChurnLabels: labelReadiness.hasValidChurnLabels,
          churnReadinessMessage: labelReadiness.churnReadinessMessage,
          readiness,
          rowValidation,
          ticketAggregation,
          modelCompatibility,
          duplicateConflict,
        };

        persistStagedImport(company.id, {
          meta,
          rows,
          validRowsOnly,
          ticketRows: parsed.ticketSheetRows,
          rejectedRowsCsv,
          rawByteSize,
        });

        recordAuditEvent({
          companyId: company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'DATASET_STAGED',
          resource: 'dataset',
          details: `Staged ${safeName} (${rows.length} rows, ${columns.length} cols, valid=${rowValidation.validCount}, warnings=${rowValidation.warningCount}, errors=${rowValidation.errorCount})`,
        });

        res.json({ stagedImport: meta });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to parse spreadsheet file.';
        res.status(400).json({ error: message });
      }
    }
  );

  // 4a-ii. Download rejected / invalid staged rows with error explanations as CSV
  app.get('/api/dataset/staged-rejected-csv', requireAuth, (req: AuthenticatedRequest, res) => {
    const ws = getCompanyWorkspace(req.auth!.company.id);
    if (!ws.stagedImport?.rejectedRowsCsv) {
      res.status(404).json({ error: 'No rejected rows report is available for the current staged upload.' });
      return;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="rejected_rows_${ws.stagedImport.meta.stagedId}.csv"`
    );
    res.send(ws.stagedImport.rejectedRowsCsv);
  });

  // 4a-iii. Save workspace satisfaction scale configuration (1-5, 1-10, 0-100, NPS)
  app.put(
    '/api/company/satisfaction-scale',
    requireAuth,
    requirePermission('canUploadAndAnalyse'),
    (req: AuthenticatedRequest, res) => {
      try {
        const { satisfactionScale } = (req.body || {}) as {
          satisfactionScale?: SatisfactionScale;
        };
        if (
          satisfactionScale !== '1-5' &&
          satisfactionScale !== '1-10' &&
          satisfactionScale !== '0-100' &&
          satisfactionScale !== 'nps'
        ) {
          res.status(400).json({ error: 'Invalid satisfaction scale. Choose 1-5, 1-10, 0-100, or nps.' });
          return;
        }
        const company = updateCompanyProfile(req.auth!.company.id, { satisfactionScale });
        const ws = getCompanyWorkspace(company.id);
        ws.satisfactionScale = satisfactionScale;
        if (ws.activeDataset) {
          ws.activeDataset.state.satisfactionScale = satisfactionScale;
        }
        persistCompanyWorkspace(company.id, ws);
        res.json({ company, satisfactionScale });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to save satisfaction scale.';
        res.status(400).json({ error: message });
      }
    }
  );

  // 4b. Commit staged dataset with user-confirmed mapping, churn definition, valid-only import, duplicate handling & ticket linking
  app.post(
    '/api/dataset/commit',
    requireAuth,
    requirePermission('canUploadAndAnalyse'),
    computeLimiter,
    (req: AuthenticatedRequest, res) => {
      try {
        let company = getCompanyById(req.auth!.company.id) || req.auth!.company;
        const ws = getCompanyWorkspace(company.id);

        const {
          stagedId,
          mapping,
          churnDefinition,
          importMode,
          satisfactionScale,
          duplicateStrategy,
        } = (req.body || {}) as {
          stagedId?: string;
          mapping?: Partial<ColumnMapping>;
          churnDefinition?: ChurnDefinition;
          importMode?: 'valid_only' | 'all';
          satisfactionScale?: SatisfactionScale;
          duplicateStrategy?: DuplicateIdHandlingMode;
        };

        if (!ws.stagedImport || ws.stagedImport.meta.stagedId !== stagedId) {
          res.status(400).json({
            error: 'Staged dataset session has expired or was not found. Please re-upload your file.',
          });
          return;
        }

        const staged = ws.stagedImport;

        // Handle standalone Ticket_Data enrichment commit cleanly without overwriting Customer_Data or resetting model
        if (staged.meta.uploadMode === 'tickets') {
          if (!ws.activeDataset) {
            res.status(400).json({
              error:
                'No active customer dataset exists in this workspace. Upload your customer spreadsheet first before linking ticket records.',
            });
            return;
          }

          const activeHeaders = ws.activeDataset.state.columns.map((c) => c.name);
          const ticketHeaders = staged.meta.columns.map((c) => c.name);
          const merged = mergeTicketsIntoCustomerRows({
            source: 'standalone_ticket_upload',
            customerHeaders: activeHeaders,
            customerRows: ws.activeDataset.rows,
            ticketHeaders,
            ticketRows: staged.ticketRows || staged.rows,
            idColumnHint: ws.activeDataset.state.mapping.idColumn,
          });

          const preservedArtifact = ws.activeModelArtifact;
          const preservedHistory = ws.modelHistory;

          const columns = profileColumns(merged.headers, merged.rows);
          const { duplicateCount, missingCellCount } = computeDatasetQualityStats(
            merged.headers,
            merged.rows
          );
          const existingMapping = ws.activeDataset.state.mapping;
          const { issues, isValid } = validateDataset(columns, merged.rows, existingMapping);
          const labelReadiness = evaluateChurnReadiness(
            columns,
            merged.rows,
            existingMapping,
            company.churnDefinition
          );
          const readiness = assessDataReadiness({
            columns,
            rows: merged.rows,
            mapping: existingMapping,
            churnDefinition: company.churnDefinition,
            industry: company.industry,
          });

          ws.activeDataset = {
            rows: merged.rows,
            state: {
              ...ws.activeDataset.state,
              columnCount: columns.length,
              duplicateCount,
              missingCellCount,
              columns,
              issues,
              isValid,
              hasValidChurnLabels: labelReadiness.hasValidChurnLabels,
              churnReadinessMessage: labelReadiness.churnReadinessMessage,
              readiness,
              ticketAggregation: merged.summary,
              previewRows: merged.rows.slice(0, 15),
            },
          };

          // Also record standalone Ticket_Data entry in uploadedDatasets for complete dataset management visibility
          const ticketDsId = `ds_tkt_${Date.now()}`;
          ws.uploadedDatasets.unshift({
            datasetId: ticketDsId,
            fileName: staged.meta.fileName,
            sourceFormat: staged.meta.sourceFormat,
            uploadPathway: staged.meta.uploadPathway,
            uploadMode: 'tickets',
            uploadedAt: new Date().toISOString(),
            customerCount: 0,
            ticketCount: merged.summary.ticketRowsCount,
            importStatus: 'Imported',
            isSample: false,
            dataset: { state: ws.activeDataset.state, rows: [] },
            ticketRows: staged.ticketRows || staged.rows,
          });

          ws.ticketAggregation = merged.summary;
          ws.activeModelArtifact = preservedArtifact;
          ws.modelHistory = preservedHistory;
          ws.activeAnalytics =
            buildWorkspaceAnalytics(company, ws) ||
            computeAnalytics(
              columns,
              merged.rows,
              existingMapping,
              {},
              company.churnDefinition
            );
          ws.stagedImport = null;
          persistCompanyWorkspace(company.id, ws);

          recordAuditEvent({
            companyId: company.id,
            actorId: req.auth!.user.id,
            actorEmail: req.auth!.user.email,
            actorRole: req.auth!.user.role,
            action: 'TICKETS_LINKED',
            resource: 'dataset',
            details: `${merged.summary.note}`,
          });

          res.json({
            company,
            dataset: ws.activeDataset.state,
            uploadedDatasets: listUploadedDatasetSummaries(ws),
            analytics: ws.activeAnalytics,
            ticketAggregation: merged.summary,
            usage: buildUsageSummary(company, ws),
            activeModel: serializeActiveModelEvaluation(ws),
            modelHistory: ws.modelHistory,
            automationStatus: ws.automationStatus,
          });
          return;
        }

        const effectiveScale =
          satisfactionScale || staged.meta.satisfactionScale || ws.satisfactionScale || '1-5';
        ws.satisfactionScale = effectiveScale;
        if (company.satisfactionScale !== effectiveScale) {
          company = updateCompanyProfile(company.id, { satisfactionScale: effectiveScale });
        }

        const baseMapping = staged.meta.suggestedMapping;
        const targetColumn =
          mapping?.targetColumn !== undefined ? mapping.targetColumn : baseMapping.targetColumn;

        const positiveClassValue =
          mapping?.positiveClassValue !== undefined
            ? mapping.positiveClassValue
            : targetColumn && targetColumn !== baseMapping.targetColumn
              ? detectPositiveClass(staged.rows, targetColumn)
              : baseMapping.positiveClassValue;

        const churnDateColumn =
          mapping?.churnDateColumn !== undefined
            ? mapping.churnDateColumn
            : baseMapping.churnDateColumn;

        const idColumn = mapping?.idColumn !== undefined ? mapping.idColumn : baseMapping.idColumn;

        const rawFeatures = Array.isArray(mapping?.featureColumns)
          ? mapping.featureColumns
          : baseMapping.featureColumns;

        const confirmedMapping: ColumnMapping = {
          targetColumn,
          positiveClassValue,
          idColumn,
          contractColumn:
            mapping?.contractColumn !== undefined
              ? mapping.contractColumn
              : baseMapping.contractColumn,
          tenureColumn:
            mapping?.tenureColumn !== undefined ? mapping.tenureColumn : baseMapping.tenureColumn,
          monthlyChargesColumn:
            mapping?.monthlyChargesColumn !== undefined
              ? mapping.monthlyChargesColumn
              : baseMapping.monthlyChargesColumn,
          dateColumn:
            mapping?.dateColumn !== undefined ? mapping.dateColumn : baseMapping.dateColumn,
          observationDateColumn:
            mapping?.observationDateColumn !== undefined
              ? mapping.observationDateColumn
              : baseMapping.observationDateColumn,
          registrationDateColumn:
            mapping?.registrationDateColumn !== undefined
              ? mapping.registrationDateColumn
              : baseMapping.registrationDateColumn,
          churnDateColumn,
          statusColumn:
            mapping?.statusColumn !== undefined ? mapping.statusColumn : baseMapping.statusColumn,
          frequencyColumn:
            mapping?.frequencyColumn !== undefined
              ? mapping.frequencyColumn
              : baseMapping.frequencyColumn,
          featureColumns: rawFeatures.filter(
            (c) => c !== targetColumn && c !== idColumn && c !== churnDateColumn
          ),
        };

        let confirmedChurnDef = churnDefinition || company.churnDefinition;
        if (churnDefinition) {
          confirmedChurnDef = {
            ...churnDefinition,
            confirmedByUser: Boolean(churnDefinition.confirmedByUser),
            confirmedAt: churnDefinition.confirmedByUser
              ? churnDefinition.confirmedAt || new Date().toISOString()
              : null,
          };
          company = updateCompanyProfile(company.id, { churnDefinition: confirmedChurnDef });
        }

        const headers = staged.meta.columns.map((c) => c.name);
        const rowsToCommit =
          importMode === 'valid_only' && staged.validRowsOnly && staged.validRowsOnly.length > 0
            ? staged.validRowsOnly
            : staged.rows;

        const isCurrentPrediction =
          staged.meta.uploadPathway === 'current_prediction' && Boolean(ws.activeModelArtifact);

        let batchResult = null;
        if (isCurrentPrediction && ws.activeModelArtifact) {
          batchResult = scoreBatchRecords(
            ws.activeModelArtifact,
            staged.meta.fileName,
            rowsToCommit
          );
          ws.batchScores = [batchResult, ...(ws.batchScores || []).slice(0, 9)];
        }

        const effectiveStrategy: DuplicateIdHandlingMode =
          duplicateStrategy === 'skip' || duplicateStrategy === 'update'
            ? duplicateStrategy
            : 'replace';

        const result = commitRowsIntoWorkspace(company, ws, {
          fileName: staged.meta.fileName,
          sourceFormat: staged.meta.sourceFormat,
          uploadPathway: staged.meta.uploadPathway,
          satisfactionScale: effectiveScale,
          headers,
          rows: rowsToCommit,
          mapping: confirmedMapping,
          churnDefinition: confirmedChurnDef,
          rowValidation: staged.meta.rowValidation,
          ticketAggregation: staged.meta.ticketAggregation || null,
          ticketRows: staged.ticketRows,
          duplicateStrategy: effectiveStrategy,
          preserveModelArtifact: isCurrentPrediction,
          isSample: false,
        });

        const automationStatus = isCurrentPrediction
          ? ws.automationStatus
          : runAutomatedPredictionSetup(company, ws, {
              allowModelExecution:
                req.auth!.user.role !== 'ANALYST' || req.auth!.user.permissions.canGeneratePredictions,
              actor: {
                id: req.auth!.user.id,
                email: req.auth!.user.email,
                role: req.auth!.user.role,
              },
            });

        recordAuditEvent({
          companyId: company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'DATASET_COMMITTED',
          resource: 'dataset',
          details: `Committed ${staged.meta.fileName} (${rowsToCommit.length} rows, strategy=${effectiveStrategy}, pathway=${staged.meta.uploadPathway || 'standard'})`,
        });

        res.json({
          company,
          ...result,
          uploadedDatasets: listUploadedDatasetSummaries(ws),
          batchResult,
          batchScores: ws.batchScores || [],
          usage: buildUsageSummary(company, ws),
          activeModel: serializeActiveModelEvaluation(ws),
          modelHistory: ws.modelHistory,
          automationStatus,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to commit dataset.';
        res.status(400).json({ error: message });
      }
    }
  );

  // 4c. Direct upload fallback (CSV or Excel, backward compatible)
  app.post(
    '/api/dataset/upload',
    requireAuth,
    requirePermission('canUploadAndAnalyse'),
    computeLimiter,
    (req: AuthenticatedRequest, res) => {
      try {
        const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
        const ws = getCompanyWorkspace(company.id);
        const { fileName, csvText, fileBase64 } = (req.body || {}) as {
          fileName?: string;
          csvText?: string;
          fileBase64?: string;
        };
        const safeName = (fileName || 'uploaded_customers.csv').trim();
        const rawByteSize = csvText
          ? Buffer.byteLength(csvText, 'utf-8')
          : fileBase64
            ? Math.ceil((fileBase64.length * 3) / 4)
            : 0;

        const { headers, rows, sourceFormat } = parseSpreadsheetUpload({
          fileName: safeName,
          csvText,
          fileBase64,
        });
        enforceDatasetPlanQuota(company, rows.length, rawByteSize);

        const result = commitRowsIntoWorkspace(company, ws, {
          fileName: safeName,
          sourceFormat,
          headers,
          rows,
          duplicateStrategy: 'replace',
        });

        const automationStatus = runAutomatedPredictionSetup(company, ws, {
          allowModelExecution:
            req.auth!.user.role !== 'ANALYST' || req.auth!.user.permissions.canGeneratePredictions,
          actor: {
            id: req.auth!.user.id,
            email: req.auth!.user.email,
            role: req.auth!.user.role,
          },
        });

        recordAuditEvent({
          companyId: company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'DATASET_UPLOADED',
          resource: 'dataset',
          details: `Uploaded ${safeName} (${rows.length} rows)`,
        });

        res.json({
          ...result,
          uploadedDatasets: listUploadedDatasetSummaries(ws),
          usage: buildUsageSummary(company, ws),
          activeModel: serializeActiveModelEvaluation(ws),
          modelHistory: ws.modelHistory,
          automationStatus,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to parse file.';
        res.status(400).json({ error: message });
      }
    }
  );

  // 4d. Uploaded Datasets Management (list, activate, delete with dependency invalidation)
  app.get('/api/datasets', requireAuth, (req: AuthenticatedRequest, res) => {
    const ws = getCompanyWorkspace(req.auth!.company.id);
    res.json({
      uploadedDatasets: listUploadedDatasetSummaries(ws),
      activeDatasetId: ws.activeDataset?.state.datasetId || null,
    });
  });

  app.post(
    '/api/datasets/:datasetId/activate',
    requireAuth,
    requirePermission('canUploadAndAnalyse'),
    (req: AuthenticatedRequest, res) => {
      try {
        const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
        const ws = getCompanyWorkspace(company.id);
        const datasetId = String(req.params.datasetId || '');
        const entry = ws.uploadedDatasets.find((d) => d.datasetId === datasetId);
        if (!entry) {
          res.status(404).json({ error: 'Dataset was not found in this company workspace.' });
          return;
        }
        if (entry.uploadMode === 'tickets' || entry.dataset.rows.length === 0) {
          res.status(400).json({ error: 'Standalone ticket files cannot be activated as the primary customer table.' });
          return;
        }

        ws.uploadedDatasets = ws.uploadedDatasets.map((d) => ({
          ...d,
          importStatus:
            d.datasetId === datasetId
              ? 'Active'
              : d.importStatus === 'Active'
                ? 'Imported'
                : d.importStatus,
        }));
        ws.activeDataset = {
          state: { ...entry.dataset.state },
          rows: [...entry.dataset.rows],
        };
        ws.rowDatasetLineage = entry.dataset.rows.map(() => [datasetId]);
        ws.ticketAggregation = entry.dataset.state.ticketAggregation || null;
        ws.activeModelArtifact = null;
        ws.activeAnalytics =
          buildWorkspaceAnalytics(company, ws) ||
          computeAnalytics(
            entry.dataset.state.columns,
            entry.dataset.rows,
            entry.dataset.state.mapping,
            {},
            company.churnDefinition
          );
        persistCompanyWorkspace(company.id, ws);

        const automationStatus = runAutomatedPredictionSetup(company, ws, {
          allowModelExecution:
            req.auth!.user.role !== 'ANALYST' || req.auth!.user.permissions.canGeneratePredictions,
          actor: {
            id: req.auth!.user.id,
            email: req.auth!.user.email,
            role: req.auth!.user.role,
          },
        });

        recordAuditEvent({
          companyId: company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'DATASET_ACTIVATED',
          resource: 'dataset',
          details: `Activated dataset ${entry.fileName} (${entry.customerCount} rows)`,
        });

        res.json({
          company,
          dataset: ws.activeDataset.state,
          uploadedDatasets: listUploadedDatasetSummaries(ws),
          analytics: ws.activeAnalytics,
          activeModel: serializeActiveModelEvaluation(ws),
          modelHistory: ws.modelHistory,
          batchScores: ws.batchScores,
          automationStatus,
          usage: buildUsageSummary(company, ws),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to activate dataset.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.delete(
    '/api/datasets/:datasetId',
    requireAuth,
    requirePermission('canUploadAndAnalyse'),
    (req: AuthenticatedRequest, res) => {
      try {
        const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
        const ws = getCompanyWorkspace(company.id);
        const datasetId = String(req.params.datasetId || '');
        const target = ws.uploadedDatasets.find((d) => d.datasetId === datasetId);
        if (!target) {
          res.status(404).json({ error: 'Dataset was not found in this company workspace.' });
          return;
        }

        const wasActiveDatasetId = ws.activeDataset?.state.datasetId === datasetId;
        ws.uploadedDatasets = ws.uploadedDatasets.filter((d) => d.datasetId !== datasetId);

        let activeRowsChanged = false;

        if (ws.activeDataset) {
          if (target.uploadMode === 'tickets') {
            // Standalone ticket file removed: clear ticket aggregation if it was tied to ticket enrichment
            ws.ticketAggregation = null;
            ws.activeDataset.state.ticketAggregation = null;
          } else {
            const survivingRows: Record<string, string>[] = [];
            const survivingLineage: string[][] = [];

            ws.activeDataset.rows.forEach((row, idx) => {
              const owners = (ws.rowDatasetLineage[idx] || [ws.activeDataset!.state.datasetId]).filter(
                (id) => id !== datasetId
              );
              if (owners.length > 0) {
                survivingRows.push(row);
                survivingLineage.push(owners);
              } else {
                activeRowsChanged = true;
              }
            });

            if (survivingRows.length === 0) {
              ws.activeDataset = null;
              ws.rowDatasetLineage = [];
              ws.activeAnalytics = null;
              ws.ticketAggregation = null;
            } else if (activeRowsChanged || wasActiveDatasetId) {
              const headers = Object.keys(survivingRows[0] || {});
              const columns = profileColumns(headers, survivingRows);
              const { duplicateCount, missingCellCount } = computeDatasetQualityStats(
                headers,
                survivingRows
              );
              const mapping = ws.activeDataset.state.mapping;
              const { issues, isValid } = validateDataset(columns, survivingRows, mapping);
              const labelReadiness = evaluateChurnReadiness(
                columns,
                survivingRows,
                mapping,
                company.churnDefinition
              );
              const readiness = assessDataReadiness({
                columns,
                rows: survivingRows,
                mapping,
                churnDefinition: company.churnDefinition,
                industry: company.industry,
              });
              const ownerId = survivingLineage[0][0] || ws.activeDataset.state.datasetId;
              const ownerEntry = ws.uploadedDatasets.find((d) => d.datasetId === ownerId);

              ws.activeDataset = {
                rows: survivingRows,
                state: {
                  ...ws.activeDataset.state,
                  datasetId: ownerId,
                  fileName: ownerEntry ? ownerEntry.fileName : ws.activeDataset.state.fileName,
                  rowCount: survivingRows.length,
                  columnCount: columns.length,
                  duplicateCount,
                  missingCellCount,
                  columns,
                  issues,
                  isValid,
                  hasValidChurnLabels: labelReadiness.hasValidChurnLabels,
                  churnReadinessMessage: labelReadiness.churnReadinessMessage,
                  readiness,
                  previewRows: survivingRows.slice(0, 15),
                },
              };
              ws.rowDatasetLineage = survivingLineage;
              ws.activeAnalytics =
                buildWorkspaceAnalytics(company, ws) ||
                computeAnalytics(
                  columns,
                  survivingRows,
                  mapping,
                  {},
                  company.churnDefinition
                );
            }
          }
        }

        // Invalidate models, predictions, and batch scores derived exclusively from deleted dataset
        const invalidatedModelIds = new Set<string>();
        ws.modelHistory = ws.modelHistory.map((m) => {
          if (m.datasetId === datasetId) {
            invalidatedModelIds.add(m.modelId);
            return {
              ...m,
              isOutdated: true,
              outdatedReason: `Source dataset "${target.fileName}" was deleted.`,
            };
          }
          return m;
        });

        const activeModelTrainedOnDeleted =
          ws.activeModelArtifact?.evaluation.datasetId === datasetId ||
          wasActiveDatasetId ||
          activeRowsChanged ||
          !ws.activeDataset;

        if (activeModelTrainedOnDeleted) {
          if (ws.activeModelArtifact) {
            invalidatedModelIds.add(ws.activeModelArtifact.evaluation.modelId);
          }
          ws.activeModelArtifact = null;
          ws.automationStatus = null;
        }

        if (invalidatedModelIds.size > 0) {
          ws.batchScores = (ws.batchScores || []).filter(
            (b) => !invalidatedModelIds.has(b.modelId)
          );
        }

        const currentActiveId = ws.activeDataset?.state.datasetId || null;
        ws.uploadedDatasets = ws.uploadedDatasets.map((d) => ({
          ...d,
          importStatus:
            d.datasetId === currentActiveId
              ? 'Active'
              : d.importStatus === 'Active'
                ? 'Imported'
                : d.importStatus,
        }));

        // Re-run analytics if remaining active dataset + unrelated model survived
        if (ws.activeDataset && ws.activeModelArtifact) {
          ws.activeAnalytics = buildWorkspaceAnalytics(company, ws) || ws.activeAnalytics;
        }

        persistCompanyWorkspace(company.id, ws, { deletedDatasetId: datasetId });

        recordAuditEvent({
          companyId: company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'DATASET_DELETED',
          resource: 'dataset',
          details: `Deleted dataset "${target.fileName}" (${target.customerCount} customers, ${target.ticketCount} tickets) and invalidated dependent predictions/analytics`,
        });

        res.json({
          deletedDatasetId: datasetId,
          deletedFileName: target.fileName,
          company,
          dataset: ws.activeDataset ? ws.activeDataset.state : null,
          uploadedDatasets: listUploadedDatasetSummaries(ws),
          analytics: ws.activeAnalytics,
          activeModel: serializeActiveModelEvaluation(ws),
          modelHistory: ws.modelHistory,
          batchScores: ws.batchScores || [],
          automationStatus: ws.automationStatus,
          usage: buildUsageSummary(company, ws),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to delete dataset.';
        res.status(400).json({ error: message });
      }
    }
  );

  // 5. Update flexible column mapping (company-isolated)
  app.post(
    '/api/dataset/mapping',
    requireAuth,
    requirePermission('canUploadAndAnalyse'),
    (req: AuthenticatedRequest, res) => {
      try {
        const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
        const ws = getCompanyWorkspace(company.id);
        if (!ws.activeDataset) {
          res.status(400).json({ error: 'No dataset is currently loaded.' });
          return;
        }

        const incoming = req.body as Partial<ColumnMapping>;
        const prev = ws.activeDataset.state.mapping;
        const targetColumn =
          incoming.targetColumn !== undefined ? incoming.targetColumn : prev.targetColumn;

        const positiveClassValue =
          incoming.positiveClassValue !== undefined
            ? incoming.positiveClassValue
            : targetColumn !== prev.targetColumn
              ? detectPositiveClass(ws.activeDataset.rows, targetColumn)
              : prev.positiveClassValue;

        const churnDateColumn =
          incoming.churnDateColumn !== undefined ? incoming.churnDateColumn : prev.churnDateColumn;
        const idColumn = incoming.idColumn !== undefined ? incoming.idColumn : prev.idColumn;
        const rawFeatures = Array.isArray(incoming.featureColumns)
          ? incoming.featureColumns
          : prev.featureColumns;

        const updatedMapping: ColumnMapping = {
          targetColumn,
          positiveClassValue,
          idColumn,
          contractColumn:
            incoming.contractColumn !== undefined ? incoming.contractColumn : prev.contractColumn,
          tenureColumn:
            incoming.tenureColumn !== undefined ? incoming.tenureColumn : prev.tenureColumn,
          monthlyChargesColumn:
            incoming.monthlyChargesColumn !== undefined
              ? incoming.monthlyChargesColumn
              : prev.monthlyChargesColumn,
          dateColumn: incoming.dateColumn !== undefined ? incoming.dateColumn : prev.dateColumn,
          observationDateColumn:
            incoming.observationDateColumn !== undefined
              ? incoming.observationDateColumn
              : prev.observationDateColumn,
          registrationDateColumn:
            incoming.registrationDateColumn !== undefined
              ? incoming.registrationDateColumn
              : prev.registrationDateColumn,
          churnDateColumn,
          statusColumn:
            incoming.statusColumn !== undefined ? incoming.statusColumn : prev.statusColumn,
          frequencyColumn:
            incoming.frequencyColumn !== undefined ? incoming.frequencyColumn : prev.frequencyColumn,
          featureColumns: rawFeatures.filter(
            (c) => c !== targetColumn && c !== idColumn && c !== churnDateColumn
          ),
        };

        const { issues, isValid } = validateDataset(
          ws.activeDataset.state.columns,
          ws.activeDataset.rows,
          updatedMapping
        );
        const labelReadiness = evaluateChurnReadiness(
          ws.activeDataset.state.columns,
          ws.activeDataset.rows,
          updatedMapping,
          company.churnDefinition
        );
        const readiness = assessDataReadiness({
          columns: ws.activeDataset.state.columns,
          rows: ws.activeDataset.rows,
          mapping: updatedMapping,
          churnDefinition: company.churnDefinition,
          industry: company.industry,
        });
        const mappingRationales = buildMappingRationales(
          ws.activeDataset.state.columns,
          updatedMapping,
          company.industry
        );

        const targetUniqueValues = targetColumn
          ? getUniqueColumnValues(ws.activeDataset.rows, targetColumn)
          : [];

        ws.activeDataset.state = {
          ...ws.activeDataset.state,
          mapping: updatedMapping,
          mappingRationales,
          targetUniqueValues,
          issues,
          isValid,
          hasValidChurnLabels: labelReadiness.hasValidChurnLabels,
          churnReadinessMessage: labelReadiness.churnReadinessMessage,
          readiness,
        };

        ws.activeModelArtifact = null;
        ws.modelHistory = [];
        ws.activeAnalytics =
          buildWorkspaceAnalytics(company, ws) ||
          computeAnalytics(
            ws.activeDataset.state.columns,
            ws.activeDataset.rows,
            updatedMapping,
            {},
            company.churnDefinition
          );
        persistCompanyWorkspace(company.id, ws);

        const automationStatus = runAutomatedPredictionSetup(company, ws, {
          allowModelExecution:
            req.auth!.user.role !== 'ANALYST' || req.auth!.user.permissions.canGeneratePredictions,
          actor: {
            id: req.auth!.user.id,
            email: req.auth!.user.email,
            role: req.auth!.user.role,
          },
        });

        recordAuditEvent({
          companyId: company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'COLUMN_MAPPING_UPDATED',
          resource: 'dataset',
          details: `Updated mapping (target=${updatedMapping.targetColumn}, features=${updatedMapping.featureColumns.length})`,
        });

        const latestWs = getCompanyWorkspace(company.id);
        res.json({
          dataset: latestWs.activeDataset?.state ?? ws.activeDataset.state,
          analytics: latestWs.activeAnalytics ?? ws.activeAnalytics,
          usage: buildUsageSummary(company, latestWs),
          activeModel: serializeActiveModelEvaluation(latestWs),
          modelHistory: latestWs.modelHistory,
          automationStatus,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to update column mapping.';
        res.status(400).json({ error: message });
      }
    }
  );

  // 5b. Record observed churn/retention outcomes over time (cold-start progression)
  app.post(
    '/api/dataset/record-outcome',
    requireAuth,
    requirePermission('canUploadAndAnalyse'),
    computeLimiter,
    (req: AuthenticatedRequest, res) => {
      try {
        const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
        const ws = getCompanyWorkspace(company.id);
        if (!ws.activeDataset) {
          res.status(400).json({ error: 'No customer dataset is loaded in this workspace.' });
          return;
        }

        const body = (req.body || {}) as {
          customerId?: string;
          outcome?: 'Churned' | 'Retained';
          updates?: { customerId: string; outcome: 'Churned' | 'Retained' }[];
        };

        const rawUpdates = Array.isArray(body.updates)
          ? body.updates
          : body.customerId && body.outcome
            ? [{ customerId: body.customerId, outcome: body.outcome }]
            : [];

        if (rawUpdates.length === 0) {
          res.status(400).json({ error: 'At least one customer outcome record is required.' });
          return;
        }

        const ds = ws.activeDataset;
        const mapping = { ...ds.state.mapping };
        const idCol = mapping.idColumn;

        let targetCol = mapping.targetColumn;
        let positiveVal = mapping.positiveClassValue;
        let negativeVal = 'Retained';

        if (!targetCol || !ds.state.columns.some((c) => c.name === targetCol)) {
          targetCol = 'churn_status';
          positiveVal = 'Churned';
          negativeVal = 'Retained';
          for (const row of ds.rows) {
            if (row[targetCol] === undefined) {
              row[targetCol] = '';
            }
          }
          mapping.targetColumn = targetCol;
          mapping.positiveClassValue = positiveVal;
          mapping.featureColumns = mapping.featureColumns.filter(
            (c) => c !== targetCol && c !== mapping.churnDateColumn
          );
        } else {
          if (!positiveVal) {
            positiveVal = 'Churned';
            mapping.positiveClassValue = positiveVal;
          }
          const existingNonMissing = getUniqueColumnValues(ds.rows, targetCol);
          const existingNegative = existingNonMissing.find((v) => v !== positiveVal);
          if (existingNegative) {
            negativeVal = existingNegative;
          } else if (positiveVal.toLowerCase() === 'yes') {
            negativeVal = 'No';
          } else if (positiveVal === '1') {
            negativeVal = '0';
          } else {
            negativeVal = 'Retained';
          }
        }

        let updatedCount = 0;
        for (const item of rawUpdates) {
          const cid = String(item.customerId || '').trim();
          if (!cid) continue;
          const nextValue = item.outcome === 'Churned' ? positiveVal : negativeVal;

          let matched = false;
          ds.rows.forEach((row, idx) => {
            const rowKey =
              idCol && !isMissingValue(row[idCol])
                ? row[idCol].trim()
                : `ROW-${String(idx + 1).padStart(4, '0')}`;
            if (rowKey === cid) {
              row[targetCol!] = nextValue;
              matched = true;
            }
          });
          if (matched) updatedCount++;
        }

        if (updatedCount === 0) {
          res.status(404).json({
            error:
              'No matching customer record(s) found. Verify the Customer ID matches your uploaded dataset.',
          });
          return;
        }

        const headers = Object.keys(ds.rows[0] || {});
        const columns = profileColumns(headers, ds.rows);
        const { duplicateCount, missingCellCount } = computeDatasetQualityStats(headers, ds.rows);
        const targetUniqueValues = getUniqueColumnValues(ds.rows, targetCol);
        const { issues, isValid } = validateDataset(columns, ds.rows, mapping);
        const labelReadiness = evaluateChurnReadiness(
          columns,
          ds.rows,
          mapping,
          company.churnDefinition
        );
        const readiness = assessDataReadiness({
          columns,
          rows: ds.rows,
          mapping,
          churnDefinition: company.churnDefinition,
          industry: company.industry,
        });
        const mappingRationales = buildMappingRationales(columns, mapping, company.industry);

        ds.state = {
          ...ds.state,
          columnCount: columns.length,
          duplicateCount,
          missingCellCount,
          columns,
          mapping,
          mappingRationales,
          targetUniqueValues,
          issues,
          isValid,
          hasValidChurnLabels: labelReadiness.hasValidChurnLabels,
          churnReadinessMessage: labelReadiness.churnReadinessMessage,
          readiness,
          previewRows: ds.rows.slice(0, 15),
        };

        ws.activeAnalytics =
          buildWorkspaceAnalytics(company, ws) ||
          computeAnalytics(
            columns,
            ds.rows,
            mapping,
            {},
            company.churnDefinition
          );
        persistCompanyWorkspace(company.id, ws);

        const automationStatus = runAutomatedPredictionSetup(company, ws, {
          allowModelExecution:
            req.auth!.user.role !== 'ANALYST' || req.auth!.user.permissions.canGeneratePredictions,
          actor: {
            id: req.auth!.user.id,
            email: req.auth!.user.email,
            role: req.auth!.user.role,
          },
        });

        recordAuditEvent({
          companyId: company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'CHURN_OUTCOME_RECORDED',
          resource: 'dataset',
          details: `Recorded ${updatedCount} observed customer outcome(s) in "${targetCol}" (readiness=${readiness.overallStatus})`,
        });

        const latestWs = getCompanyWorkspace(company.id);
        res.json({
          updatedCount,
          dataset: latestWs.activeDataset?.state ?? ds.state,
          analytics: latestWs.activeAnalytics ?? ws.activeAnalytics,
          activeModel: serializeActiveModelEvaluation(latestWs),
          modelHistory: latestWs.modelHistory,
          automationStatus,
          usage: buildUsageSummary(company, latestWs),
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Failed to record observed churn outcome.';
        res.status(400).json({ error: message });
      }
    }
  );

  // 5c. Customer Directory CRUD (Add / Update / Remove single customer record)
  const buildTemplateMappingForIndustry = (industry: IndustryKey, headers: string[]): ColumnMapping => {
    const specs = getIndustryDataTemplateColumns(industry);
    const findByRole = (role: string) =>
      specs.find((s) => s.semanticRole === role && headers.includes(s.name))?.name || null;

    const targetCol = findByRole('target') || '';
    const idCol = findByRole('id');
    const dateCol = findByRole('date');
    const observationDateCol = findByRole('observation_date');
    const registrationDateCol = findByRole('registration_date');
    const churnDateCol = findByRole('churn_date');
    const statusCol = findByRole('status');

    const excluded = new Set(
      [targetCol, idCol, dateCol, observationDateCol, registrationDateCol, churnDateCol].filter(
        (v): v is string => Boolean(v)
      )
    );

    return {
      targetColumn: targetCol,
      positiveClassValue: targetCol ? 'Yes' : '',
      idColumn: idCol,
      contractColumn: findByRole('segment'),
      tenureColumn: findByRole('tenure'),
      monthlyChargesColumn: findByRole('revenue'),
      dateColumn: dateCol,
      observationDateColumn: observationDateCol,
      registrationDateColumn: registrationDateCol,
      churnDateColumn: churnDateCol,
      statusColumn: statusCol,
      frequencyColumn: findByRole('frequency'),
      featureColumns: headers.filter((h) => !excluded.has(h)),
    };
  };

  const refreshActiveDatasetState = (
    company: CompanyWorkspaceInfo,
    ws: CompanyWorkspaceState,
    actor: { id: string; email: string; role: UserRole },
    allowModelExecution: boolean
  ) => {
    const ds = ws.activeDataset!;
    const headers = Object.keys(ds.rows[0] || {});
    const columns = profileColumns(headers, ds.rows);
    const { duplicateCount, missingCellCount } = computeDatasetQualityStats(headers, ds.rows);
    const mapping = ds.state.mapping;
    const targetUniqueValues = mapping.targetColumn
      ? getUniqueColumnValues(ds.rows, mapping.targetColumn)
      : [];
    const { issues, isValid } = validateDataset(columns, ds.rows, mapping);
    const labelReadiness = evaluateChurnReadiness(
      columns,
      ds.rows,
      mapping,
      company.churnDefinition
    );
    const readiness = assessDataReadiness({
      columns,
      rows: ds.rows,
      mapping,
      churnDefinition: company.churnDefinition,
      industry: company.industry,
    });
    const mappingRationales = buildMappingRationales(columns, mapping, company.industry);
    const invalidDateCount = columns.reduce((acc, c) => acc + (c.invalidDateCount || 0), 0);
    const inconsistentCategoryCount = columns.reduce(
      (acc, c) => acc + (c.inconsistentCategoryCount || 0),
      0
    );

    ds.state = {
      ...ds.state,
      rowCount: ds.rows.length,
      columnCount: columns.length,
      duplicateCount,
      missingCellCount,
      invalidDateCount,
      inconsistentCategoryCount,
      columns,
      mappingRationales,
      targetUniqueValues,
      issues,
      isValid,
      hasValidChurnLabels: labelReadiness.hasValidChurnLabels,
      churnReadinessMessage: labelReadiness.churnReadinessMessage,
      readiness,
      previewRows: ds.rows.slice(0, 15),
    };

    ws.activeAnalytics =
      buildWorkspaceAnalytics(company, ws) ||
      computeAnalytics(
        columns,
        ds.rows,
        mapping,
        {},
        company.churnDefinition
      );

    // Sync active dataset entry count in uploadedDatasets
    const activeEntryIdx = ws.uploadedDatasets.findIndex((d) => d.datasetId === ds.state.datasetId);
    if (activeEntryIdx >= 0) {
      ws.uploadedDatasets[activeEntryIdx] = {
        ...ws.uploadedDatasets[activeEntryIdx],
        customerCount: ds.rows.length,
        dataset: {
          state: { ...ds.state },
          rows: [...ds.rows],
        },
      };
    }

    persistCompanyWorkspace(company.id, ws);

    const automationStatus = runAutomatedPredictionSetup(company, ws, {
      allowModelExecution,
      actor,
    });

    return { automationStatus };
  };

  app.post(
    '/api/dataset/customers',
    requireAuth,
    requirePermission('canUploadAndAnalyse'),
    (req: AuthenticatedRequest, res) => {
      try {
        const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
        const ws = getCompanyWorkspace(company.id);
        const body = (req.body || {}) as { customer?: Record<string, string> };
        const incoming = body.customer;
        if (!incoming || typeof incoming !== 'object') {
          res.status(400).json({ error: 'Customer details are required.' });
          return;
        }

        const allowModelExecution =
          req.auth!.user.role !== 'ANALYST' || req.auth!.user.permissions.canGeneratePredictions;
        const actor = {
          id: req.auth!.user.id,
          email: req.auth!.user.email,
          role: req.auth!.user.role,
        };

        if (!ws.activeDataset) {
          const specs = getIndustryDataTemplateColumns(company.industry);
          const headers = Array.from(
            new Set([
              ...specs.map((s) => s.name),
              ...Object.keys(incoming).map((k) => k.trim()).filter(Boolean),
            ])
          );
          const normalizedRow: Record<string, string> = {};
          for (const h of headers) {
            normalizedRow[h] = String(incoming[h] ?? '').trim();
          }

          const mapping = buildTemplateMappingForIndustry(company.industry, headers);
          const idCol = mapping.idColumn;
          if (idCol && !normalizedRow[idCol]) {
            normalizedRow[idCol] = `CUST-${String(1001).padStart(4, '0')}`;
          }

          const rows = [normalizedRow];
          enforceDatasetPlanQuota(company, rows.length, Buffer.byteLength(JSON.stringify(rows)));

          const committed = commitRowsIntoWorkspace(company, ws, {
            fileName: 'customer_directory.csv',
            sourceFormat: 'csv',
            headers,
            rows,
            mapping,
            churnDefinition: company.churnDefinition,
            isSample: false,
          });

          const automationStatus = runAutomatedPredictionSetup(company, ws, {
            allowModelExecution,
            actor,
          });

          recordAuditEvent({
            companyId: company.id,
            actorId: actor.id,
            actorEmail: actor.email,
            actorRole: actor.role,
            action: 'CUSTOMER_RECORD_ADDED',
            resource: 'dataset',
            details: `Initialized customer directory with record ${idCol ? normalizedRow[idCol] : '#1'}`,
          });

          const latestWs = getCompanyWorkspace(company.id);
          res.status(201).json({
            dataset: latestWs.activeDataset?.state ?? committed.dataset,
            uploadedDatasets: listUploadedDatasetSummaries(latestWs),
            analytics: latestWs.activeAnalytics ?? committed.analytics,
            activeModel: serializeActiveModelEvaluation(latestWs),
            modelHistory: latestWs.modelHistory,
            automationStatus,
            usage: buildUsageSummary(company, latestWs),
          });
          return;
        }

        const ds = ws.activeDataset;
        const existingHeaders = ds.state.columns.map((c) => c.name);
        const extraKeys = Object.keys(incoming).filter((k) => k.trim() && !existingHeaders.includes(k));
        const headers = [...existingHeaders, ...extraKeys];

        const normalizedRow: Record<string, string> = {};
        for (const h of headers) {
          normalizedRow[h] = String(incoming[h] ?? '').trim();
        }

        const idCol = ds.state.mapping.idColumn;
        if (idCol) {
          if (!normalizedRow[idCol]) {
            normalizedRow[idCol] = `CUST-${String(ds.rows.length + 1001).padStart(4, '0')}`;
          }
          const dupExists = ds.rows.some(
            (r) => (r[idCol] || '').trim().toLowerCase() === normalizedRow[idCol].toLowerCase()
          );
          if (dupExists) {
            res.status(400).json({
              error: `A customer with ${idCol} "${normalizedRow[idCol]}" already exists.`,
            });
            return;
          }
        }

        const nextRows = [normalizedRow, ...ds.rows].map((r) => {
          if (extraKeys.length === 0) return r;
          const padded = { ...r };
          for (const k of extraKeys) {
            if (padded[k] === undefined) padded[k] = '';
          }
          return padded;
        });

        enforceDatasetPlanQuota(
          company,
          nextRows.length,
          Buffer.byteLength(JSON.stringify(nextRows))
        );

        ds.rows = nextRows;
        if (ws.rowDatasetLineage.length > 0) {
          ws.rowDatasetLineage = [[ds.state.datasetId], ...ws.rowDatasetLineage];
        }
        const { automationStatus } = refreshActiveDatasetState(
          company,
          ws,
          actor,
          allowModelExecution
        );

        recordAuditEvent({
          companyId: company.id,
          actorId: actor.id,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'CUSTOMER_RECORD_ADDED',
          resource: 'dataset',
          details: `Added customer record ${idCol ? normalizedRow[idCol] : `row #${nextRows.length}`}`,
        });

        const latestWs = getCompanyWorkspace(company.id);
        res.status(201).json({
          dataset: latestWs.activeDataset?.state ?? ds.state,
          uploadedDatasets: listUploadedDatasetSummaries(latestWs),
          analytics: latestWs.activeAnalytics ?? ws.activeAnalytics,
          activeModel: serializeActiveModelEvaluation(latestWs),
          modelHistory: latestWs.modelHistory,
          automationStatus,
          usage: buildUsageSummary(company, latestWs),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to add customer record.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.put(
    '/api/dataset/customers/:rowIndex',
    requireAuth,
    requirePermission('canUploadAndAnalyse'),
    (req: AuthenticatedRequest, res) => {
      try {
        const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
        const ws = getCompanyWorkspace(company.id);
        if (!ws.activeDataset) {
          res.status(400).json({ error: 'No dataset loaded.' });
          return;
        }

        const rowIndex = Number(req.params.rowIndex);
        if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= ws.activeDataset.rows.length) {
          res.status(404).json({ error: 'Customer record not found.' });
          return;
        }

        const body = (req.body || {}) as { customer?: Record<string, string> };
        const incoming = body.customer;
        if (!incoming || typeof incoming !== 'object') {
          res.status(400).json({ error: 'Updated customer fields are required.' });
          return;
        }

        const ds = ws.activeDataset;
        const headers = ds.state.columns.map((c) => c.name);
        const existing = ds.rows[rowIndex];
        const updatedRow: Record<string, string> = { ...existing };
        for (const h of headers) {
          if (incoming[h] !== undefined) {
            updatedRow[h] = String(incoming[h]).trim();
          }
        }

        const idCol = ds.state.mapping.idColumn;
        if (idCol && updatedRow[idCol]) {
          const dupExists = ds.rows.some(
            (r, idx) =>
              idx !== rowIndex &&
              (r[idCol] || '').trim().toLowerCase() === updatedRow[idCol].toLowerCase()
          );
          if (dupExists) {
            res.status(400).json({
              error: `Another customer already uses ${idCol} "${updatedRow[idCol]}".`,
            });
            return;
          }
        }

        ds.rows[rowIndex] = updatedRow;
        const allowModelExecution =
          req.auth!.user.role !== 'ANALYST' || req.auth!.user.permissions.canGeneratePredictions;
        const actor = {
          id: req.auth!.user.id,
          email: req.auth!.user.email,
          role: req.auth!.user.role,
        };

        const { automationStatus } = refreshActiveDatasetState(
          company,
          ws,
          actor,
          allowModelExecution
        );

        recordAuditEvent({
          companyId: company.id,
          actorId: actor.id,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'CUSTOMER_RECORD_UPDATED',
          resource: 'dataset',
          details: `Updated customer record ${idCol ? updatedRow[idCol] : `#${rowIndex + 1}`}`,
        });

        const latestWs = getCompanyWorkspace(company.id);
        res.json({
          dataset: latestWs.activeDataset?.state ?? ds.state,
          analytics: latestWs.activeAnalytics ?? ws.activeAnalytics,
          activeModel: serializeActiveModelEvaluation(latestWs),
          modelHistory: latestWs.modelHistory,
          automationStatus,
          usage: buildUsageSummary(company, latestWs),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to update customer record.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.delete(
    '/api/dataset/customers/:rowIndex',
    requireAuth,
    requirePermission('canUploadAndAnalyse'),
    (req: AuthenticatedRequest, res) => {
      try {
        const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
        const ws = getCompanyWorkspace(company.id);
        if (!ws.activeDataset) {
          res.status(400).json({ error: 'No dataset loaded.' });
          return;
        }

        const rowIndex = Number(req.params.rowIndex);
        if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= ws.activeDataset.rows.length) {
          res.status(404).json({ error: 'Customer record not found.' });
          return;
        }

        const ds = ws.activeDataset;
        const idCol = ds.state.mapping.idColumn;
        const removedId = idCol ? ds.rows[rowIndex]?.[idCol] : `#${rowIndex + 1}`;
        ds.rows.splice(rowIndex, 1);
        if (ws.rowDatasetLineage.length > rowIndex) {
          ws.rowDatasetLineage.splice(rowIndex, 1);
        }

        const actor = {
          id: req.auth!.user.id,
          email: req.auth!.user.email,
          role: req.auth!.user.role,
        };

        if (ds.rows.length === 0) {
          const emptyId = ds.state.datasetId;
          ws.uploadedDatasets = ws.uploadedDatasets.filter((d) => d.datasetId !== emptyId);
          ws.activeDataset = null;
          ws.rowDatasetLineage = [];
          ws.activeAnalytics = null;
          ws.activeModelArtifact = null;
          ws.modelHistory = [];
          ws.automationStatus = null;
          persistCompanyWorkspace(company.id, ws, { deletedDatasetId: emptyId });

          recordAuditEvent({
            companyId: company.id,
            actorId: actor.id,
            actorEmail: actor.email,
            actorRole: actor.role,
            action: 'CUSTOMER_RECORD_DELETED',
            resource: 'dataset',
            details: `Removed final customer record (${removedId}); directory is now empty`,
          });

          res.json({
            dataset: null,
            uploadedDatasets: listUploadedDatasetSummaries(ws),
            analytics: null,
            activeModel: null,
            modelHistory: [],
            automationStatus: null,
            usage: buildUsageSummary(company, ws),
          });
          return;
        }

        const allowModelExecution =
          req.auth!.user.role !== 'ANALYST' || req.auth!.user.permissions.canGeneratePredictions;

        const { automationStatus } = refreshActiveDatasetState(
          company,
          ws,
          actor,
          allowModelExecution
        );

        recordAuditEvent({
          companyId: company.id,
          actorId: actor.id,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'CUSTOMER_RECORD_DELETED',
          resource: 'dataset',
          details: `Removed customer record (${removedId})`,
        });

        const latestWs = getCompanyWorkspace(company.id);
        res.json({
          dataset: latestWs.activeDataset?.state ?? ds.state,
          uploadedDatasets: listUploadedDatasetSummaries(latestWs),
          analytics: latestWs.activeAnalytics ?? ws.activeAnalytics,
          activeModel: serializeActiveModelEvaluation(latestWs),
          modelHistory: latestWs.modelHistory,
          automationStatus,
          usage: buildUsageSummary(company, latestWs),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to delete customer record.';
        res.status(400).json({ error: message });
      }
    }
  );

  // 6. Paginated & searchable dataset rows (company-isolated)
  app.get('/api/dataset/rows', requireAuth, (req: AuthenticatedRequest, res) => {
    const ws = getCompanyWorkspace(req.auth!.company.id);
    if (!ws.activeDataset) {
      res.status(400).json({ error: 'No dataset loaded.' });
      return;
    }

    const ds = ws.activeDataset;
    const mapping = ds.state.mapping;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(5, Number(req.query.limit) || 20));
    const search = String(req.query.search || '').trim().toLowerCase();
    const statusFilter = String(req.query.status || 'ALL').trim().toLowerCase();
    const monthFilter = String(req.query.month || '').trim(); // YYYY-MM

    const predByRowIndex = new Map<
      number,
      { churnProbability: number; riskCategory: string; predictedChurn: string }
    >();
    const predByCustomerId = new Map<
      string,
      { churnProbability: number; riskCategory: string; predictedChurn: string }
    >();
    if (ws.activeModelArtifact) {
      for (const p of ws.activeModelArtifact.evaluation.predictions) {
        predByRowIndex.set(p.rowIndex, {
          churnProbability: p.churnProbability,
          riskCategory: p.riskCategory,
          predictedChurn: p.predictedChurn,
        });
        if (p.customerId) {
          predByCustomerId.set(p.customerId.trim().toLowerCase(), {
            churnProbability: p.churnProbability,
            riskCategory: p.riskCategory,
            predictedChurn: p.predictedChurn,
          });
        }
      }
    }

    const statusHints = detectStatusColumnHints(ds.state.columns, mapping);
    const idCol = mapping.idColumn;
    const dateCol = mapping.dateColumn;

    const counts = {
      all: ds.rows.length,
      active: 0,
      churned: 0,
      inconsistent: 0,
      highRisk: 0,
      pending: 0,
    };

    const indexed = ds.rows.map((row, idx) => {
      const resolved = resolveCustomerStatusRecord(
        row,
        idx + 1,
        statusHints,
        ds.state.churnDefinition
      );

      const isMissingOutcome = resolved.actualStatus === 'Unknown';
      const isChurned = resolved.isActualChurned;
      const isInconsistent = resolved.isInconsistent;
      const isActive = resolved.isActive;

      const rowIdKey = idCol && row[idCol] ? row[idCol].trim().toLowerCase() : '';
      const rawRisk =
        predByRowIndex.get(idx + 1) ||
        (rowIdKey ? predByCustomerId.get(rowIdKey) : undefined) ||
        null;

      // Forward predicted risk applies ONLY to Active (or pending Active) accounts, never Churned/Inconsistent
      const riskApplicable = !isChurned && !isInconsistent;
      const risk = riskApplicable ? rawRisk : null;
      const isHighRisk = riskApplicable && risk?.riskCategory === 'Higher Estimated Churn Risk';

      if (isInconsistent) counts.inconsistent++;
      else if (isMissingOutcome) counts.pending++;
      else if (isChurned) counts.churned++;
      else counts.active++;
      if (isHighRisk) counts.highRisk++;

      return {
        row,
        idx,
        risk,
        actualStatus: resolved.actualStatus,
        conflictReason: resolved.conflictReason,
        riskApplicable,
        isActive,
        isChurned,
        isInconsistent,
        isMissingOutcome,
        isHighRisk,
      };
    });

    let filtered = indexed;
    if (search) {
      filtered = filtered.filter((entry) =>
        Object.values(entry.row).some((val) => val.toLowerCase().includes(search))
      );
    }
    if (statusFilter === 'active') {
      filtered = filtered.filter((entry) => entry.isActive);
    } else if (statusFilter === 'churned') {
      filtered = filtered.filter((entry) => entry.isChurned);
    } else if (statusFilter === 'inconsistent') {
      filtered = filtered.filter((entry) => entry.isInconsistent);
    } else if (statusFilter === 'high_risk') {
      filtered = filtered.filter((entry) => entry.isHighRisk);
    } else if (statusFilter === 'pending') {
      filtered = filtered.filter((entry) => entry.isMissingOutcome);
    }
    if (monthFilter && dateCol) {
      filtered = filtered.filter((entry) => {
        const rawDate = (entry.row[dateCol] || '').trim();
        if (!rawDate) return false;
        if (rawDate.startsWith(monthFilter)) return true;
        const parsed = new Date(rawDate);
        if (Number.isNaN(parsed.getTime())) return false;
        const ym = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}`;
        return ym === monthFilter;
      });
    }

    const total = filtered.length;
    const start = (page - 1) * limit;
    const slice = filtered.slice(start, start + limit);

    res.json({
      items: slice.map((s) => s.row),
      rowIndices: slice.map((s) => s.idx),
      risks: slice.map((s) => s.risk),
      statuses: slice.map((s) => ({
        actualStatus: s.actualStatus,
        conflictReason: s.conflictReason,
        riskApplicable: s.riskApplicable,
      })),
      counts,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  });

  // 6b. Filtered analytics for Data Analysis charts (company-isolated)
  app.post('/api/analytics/filter', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
      const ws = getCompanyWorkspace(company.id);
      if (!ws.activeDataset) {
        res.status(400).json({ error: 'No dataset loaded.' });
        return;
      }

      const body = (req.body || {}) as AnalyticsFilters;
      const filters: AnalyticsFilters = {
        contract: body.contract || 'ALL',
        churnStatus:
          body.churnStatus === 'Churned' || body.churnStatus === 'Stayed'
            ? body.churnStatus
            : 'ALL',
        tenureGroup: body.tenureGroup || 'ALL',
        paymentMethod: body.paymentMethod || 'ALL',
        reportingPeriod: body.reportingPeriod || 'ALL',
      };

      const filtered =
        buildWorkspaceAnalytics(company, ws, filters) ||
        computeAnalytics(
          ws.activeDataset.state.columns,
          ws.activeDataset.rows,
          ws.activeDataset.state.mapping,
          filters,
          company.churnDefinition,
          ws.activeModelArtifact
        );

      res.json({ analytics: filtered });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to filter analytics.';
      res.status(400).json({ error: message });
    }
  });

  // 7. Train & evaluate ML classification model (company-isolated + permission & plan enforced)
  app.post(
    '/api/model/train',
    requireAuth,
    requirePermission('canGeneratePredictions'),
    computeLimiter,
    (req: AuthenticatedRequest, res) => {
      try {
        const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
        const ws = getCompanyWorkspace(company.id);
        const plan = getSubscriptionPlanSpec(company.subscriptionPlan);

        if (!ws.activeDataset) {
          res.status(400).json({ error: 'Please load or upload a customer dataset first.' });
          return;
        }
        const modelReadiness =
          ws.activeDataset.state.readiness ||
          assessDataReadiness({
            columns: ws.activeDataset.state.columns,
            rows: ws.activeDataset.rows,
            mapping: ws.activeDataset.state.mapping,
            churnDefinition: company.churnDefinition,
            industry: company.industry,
          });
        if (!ws.activeDataset.state.isValid || !modelReadiness.predictionReady.ready) {
          res.status(400).json({
            error:
              modelReadiness.predictionReady.blockers[0] ||
              ws.activeDataset.state.churnReadinessMessage ||
              'Dataset is not yet Prediction Ready. Resolve readiness requirements in Data Management before training.',
          });
          return;
        }

        const body = (req.body || {}) as TrainModelRequest;
        const requestedModel: MLModelType =
          body.modelType === 'decision_tree'
            ? 'decision_tree'
            : body.modelType === 'random_forest'
              ? 'random_forest'
              : 'logistic_regression';

        if (!plan.allowedModels.includes(requestedModel)) {
          res.status(403).json({
            error: `${requestedModel === 'random_forest' ? 'Random Forest' : requestedModel} is not included in the ${plan.name} plan. Upgrade to Starter or above to unlock ensemble models.`,
          });
          return;
        }

        const splitStrategy =
          body.splitStrategy === 'chronological' ? 'chronological' : 'stratified';
        if (splitStrategy === 'chronological' && !plan.allowChronologicalSplit) {
          res.status(403).json({
            error: `Chronological time-based validation splits are not available on the ${plan.name} plan.`,
          });
          return;
        }

        const maxPrevVersion = ws.modelHistory.reduce((max, m) => {
          const num = Number((m.version || '').replace(/^v/i, ''));
          return Number.isFinite(num) ? Math.max(max, num) : max;
        }, 0);
        const nextVersion = Math.max(ws.modelHistory.length + 1, maxPrevVersion + 1);

        const artifact = trainAndEvaluateModel(
          ws.activeDataset,
          {
            modelType: requestedModel,
            testSplitRatio: Number(body.testSplitRatio) || 0.2,
            maxDepth: body.maxDepth ? Number(body.maxDepth) : requestedModel === 'random_forest' ? 5 : 4,
            nEstimators: body.nEstimators ? Number(body.nEstimators) : 25,
            splitStrategy,
          },
          nextVersion
        );

        ws.activeModelArtifact = artifact;
        ws.modelHistory = [artifact.evaluation, ...ws.modelHistory.slice(0, 9)];

        const ev = artifact.evaluation;
        const qualityOk = !(ev.testChurnRate > 0 && ev.recall === 0 && ev.f1Score === 0);
        ws.automationStatus = {
          stage: qualityOk ? 'predictions_ready' : 'more_historical_data_required',
          headline: qualityOk ? 'Predictions ready.' : 'More historical data required.',
          summary: qualityOk
            ? `${ev.modelName} (${ev.version}) built via Technical ML Studio with ${ev.accuracy.toFixed(1)}% held-out accuracy.`
            : 'Custom model build produced 0% churn recall on the hold-out test split.',
          predictionAvailable: qualityOk,
          needsRefresh: !qualityOk || (ev.leakageWarnings?.length || 0) > 0,
          refreshNotice:
            ev.leakageWarnings && ev.leakageWarnings.length > 0
              ? 'Target leakage notice flagged on this model version.'
              : null,
          failureReason: qualityOk ? null : '0% churn recall on held-out test records.',
          recommendedAction: qualityOk
            ? null
            : 'Review your feature selection or upload additional labeled churn records.',
          selectedAlgorithmReason: `Manually configured ${ev.modelName} (${ev.splitStrategy} split) in Technical ML Studio.`,
          updatedAt: new Date().toISOString(),
          steps: buildPipelineSteps({
            datasetFileName: ws.activeDataset.state.fileName,
            rowCount: ws.activeDataset.state.rowCount,
            missingCellCount: ws.activeDataset.state.missingCellCount ?? 0,
            duplicateCount: ws.activeDataset.state.duplicateCount ?? 0,
            featureCount: ws.activeDataset.state.mapping.featureColumns.length,
            validationOk: true,
            labelsOk: true,
            modelBuilt: true,
            qualityOk,
            modelName: ev.modelName,
            splitLabel: ev.splitStrategy,
            qualityDetail: `${ev.accuracy.toFixed(1)}% accuracy, ${ev.recall.toFixed(1)}% recall on ${ev.testCount} held-out records`,
          }),
        };

        ws.activeAnalytics = buildWorkspaceAnalytics(company, ws) || ws.activeAnalytics;
        persistCompanyWorkspace(company.id, ws);

        recordAuditEvent({
          companyId: company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'MODEL_TRAINED',
          resource: 'model',
          details: `Trained ${artifact.evaluation.modelName} ${artifact.evaluation.version} (${artifact.evaluation.splitStrategy}, acc=${artifact.evaluation.accuracy}%, f1=${artifact.evaluation.f1Score}%)`,
        });

        res.json({
          analytics: ws.activeAnalytics,
          activeModel: serializeActiveModelEvaluation(ws),
          modelHistory: ws.modelHistory,
          automationStatus: ws.automationStatus,
          usage: buildUsageSummary(company, ws),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Model training failed.';
        res.status(400).json({ error: message });
      }
    }
  );

  // 7b. Automated managed prediction build / refresh (customer-facing one-click workflow)
  app.post(
    '/api/model/auto-build',
    requireAuth,
    requirePermission('canGeneratePredictions'),
    computeLimiter,
    (req: AuthenticatedRequest, res) => {
      try {
        const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
        const ws = getCompanyWorkspace(company.id);

        if (!ws.activeDataset) {
          res.status(400).json({ error: 'Please upload or load a customer dataset first.' });
          return;
        }

        const automationStatus = runAutomatedPredictionSetup(company, ws, {
          allowModelExecution: true,
          actor: {
            id: req.auth!.user.id,
            email: req.auth!.user.email,
            role: req.auth!.user.role,
          },
        });

        res.json({
          analytics: ws.activeAnalytics,
          activeModel: serializeActiveModelEvaluation(ws),
          modelHistory: ws.modelHistory,
          automationStatus,
          usage: buildUsageSummary(company, ws),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Managed prediction setup failed.';
        res.status(400).json({ error: message });
      }
    }
  );

  // 8. Predict single customer (What-If simulation using trained model, company-isolated)
  app.post(
    '/api/model/predict-single',
    requireAuth,
    requirePermission('canGeneratePredictions'),
    (req: AuthenticatedRequest, res) => {
      try {
        const ws = getCompanyWorkspace(req.auth!.company.id);
        if (!ws.activeModelArtifact) {
          res.status(400).json({ error: 'Please train a classification model first.' });
          return;
        }
        const attributes = req.body as Record<string, string>;
        const result = predictSingleCustomer(ws.activeModelArtifact, attributes);
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Prediction failed.';
        res.status(400).json({ error: message });
      }
    }
  );

  // 8b. Batch prediction scoring upload (CSV or Excel scored against company's active model)
  app.post(
    '/api/model/batch-score',
    requireAuth,
    requirePermission('canGeneratePredictions'),
    computeLimiter,
    (req: AuthenticatedRequest, res) => {
      try {
        const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
        const ws = getCompanyWorkspace(company.id);
        const plan = getSubscriptionPlanSpec(company.subscriptionPlan);

        if (!plan.allowBatchScoring) {
          res.status(403).json({
            error: `Batch prediction scoring requires Starter plan or higher (current plan: ${plan.name}).`,
          });
          return;
        }
        if (!ws.activeModelArtifact) {
          res.status(400).json({ error: 'Please train an active classification model first.' });
          return;
        }

        const { fileName, csvText, fileBase64 } = (req.body || {}) as {
          fileName?: string;
          csvText?: string;
          fileBase64?: string;
        };
        const safeName = (fileName || 'batch_customers.csv').trim();
        const rawByteSize = csvText
          ? Buffer.byteLength(csvText, 'utf-8')
          : fileBase64
            ? Math.ceil((fileBase64.length * 3) / 4)
            : 0;

        const { rows } = parseSpreadsheetUpload({
          fileName: safeName,
          csvText,
          fileBase64,
        });

        enforceDatasetPlanQuota(company, rows.length, rawByteSize);

        const batchResult = scoreBatchRecords(ws.activeModelArtifact, safeName, rows);
        ws.batchScores = [batchResult, ...(ws.batchScores || []).slice(0, 9)];
        persistCompanyWorkspace(company.id, ws);

        recordAuditEvent({
          companyId: company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'BATCH_PREDICTION_SCORED',
          resource: 'batch_score',
          details: `Scored ${batchResult.totalRows} rows from ${safeName} using ${batchResult.modelName} ${batchResult.modelVersion} (${batchResult.highRiskCount} high risk)`,
        });

        res.json({ batchResult, batchScores: ws.batchScores, usage: buildUsageSummary(company, ws) });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Batch scoring failed.';
        res.status(400).json({ error: message });
      }
    }
  );

  // 8c. Export specific batch prediction result as CSV
  app.get('/api/model/export-batch/:batchId', requireAuth, (req: AuthenticatedRequest, res) => {
    const ws = getCompanyWorkspace(req.auth!.company.id);
    const batchId = String(req.params.batchId || '');
    const batch = (ws.batchScores || []).find((b) => b.batchId === batchId);
    if (!batch) {
      res.status(404).json({ error: 'Batch score result not found in this workspace.' });
      return;
    }

    const headers = [
      'Row',
      'CustomerID',
      'PredictedStatus',
      'EstimatedChurnProbability',
      'RiskCategory',
    ];
    const lines = [headers.join(',')];
    for (const r of batch.records) {
      lines.push(
        [
          String(r.rowIndex),
          escapeCsvCell(r.customerId),
          escapeCsvCell(r.predictedChurn),
          `${(r.churnProbability * 100).toFixed(1)}%`,
          escapeCsvCell(r.riskCategory),
        ].join(',')
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="batch_predictions_${batch.batchId}.csv"`
    );
    res.send(lines.join('\n'));
  });

  // 9. Export predictions as CSV (company-isolated)
  app.get('/api/model/export-predictions', requireAuth, (req: AuthenticatedRequest, res) => {
    const ws = getCompanyWorkspace(req.auth!.company.id);
    if (!ws.activeModelArtifact) {
      res.status(400).json({ error: 'No trained model predictions available to export.' });
      return;
    }

    const serialized = serializeActiveModelEvaluation(ws);
    const preds = serialized?.predictions || ws.activeModelArtifact.evaluation.predictions;
    const headers = [
      'Row',
      'CustomerID',
      'CustomerName',
      'DatasetSplit',
      'ActualCustomerStatus',
      'PredictedChurnProbability',
      'PredictedRiskClassification',
    ];

    const lines = [headers.join(',')];
    for (const p of preds) {
      const actualStatus =
        p.actualStatus || (p.actualChurn === 'Churned' ? 'Churned' : 'Active');
      const isRiskApplicable =
        p.riskApplicable !== false && actualStatus !== 'Churned' && actualStatus !== 'Inconsistent';
      const probText = isRiskApplicable
        ? `${(p.churnProbability * 100).toFixed(1)}%`
        : 'Not Applicable';
      const riskText = isRiskApplicable
        ? p.predictedRiskLabel || classifyPredictedRiskLabel(p.riskCategory)
        : 'Not Applicable';
      lines.push(
        [
          String(p.rowIndex),
          escapeCsvCell(p.customerId),
          escapeCsvCell(p.customerName || 'Name unavailable'),
          escapeCsvCell(p.split),
          escapeCsvCell(actualStatus),
          escapeCsvCell(probText),
          escapeCsvCell(riskText),
        ].join(',')
      );
    }

    recordAuditEvent({
      companyId: req.auth!.company.id,
      actorId: req.auth!.user.id,
      actorEmail: req.auth!.user.email,
      actorRole: req.auth!.user.role,
      action: 'PREDICTIONS_EXPORTED',
      resource: 'export',
      details: `Exported ${preds.length} model predictions as CSV`,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="churn_predictions.csv"');
    res.send(lines.join('\n'));
  });

  // ---------------------------------------------------------------------------
  // 9b. Customer Value Intelligence Routes (Strictly Tenant-Isolated)
  // ---------------------------------------------------------------------------
  app.get('/api/value-intelligence', requireAuth, (req: AuthenticatedRequest, res) => {
    const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
    const ws = getCompanyWorkspace(company.id);
    const summary = computeCustomerValueIntelligence({
      dataset: ws.activeDataset,
      activeArtifact: ws.activeModelArtifact,
      batchScores: ws.batchScores,
      valueConfig: ws.valueConfig || DEFAULT_CUSTOMER_VALUE_CONFIG,
    });
    res.json({ summary });
  });

  app.put(
    '/api/value-intelligence/config',
    requireAuth,
    requirePermission('canUploadAndAnalyse'),
    (req: AuthenticatedRequest, res) => {
      try {
        const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
        const ws = getCompanyWorkspace(company.id);
        const incoming = (req.body || {}) as Partial<CustomerValueConfig>;
        const nextConfig = normalizeValueConfig({
          ...(ws.valueConfig || DEFAULT_CUSTOMER_VALUE_CONFIG),
          ...incoming,
          weights: {
            ...(ws.valueConfig?.weights || DEFAULT_CUSTOMER_VALUE_CONFIG.weights),
            ...(incoming.weights || {}),
          },
        });
        ws.valueConfig = nextConfig;
        persistCompanyWorkspace(company.id, ws);

        const summary = computeCustomerValueIntelligence({
          dataset: ws.activeDataset,
          activeArtifact: ws.activeModelArtifact,
          batchScores: ws.batchScores,
          valueConfig: nextConfig,
        });

        recordAuditEvent({
          companyId: company.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'VALUE_CONFIG_UPDATED',
          resource: 'value_intelligence',
          details: `Updated value weights (rev=${nextConfig.weights.revenue}, highPct=${nextConfig.highValuePercentile}, riskCutoff=${nextConfig.highRiskCutoff})`,
        });

        res.json({ summary, config: nextConfig });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to update value configuration.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.get('/api/value-intelligence/export-csv', requireAuth, (req: AuthenticatedRequest, res) => {
    const company = getCompanyById(req.auth!.company.id) || req.auth!.company;
    const ws = getCompanyWorkspace(company.id);
    const summary = computeCustomerValueIntelligence({
      dataset: ws.activeDataset,
      activeArtifact: ws.activeModelArtifact,
      batchScores: ws.batchScores,
      valueConfig: ws.valueConfig || DEFAULT_CUSTOMER_VALUE_CONFIG,
    });

    if (!summary.valueAssessmentAvailable || summary.customers.length === 0) {
      res.status(400).json({ error: summary.unavailableReason || 'No customer value assessment available.' });
      return;
    }

    const headers = [
      'CustomerID',
      'CustomerName',
      'ActualCustomerStatus',
      'Segment',
      'ValueScore',
      'ValueSegment',
      'AnnualizedRevenue',
      'ProfitContribution',
      'PredictedChurnProbability',
      'PredictedRiskClassification',
      'ValueRiskQuadrant',
      'RetentionPriority',
      'ExpectedRevenueExposure',
      'RiskFactors',
    ];
    const lines = [headers.join(',')];
    for (const c of summary.customers) {
      const isRiskApplicable =
        c.riskApplicable !== false &&
        c.actualStatus !== 'Churned' &&
        c.actualStatus !== 'Inconsistent';
      lines.push(
        [
          escapeCsvCell(c.customerId),
          escapeCsvCell(c.customerName),
          escapeCsvCell(c.actualStatus || 'Unknown'),
          escapeCsvCell(c.segment),
          String(c.valueScore),
          escapeCsvCell(c.valueSegment),
          c.annualizedRevenue !== null ? String(c.annualizedRevenue) : 'Unavailable',
          c.profitContribution !== null ? String(c.profitContribution) : 'Unavailable',
          !isRiskApplicable
            ? 'Not Applicable'
            : c.churnProbability !== null
              ? `${(c.churnProbability * 100).toFixed(1)}%`
              : 'Unavailable',
          !isRiskApplicable
            ? 'Not Applicable'
            : escapeCsvCell(c.predictedRiskLabel || c.riskCategory || 'Unavailable'),
          escapeCsvCell(c.quadrantLabel),
          escapeCsvCell(c.retentionPriority),
          !isRiskApplicable
            ? 'Not Applicable'
            : c.expectedRevenueExposure !== null
              ? String(c.expectedRevenueExposure)
              : 'Unavailable',
          escapeCsvCell(c.riskFactors.join('; ')),
        ].join(',')
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="churnsight_customer_value_intelligence.csv"'
    );
    res.send(lines.join('\n'));
  });

  // ---------------------------------------------------------------------------
  // Platform Owner SaaS Governance Routes (Strictly PLATFORM_OWNER Only)
  // ---------------------------------------------------------------------------
  app.get(
    '/api/platform/overview',
    requireAuth,
    requireRole('PLATFORM_OWNER'),
    (_req: AuthenticatedRequest, res) => {
      const companies = listAllCompanies();
      const summaries: PlatformCompanySummary[] = companies.map((c) => {
        const users = listCompanyUsers(c.id);
        const ws = getCompanyWorkspace(c.id);
        return {
          company: c,
          userCount: users.length,
          activeUserCount: users.filter((u) => u.isActive).length,
          hasDataset: Boolean(ws.activeDataset),
          datasetFileName: ws.activeDataset?.state.fileName || null,
          recordCount: ws.activeDataset?.state.rowCount || 0,
          trainedModelsCount: ws.modelHistory.length,
          lastModelTrainedAt: ws.modelHistory[0]?.trainedAt || null,
          storageBytesUsed: ws.storageBytesUsed || 0,
        };
      });

      res.json({
        companies: summaries,
        auditLogs: listPlatformAuditLogs(150),
        plans: SUBSCRIPTION_PLAN_LIST,
        industriesConfigured: Object.keys(INDUSTRY_PROFILES).length,
        billingIntegrationConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      });
    }
  );

  app.patch(
    '/api/platform/companies/:companyId/plan',
    requireAuth,
    requireRole('PLATFORM_OWNER'),
    (req: AuthenticatedRequest, res) => {
      try {
        const companyId = String(req.params.companyId || '');
        const { subscriptionPlan } = (req.body || {}) as {
          subscriptionPlan?: SubscriptionPlanTier;
        };
        if (!subscriptionPlan) {
          res.status(400).json({ error: 'Subscription plan tier is required.' });
          return;
        }
        const updated = updateCompanyProfile(companyId, { subscriptionPlan });
        recordAuditEvent({
          companyId: updated.id,
          actorId: req.auth!.user.id,
          actorEmail: req.auth!.user.email,
          actorRole: req.auth!.user.role,
          action: 'PLATFORM_PLAN_ASSIGNED',
          resource: 'subscription',
          details: `Platform owner assigned "${subscriptionPlan}" plan to "${updated.name}"`,
        });
        res.json({ company: updated });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to update company plan.';
        res.status(400).json({ error: message });
      }
    }
  );

  // Ensure unknown /api routes always return JSON rather than SPA HTML
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  return app;
}

async function startServer() {
  const app = createApiApp();
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  // Vite middleware in development, static files in production
  if (process.env.NODE_ENV !== 'production') {
    const vitePromise = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: {
          middlewareMode: true,
          ...(process.env.DISABLE_HMR !== 'true' ? { ws: { server: httpServer } } : {}),
        },
        appType: 'spa',
      })
    );

    vitePromise.catch((err) => {
      console.error('Failed to initialize Vite dev middleware:', err);
    });

    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.on('error', (err) => {
    console.error('HTTP server failed to bind:', err);
    process.exit(1);
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL && process.env.CHURNSIGHT_NO_LISTEN !== 'true') {
  startServer().catch((err) => {
    console.error('Fatal server startup error:', err);
    process.exit(1);
  });
}
