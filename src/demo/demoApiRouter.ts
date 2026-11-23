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
  UserAccount,
  UserPermissions,
  UserRole,
  WorkspaceUsageSummary,
} from '../types/churn';
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
  type TrainedModelArtifact,
} from '../../server/mlEngine';
import {
  generateIndustryTemplateExport,
  generatePredictionInputTemplateExport,
  normalizeTemplateMode,
  type LegacyCompatibleTemplateMode,
  type TemplateFormat,
} from '../../server/industryTemplates';
import {
  aggregateTicketsByCustomer,
  checkModelCompatibility,
  mergeTicketsIntoCustomerRows,
  parseMultiSheetSpreadsheetUpload,
  validateCustomerImportRows,
} from '../../server/importEngine';
import {
  computeCustomerValueIntelligence,
  DEFAULT_CUSTOMER_VALUE_CONFIG,
  normalizeValueConfig,
} from '../../server/valueEngine';
import {
  classifyPredictedRiskLabel,
  detectStatusColumnHints,
  resolveCustomerStatusRecord,
} from '../../server/customerStatusEngine';
import {
  generateSampleIndustryBundle,
  generateSampleIndustryCsv,
} from '../../server/sampleDataset';
import {
  buildDefaultChurnDefinition,
  buildDefaultPrivacySettings,
  getDefaultRelationshipForIndustry,
  getIndustryDataTemplateColumns,
  INDUSTRY_PROFILES,
} from '../utils/industryConfig';
import {
  formatBytes,
  getSubscriptionPlanSpec,
  SUBSCRIPTION_PLAN_LIST,
} from '../utils/subscriptionPlans';
import {
  appendDemoAuditLog,
  buildWorkspaceBackupJson,
  clearCompanyAuditLogs,
  createEmptyWorkspaceRecord,
  DEFAULT_DEMO_COMPANY_ID,
  deleteDemoSession,
  ensureDemoDbInitialized,
  findDemoUserByEmail,
  generateId,
  generateSaltHex,
  getDemoCompany,
  getDemoSession,
  getDemoUserById,
  getDemoWorkspace,
  hashPasswordWithSalt,
  isDefaultSampleSeeded,
  listAllDemoAuditLogs,
  listAllDemoCompanies,
  listAllDemoUsers,
  listDemoAuditLogsForCompany,
  listDemoUploadedDatasetSummaries,
  listDemoUsersForCompany,
  markDefaultSampleSeeded,
  recomputeWorkspaceStorageBytes,
  resetEntireDemoDatabase,
  saveDemoCompany,
  saveDemoSession,
  saveDemoUser,
  saveDemoWorkspace,
  toPublicUserAccount,
  updateDemoPreferences,
  utf8ByteLength,
  verifyPasswordHash,
  type DemoSessionRecord,
  type DemoUploadedDatasetEntry,
  type DemoUserRecord,
  type DemoWorkspaceRecord,
} from './demoDb';

const SESSION_SHORT_MS = 8 * 60 * 60 * 1000;
const SESSION_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_IMAGE_DATA_URL_LENGTH = 750_000;

interface DemoAuthContext {
  token: string;
  user: UserAccount;
  company: CompanyWorkspaceInfo;
  expiresAt: string;
  rememberMe: boolean;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function fileResponse(
  body: string | Uint8Array,
  contentType: string,
  fileName: string,
  status = 200
): Response {
  const responseBody: BodyInit = typeof body === 'string' ? body : new Uint8Array(body);
  return new Response(responseBody, {
    status,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  });
}

function escapeCsvCell(val: string): string {
  const safe = /^[=+\-@]/.test(val) ? `'${val}` : val;
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function parseJsonBody(init?: RequestInit): Record<string, any> {
  if (!init?.body) return {};
  if (typeof init.body === 'string') {
    try {
      return (JSON.parse(init.body) || {}) as Record<string, any>;
    } catch {
      return {};
    }
  }
  return {};
}

function extractBearerToken(init?: RequestInit, fallbackToken?: string | null): string | null {
  if (init?.headers) {
    const headers = new Headers(init.headers);
    const auth = headers.get('Authorization');
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      const t = auth.slice(7).trim();
      if (t) return t;
    }
  }
  return fallbackToken || null;
}

function getDemoAuthContext(token: string | null): DemoAuthContext | null {
  if (!token) return null;
  const session = getDemoSession(token);
  if (!session) return null;
  const userRec = getDemoUserById(session.userId);
  if (!userRec || !userRec.isActive) return null;
  const company = getDemoCompany(session.companyId);
  if (!company) return null;
  return {
    token: session.token,
    user: toPublicUserAccount(userRec),
    company,
    expiresAt: session.expiresAt,
    rememberMe: session.rememberMe,
  };
}

function buildUsageSummary(
  company: CompanyWorkspaceInfo,
  ws: DemoWorkspaceRecord
): WorkspaceUsageSummary {
  const plan = getSubscriptionPlanSpec(company.subscriptionPlan);
  const userCount = listDemoUsersForCompany(company.id).length;
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
  ws: DemoWorkspaceRecord,
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

function serializeActiveModelEvaluation(ws: DemoWorkspaceRecord) {
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
      `Dataset contains ${rowCount.toLocaleString()} rows, which exceeds the ${plan.maxRecords.toLocaleString()} record limit on your ${plan.name} plan. Upgrade your subscription plan in Settings to process larger datasets.`
    );
  }
  if (rawByteSize > plan.maxStorageBytes) {
    throw new Error(
      `Uploaded file (${formatBytes(rawByteSize)}) exceeds the ${formatBytes(plan.maxStorageBytes)} workspace storage quota on your ${plan.name} plan.`
    );
  }
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

function commitRowsIntoWorkspaceInMemory(
  company: CompanyWorkspaceInfo,
  ws: DemoWorkspaceRecord,
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

  ws.uploadedDatasets = ws.uploadedDatasets.map((entry) => ({
    ...entry,
    importStatus: entry.importStatus === 'Active' ? 'Imported' : entry.importStatus,
  }));

  const hasErrorsExcluded =
    (rowValidation?.errorCount || 0) > 0 &&
    incomingRows.length < (rowValidation?.totalRows || incomingRows.length);
  const entryStatus: DemoUploadedDatasetEntry['importStatus'] = hasErrorsExcluded
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

  let finalHeaders = incomingHeaders;
  let finalRows = incomingRows;
  let finalLineage: string[][] = incomingRows.map(() => [newDatasetId]);

  if (ws.activeDataset && (duplicateStrategy === 'skip' || duplicateStrategy === 'update')) {
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
      const idKey = incomingIdCol ? (rawRow[incomingIdCol] || '').trim().toLowerCase() : '';

      if (idKey && indexById.has(idKey)) {
        if (duplicateStrategy === 'update') {
          const idx = indexById.get(idKey)!;
          mergedRows[idx] = { ...mergedRows[idx], ...normalizedIncoming };
          if (!mergedLineage[idx].includes(newDatasetId)) {
            mergedLineage[idx].push(newDatasetId);
          }
        }
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

  return { dataset: state, analytics: ws.activeAnalytics };
}

function runAutomatedPredictionSetupInMemory(
  company: CompanyWorkspaceInfo,
  ws: DemoWorkspaceRecord,
  options?: { allowModelExecution?: boolean }
): PredictionPipelineStatus {
  const now = new Date().toISOString();
  const ds = ws.activeDataset;
  if (!ds) {
    ws.activeModelArtifact = null;
    ws.automationStatus = null;
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
    return status;
  }

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

    let chosenArtifact: TrainedModelArtifact;
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
        const scoreA =
          a.evaluation.f1Score * 1.2 + a.evaluation.recall * 0.4 + a.evaluation.accuracy * 0.2;
        const scoreB =
          b.evaluation.f1Score * 1.2 + b.evaluation.recall * 0.4 + b.evaluation.accuracy * 0.2;
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
          'Add more historical customer records with clear churned examples, or verify that relevant customer behavior columns are mapped in Data Management.',
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
    return status;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Automated prediction build failed.';
    ws.activeModelArtifact = null;
    const status: PredictionPipelineStatus = {
      stage: 'setup_failed',
      headline: 'Prediction setup could not be completed.',
      summary:
        'Your data is saved for visual exploration, but automated prediction setup encountered an issue.',
      predictionAvailable: false,
      needsRefresh: true,
      refreshNotice: errMsg,
      failureReason: errMsg,
      recommendedAction:
        'Check your target churn column and feature selections in Data Management, then refresh predictions.',
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
    return status;
  }
}

function loadSampleIntoWorkspaceInMemory(
  company: CompanyWorkspaceInfo,
  ws: DemoWorkspaceRecord
): {
  dataset: DatasetState;
  analytics: AnalyticsSummary;
  automationStatus: PredictionPipelineStatus;
} {
  const sample = generateSampleIndustryBundle(company.industry, 250);
  const parsed = parseSpreadsheetUpload({
    fileName: sample.fileName,
    csvText: sample.csvText,
  });

  let headers = parsed.headers;
  let rows = parsed.rows;
  let ticketAggregation: TicketAggregationSummary | null = null;
  let ticketRows: Record<string, string>[] | undefined = undefined;

  if (sample.ticketRows.length > 0) {
    const merged = mergeTicketsIntoCustomerRows({
      source: 'workbook_sheet',
      customerHeaders: parsed.headers,
      customerRows: parsed.rows,
      ticketHeaders: sample.ticketHeaders,
      ticketRows: sample.ticketRows,
      idColumnHint: 'customer_id',
    });
    headers = merged.headers;
    rows = merged.rows;
    ticketAggregation = merged.summary;
    ticketRows = sample.ticketRows;
  }

  const confirmedChurnDef: ChurnDefinition = {
    ...(company.churnDefinition || buildDefaultChurnDefinition(company.industry)),
    confirmedByUser: true,
    confirmedAt: company.churnDefinition?.confirmedAt || new Date().toISOString(),
  };

  const profiledCols = profileColumns(headers, rows);
  const autoMapping = autoDetectMapping(profiledCols, rows, company.industry);
  const rowValidation = validateCustomerImportRows({
    headers,
    rows,
    mapping: autoMapping,
    satisfactionScale: ws.satisfactionScale || company.satisfactionScale || '1-5',
    ticketAggregation,
  });

  // Replace any earlier copy of this exact sample dataset cleanly so repeated demo loads never duplicate entries
  ws.uploadedDatasets = ws.uploadedDatasets.filter(
    (entry) => !(entry.isSample && entry.fileName === sample.fileName)
  );

  const committed = commitRowsIntoWorkspaceInMemory(company, ws, {
    fileName: sample.fileName,
    sourceFormat: parsed.sourceFormat,
    headers,
    rows,
    mapping: autoMapping,
    churnDefinition: confirmedChurnDef,
    rowValidation,
    ticketAggregation,
    ticketRows,
    duplicateStrategy: 'replace',
    isSample: true,
  });

  const automationStatus = runAutomatedPredictionSetupInMemory(company, ws, {
    allowModelExecution: true,
  });

  return {
    ...committed,
    automationStatus,
  };
}

async function ensureDefaultDemoWorkspacePopulated(): Promise<void> {
  await ensureDemoDbInitialized();
  if (isDefaultSampleSeeded()) return;
  const defaultCompany = getDemoCompany(DEFAULT_DEMO_COMPANY_ID);
  if (!defaultCompany) return;
  const ws = getDemoWorkspace(DEFAULT_DEMO_COMPANY_ID);
  if (!ws.activeDataset && ws.uploadedDatasets.length === 0) {
    loadSampleIntoWorkspaceInMemory(defaultCompany, ws);
    await saveDemoWorkspace(ws);
  }
  await markDefaultSampleSeeded();
}

function buildTemplateMappingForIndustry(industry: IndustryKey, headers: string[]): ColumnMapping {
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
}

function refreshActiveDatasetStateInMemory(
  company: CompanyWorkspaceInfo,
  ws: DemoWorkspaceRecord,
  allowModelExecution: boolean
): { automationStatus: PredictionPipelineStatus } {
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
    computeAnalytics(columns, ds.rows, mapping, {}, company.churnDefinition);

  const activeEntryIdx = ws.uploadedDatasets.findIndex(
    (d) => d.datasetId === ds.state.datasetId
  );
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

  const automationStatus = runAutomatedPredictionSetupInMemory(company, ws, {
    allowModelExecution,
  });

  return { automationStatus };
}

function checkPermissionError(
  auth: DemoAuthContext,
  perm: keyof UserPermissions
): Response | null {
  if (auth.user.role === 'FIRM_ADMIN' || auth.user.role === 'PLATFORM_OWNER') {
    return null;
  }
  if (!auth.user.permissions[perm]) {
    return jsonResponse(
      {
        error:
          perm === 'canUploadAndAnalyse'
            ? 'Your Analyst account does not have permission to upload or modify datasets.'
            : 'Your Analyst account does not have permission to train models or generate predictions.',
      },
      403
    );
  }
  return null;
}

function checkAdminError(auth: DemoAuthContext): Response | null {
  if (auth.user.role === 'FIRM_ADMIN' || auth.user.role === 'PLATFORM_OWNER') {
    return null;
  }
  return jsonResponse(
    { error: 'Access denied. Firm Administrator privileges are required for this action.' },
    403
  );
}

export async function handleDemoApiRequest(
  rawUrl: string,
  init: RequestInit = {},
  clientSessionToken: string | null = null
): Promise<Response> {
  await ensureDefaultDemoWorkspacePopulated();

  const parsedUrl = new URL(
    rawUrl.startsWith('http') ? rawUrl : `http://churnsight.local${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`
  );
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
  const method = (init.method || 'GET').toUpperCase();
  const token = extractBearerToken(init, clientSessionToken);
  const body = parseJsonBody(init);

  // ---------------------------------------------------------------------------
  // Public Health & Auth Status Routes
  // ---------------------------------------------------------------------------
  if (method === 'GET' && pathname === '/api/health') {
    return jsonResponse({
      status: 'ok',
      demoMode: true,
      storagePersistent: true,
      storageMode: 'demo',
      provider: 'IndexedDB (Local Browser)',
      message: 'DEMO MODE — Data stored locally in this browser.',
    });
  }

  if (method === 'GET' && pathname === '/api/auth/status') {
    const hasWorkspaces = listAllDemoUsers().length > 0;
    return jsonResponse({
      demoMode: true,
      hasRegisteredWorkspaces: hasWorkspaces,
      storagePersistent: true,
      storageMode: 'demo',
      provider: 'IndexedDB (Local Browser)',
      message: 'DEMO MODE — Data stored locally in this browser.',
    });
  }

  // ---------------------------------------------------------------------------
  // Demo Factory Reset (accessible from Login/Register or Settings)
  // ---------------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/demo/factory-reset') {
    await resetEntireDemoDatabase();
    const defaultCompany = getDemoCompany(DEFAULT_DEMO_COMPANY_ID);
    if (defaultCompany) {
      const ws = getDemoWorkspace(defaultCompany.id);
      loadSampleIntoWorkspaceInMemory(defaultCompany, ws);
      await saveDemoWorkspace(ws);
      await markDefaultSampleSeeded();
    }
    return jsonResponse({
      ok: true,
      message: 'Local browser demo workspace and accounts have been reset.',
    });
  }

  // ---------------------------------------------------------------------------
  // Auth: Register Company, Login, Logout, Me, Refresh, Forgot/Reset Password
  // ---------------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/auth/register-company') {
    const input = body as RegisterCompanyRequest;
    const companyName = (input.companyName || '').trim();
    const adminFullName = (input.adminFullName || '').trim();
    const adminEmail = (input.adminEmail || '').trim().toLowerCase();
    const companyEmail = ((input.companyEmail || '').trim() || adminEmail).toLowerCase();
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
    const password = String(input.password || '');
    const confirmPassword = String(input.confirmPassword || '');

    if (companyName.length < 2) {
      return jsonResponse({ error: 'Company name must be at least 2 characters long.' }, 400);
    }
    if (!isValidEmail(companyEmail)) {
      return jsonResponse({ error: 'Please provide a valid company email address.' }, 400);
    }
    if (industry === 'other' && !customIndustryName) {
      return jsonResponse({ error: 'Please specify your custom industry name.' }, 400);
    }
    if (adminFullName.length < 2) {
      return jsonResponse({ error: 'Full name must be at least 2 characters long.' }, 400);
    }
    if (!isValidEmail(adminEmail)) {
      return jsonResponse({ error: 'Please provide a valid email address.' }, 400);
    }
    if (password.length < 8) {
      return jsonResponse({ error: 'Password must be at least 8 characters long.' }, 400);
    }
    if (password !== confirmPassword) {
      return jsonResponse({ error: 'Password and confirmation password do not match.' }, 400);
    }

    const existingUsers = listAllDemoUsers();
    const existingCompanies = listAllDemoCompanies();
    if (
      existingUsers.some(
        (u) =>
          u.email.trim().toLowerCase() === adminEmail ||
          u.email.trim().toLowerCase() === companyEmail
      ) ||
      existingCompanies.some(
        (c) =>
          c.email.trim().toLowerCase() === companyEmail ||
          c.email.trim().toLowerCase() === adminEmail
      )
    ) {
      return jsonResponse(
        {
          error: 'This email is already registered in this browser. Please sign in.',
          code: 'ACCOUNT_ALREADY_EXISTS',
        },
        409
      );
    }
    if (existingCompanies.some((c) => c.name.trim().toLowerCase() === companyName.toLowerCase())) {
      return jsonResponse(
        {
          error: 'A company workspace with this name is already registered in this browser.',
          code: 'COMPANY_ALREADY_EXISTS',
        },
        409
      );
    }

    const now = new Date().toISOString();
    const company: CompanyWorkspaceInfo = {
      id: generateId('cmp'),
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
      subscriptionPlan: 'professional',
      satisfactionScale: '1-5',
      churnDefinition: buildDefaultChurnDefinition(industry),
      privacySettings: buildDefaultPrivacySettings(),
      createdAt: now,
    };

    const salt = generateSaltHex();
    const pwHash = await hashPasswordWithSalt(password, salt);
    const user: DemoUserRecord = {
      id: generateId('usr'),
      companyId: company.id,
      fullName: adminFullName,
      email: adminEmail,
      passwordSalt: salt,
      passwordHash: pwHash,
      role: 'FIRM_ADMIN',
      isActive: true,
      avatarDataUrl: null,
      permissions: { canUploadAndAnalyse: true, canGeneratePredictions: true },
      createdAt: now,
      lastLoginAt: now,
    };

    const ws = createEmptyWorkspaceRecord(company.id);
    recomputeWorkspaceStorageBytes(ws);

    const sessionToken = `demo_${generateSaltHex(20)}`;
    const session: DemoSessionRecord = {
      token: sessionToken,
      userId: user.id,
      companyId: company.id,
      rememberMe: true,
      createdAt: now,
      expiresAt: new Date(Date.now() + SESSION_REMEMBER_MS).toISOString(),
    };

    await Promise.all([
      saveDemoCompany(company),
      saveDemoUser(user),
      saveDemoWorkspace(ws),
      saveDemoSession(session),
      appendDemoAuditLog({
        companyId: company.id,
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: 'COMPANY_REGISTERED',
        resource: 'company',
        details: `Registered local demo workspace "${company.name}" (${company.industry})`,
      }),
    ]);

    updateDemoPreferences({ lastDemoEmail: user.email });

    return jsonResponse(
      {
        company,
        user: toPublicUserAccount(user),
        expiresAt: session.expiresAt,
        rememberMe: true,
        sessionToken,
        message: 'Demo company workspace created.',
      },
      201
    );
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    const input = body as LoginRequest;
    const email = (input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    const rememberMe = Boolean(input.rememberMe ?? true);

    if (!isValidEmail(email)) {
      return jsonResponse({ error: 'Please enter a valid email address.' }, 400);
    }
    if (!password) {
      return jsonResponse({ error: 'Please enter your password.' }, 400);
    }

    const userRec = findDemoUserByEmail(email);
    if (!userRec) {
      return jsonResponse(
        {
          error: 'Account not found in this browser. Register a demo workspace first or use Quick Demo Sign-In.',
          code: 'ACCOUNT_NOT_FOUND',
        },
        401
      );
    }
    if (!userRec.isActive) {
      return jsonResponse(
        {
          error: 'This account has been deactivated by your workspace administrator.',
          code: 'ACCOUNT_DEACTIVATED',
        },
        403
      );
    }
    const validPw = await verifyPasswordHash(password, userRec.passwordSalt, userRec.passwordHash);
    if (!validPw) {
      return jsonResponse(
        { error: 'Incorrect password. Please try again.', code: 'INVALID_PASSWORD' },
        401
      );
    }

    const company = getDemoCompany(userRec.companyId);
    if (!company) {
      return jsonResponse({ error: 'Company workspace not found.' }, 404);
    }

    const now = new Date().toISOString();
    userRec.lastLoginAt = now;
    const ttlMs = rememberMe ? SESSION_REMEMBER_MS : SESSION_SHORT_MS;
    const sessionToken = `demo_${generateSaltHex(20)}`;
    const session: DemoSessionRecord = {
      token: sessionToken,
      userId: userRec.id,
      companyId: company.id,
      rememberMe,
      createdAt: now,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };

    await Promise.all([
      saveDemoUser(userRec),
      saveDemoSession(session),
      appendDemoAuditLog({
        companyId: company.id,
        actorId: userRec.id,
        actorEmail: userRec.email,
        actorRole: userRec.role,
        action: 'USER_LOGIN',
        resource: 'session',
        details: `Signed in to ${company.name} (Local Browser Demo)`,
      }),
    ]);

    updateDemoPreferences({ lastDemoEmail: userRec.email });

    return jsonResponse({
      user: toPublicUserAccount(userRec),
      company,
      expiresAt: session.expiresAt,
      rememberMe,
      sessionToken,
    });
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    const ctx = getDemoAuthContext(token);
    if (ctx) {
      await appendDemoAuditLog({
        companyId: ctx.company.id,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        actorRole: ctx.user.role,
        action: 'USER_LOGOUT',
        resource: 'session',
        details: 'Signed out cleanly',
      });
    }
    if (token) {
      await deleteDemoSession(token);
    }
    return jsonResponse({ ok: true });
  }

  if (method === 'GET' && pathname === '/api/auth/me') {
    const ctx = getDemoAuthContext(token);
    if (!ctx) {
      return jsonResponse({ error: 'Not authenticated.' }, 401);
    }
    return jsonResponse({
      user: ctx.user,
      company: ctx.company,
      expiresAt: ctx.expiresAt,
      rememberMe: ctx.rememberMe,
    });
  }

  if (method === 'POST' && pathname === '/api/auth/refresh') {
    const sess = token ? getDemoSession(token) : null;
    const ctx = getDemoAuthContext(token);
    if (!sess || !ctx) {
      return jsonResponse({ error: 'Session expired. Please sign in again.' }, 401);
    }
    const ttlMs = sess.rememberMe ? SESSION_REMEMBER_MS : SESSION_SHORT_MS;
    sess.expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await saveDemoSession(sess);
    return jsonResponse({
      user: ctx.user,
      company: ctx.company,
      expiresAt: sess.expiresAt,
      rememberMe: sess.rememberMe,
    });
  }

  if (method === 'POST' && pathname === '/api/auth/forgot-password') {
    const email = String(body.email || '').trim().toLowerCase();
    const newDemoPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!isValidEmail(email)) {
      return jsonResponse({ error: 'Please enter a valid email address.' }, 400);
    }
    const userRec = findDemoUserByEmail(email);
    if (!userRec) {
      return jsonResponse(
        {
          error: 'No local demo account found for that email address in this browser.',
          code: 'ACCOUNT_NOT_FOUND',
        },
        404
      );
    }
    if (newDemoPassword) {
      if (newDemoPassword.length < 8) {
        return jsonResponse({ error: 'New password must be at least 8 characters long.' }, 400);
      }
      const nextSalt = generateSaltHex();
      userRec.passwordSalt = nextSalt;
      userRec.passwordHash = await hashPasswordWithSalt(newDemoPassword, nextSalt);
      await saveDemoUser(userRec);
      return jsonResponse({
        emailConfigured: false,
        passwordResetInDemo: true,
        message: `Local demo password updated for ${userRec.email}. You can now sign in with your new password.`,
      });
    }
    return jsonResponse({
      emailConfigured: false,
      accountFound: true,
      message:
        'Demo Mode runs locally in your browser without an email server. Enter a new password below to update this local demo account password, or reset the demo workspace.',
    });
  }

  // ---------------------------------------------------------------------------
  // Protected Routes Below Require Valid Demo Session
  // ---------------------------------------------------------------------------
  const auth = getDemoAuthContext(token);
  if (!auth) {
    return jsonResponse({ error: 'Authentication required. Please sign in to continue.' }, 401);
  }

  // User Profile & Password
  if (method === 'PATCH' && pathname === '/api/auth/profile') {
    const userRec = getDemoUserById(auth.user.id);
    if (!userRec) return jsonResponse({ error: 'Account not found.' }, 404);
    if (typeof body.fullName === 'string') {
      const trimmed = body.fullName.trim();
      if (trimmed.length < 2) {
        return jsonResponse({ error: 'Full name must be at least 2 characters long.' }, 400);
      }
      userRec.fullName = trimmed;
    }
    if (body.avatarDataUrl === null) {
      userRec.avatarDataUrl = null;
    } else if (typeof body.avatarDataUrl === 'string' && body.avatarDataUrl) {
      if (body.avatarDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        return jsonResponse({ error: 'Avatar image exceeds maximum size limit.' }, 400);
      }
      userRec.avatarDataUrl = body.avatarDataUrl;
    }
    await saveDemoUser(userRec);
    return jsonResponse({ user: toPublicUserAccount(userRec) });
  }

  if (method === 'POST' && pathname === '/api/auth/change-password') {
    const userRec = getDemoUserById(auth.user.id);
    if (!userRec) return jsonResponse({ error: 'Account not found.' }, 404);
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    const confirmNewPassword = String(body.confirmNewPassword || '');
    const valid = await verifyPasswordHash(
      currentPassword,
      userRec.passwordSalt,
      userRec.passwordHash
    );
    if (!valid) {
      return jsonResponse({ error: 'Current password is incorrect.' }, 400);
    }
    if (newPassword.length < 8) {
      return jsonResponse({ error: 'New password must be at least 8 characters long.' }, 400);
    }
    if (newPassword !== confirmNewPassword) {
      return jsonResponse({ error: 'New password and confirmation do not match.' }, 400);
    }
    const nextSalt = generateSaltHex();
    userRec.passwordSalt = nextSalt;
    userRec.passwordHash = await hashPasswordWithSalt(newPassword, nextSalt);
    await Promise.all([
      saveDemoUser(userRec),
      appendDemoAuditLog({
        companyId: auth.company.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        actorRole: auth.user.role,
        action: 'PASSWORD_CHANGED',
        resource: 'user',
        details: 'User updated account password',
      }),
    ]);
    return jsonResponse({ ok: true, message: 'Your password has been updated successfully.' });
  }

  // ---------------------------------------------------------------------------
  // Demo Workspace Management Controls (Accessible to All Signed-In Demo Users)
  // ---------------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/demo/clear-dataset') {
    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    ws.activeDataset = null;
    ws.uploadedDatasets = [];
    ws.rowDatasetLineage = [];
    ws.ticketAggregation = null;
    ws.activeAnalytics = null;
    ws.activeModelArtifact = null;
    ws.modelHistory = [];
    ws.automationStatus = null;
    ws.batchScores = [];
    ws.stagedImport = null;
    recomputeWorkspaceStorageBytes(ws);

    await Promise.all([
      saveDemoWorkspace(ws),
      appendDemoAuditLog({
        companyId: company.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        actorRole: auth.user.role,
        action: 'DEMO_DATASET_CLEARED',
        resource: 'dataset',
        details: 'Cleared all imported datasets, models, and predictions in local demo workspace',
      }),
    ]);

    return jsonResponse({
      company,
      dataset: null,
      uploadedDatasets: [],
      analytics: null,
      activeModel: null,
      modelHistory: [],
      batchScores: [],
      automationStatus: null,
      usage: buildUsageSummary(company, ws),
      message: 'Imported dataset and derived predictions cleared. Ready for a new upload.',
    });
  }

  if (method === 'POST' && pathname === '/api/demo/reset-workspace') {
    const company = getDemoCompany(auth.company.id) || auth.company;
    const resetCompany: CompanyWorkspaceInfo = {
      ...company,
      churnDefinition: {
        ...buildDefaultChurnDefinition(company.industry),
        confirmedByUser: company.id === DEFAULT_DEMO_COMPANY_ID,
        confirmedAt: company.id === DEFAULT_DEMO_COMPANY_ID ? new Date().toISOString() : null,
      },
      satisfactionScale: '1-5',
      privacySettings: buildDefaultPrivacySettings(),
    };
    const ws = createEmptyWorkspaceRecord(company.id);
    await clearCompanyAuditLogs(company.id);

    // If this is the built-in default Horizon Demo account, restore its fresh 250-row sample dataset;
    // for custom user-registered demo accounts, reset back to a clean blank workspace.
    if (company.id === DEFAULT_DEMO_COMPANY_ID) {
      loadSampleIntoWorkspaceInMemory(resetCompany, ws);
    }
    recomputeWorkspaceStorageBytes(ws);

    await Promise.all([
      saveDemoCompany(resetCompany),
      saveDemoWorkspace(ws),
      appendDemoAuditLog({
        companyId: resetCompany.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        actorRole: auth.user.role,
        action: 'DEMO_WORKSPACE_RESET',
        resource: 'workspace',
        details:
          company.id === DEFAULT_DEMO_COMPANY_ID
            ? 'Reset default demo workspace to clean initial sample state'
            : 'Reset custom demo workspace (cleared custom data, models, and settings defaults)',
      }),
    ]);

    return jsonResponse({
      company: resetCompany,
      dataset: ws.activeDataset ? ws.activeDataset.state : null,
      uploadedDatasets: listDemoUploadedDatasetSummaries(ws),
      analytics: ws.activeAnalytics,
      activeModel: serializeActiveModelEvaluation(ws),
      modelHistory: ws.modelHistory,
      batchScores: ws.batchScores,
      automationStatus: ws.automationStatus,
      usage: buildUsageSummary(resetCompany, ws),
      message:
        company.id === DEFAULT_DEMO_COMPANY_ID
          ? 'Demo workspace restored to initial sample state.'
          : 'Demo workspace reset cleanly.',
    });
  }

  if (method === 'GET' && pathname === '/api/demo/export-workspace') {
    const exported = buildWorkspaceBackupJson(auth.company.id);
    return fileResponse(exported.json, 'application/json; charset=utf-8', exported.fileName);
  }

  // ---------------------------------------------------------------------------
  // Company Settings, Churn Definition, Usage & Team Management
  // ---------------------------------------------------------------------------
  if (method === 'PUT' && pathname === '/api/company') {
    const adminErr = checkAdminError(auth);
    if (adminErr) return adminErr;

    const current = getDemoCompany(auth.company.id) || auth.company;
    const nextIndustry: IndustryKey =
      body.industry && INDUSTRY_PROFILES[body.industry as IndustryKey]
        ? (body.industry as IndustryKey)
        : current.industry;

    const updatedCompany: CompanyWorkspaceInfo = {
      ...current,
      ...(typeof body.name === 'string' && body.name.trim().length >= 2
        ? { name: body.name.trim() }
        : {}),
      ...(typeof body.email === 'string' && isValidEmail(body.email)
        ? { email: body.email.trim().toLowerCase() }
        : {}),
      ...(body.registrationNumber !== undefined
        ? {
            registrationNumber:
              typeof body.registrationNumber === 'string' && body.registrationNumber.trim()
                ? body.registrationNumber.trim()
                : null,
          }
        : {}),
      ...(body.logoDataUrl !== undefined ? { logoDataUrl: body.logoDataUrl } : {}),
      industry: nextIndustry,
      customIndustryName:
        nextIndustry === 'other'
          ? (typeof body.customIndustryName === 'string'
              ? body.customIndustryName.trim()
              : current.customIndustryName) || null
          : null,
      ...(typeof body.country === 'string' && body.country.trim()
        ? { country: body.country.trim() }
        : {}),
      ...(body.businessType ? { businessType: body.businessType } : {}),
      ...(body.businessModel ? { businessModel: body.businessModel } : {}),
      ...(body.customerRelationshipType
        ? { customerRelationshipType: body.customerRelationshipType }
        : {}),
      ...(body.subscriptionPlan ? { subscriptionPlan: body.subscriptionPlan } : {}),
      ...(body.churnDefinition ? { churnDefinition: body.churnDefinition } : {}),
    };

    await saveDemoCompany(updatedCompany);
    const ws = getDemoWorkspace(updatedCompany.id);

    if ((body.churnDefinition || body.industry) && ws.activeDataset) {
      const labelReadiness = evaluateChurnReadiness(
        ws.activeDataset.state.columns,
        ws.activeDataset.rows,
        ws.activeDataset.state.mapping,
        updatedCompany.churnDefinition
      );
      const readiness = assessDataReadiness({
        columns: ws.activeDataset.state.columns,
        rows: ws.activeDataset.rows,
        mapping: ws.activeDataset.state.mapping,
        churnDefinition: updatedCompany.churnDefinition,
        industry: updatedCompany.industry,
      });
      ws.activeDataset.state = {
        ...ws.activeDataset.state,
        churnDefinition: updatedCompany.churnDefinition,
        hasValidChurnLabels: labelReadiness.hasValidChurnLabels,
        churnReadinessMessage: labelReadiness.churnReadinessMessage,
        readiness,
      };
      ws.activeAnalytics =
        buildWorkspaceAnalytics(updatedCompany, ws) ||
        computeAnalytics(
          ws.activeDataset.state.columns,
          ws.activeDataset.rows,
          ws.activeDataset.state.mapping,
          {},
          updatedCompany.churnDefinition
        );
      runAutomatedPredictionSetupInMemory(updatedCompany, ws, {
        allowModelExecution:
          auth.user.role !== 'ANALYST' || auth.user.permissions.canGeneratePredictions,
      });
      await saveDemoWorkspace(ws);
    }

    await appendDemoAuditLog({
      companyId: updatedCompany.id,
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      actorRole: auth.user.role,
      action: 'COMPANY_SETTINGS_UPDATED',
      resource: 'company',
      details: `Updated workspace profile (${updatedCompany.industry}, ${updatedCompany.subscriptionPlan} plan)`,
    });

    return jsonResponse({
      company: updatedCompany,
      dataset: ws.activeDataset?.state || null,
      analytics: ws.activeAnalytics,
      activeModel: serializeActiveModelEvaluation(ws),
      modelHistory: ws.modelHistory,
      automationStatus: ws.automationStatus,
      usage: buildUsageSummary(updatedCompany, ws),
    });
  }

  if (method === 'PUT' && pathname === '/api/company/churn-definition') {
    const permErr = checkPermissionError(auth, 'canUploadAndAnalyse');
    if (permErr) return permErr;

    const current = getDemoCompany(auth.company.id) || auth.company;
    const incoming = body as ChurnDefinition;
    const updatedCompany: CompanyWorkspaceInfo = {
      ...current,
      churnDefinition: {
        ...current.churnDefinition,
        ...incoming,
        confirmedByUser: Boolean(incoming.confirmedByUser),
        confirmedAt: incoming.confirmedByUser
          ? incoming.confirmedAt || new Date().toISOString()
          : null,
      },
    };
    await saveDemoCompany(updatedCompany);

    const ws = getDemoWorkspace(updatedCompany.id);
    if (ws.activeDataset) {
      const labelReadiness = evaluateChurnReadiness(
        ws.activeDataset.state.columns,
        ws.activeDataset.rows,
        ws.activeDataset.state.mapping,
        updatedCompany.churnDefinition
      );
      const readiness = assessDataReadiness({
        columns: ws.activeDataset.state.columns,
        rows: ws.activeDataset.rows,
        mapping: ws.activeDataset.state.mapping,
        churnDefinition: updatedCompany.churnDefinition,
        industry: updatedCompany.industry,
      });
      ws.activeDataset.state = {
        ...ws.activeDataset.state,
        churnDefinition: updatedCompany.churnDefinition,
        hasValidChurnLabels: labelReadiness.hasValidChurnLabels,
        churnReadinessMessage: labelReadiness.churnReadinessMessage,
        readiness,
      };
      ws.activeAnalytics =
        buildWorkspaceAnalytics(updatedCompany, ws) ||
        computeAnalytics(
          ws.activeDataset.state.columns,
          ws.activeDataset.rows,
          ws.activeDataset.state.mapping,
          {},
          updatedCompany.churnDefinition
        );
      runAutomatedPredictionSetupInMemory(updatedCompany, ws, {
        allowModelExecution:
          auth.user.role !== 'ANALYST' || auth.user.permissions.canGeneratePredictions,
      });
      await saveDemoWorkspace(ws);
    }

    await appendDemoAuditLog({
      companyId: updatedCompany.id,
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      actorRole: auth.user.role,
      action: 'CHURN_DEFINITION_UPDATED',
      resource: 'churn_definition',
      details: `Configured ${updatedCompany.churnDefinition.triggerType} (${updatedCompany.churnDefinition.reportingPeriod})`,
    });

    return jsonResponse({
      company: updatedCompany,
      dataset: ws.activeDataset ? ws.activeDataset.state : null,
      analytics: ws.activeAnalytics,
      activeModel: serializeActiveModelEvaluation(ws),
      modelHistory: ws.modelHistory,
      automationStatus: ws.automationStatus,
      usage: buildUsageSummary(updatedCompany, ws),
    });
  }

  if (method === 'PUT' && pathname === '/api/company/privacy') {
    const adminErr = checkAdminError(auth);
    if (adminErr) return adminErr;

    const current = getDemoCompany(auth.company.id) || auth.company;
    const priv = body as Partial<DataPrivacySettings>;
    const updatedCompany: CompanyWorkspaceInfo = {
      ...current,
      privacySettings: {
        ...(current.privacySettings || buildDefaultPrivacySettings()),
        ...(priv.allowSharedModelContribution !== undefined
          ? { allowSharedModelContribution: Boolean(priv.allowSharedModelContribution) }
          : {}),
        ...(priv.optInCrossCompanyBaseline !== undefined
          ? { optInCrossCompanyBaseline: Boolean(priv.optInCrossCompanyBaseline) }
          : {}),
      },
    };
    await Promise.all([
      saveDemoCompany(updatedCompany),
      appendDemoAuditLog({
        companyId: updatedCompany.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        actorRole: auth.user.role,
        action: 'DATA_PRIVACY_SETTINGS_UPDATED',
        resource: 'privacy',
        details: 'Updated workspace privacy consent preferences',
      }),
    ]);
    return jsonResponse({ company: updatedCompany });
  }

  if (method === 'PUT' && pathname === '/api/company/satisfaction-scale') {
    const permErr = checkPermissionError(auth, 'canUploadAndAnalyse');
    if (permErr) return permErr;

    const satisfactionScale = body.satisfactionScale as SatisfactionScale;
    if (
      satisfactionScale !== '1-5' &&
      satisfactionScale !== '1-10' &&
      satisfactionScale !== '0-100' &&
      satisfactionScale !== 'nps'
    ) {
      return jsonResponse(
        { error: 'Invalid satisfaction scale. Choose 1-5, 1-10, 0-100, or nps.' },
        400
      );
    }

    const current = getDemoCompany(auth.company.id) || auth.company;
    const updatedCompany: CompanyWorkspaceInfo = { ...current, satisfactionScale };
    const ws = getDemoWorkspace(current.id);
    ws.satisfactionScale = satisfactionScale;
    if (ws.activeDataset) {
      ws.activeDataset.state.satisfactionScale = satisfactionScale;
    }
    await Promise.all([saveDemoCompany(updatedCompany), saveDemoWorkspace(ws)]);
    return jsonResponse({ company: updatedCompany, satisfactionScale });
  }

  if (method === 'GET' && pathname === '/api/workspace/usage') {
    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    return jsonResponse({
      usage: buildUsageSummary(company, ws),
      plans: SUBSCRIPTION_PLAN_LIST,
    });
  }

  if (method === 'GET' && pathname === '/api/audit-logs') {
    const adminErr = checkAdminError(auth);
    if (adminErr) return adminErr;
    const plan = getSubscriptionPlanSpec(auth.company.subscriptionPlan);
    if (!plan.allowAuditLogs && auth.user.role !== 'PLATFORM_OWNER') {
      return jsonResponse(
        {
          error: `Workspace audit logs require Professional or Enterprise tier (current plan: ${plan.name}).`,
        },
        403
      );
    }
    return jsonResponse({ auditLogs: listDemoAuditLogsForCompany(auth.company.id, 100) });
  }

  if (method === 'GET' && pathname === '/api/users') {
    const adminErr = checkAdminError(auth);
    if (adminErr) return adminErr;
    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    const users = listDemoUsersForCompany(company.id).map(toPublicUserAccount);
    return jsonResponse({ users, usage: buildUsageSummary(company, ws) });
  }

  if (method === 'POST' && pathname === '/api/users') {
    const adminErr = checkAdminError(auth);
    if (adminErr) return adminErr;

    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const role: UserRole = body.role === 'FIRM_ADMIN' ? 'FIRM_ADMIN' : 'ANALYST';

    if (fullName.length < 2) {
      return jsonResponse({ error: 'Full name must be at least 2 characters long.' }, 400);
    }
    if (!isValidEmail(email)) {
      return jsonResponse({ error: 'Please provide a valid email address.' }, 400);
    }
    if (password.length < 8) {
      return jsonResponse({ error: 'Password must be at least 8 characters long.' }, 400);
    }
    if (findDemoUserByEmail(email)) {
      return jsonResponse({ error: 'A user with this email already exists.' }, 400);
    }

    const plan = getSubscriptionPlanSpec(auth.company.subscriptionPlan);
    const existingCount = listDemoUsersForCompany(auth.company.id).length;
    if (existingCount >= plan.maxUsers) {
      return jsonResponse(
        { error: `Team seat limit (${plan.maxUsers}) reached for your current plan.` },
        400
      );
    }

    const salt = generateSaltHex();
    const pwHash = await hashPasswordWithSalt(password, salt);
    const newUser: DemoUserRecord = {
      id: generateId('usr'),
      companyId: auth.company.id,
      fullName,
      email,
      passwordSalt: salt,
      passwordHash: pwHash,
      role,
      isActive: true,
      avatarDataUrl: null,
      permissions:
        role === 'FIRM_ADMIN'
          ? { canUploadAndAnalyse: true, canGeneratePredictions: true }
          : {
              canUploadAndAnalyse: Boolean(body.permissions?.canUploadAndAnalyse),
              canGeneratePredictions: Boolean(body.permissions?.canGeneratePredictions),
            },
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };

    await Promise.all([
      saveDemoUser(newUser),
      appendDemoAuditLog({
        companyId: auth.company.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        actorRole: auth.user.role,
        action: 'USER_CREATED',
        resource: 'user',
        details: `Created ${newUser.role} demo account for ${newUser.email}`,
      }),
    ]);
    return jsonResponse({ user: toPublicUserAccount(newUser) }, 201);
  }

  if (method === 'PATCH' && pathname.startsWith('/api/users/')) {
    const adminErr = checkAdminError(auth);
    if (adminErr) return adminErr;

    const targetId = decodeURIComponent(pathname.slice('/api/users/'.length));
    const target = getDemoUserById(targetId);
    if (!target || target.companyId !== auth.company.id) {
      return jsonResponse({ error: 'User not found in this company workspace.' }, 404);
    }

    if (body.role === 'FIRM_ADMIN' || body.role === 'ANALYST') {
      if (target.id === auth.user.id && body.role !== 'FIRM_ADMIN') {
        return jsonResponse({ error: 'You cannot demote your own Firm Admin role.' }, 400);
      }
      target.role = body.role;
      if (body.role === 'FIRM_ADMIN') {
        target.permissions = { canUploadAndAnalyse: true, canGeneratePredictions: true };
      }
    }
    if (typeof body.isActive === 'boolean') {
      if (target.id === auth.user.id && !body.isActive) {
        return jsonResponse({ error: 'You cannot deactivate your own account.' }, 400);
      }
      target.isActive = body.isActive;
    }
    if (body.permissions && target.role === 'ANALYST') {
      target.permissions = {
        canUploadAndAnalyse:
          body.permissions.canUploadAndAnalyse ?? target.permissions.canUploadAndAnalyse,
        canGeneratePredictions:
          body.permissions.canGeneratePredictions ?? target.permissions.canGeneratePredictions,
      };
    }
    if (typeof body.newPassword === 'string' && body.newPassword) {
      if (body.newPassword.length < 8) {
        return jsonResponse({ error: 'Password must be at least 8 characters long.' }, 400);
      }
      const nextSalt = generateSaltHex();
      target.passwordSalt = nextSalt;
      target.passwordHash = await hashPasswordWithSalt(body.newPassword, nextSalt);
    }

    await Promise.all([
      saveDemoUser(target),
      appendDemoAuditLog({
        companyId: auth.company.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        actorRole: auth.user.role,
        action: 'USER_UPDATED',
        resource: 'user',
        details: `Updated account ${target.email}`,
      }),
    ]);

    return jsonResponse({ user: toPublicUserAccount(target) });
  }

  // ---------------------------------------------------------------------------
  // Workspace State, Sample, Templates & Readiness
  // ---------------------------------------------------------------------------
  if (method === 'GET' && pathname === '/api/state') {
    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    const plan = getSubscriptionPlanSpec(company.subscriptionPlan);
    const canSeeLogs =
      (auth.user.role === 'FIRM_ADMIN' || auth.user.role === 'PLATFORM_OWNER') &&
      (plan.allowAuditLogs || auth.user.role === 'PLATFORM_OWNER');

    if (
      ws.activeDataset &&
      (!ws.activeAnalytics ||
        !ws.activeAnalytics.historicalPerformance ||
        (ws.activeModelArtifact && !ws.activeAnalytics.activeRiskSummary))
    ) {
      ws.activeAnalytics = buildWorkspaceAnalytics(company, ws) || ws.activeAnalytics;
      await saveDemoWorkspace(ws);
    }

    return jsonResponse({
      company,
      dataset: ws.activeDataset ? ws.activeDataset.state : null,
      uploadedDatasets: listDemoUploadedDatasetSummaries(ws),
      analytics: ws.activeAnalytics,
      activeModel: serializeActiveModelEvaluation(ws),
      modelHistory: ws.modelHistory,
      batchScores: ws.batchScores || [],
      automationStatus: ws.automationStatus || null,
      usage: buildUsageSummary(company, ws),
      auditLogs: canSeeLogs ? listDemoAuditLogsForCompany(company.id, 50) : [],
    });
  }

  if (method === 'POST' && pathname === '/api/dataset/load-sample') {
    const permErr = checkPermissionError(auth, 'canUploadAndAnalyse');
    if (permErr) return permErr;

    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    const loaded = loadSampleIntoWorkspaceInMemory(company, ws);

    await Promise.all([
      saveDemoWorkspace(ws),
      appendDemoAuditLog({
        companyId: company.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        actorRole: auth.user.role,
        action: 'SAMPLE_DATASET_LOADED',
        resource: 'dataset',
        details: `Loaded demo sample dataset ${loaded.dataset.fileName} (${loaded.dataset.rowCount} rows)`,
      }),
    ]);

    return jsonResponse({
      dataset: loaded.dataset,
      analytics: loaded.analytics,
      uploadedDatasets: listDemoUploadedDatasetSummaries(ws),
      usage: buildUsageSummary(company, ws),
      activeModel: serializeActiveModelEvaluation(ws),
      modelHistory: ws.modelHistory,
      automationStatus: loaded.automationStatus,
    });
  }

  if (method === 'GET' && pathname === '/api/dataset/sample-csv') {
    const sample = generateSampleIndustryCsv(auth.company.industry, 250);
    return fileResponse(sample.csvText, 'text/csv; charset=utf-8', sample.fileName);
  }

  if (method === 'GET' && pathname === '/api/dataset/template') {
    try {
      const company = getDemoCompany(auth.company.id) || auth.company;
      const requestedIndustry = (parsedUrl.searchParams.get('industry') || company.industry) as IndustryKey;
      const industry: IndustryKey = INDUSTRY_PROFILES[requestedIndustry]
        ? requestedIndustry
        : company.industry;
      const format: TemplateFormat =
        (parsedUrl.searchParams.get('format') || 'csv').toLowerCase() === 'xlsx' ? 'xlsx' : 'csv';
      const rawMode = (parsedUrl.searchParams.get('mode') || 'established_historical').toLowerCase();
      const rawScope = (parsedUrl.searchParams.get('scope') || '').toLowerCase();
      const scope: 'comprehensive' | 'tickets' | 'pathway' =
        rawScope === 'tickets' || rawMode === 'tickets'
          ? 'tickets'
          : rawScope === 'pathway'
            ? 'pathway'
            : 'comprehensive';

      if (rawMode === 'prediction_input') {
        const ws = getDemoWorkspace(company.id);
        if (!ws.activeModelArtifact) {
          return jsonResponse(
            {
              error:
                'A validated prediction model is required before downloading the Current Customer Prediction Template.',
            },
            400
          );
        }
        const exported = generatePredictionInputTemplateExport({
          industry: company.industry,
          format,
          artifact: ws.activeModelArtifact,
          customIndustryName: company.customIndustryName,
        });
        return fileResponse(exported.body, exported.contentType, exported.fileName);
      }

      const mode: LegacyCompatibleTemplateMode = normalizeTemplateMode(rawMode);
      const exported = generateIndustryTemplateExport({
        industry,
        format,
        mode,
        scope,
        customIndustryName: company.customIndustryName,
      });
      return fileResponse(exported.body, exported.contentType, exported.fileName);
    } catch (err: unknown) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to generate template.' },
        400
      );
    }
  }

  if (method === 'GET' && pathname === '/api/dataset/prediction-template') {
    try {
      const company = getDemoCompany(auth.company.id) || auth.company;
      const ws = getDemoWorkspace(company.id);
      const wantMeta = parsedUrl.searchParams.get('meta') === '1';

      if (wantMeta) {
        if (!ws.activeModelArtifact) {
          return jsonResponse({
            available: false,
            modelVersion: null,
            modelName: null,
            columns: [],
            reason:
              'No validated prediction model is active in this workspace yet. Upload historical data with churn outcomes or record enough outcomes to unlock prediction templates.',
          });
        }
        const preview = generatePredictionInputTemplateExport({
          industry: company.industry,
          format: 'csv',
          artifact: ws.activeModelArtifact,
          customIndustryName: company.customIndustryName,
        });
        return jsonResponse({
          available: true,
          modelVersion: ws.activeModelArtifact.evaluation.version,
          modelName: ws.activeModelArtifact.evaluation.modelName,
          columns: preview.columns,
          reason: null,
        });
      }

      if (!ws.activeModelArtifact) {
        return jsonResponse(
          {
            error:
              'No validated prediction model is active yet. Upload historical data with confirmed churn outcomes first.',
          },
          400
        );
      }
      const format: TemplateFormat =
        (parsedUrl.searchParams.get('format') || 'csv').toLowerCase() === 'xlsx' ? 'xlsx' : 'csv';
      const exported = generatePredictionInputTemplateExport({
        industry: company.industry,
        format,
        artifact: ws.activeModelArtifact,
        customIndustryName: company.customIndustryName,
      });
      return fileResponse(exported.body, exported.contentType, exported.fileName);
    } catch (err: unknown) {
      return jsonResponse(
        {
          error:
            err instanceof Error ? err.message : 'Failed to build prediction template.',
        },
        400
      );
    }
  }

  if (method === 'GET' && pathname === '/api/dataset/readiness') {
    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    const modeParam = normalizeTemplateMode(
      parsedUrl.searchParams.get('mode') || 'established_historical'
    );
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
    return jsonResponse({
      readiness,
      templateColumns,
      privacySettings: company.privacySettings,
    });
  }

  // ---------------------------------------------------------------------------
  // Dataset Staging, Rejected Rows CSV, Commit, Direct Upload, Dataset Management
  // ---------------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/dataset/stage') {
    const permErr = checkPermissionError(auth, 'canUploadAndAnalyse');
    if (permErr) return permErr;

    try {
      const company = getDemoCompany(auth.company.id) || auth.company;
      const ws = getDemoWorkspace(company.id);
      const {
        fileName,
        csvText,
        fileBase64,
        uploadPathway: rawPathway,
        uploadMode: rawUploadMode,
        satisfactionScale: rawScale,
      } = body as {
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
        ? utf8ByteLength(csvText)
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
                message: 'Upload customer master records first so Ticket_Data can link to Customer_IDs.',
              },
            ]
          : [];

        if (
          ticketAggregation.unmatchedTicketRowsCount &&
          ticketAggregation.unmatchedTicketRowsCount > 0 &&
          ws.activeDataset
        ) {
          ticketIssues.push({
            severity: 'warning' as const,
            message: `${ticketAggregation.unmatchedTicketRowsCount} ticket row(s) reference a Customer_ID not found in the active Customer_Data table.`,
          });
        }

        const ticketIssuesSummary: { label: string; count: number; severity: 'warning' | 'error' }[] =
          [];
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
          churnReadinessMessage: ticketAggregation.note,
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

        ws.stagedImport = {
          meta,
          rows,
          ticketRows: parsed.ticketSheetRows,
          rawByteSize,
        };
        await saveDemoWorkspace(ws);
        return jsonResponse({ stagedImport: meta });
      }

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

      ws.stagedImport = {
        meta,
        rows,
        validRowsOnly,
        ticketRows: parsed.ticketSheetRows,
        rejectedRowsCsv,
        rawByteSize,
      };
      await Promise.all([
        saveDemoWorkspace(ws),
        appendDemoAuditLog({
          companyId: company.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          actorRole: auth.user.role,
          action: 'DATASET_STAGED',
          resource: 'dataset',
          details: `Staged ${safeName} (${rows.length} rows)`,
        }),
      ]);

      return jsonResponse({ stagedImport: meta });
    } catch (err: unknown) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to parse spreadsheet file.' },
        400
      );
    }
  }

  if (method === 'GET' && pathname === '/api/dataset/staged-rejected-csv') {
    const ws = getDemoWorkspace(auth.company.id);
    if (!ws.stagedImport?.rejectedRowsCsv) {
      return jsonResponse(
        { error: 'No rejected rows report is available for the current staged upload.' },
        404
      );
    }
    return fileResponse(
      ws.stagedImport.rejectedRowsCsv,
      'text/csv; charset=utf-8',
      `rejected_rows_${ws.stagedImport.meta.stagedId}.csv`
    );
  }

  if (method === 'POST' && pathname === '/api/dataset/commit') {
    const permErr = checkPermissionError(auth, 'canUploadAndAnalyse');
    if (permErr) return permErr;

    try {
      let company = getDemoCompany(auth.company.id) || auth.company;
      const ws = getDemoWorkspace(company.id);

      const {
        stagedId,
        mapping,
        churnDefinition,
        importMode,
        satisfactionScale,
        duplicateStrategy,
      } = body as {
        stagedId?: string;
        mapping?: Partial<ColumnMapping>;
        churnDefinition?: ChurnDefinition;
        importMode?: 'valid_only' | 'all';
        satisfactionScale?: SatisfactionScale;
        duplicateStrategy?: DuplicateIdHandlingMode;
      };

      if (!ws.stagedImport || ws.stagedImport.meta.stagedId !== stagedId) {
        return jsonResponse(
          { error: 'Staged dataset session has expired or was not found. Please re-upload your file.' },
          400
        );
      }

      const staged = ws.stagedImport;

      if (staged.meta.uploadMode === 'tickets') {
        if (!ws.activeDataset) {
          return jsonResponse(
            {
              error:
                'No active customer dataset exists in this workspace. Upload your customer spreadsheet first before linking ticket records.',
            },
            400
          );
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

        ws.uploadedDatasets.unshift({
          datasetId: `ds_tkt_${Date.now()}`,
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

        await Promise.all([
          saveDemoWorkspace(ws),
          appendDemoAuditLog({
            companyId: company.id,
            actorId: auth.user.id,
            actorEmail: auth.user.email,
            actorRole: auth.user.role,
            action: 'TICKETS_LINKED',
            resource: 'dataset',
            details: merged.summary.note,
          }),
        ]);

        return jsonResponse({
          company,
          dataset: ws.activeDataset.state,
          uploadedDatasets: listDemoUploadedDatasetSummaries(ws),
          analytics: ws.activeAnalytics,
          ticketAggregation: merged.summary,
          usage: buildUsageSummary(company, ws),
          activeModel: serializeActiveModelEvaluation(ws),
          modelHistory: ws.modelHistory,
          automationStatus: ws.automationStatus,
        });
      }

      const effectiveScale =
        satisfactionScale || staged.meta.satisfactionScale || ws.satisfactionScale || '1-5';
      ws.satisfactionScale = effectiveScale;
      if (company.satisfactionScale !== effectiveScale) {
        company = { ...company, satisfactionScale: effectiveScale };
        await saveDemoCompany(company);
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
        dateColumn: mapping?.dateColumn !== undefined ? mapping.dateColumn : baseMapping.dateColumn,
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
        company = { ...company, churnDefinition: confirmedChurnDef };
        await saveDemoCompany(company);
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

      const result = commitRowsIntoWorkspaceInMemory(company, ws, {
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
        : runAutomatedPredictionSetupInMemory(company, ws, {
            allowModelExecution:
              auth.user.role !== 'ANALYST' || auth.user.permissions.canGeneratePredictions,
          });

      await Promise.all([
        saveDemoWorkspace(ws),
        appendDemoAuditLog({
          companyId: company.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          actorRole: auth.user.role,
          action: 'DATASET_COMMITTED',
          resource: 'dataset',
          details: `Committed ${staged.meta.fileName} (${rowsToCommit.length} rows)`,
        }),
      ]);

      return jsonResponse({
        company,
        ...result,
        uploadedDatasets: listDemoUploadedDatasetSummaries(ws),
        batchResult,
        batchScores: ws.batchScores || [],
        usage: buildUsageSummary(company, ws),
        activeModel: serializeActiveModelEvaluation(ws),
        modelHistory: ws.modelHistory,
        automationStatus,
      });
    } catch (err: unknown) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to commit dataset.' },
        400
      );
    }
  }

  if (method === 'POST' && pathname === '/api/dataset/upload') {
    const permErr = checkPermissionError(auth, 'canUploadAndAnalyse');
    if (permErr) return permErr;

    try {
      const company = getDemoCompany(auth.company.id) || auth.company;
      const ws = getDemoWorkspace(company.id);
      const { fileName, csvText, fileBase64 } = body as {
        fileName?: string;
        csvText?: string;
        fileBase64?: string;
      };
      const safeName = (fileName || 'uploaded_customers.csv').trim();
      const rawByteSize = csvText
        ? utf8ByteLength(csvText)
        : fileBase64
          ? Math.ceil((fileBase64.length * 3) / 4)
          : 0;

      const { headers, rows, sourceFormat } = parseSpreadsheetUpload({
        fileName: safeName,
        csvText,
        fileBase64,
      });
      enforceDatasetPlanQuota(company, rows.length, rawByteSize);

      const result = commitRowsIntoWorkspaceInMemory(company, ws, {
        fileName: safeName,
        sourceFormat,
        headers,
        rows,
        duplicateStrategy: 'replace',
      });

      const automationStatus = runAutomatedPredictionSetupInMemory(company, ws, {
        allowModelExecution:
          auth.user.role !== 'ANALYST' || auth.user.permissions.canGeneratePredictions,
      });

      await Promise.all([
        saveDemoWorkspace(ws),
        appendDemoAuditLog({
          companyId: company.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          actorRole: auth.user.role,
          action: 'DATASET_UPLOADED',
          resource: 'dataset',
          details: `Uploaded ${safeName} (${rows.length} rows)`,
        }),
      ]);

      return jsonResponse({
        ...result,
        uploadedDatasets: listDemoUploadedDatasetSummaries(ws),
        usage: buildUsageSummary(company, ws),
        activeModel: serializeActiveModelEvaluation(ws),
        modelHistory: ws.modelHistory,
        automationStatus,
      });
    } catch (err: unknown) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to parse file.' },
        400
      );
    }
  }

  if (method === 'GET' && pathname === '/api/datasets') {
    const ws = getDemoWorkspace(auth.company.id);
    return jsonResponse({
      uploadedDatasets: listDemoUploadedDatasetSummaries(ws),
      activeDatasetId: ws.activeDataset?.state.datasetId || null,
    });
  }

  if (method === 'POST' && /^\/api\/datasets\/[^/]+\/activate$/.test(pathname)) {
    const permErr = checkPermissionError(auth, 'canUploadAndAnalyse');
    if (permErr) return permErr;

    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    const datasetId = decodeURIComponent(
      pathname.slice('/api/datasets/'.length, -'/activate'.length)
    );
    const entry = ws.uploadedDatasets.find((d) => d.datasetId === datasetId);
    if (!entry) {
      return jsonResponse({ error: 'Dataset was not found in this company workspace.' }, 404);
    }
    if (entry.uploadMode === 'tickets' || entry.dataset.rows.length === 0) {
      return jsonResponse(
        { error: 'Standalone ticket files cannot be activated as the primary customer table.' },
        400
      );
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

    const automationStatus = runAutomatedPredictionSetupInMemory(company, ws, {
      allowModelExecution:
        auth.user.role !== 'ANALYST' || auth.user.permissions.canGeneratePredictions,
    });

    await Promise.all([
      saveDemoWorkspace(ws),
      appendDemoAuditLog({
        companyId: company.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        actorRole: auth.user.role,
        action: 'DATASET_ACTIVATED',
        resource: 'dataset',
        details: `Activated dataset ${entry.fileName}`,
      }),
    ]);

    return jsonResponse({
      company,
      dataset: ws.activeDataset.state,
      uploadedDatasets: listDemoUploadedDatasetSummaries(ws),
      analytics: ws.activeAnalytics,
      activeModel: serializeActiveModelEvaluation(ws),
      modelHistory: ws.modelHistory,
      batchScores: ws.batchScores,
      automationStatus,
      usage: buildUsageSummary(company, ws),
    });
  }

  if (method === 'DELETE' && pathname.startsWith('/api/datasets/')) {
    const permErr = checkPermissionError(auth, 'canUploadAndAnalyse');
    if (permErr) return permErr;

    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    const datasetId = decodeURIComponent(pathname.slice('/api/datasets/'.length));
    const target = ws.uploadedDatasets.find((d) => d.datasetId === datasetId);
    if (!target) {
      return jsonResponse({ error: 'Dataset was not found in this company workspace.' }, 404);
    }

    const wasActiveDatasetId = ws.activeDataset?.state.datasetId === datasetId;
    ws.uploadedDatasets = ws.uploadedDatasets.filter((d) => d.datasetId !== datasetId);
    let activeRowsChanged = false;

    if (ws.activeDataset) {
      if (target.uploadMode === 'tickets') {
        ws.ticketAggregation = null;
        ws.activeDataset.state.ticketAggregation = null;
      } else {
        const survivingRows: Record<string, string>[] = [];
        const survivingLineage: string[][] = [];

        ws.activeDataset.rows.forEach((row, idx) => {
          const owners = (
            ws.rowDatasetLineage[idx] || [ws.activeDataset!.state.datasetId]
          ).filter((id) => id !== datasetId);
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
            computeAnalytics(columns, survivingRows, mapping, {}, company.churnDefinition);
        }
      }
    }

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
      ws.batchScores = (ws.batchScores || []).filter((b) => !invalidatedModelIds.has(b.modelId));
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

    if (ws.activeDataset && ws.activeModelArtifact) {
      ws.activeAnalytics = buildWorkspaceAnalytics(company, ws) || ws.activeAnalytics;
    }

    await Promise.all([
      saveDemoWorkspace(ws),
      appendDemoAuditLog({
        companyId: company.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        actorRole: auth.user.role,
        action: 'DATASET_DELETED',
        resource: 'dataset',
        details: `Deleted dataset "${target.fileName}" and invalidated dependent predictions`,
      }),
    ]);

    return jsonResponse({
      deletedDatasetId: datasetId,
      deletedFileName: target.fileName,
      company,
      dataset: ws.activeDataset ? ws.activeDataset.state : null,
      uploadedDatasets: listDemoUploadedDatasetSummaries(ws),
      analytics: ws.activeAnalytics,
      activeModel: serializeActiveModelEvaluation(ws),
      modelHistory: ws.modelHistory,
      batchScores: ws.batchScores || [],
      automationStatus: ws.automationStatus,
      usage: buildUsageSummary(company, ws),
    });
  }

  // ---------------------------------------------------------------------------
  // Mapping & Record Outcome
  // ---------------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/dataset/mapping') {
    const permErr = checkPermissionError(auth, 'canUploadAndAnalyse');
    if (permErr) return permErr;

    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    if (!ws.activeDataset) {
      return jsonResponse({ error: 'No dataset is currently loaded.' }, 400);
    }

    const incoming = body as Partial<ColumnMapping>;
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
      statusColumn: incoming.statusColumn !== undefined ? incoming.statusColumn : prev.statusColumn,
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

    const automationStatus = runAutomatedPredictionSetupInMemory(company, ws, {
      allowModelExecution:
        auth.user.role !== 'ANALYST' || auth.user.permissions.canGeneratePredictions,
    });

    await Promise.all([
      saveDemoWorkspace(ws),
      appendDemoAuditLog({
        companyId: company.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        actorRole: auth.user.role,
        action: 'COLUMN_MAPPING_UPDATED',
        resource: 'dataset',
        details: `Updated column mapping (target=${updatedMapping.targetColumn})`,
      }),
    ]);

    return jsonResponse({
      dataset: ws.activeDataset.state,
      analytics: ws.activeAnalytics,
      usage: buildUsageSummary(company, ws),
      activeModel: serializeActiveModelEvaluation(ws),
      modelHistory: ws.modelHistory,
      automationStatus,
    });
  }

  if (method === 'POST' && pathname === '/api/dataset/record-outcome') {
    const permErr = checkPermissionError(auth, 'canUploadAndAnalyse');
    if (permErr) return permErr;

    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    if (!ws.activeDataset) {
      return jsonResponse({ error: 'No customer dataset is loaded in this workspace.' }, 400);
    }

    const rawUpdates = Array.isArray(body.updates)
      ? (body.updates as { customerId: string; outcome: 'Churned' | 'Retained' }[])
      : body.customerId && body.outcome
        ? [{ customerId: String(body.customerId), outcome: body.outcome as 'Churned' | 'Retained' }]
        : [];

    if (rawUpdates.length === 0) {
      return jsonResponse({ error: 'At least one customer outcome record is required.' }, 400);
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
        if (row[targetCol] === undefined) row[targetCol] = '';
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
      return jsonResponse(
        {
          error:
            'No matching customer record(s) found. Verify the Customer ID matches your active dataset.',
        },
        404
      );
    }

    ds.state.mapping = mapping;
    const { automationStatus } = refreshActiveDatasetStateInMemory(
      company,
      ws,
      auth.user.role !== 'ANALYST' || auth.user.permissions.canGeneratePredictions
    );

    await Promise.all([
      saveDemoWorkspace(ws),
      appendDemoAuditLog({
        companyId: company.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        actorRole: auth.user.role,
        action: 'CHURN_OUTCOME_RECORDED',
        resource: 'dataset',
        details: `Recorded ${updatedCount} customer outcome(s)`,
      }),
    ]);

    return jsonResponse({
      updatedCount,
      dataset: ws.activeDataset.state,
      analytics: ws.activeAnalytics,
      activeModel: serializeActiveModelEvaluation(ws),
      modelHistory: ws.modelHistory,
      automationStatus,
      usage: buildUsageSummary(company, ws),
    });
  }

  // ---------------------------------------------------------------------------
  // Customer Directory CRUD (Add / Update / Delete / Paginated Query)
  // ---------------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/dataset/customers') {
    const permErr = checkPermissionError(auth, 'canUploadAndAnalyse');
    if (permErr) return permErr;

    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    const incoming = body.customer as Record<string, string> | undefined;
    if (!incoming || typeof incoming !== 'object') {
      return jsonResponse({ error: 'Customer details are required.' }, 400);
    }

    const allowModelExecution =
      auth.user.role !== 'ANALYST' || auth.user.permissions.canGeneratePredictions;

    if (!ws.activeDataset) {
      const specs = getIndustryDataTemplateColumns(company.industry);
      const headers = Array.from(
        new Set([
          ...specs.map((s) => s.name),
          ...Object.keys(incoming)
            .map((k) => k.trim())
            .filter(Boolean),
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
      enforceDatasetPlanQuota(company, rows.length, utf8ByteLength(JSON.stringify(rows)));

      const committed = commitRowsIntoWorkspaceInMemory(company, ws, {
        fileName: 'customer_directory.csv',
        sourceFormat: 'csv',
        headers,
        rows,
        mapping,
        churnDefinition: company.churnDefinition,
        isSample: false,
      });

      const automationStatus = runAutomatedPredictionSetupInMemory(company, ws, {
        allowModelExecution,
      });

      await Promise.all([
        saveDemoWorkspace(ws),
        appendDemoAuditLog({
          companyId: company.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          actorRole: auth.user.role,
          action: 'CUSTOMER_RECORD_ADDED',
          resource: 'dataset',
          details: `Initialized customer directory with ${idCol ? normalizedRow[idCol] : '#1'}`,
        }),
      ]);

      return jsonResponse(
        {
          dataset: committed.dataset,
          uploadedDatasets: listDemoUploadedDatasetSummaries(ws),
          analytics: committed.analytics,
          activeModel: serializeActiveModelEvaluation(ws),
          modelHistory: ws.modelHistory,
          automationStatus,
          usage: buildUsageSummary(company, ws),
        },
        201
      );
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
        return jsonResponse(
          { error: `A customer with ${idCol} "${normalizedRow[idCol]}" already exists.` },
          400
        );
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

    enforceDatasetPlanQuota(company, nextRows.length, utf8ByteLength(JSON.stringify(nextRows)));
    ds.rows = nextRows;
    if (ws.rowDatasetLineage.length > 0) {
      ws.rowDatasetLineage = [[ds.state.datasetId], ...ws.rowDatasetLineage];
    }

    const { automationStatus } = refreshActiveDatasetStateInMemory(
      company,
      ws,
      allowModelExecution
    );

    await Promise.all([
      saveDemoWorkspace(ws),
      appendDemoAuditLog({
        companyId: company.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        actorRole: auth.user.role,
        action: 'CUSTOMER_RECORD_ADDED',
        resource: 'dataset',
        details: `Added customer record ${idCol ? normalizedRow[idCol] : `row #${nextRows.length}`}`,
      }),
    ]);

    return jsonResponse(
      {
        dataset: ws.activeDataset.state,
        uploadedDatasets: listDemoUploadedDatasetSummaries(ws),
        analytics: ws.activeAnalytics,
        activeModel: serializeActiveModelEvaluation(ws),
        modelHistory: ws.modelHistory,
        automationStatus,
        usage: buildUsageSummary(company, ws),
      },
      201
    );
  }

  if (method === 'PUT' && pathname.startsWith('/api/dataset/customers/')) {
    const permErr = checkPermissionError(auth, 'canUploadAndAnalyse');
    if (permErr) return permErr;

    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    if (!ws.activeDataset) {
      return jsonResponse({ error: 'No dataset loaded.' }, 400);
    }

    const rowIndex = Number(pathname.slice('/api/dataset/customers/'.length));
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= ws.activeDataset.rows.length) {
      return jsonResponse({ error: 'Customer record not found.' }, 404);
    }

    const incoming = body.customer as Record<string, string> | undefined;
    if (!incoming || typeof incoming !== 'object') {
      return jsonResponse({ error: 'Updated customer fields are required.' }, 400);
    }

    const ds = ws.activeDataset;
    const headers = ds.state.columns.map((c) => c.name);
    const updatedRow: Record<string, string> = { ...ds.rows[rowIndex] };
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
        return jsonResponse(
          { error: `Another customer already uses ${idCol} "${updatedRow[idCol]}".` },
          400
        );
      }
    }

    ds.rows[rowIndex] = updatedRow;
    const allowModelExecution =
      auth.user.role !== 'ANALYST' || auth.user.permissions.canGeneratePredictions;
    const { automationStatus } = refreshActiveDatasetStateInMemory(
      company,
      ws,
      allowModelExecution
    );

    await Promise.all([
      saveDemoWorkspace(ws),
      appendDemoAuditLog({
        companyId: company.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        actorRole: auth.user.role,
        action: 'CUSTOMER_RECORD_UPDATED',
        resource: 'dataset',
        details: `Updated customer record ${idCol ? updatedRow[idCol] : `#${rowIndex + 1}`}`,
      }),
    ]);

    return jsonResponse({
      dataset: ws.activeDataset.state,
      analytics: ws.activeAnalytics,
      activeModel: serializeActiveModelEvaluation(ws),
      modelHistory: ws.modelHistory,
      automationStatus,
      usage: buildUsageSummary(company, ws),
    });
  }

  if (method === 'DELETE' && pathname.startsWith('/api/dataset/customers/')) {
    const permErr = checkPermissionError(auth, 'canUploadAndAnalyse');
    if (permErr) return permErr;

    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    if (!ws.activeDataset) {
      return jsonResponse({ error: 'No dataset loaded.' }, 400);
    }

    const rowIndex = Number(pathname.slice('/api/dataset/customers/'.length));
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= ws.activeDataset.rows.length) {
      return jsonResponse({ error: 'Customer record not found.' }, 404);
    }

    const ds = ws.activeDataset;
    const idCol = ds.state.mapping.idColumn;
    const removedId = idCol ? ds.rows[rowIndex]?.[idCol] : `#${rowIndex + 1}`;
    ds.rows.splice(rowIndex, 1);
    if (ws.rowDatasetLineage.length > rowIndex) {
      ws.rowDatasetLineage.splice(rowIndex, 1);
    }

    if (ds.rows.length === 0) {
      const emptyId = ds.state.datasetId;
      ws.uploadedDatasets = ws.uploadedDatasets.filter((d) => d.datasetId !== emptyId);
      ws.activeDataset = null;
      ws.rowDatasetLineage = [];
      ws.activeAnalytics = null;
      ws.activeModelArtifact = null;
      ws.modelHistory = [];
      ws.automationStatus = null;

      await Promise.all([
        saveDemoWorkspace(ws),
        appendDemoAuditLog({
          companyId: company.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          actorRole: auth.user.role,
          action: 'CUSTOMER_RECORD_DELETED',
          resource: 'dataset',
          details: `Removed final customer record (${removedId}); directory is now empty`,
        }),
      ]);

      return jsonResponse({
        dataset: null,
        uploadedDatasets: listDemoUploadedDatasetSummaries(ws),
        analytics: null,
        activeModel: null,
        modelHistory: [],
        automationStatus: null,
        usage: buildUsageSummary(company, ws),
      });
    }

    const allowModelExecution =
      auth.user.role !== 'ANALYST' || auth.user.permissions.canGeneratePredictions;
    const { automationStatus } = refreshActiveDatasetStateInMemory(
      company,
      ws,
      allowModelExecution
    );

    await Promise.all([
      saveDemoWorkspace(ws),
      appendDemoAuditLog({
        companyId: company.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        actorRole: auth.user.role,
        action: 'CUSTOMER_RECORD_DELETED',
        resource: 'dataset',
        details: `Removed customer record (${removedId})`,
      }),
    ]);

    return jsonResponse({
      dataset: ws.activeDataset.state,
      uploadedDatasets: listDemoUploadedDatasetSummaries(ws),
      analytics: ws.activeAnalytics,
      activeModel: serializeActiveModelEvaluation(ws),
      modelHistory: ws.modelHistory,
      automationStatus,
      usage: buildUsageSummary(company, ws),
    });
  }

  if (method === 'GET' && pathname === '/api/dataset/rows') {
    const ws = getDemoWorkspace(auth.company.id);
    if (!ws.activeDataset) {
      return jsonResponse({ error: 'No dataset loaded.' }, 400);
    }

    const ds = ws.activeDataset;
    const mapping = ds.state.mapping;
    const page = Math.max(1, Number(parsedUrl.searchParams.get('page')) || 1);
    const limit = Math.min(100, Math.max(5, Number(parsedUrl.searchParams.get('limit')) || 20));
    const search = (parsedUrl.searchParams.get('search') || '').trim().toLowerCase();
    const statusFilter = (parsedUrl.searchParams.get('status') || 'ALL').trim().toLowerCase();
    const monthFilter = (parsedUrl.searchParams.get('month') || '').trim();

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

    return jsonResponse({
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
  }

  // ---------------------------------------------------------------------------
  // Analytics Filtering & ML Model Training / Predictions / Batch Exports
  // ---------------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/analytics/filter') {
    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    if (!ws.activeDataset) {
      return jsonResponse({ error: 'No dataset loaded.' }, 400);
    }

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

    return jsonResponse({ analytics: filtered });
  }

  if (method === 'POST' && pathname === '/api/model/train') {
    const permErr = checkPermissionError(auth, 'canGeneratePredictions');
    if (permErr) return permErr;

    try {
      const company = getDemoCompany(auth.company.id) || auth.company;
      const ws = getDemoWorkspace(company.id);
      const plan = getSubscriptionPlanSpec(company.subscriptionPlan);

      if (!ws.activeDataset) {
        return jsonResponse({ error: 'Please load or upload a customer dataset first.' }, 400);
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
        return jsonResponse(
          {
            error:
              modelReadiness.predictionReady.blockers[0] ||
              ws.activeDataset.state.churnReadinessMessage ||
              'Dataset is not yet Prediction Ready.',
          },
          400
        );
      }

      const reqBody = body as TrainModelRequest;
      const requestedModel: MLModelType =
        reqBody.modelType === 'decision_tree'
          ? 'decision_tree'
          : reqBody.modelType === 'random_forest'
            ? 'random_forest'
            : 'logistic_regression';

      if (!plan.allowedModels.includes(requestedModel)) {
        return jsonResponse(
          { error: `${requestedModel} is not included in the ${plan.name} plan.` },
          403
        );
      }

      const splitStrategy = reqBody.splitStrategy === 'chronological' ? 'chronological' : 'stratified';
      if (splitStrategy === 'chronological' && !plan.allowChronologicalSplit) {
        return jsonResponse(
          { error: `Chronological splits are not available on the ${plan.name} plan.` },
          403
        );
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
          testSplitRatio: Number(reqBody.testSplitRatio) || 0.2,
          maxDepth: reqBody.maxDepth
            ? Number(reqBody.maxDepth)
            : requestedModel === 'random_forest'
              ? 5
              : 4,
          nEstimators: reqBody.nEstimators ? Number(reqBody.nEstimators) : 25,
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

      await Promise.all([
        saveDemoWorkspace(ws),
        appendDemoAuditLog({
          companyId: company.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          actorRole: auth.user.role,
          action: 'MODEL_TRAINED',
          resource: 'model',
          details: `Trained ${ev.modelName} ${ev.version} (${ev.splitStrategy}, acc=${ev.accuracy}%)`,
        }),
      ]);

      return jsonResponse({
        analytics: ws.activeAnalytics,
        activeModel: serializeActiveModelEvaluation(ws),
        modelHistory: ws.modelHistory,
        automationStatus: ws.automationStatus,
        usage: buildUsageSummary(company, ws),
      });
    } catch (err: unknown) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Model training failed.' },
        400
      );
    }
  }

  if (method === 'POST' && pathname === '/api/model/auto-build') {
    const permErr = checkPermissionError(auth, 'canGeneratePredictions');
    if (permErr) return permErr;

    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    if (!ws.activeDataset) {
      return jsonResponse({ error: 'Please upload or load a customer dataset first.' }, 400);
    }

    const automationStatus = runAutomatedPredictionSetupInMemory(company, ws, {
      allowModelExecution: true,
    });
    await saveDemoWorkspace(ws);

    return jsonResponse({
      analytics: ws.activeAnalytics,
      activeModel: serializeActiveModelEvaluation(ws),
      modelHistory: ws.modelHistory,
      automationStatus,
      usage: buildUsageSummary(company, ws),
    });
  }

  if (method === 'POST' && pathname === '/api/model/predict-single') {
    const permErr = checkPermissionError(auth, 'canGeneratePredictions');
    if (permErr) return permErr;

    const ws = getDemoWorkspace(auth.company.id);
    if (!ws.activeModelArtifact) {
      return jsonResponse({ error: 'Please train a classification model first.' }, 400);
    }
    const normalizedAttributes: Record<string, string> = {};
    for (const [k, v] of Object.entries((body || {}) as Record<string, unknown>)) {
      normalizedAttributes[k] = v === null || v === undefined ? '' : String(v);
    }
    const result = predictSingleCustomer(ws.activeModelArtifact, normalizedAttributes);
    return jsonResponse(result);
  }

  if (method === 'POST' && pathname === '/api/model/batch-score') {
    const permErr = checkPermissionError(auth, 'canGeneratePredictions');
    if (permErr) return permErr;

    try {
      const company = getDemoCompany(auth.company.id) || auth.company;
      const ws = getDemoWorkspace(company.id);
      const plan = getSubscriptionPlanSpec(company.subscriptionPlan);
      if (!plan.allowBatchScoring) {
        return jsonResponse(
          { error: `Batch prediction scoring requires Starter plan or higher (current: ${plan.name}).` },
          403
        );
      }
      if (!ws.activeModelArtifact) {
        return jsonResponse({ error: 'Please train an active classification model first.' }, 400);
      }

      const { fileName, csvText, fileBase64 } = body as {
        fileName?: string;
        csvText?: string;
        fileBase64?: string;
      };
      const safeName = (fileName || 'batch_customers.csv').trim();
      const rawByteSize = csvText
        ? utf8ByteLength(csvText)
        : fileBase64
          ? Math.ceil((fileBase64.length * 3) / 4)
          : 0;
      const { rows } = parseSpreadsheetUpload({ fileName: safeName, csvText, fileBase64 });
      enforceDatasetPlanQuota(company, rows.length, rawByteSize);

      const batchResult = scoreBatchRecords(ws.activeModelArtifact, safeName, rows);
      ws.batchScores = [batchResult, ...(ws.batchScores || []).slice(0, 9)];
      await Promise.all([
        saveDemoWorkspace(ws),
        appendDemoAuditLog({
          companyId: company.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          actorRole: auth.user.role,
          action: 'BATCH_PREDICTION_SCORED',
          resource: 'batch_score',
          details: `Scored ${batchResult.totalRows} rows from ${safeName}`,
        }),
      ]);

      return jsonResponse({
        batchResult,
        batchScores: ws.batchScores,
        usage: buildUsageSummary(company, ws),
      });
    } catch (err: unknown) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Batch scoring failed.' },
        400
      );
    }
  }

  if (method === 'GET' && pathname.startsWith('/api/model/export-batch/')) {
    const ws = getDemoWorkspace(auth.company.id);
    const batchId = decodeURIComponent(pathname.slice('/api/model/export-batch/'.length));
    const batch = (ws.batchScores || []).find((b) => b.batchId === batchId);
    if (!batch) {
      return jsonResponse({ error: 'Batch score result not found in this workspace.' }, 404);
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

    return fileResponse(
      lines.join('\n'),
      'text/csv; charset=utf-8',
      `batch_predictions_${batch.batchId}.csv`
    );
  }

  if (method === 'GET' && pathname === '/api/model/export-predictions') {
    const ws = getDemoWorkspace(auth.company.id);
    if (!ws.activeModelArtifact) {
      return jsonResponse({ error: 'No trained model predictions available to export.' }, 400);
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

    await appendDemoAuditLog({
      companyId: auth.company.id,
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      actorRole: auth.user.role,
      action: 'PREDICTIONS_EXPORTED',
      resource: 'export',
      details: `Exported ${preds.length} predictions as CSV`,
    });

    return fileResponse(lines.join('\n'), 'text/csv; charset=utf-8', 'churn_predictions.csv');
  }

  // ---------------------------------------------------------------------------
  // Customer Value Intelligence
  // ---------------------------------------------------------------------------
  if (method === 'GET' && pathname === '/api/value-intelligence') {
    const ws = getDemoWorkspace(auth.company.id);
    const summary = computeCustomerValueIntelligence({
      dataset: ws.activeDataset,
      activeArtifact: ws.activeModelArtifact,
      batchScores: ws.batchScores,
      valueConfig: ws.valueConfig || DEFAULT_CUSTOMER_VALUE_CONFIG,
    });
    return jsonResponse({ summary });
  }

  if (method === 'PUT' && pathname === '/api/value-intelligence/config') {
    const permErr = checkPermissionError(auth, 'canUploadAndAnalyse');
    if (permErr) return permErr;

    const company = getDemoCompany(auth.company.id) || auth.company;
    const ws = getDemoWorkspace(company.id);
    const incoming = body as Partial<CustomerValueConfig>;
    const nextConfig = normalizeValueConfig({
      ...(ws.valueConfig || DEFAULT_CUSTOMER_VALUE_CONFIG),
      ...incoming,
      weights: {
        ...(ws.valueConfig?.weights || DEFAULT_CUSTOMER_VALUE_CONFIG.weights),
        ...(incoming.weights || {}),
      },
    });
    ws.valueConfig = nextConfig;
    await saveDemoWorkspace(ws);

    const summary = computeCustomerValueIntelligence({
      dataset: ws.activeDataset,
      activeArtifact: ws.activeModelArtifact,
      batchScores: ws.batchScores,
      valueConfig: nextConfig,
    });

    await appendDemoAuditLog({
      companyId: company.id,
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      actorRole: auth.user.role,
      action: 'VALUE_CONFIG_UPDATED',
      resource: 'value_intelligence',
      details: 'Updated customer value intelligence scoring configuration',
    });

    return jsonResponse({ summary, config: nextConfig });
  }

  if (method === 'GET' && pathname === '/api/value-intelligence/export-csv') {
    const ws = getDemoWorkspace(auth.company.id);
    const summary = computeCustomerValueIntelligence({
      dataset: ws.activeDataset,
      activeArtifact: ws.activeModelArtifact,
      batchScores: ws.batchScores,
      valueConfig: ws.valueConfig || DEFAULT_CUSTOMER_VALUE_CONFIG,
    });

    if (!summary.valueAssessmentAvailable || summary.customers.length === 0) {
      return jsonResponse(
        { error: summary.unavailableReason || 'No customer value assessment available.' },
        400
      );
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

    return fileResponse(
      lines.join('\n'),
      'text/csv; charset=utf-8',
      'churnsight_customer_value_intelligence.csv'
    );
  }

  // ---------------------------------------------------------------------------
  // Platform Owner Overview (In Case Demo User Inspected Platform Route)
  // ---------------------------------------------------------------------------
  if (method === 'GET' && pathname === '/api/platform/overview') {
    if (auth.user.role !== 'PLATFORM_OWNER') {
      return jsonResponse({ error: 'Platform Owner privileges required.' }, 403);
    }
    const companies = listAllDemoCompanies();
    const summaries: PlatformCompanySummary[] = companies.map((c) => {
      const users = listDemoUsersForCompany(c.id);
      const ws = getDemoWorkspace(c.id);
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
    return jsonResponse({
      companies: summaries,
      auditLogs: listAllDemoAuditLogs(150),
      plans: SUBSCRIPTION_PLAN_LIST,
      industriesConfigured: Object.keys(INDUSTRY_PROFILES).length,
      billingIntegrationConfigured: false,
    });
  }

  if (method === 'PATCH' && /^\/api\/platform\/companies\/[^/]+\/plan$/.test(pathname)) {
    if (auth.user.role !== 'PLATFORM_OWNER') {
      return jsonResponse({ error: 'Platform Owner privileges required.' }, 403);
    }
    const companyId = decodeURIComponent(
      pathname.slice('/api/platform/companies/'.length, -'/plan'.length)
    );
    const target = getDemoCompany(companyId);
    if (!target) return jsonResponse({ error: 'Company not found.' }, 404);
    const subscriptionPlan = body.subscriptionPlan as SubscriptionPlanTier | undefined;
    if (!subscriptionPlan) {
      return jsonResponse({ error: 'Subscription plan tier is required.' }, 400);
    }
    const updated: CompanyWorkspaceInfo = { ...target, subscriptionPlan };
    await saveDemoCompany(updated);
    return jsonResponse({ company: updated });
  }

  return jsonResponse({ error: `API endpoint not found: ${method} ${pathname}` }, 404);
}
