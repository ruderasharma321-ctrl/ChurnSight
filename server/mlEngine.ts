import * as XLSX from 'xlsx';
import type {
  AdditionalChartBreakdown,
  AdditionalChartKey,
  AnalyticsFilterOptions,
  AnalyticsFilters,
  AnalyticsSummary,
  BatchScoreResult,
  BatchScoredRecord,
  BehaviourMonitoringSummary,
  BehaviourWatchlistItem,
  CategoryChurnStat,
  ChurnDefinition,
  ColumnDataType,
  ColumnMapping,
  ColumnProfile,
  ColumnSemanticRole,
  ConfusionMatrix,
  CustomerPrediction,
  DataReadinessAssessment,
  DatasetState,
  FeatureImportance,
  IndustryKey,
  MLModelType,
  MappingSuggestionRationale,
  ModelEvaluationResult,
  MonthlyChargesComparison,
  NumericComparisonStat,
  OverallReadinessTier,
  ReadinessScoreFactor,
  RiskCategory,
  SplitStrategy,
  TrainModelRequest,
  ValidationIssue,
} from '../src/types/churn.ts';
import {
  formatChurnCalculationExplanation,
  getIndustryDataTemplateColumns,
  getIndustryTemplate,
} from '../src/utils/industryConfig.ts';

export interface StoredDataset {
  state: DatasetState;
  rows: Record<string, string>[];
}

interface NumericFeatureMeta {
  kind: 'numeric';
  column: string;
  median: number;
  mean: number;
  std: number;
}

interface CategoricalFeatureMeta {
  kind: 'categorical';
  column: string;
  mode: string;
  categories: string[];
}

type FeatureMeta = NumericFeatureMeta | CategoricalFeatureMeta;

interface DecisionTreeNode {
  isLeaf: boolean;
  churnProbability: number;
  featureIndex?: number;
  threshold?: number;
  left?: DecisionTreeNode;
  right?: DecisionTreeNode;
}

export interface TrainedModelArtifact {
  evaluation: ModelEvaluationResult;
  mapping: ColumnMapping;
  features: FeatureMeta[];
  encodedFeatureNames: string[];
  modelType: MLModelType;
  weights?: number[];
  bias?: number;
  tree?: DecisionTreeNode;
  forest?: DecisionTreeNode[];
}

const MISSING_TOKENS = new Set(['', 'null', 'na', 'n/a', 'nan', 'none', 'undefined', '?']);

export function isMissingValue(val: string | undefined): boolean {
  if (val === undefined || val === null) return true;
  return MISSING_TOKENS.has(val.trim().toLowerCase());
}

export function parseCsvText(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  const cleanText = csvText.replace(/^\uFEFF/, '').trim();
  if (!cleanText) {
    throw new Error('The uploaded CSV file is empty.');
  }

  const parsedRows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];
    const next = cleanText[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (ch === '\r' && next === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some((cell) => cell !== '')) {
          parsedRows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        currentRow.push(currentField.trim());
        if (currentRow.some((cell) => cell !== '')) {
          parsedRows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += ch;
      }
    }
  }

  currentRow.push(currentField.trim());
  if (currentRow.some((cell) => cell !== '')) {
    parsedRows.push(currentRow);
  }

  if (parsedRows.length < 2) {
    throw new Error('CSV must contain a header row and at least one data row.');
  }

  const rawHeaders = parsedRows[0];
  const headers = rawHeaders.map((h, idx) => (h ? h : `Column_${idx + 1}`));

  // Check for duplicate headers
  const seen = new Set<string>();
  const uniqueHeaders = headers.map((h) => {
    let candidate = h;
    let suffix = 2;
    while (seen.has(candidate)) {
      candidate = `${h}_${suffix++}`;
    }
    seen.add(candidate);
    return candidate;
  });

  const rows: Record<string, string>[] = [];
  for (let r = 1; r < parsedRows.length; r++) {
    const values = parsedRows[r];
    const rowObj: Record<string, string> = {};
    for (let c = 0; c < uniqueHeaders.length; c++) {
      rowObj[uniqueHeaders[c]] = values[c] !== undefined ? values[c] : '';
    }
    rows.push(rowObj);
  }

  return { headers: uniqueHeaders, rows };
}

export function parseSpreadsheetUpload(input: {
  fileName: string;
  csvText?: string;
  fileBase64?: string;
}): {
  headers: string[];
  rows: Record<string, string>[];
  sourceFormat: 'csv' | 'xlsx';
} {
  const lowerName = (input.fileName || '').toLowerCase();
  const isExcel = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');

  if (!isExcel && input.csvText && typeof input.csvText === 'string') {
    const { headers, rows } = parseCsvText(input.csvText);
    return { headers, rows, sourceFormat: 'csv' };
  }

  if (input.fileBase64 && typeof input.fileBase64 === 'string') {
    const cleanB64 = input.fileBase64.includes(',')
      ? input.fileBase64.split(',').pop() || ''
      : input.fileBase64;
    const buffer = Buffer.from(cleanB64, 'base64');
    if (buffer.length === 0) {
      throw new Error('The uploaded spreadsheet file is empty.');
    }

    if (!isExcel) {
      const text = buffer.toString('utf-8');
      const { headers, rows } = parseCsvText(text);
      return { headers, rows, sourceFormat: 'csv' };
    }

    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error('The Excel workbook contains no readable sheets.');
    }
    const sheet = workbook.Sheets[firstSheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });

    const nonEmptyRows = matrix.filter(
      (r) => Array.isArray(r) && r.some((cell) => String(cell ?? '').trim() !== '')
    );
    if (nonEmptyRows.length < 2) {
      throw new Error('Excel sheet must contain a header row and at least one data row.');
    }

    const rawHeaders = nonEmptyRows[0].map((h, idx) => {
      const s = String(h ?? '').trim();
      return s || `Column_${idx + 1}`;
    });
    const seen = new Set<string>();
    const uniqueHeaders = rawHeaders.map((h) => {
      let candidate = h;
      let suffix = 2;
      while (seen.has(candidate)) {
        candidate = `${h}_${suffix++}`;
      }
      seen.add(candidate);
      return candidate;
    });

    const rows: Record<string, string>[] = [];
    for (let r = 1; r < nonEmptyRows.length; r++) {
      const values = nonEmptyRows[r];
      const rowObj: Record<string, string> = {};
      for (let c = 0; c < uniqueHeaders.length; c++) {
        rowObj[uniqueHeaders[c]] =
          values[c] !== undefined && values[c] !== null ? String(values[c]).trim() : '';
      }
      rows.push(rowObj);
    }

    return { headers: uniqueHeaders, rows, sourceFormat: 'xlsx' };
  }

  throw new Error('No CSV or Excel file payload was provided.');
}

export function computeDatasetQualityStats(
  headers: string[],
  rows: Record<string, string>[]
): { duplicateCount: number; missingCellCount: number } {
  const seen = new Set<string>();
  let duplicateCount = 0;
  let missingCellCount = 0;

  for (const row of rows) {
    const parts: string[] = [];
    for (const h of headers) {
      const v = row[h] ?? '';
      if (isMissingValue(v)) {
        missingCellCount++;
      }
      parts.push(v.trim());
    }
    const sig = parts.join('\u0001');
    if (seen.has(sig)) {
      duplicateCount++;
    } else {
      seen.add(sig);
    }
  }

  return { duplicateCount, missingCellCount };
}

function isLikelyDateString(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed || /^\d+(\.\d+)?$/.test(trimmed)) return false;
  if (
    !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(trimmed) &&
    !/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(trimmed)
  ) {
    return false;
  }
  const ts = Date.parse(trimmed);
  return !Number.isNaN(ts);
}

function inferSemanticRole(header: string, dataType: ColumnDataType): ColumnSemanticRole {
  const h = header.toLowerCase();
  if (dataType === 'identifier' || /(customer|user|account|member|workspace|client).*id|^id$/.test(h)) {
    return 'id';
  }
  if (/(churn|exited|attrition|lapsed|cancelled|dropped|non_renew)/.test(h) && dataType !== 'date') {
    return 'target';
  }
  if (dataType === 'date' || /(date|_at$|timestamp|renewal|signup|joined)/.test(h)) {
    return 'date';
  }
  if (
    dataType === 'numeric' &&
    /(charge|mrr|arr|acv|revenue|spend|order_value|aov|balance|salary|premium|tuition|dues|fee|price|amount)/.test(h)
  ) {
    return 'revenue';
  }
  if (dataType === 'numeric' && /(tenure|months|lifetime|age_months|terms)/.test(h)) {
    return 'tenure';
  }
  if (
    dataType === 'numeric' &&
    /(frequency|orders|visits|checkins|sessions|transactions|tickets|calls|products|claims|usage|active_users)/.test(h)
  ) {
    return 'frequency';
  }
  if (
    dataType === 'categorical' &&
    /(contract|plan|tier|segment|package|membership|program|policy|channel)/.test(h)
  ) {
    return 'segment';
  }
  return 'other';
}

export function profileColumns(headers: string[], rows: Record<string, string>[]): ColumnProfile[] {
  const total = rows.length;

  return headers.map((header) => {
    let missingCount = 0;
    let numericCount = 0;
    let nonNumericCount = 0;
    let dateCount = 0;
    const uniqueSet = new Set<string>();
    const rawUniqueByNorm = new Map<string, Set<string>>();
    const samples: string[] = [];

    for (const row of rows) {
      const val = row[header];
      if (isMissingValue(val)) {
        missingCount++;
        continue;
      }
      const rawClean = val.replace(/\r/g, '');
      const trimmed = rawClean.trim();
      uniqueSet.add(trimmed);
      const normKey = trimmed.replace(/\s+/g, ' ').toLowerCase();
      const variantSet = rawUniqueByNorm.get(normKey) || new Set<string>();
      variantSet.add(rawClean);
      rawUniqueByNorm.set(normKey, variantSet);

      if (samples.length < 4 && !samples.includes(trimmed)) {
        samples.push(trimmed);
      }
      const num = Number(trimmed);
      if (!Number.isNaN(num) && Number.isFinite(num)) {
        numericCount++;
      } else {
        nonNumericCount++;
        if (isLikelyDateString(trimmed)) {
          dateCount++;
        }
      }
    }

    const nonMissing = total - missingCount;
    const lowerHeader = header.toLowerCase();
    const headerSuggestsDate = /(date|_at$|timestamp|renewal|signup|joined|checkin)/.test(lowerHeader);
    const looksLikeId =
      lowerHeader === 'id' ||
      lowerHeader === 'customerid' ||
      lowerHeader === 'customer_id' ||
      lowerHeader === 'user_id' ||
      lowerHeader === 'userid' ||
      lowerHeader === 'account_id' ||
      lowerHeader === 'member_id' ||
      lowerHeader === 'workspace_id' ||
      (uniqueSet.size === nonMissing && nonMissing > 20 && nonNumericCount > 0 && dateCount === 0);

    let dataType: ColumnDataType = 'categorical';
    let invalidNumericCount = 0;
    let invalidDateCount = 0;

    if (looksLikeId) {
      dataType = 'identifier';
    } else if (
      nonMissing > 0 &&
      (dateCount / nonMissing >= 0.7 ||
        (headerSuggestsDate && dateCount >= 1 && numericCount / nonMissing < 0.6))
    ) {
      dataType = 'date';
      invalidDateCount = Math.max(0, nonMissing - dateCount);
    } else if (headerSuggestsDate && nonMissing > 0 && numericCount === 0 && uniqueSet.size > 4) {
      dataType = 'date';
      invalidDateCount = nonMissing;
    } else if (nonMissing > 0 && numericCount / nonMissing >= 0.85) {
      dataType = 'numeric';
      invalidNumericCount = nonNumericCount;
    } else {
      dataType = 'categorical';
    }

    let inconsistentCategoryCount = 0;
    const inconsistentCategorySamples: string[] = [];
    if (dataType === 'categorical' && uniqueSet.size <= 40) {
      for (const variants of rawUniqueByNorm.values()) {
        const arr = Array.from(variants);
        const hasWhitespaceVariant = arr.some((v) => v !== v.trim());
        if (arr.length > 1 || hasWhitespaceVariant) {
          inconsistentCategoryCount += Math.max(1, arr.length - 1);
          for (const v of arr) {
            if (inconsistentCategorySamples.length < 6 && !inconsistentCategorySamples.includes(v)) {
              inconsistentCategorySamples.push(v);
            }
          }
        }
      }
    }

    const semanticRole = inferSemanticRole(header, dataType);

    return {
      name: header,
      dataType,
      semanticRole,
      missingCount,
      missingPercent: total > 0 ? Number(((missingCount / total) * 100).toFixed(1)) : 0,
      uniqueCount: uniqueSet.size,
      sampleValues: samples,
      categories:
        dataType === 'categorical' && uniqueSet.size <= 20 ? Array.from(uniqueSet) : undefined,
      invalidNumericCount,
      invalidDateCount,
      inconsistentCategoryCount,
      inconsistentCategorySamples:
        inconsistentCategorySamples.length > 0 ? inconsistentCategorySamples : undefined,
    };
  });
}

function findMatchingColumn(headers: string[], candidates: string[]): string | null {
  const lowerMap = new Map(headers.map((h) => [h.toLowerCase(), h]));
  for (const cand of candidates) {
    const exact = lowerMap.get(cand.toLowerCase());
    if (exact) return exact;
  }
  for (const cand of candidates) {
    const partial = headers.find((h) => h.toLowerCase().includes(cand.toLowerCase()));
    if (partial) return partial;
  }
  return null;
}

export function detectPositiveClass(rows: Record<string, string>[], targetColumn: string): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const val = row[targetColumn];
    if (!isMissingValue(val)) {
      const trimmed = val.trim();
      counts.set(trimmed, (counts.get(trimmed) || 0) + 1);
    }
  }
  const values = Array.from(counts.keys());
  if (values.length === 0) return 'Yes';

  const preferredPositive = ['yes', '1', 'true', 'churn', 'churned', 'exited', 'positive', 'y'];
  for (const pref of preferredPositive) {
    const match = values.find((v) => v.toLowerCase() === pref);
    if (match) return match;
  }

  // Otherwise pick the minority class (churn is typically the smaller class)
  values.sort((a, b) => (counts.get(a) || 0) - (counts.get(b) || 0));
  return values[0];
}

export function getUniqueColumnValues(rows: Record<string, string>[], columnName: string): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const val = row[columnName];
    if (!isMissingValue(val)) {
      set.add(val.trim());
    }
  }
  return Array.from(set);
}

const SUSPICIOUS_LEAKAGE_PATTERNS = [
  'churn_date',
  'cancel_date',
  'cancellation_date',
  'exit_date',
  'churn_reason',
  'cancel_reason',
  'churn_score',
  'predicted_churn',
];

function looksLikeLeakageColumn(colName: string): boolean {
  const lower = colName.toLowerCase();
  return SUSPICIOUS_LEAKAGE_PATTERNS.some((p) => lower.includes(p));
}

export function autoDetectMapping(
  columns: ColumnProfile[],
  rows: Record<string, string>[],
  industry: IndustryKey = 'telecommunications'
): ColumnMapping {
  const headers = columns.map((c) => c.name);
  const tmpl = getIndustryTemplate(industry);

  let targetColumn =
    findMatchingColumn(headers, [
      ...tmpl.suggestedTargetCols,
      'churn',
      'exited',
      'target',
      'status',
      'attrition',
      'is_churn',
    ]) || '';

  if (!targetColumn) {
    const binaryCol = columns.find((c) => c.dataType === 'categorical' && c.uniqueCount === 2);
    targetColumn = binaryCol ? binaryCol.name : '';
  }

  const positiveClassValue = targetColumn ? detectPositiveClass(rows, targetColumn) : '';

  const idColumn = findMatchingColumn(headers, [
    'customerid',
    'customer_id',
    'account_id',
    'member_id',
    'workspace_id',
    'cust_id',
    'userid',
    'user_id',
    'id',
  ]);

  const contractColumn = findMatchingColumn(headers, [
    ...tmpl.suggestedSegmentCols,
    'contract',
    'contract_type',
    'plan',
    'subscription_type',
    'tier',
  ]);

  const tenureColumn = findMatchingColumn(headers, [
    ...tmpl.suggestedTenureCols,
    'tenure',
    'tenure_months',
    'months',
    'subscription_months',
  ]);

  const monthlyChargesColumn = findMatchingColumn(headers, [
    ...tmpl.suggestedRevenueCols,
    'monthlycharges',
    'monthly_charges',
    'monthly_fee',
    'charges',
    'mrr',
    'price',
  ]);

  const dateColumn =
    findMatchingColumn(headers, tmpl.suggestedDateCols) ||
    columns.find((c) => c.dataType === 'date' && !looksLikeLeakageColumn(c.name))?.name ||
    null;

  const frequencyColumn = findMatchingColumn(headers, tmpl.suggestedFrequencyCols);

  const featureColumns = columns
    .filter(
      (c) =>
        c.name !== targetColumn &&
        c.name !== idColumn &&
        c.dataType !== 'identifier' &&
        c.dataType !== 'date' &&
        !looksLikeLeakageColumn(c.name)
    )
    .map((c) => c.name);

  return {
    targetColumn,
    positiveClassValue,
    idColumn: idColumn !== targetColumn ? idColumn : null,
    contractColumn: contractColumn !== targetColumn ? contractColumn : null,
    tenureColumn: tenureColumn !== targetColumn ? tenureColumn : null,
    monthlyChargesColumn: monthlyChargesColumn !== targetColumn ? monthlyChargesColumn : null,
    dateColumn: dateColumn !== targetColumn ? dateColumn : null,
    frequencyColumn: frequencyColumn !== targetColumn ? frequencyColumn : null,
    featureColumns,
  };
}

export function buildMappingRationales(
  columns: ColumnProfile[],
  mapping: ColumnMapping,
  industry: IndustryKey = 'telecommunications'
): MappingSuggestionRationale[] {
  const tmpl = getIndustryTemplate(industry);
  const byName = new Map(columns.map((c) => [c.name, c]));

  const evaluateField = (
    field: keyof ColumnMapping,
    mappedCol: string | null | undefined,
    preferredNames: string[],
    expectedDesc: string
  ): MappingSuggestionRationale => {
    if (!mappedCol || !byName.has(mappedCol)) {
      return {
        field,
        suggestedColumn: null,
        confidence: 'unmapped',
        reason: `No ${expectedDesc} column was auto-detected. Map one manually if present in your dataset.`,
      };
    }
    const lower = mappedCol.toLowerCase();
    const isExactIndustryMatch = preferredNames.some((p) => lower === p.toLowerCase());
    const isPartialIndustryMatch = preferredNames.some((p) => lower.includes(p.toLowerCase()));
    const col = byName.get(mappedCol)!;
    if (isExactIndustryMatch) {
      return {
        field,
        suggestedColumn: mappedCol,
        confidence: 'high',
        reason: `Exact ${tmpl.shortLabel} schema match ("${mappedCol}", ${col.dataType}, ${col.uniqueCount} unique values).`,
      };
    }
    if (isPartialIndustryMatch) {
      return {
        field,
        suggestedColumn: mappedCol,
        confidence: 'high',
        reason: `Matched ${tmpl.shortLabel} naming pattern ("${mappedCol}", ${col.dataType}).`,
      };
    }
    return {
      field,
      suggestedColumn: mappedCol,
      confidence: 'medium',
      reason: `Inferred from column profile ("${mappedCol}", ${col.dataType}, ${col.uniqueCount} unique values). Confirm before committing.`,
    };
  };

  return [
    evaluateField(
      'targetColumn',
      mapping.targetColumn,
      [...tmpl.suggestedTargetCols, 'churn', 'exited', 'target', 'status', 'attrition', 'is_churn'],
      'historical churn outcome'
    ),
    evaluateField(
      'idColumn',
      mapping.idColumn,
      ['customer_id', 'customerid', 'account_id', 'member_id', 'workspace_id', 'user_id', 'id'],
      'unique customer identifier'
    ),
    evaluateField(
      'contractColumn',
      mapping.contractColumn,
      [...tmpl.suggestedSegmentCols, 'contract', 'plan', 'tier', 'segment'],
      `${tmpl.segmentLabel.toLowerCase()}`
    ),
    evaluateField(
      'tenureColumn',
      mapping.tenureColumn,
      [...tmpl.suggestedTenureCols, 'tenure', 'tenure_months', 'months'],
      `${tmpl.tenureLabel.toLowerCase()}`
    ),
    evaluateField(
      'monthlyChargesColumn',
      mapping.monthlyChargesColumn,
      [...tmpl.suggestedRevenueCols, 'monthly_charges', 'mrr', 'revenue', 'spend'],
      `${tmpl.revenueLabel.toLowerCase()}`
    ),
    evaluateField(
      'dateColumn',
      mapping.dateColumn,
      tmpl.suggestedDateCols,
      'activity or billing date'
    ),
    evaluateField(
      'frequencyColumn',
      mapping.frequencyColumn,
      tmpl.suggestedFrequencyCols,
      `${tmpl.frequencyLabel.toLowerCase()}`
    ),
  ];
}

export function evaluateChurnReadiness(
  columns: ColumnProfile[],
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  churnDefinition?: ChurnDefinition
): { hasValidChurnLabels: boolean; churnReadinessMessage: string | null } {
  if (!mapping.targetColumn) {
    return {
      hasValidChurnLabels: false,
      churnReadinessMessage:
        'No historical churn column is mapped (Cold-Start / Active Customer mode). Descriptive analytics and behavioural monitoring remain available.',
    };
  }

  const targetProfile = columns.find((c) => c.name === mapping.targetColumn);
  if (!targetProfile) {
    return {
      hasValidChurnLabels: false,
      churnReadinessMessage: `Mapped churn column "${mapping.targetColumn}" does not exist in the uploaded file.`,
    };
  }

  const uniqueVals = new Set<string>();
  let posCount = 0;
  let validCount = 0;
  for (const r of rows) {
    const v = r[mapping.targetColumn];
    if (!isMissingValue(v)) {
      const trimmed = v.trim();
      uniqueVals.add(trimmed);
      validCount++;
      if (trimmed === mapping.positiveClassValue) posCount++;
    }
  }

  if (uniqueVals.size < 2) {
    return {
      hasValidChurnLabels: false,
      churnReadinessMessage: `Target column "${mapping.targetColumn}" contains ${uniqueVals.size} distinct value(s). Supervised churn training requires both churned and retained historical outcomes.`,
    };
  }

  if (posCount === 0 || posCount === validCount) {
    return {
      hasValidChurnLabels: false,
      churnReadinessMessage: `Positive churn value "${mapping.positiveClassValue}" matches ${posCount} of ${validCount} labeled records. Both positive (churned) and negative (retained) examples are required.`,
    };
  }

  if (churnDefinition && !churnDefinition.confirmedByUser) {
    return {
      hasValidChurnLabels: true,
      churnReadinessMessage:
        'Historical churn labels are present, though your organization’s churn definition has not yet been confirmed before model training.',
    };
  }

  return { hasValidChurnLabels: true, churnReadinessMessage: null };
}

function computeBehaviourMonitoring(
  columns: ColumnProfile[],
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  churnDefinition?: ChurnDefinition,
  hasValidLabels = true
): BehaviourMonitoringSummary | null {
  const dateCol =
    mapping.dateColumn && columns.some((c) => c.name === mapping.dateColumn)
      ? mapping.dateColumn
      : null;
  const freqCol =
    mapping.frequencyColumn && columns.some((c) => c.name === mapping.frequencyColumn)
      ? mapping.frequencyColumn
      : null;
  const tenureCol =
    mapping.tenureColumn && columns.some((c) => c.name === mapping.tenureColumn)
      ? mapping.tenureColumn
      : null;
  const revCol =
    mapping.monthlyChargesColumn && columns.some((c) => c.name === mapping.monthlyChargesColumn)
      ? mapping.monthlyChargesColumn
      : null;

  const signalsDetected: string[] = [];
  if (dateCol) signalsDetected.push(`Activity / Event Dates (${dateCol})`);
  if (freqCol) signalsDetected.push(`Engagement Frequency (${freqCol})`);
  if (tenureCol) signalsDetected.push(`Customer Tenure (${tenureCol})`);
  if (revCol) signalsDetected.push(`Customer Value / Spend (${revCol})`);
  if (mapping.contractColumn && columns.some((c) => c.name === mapping.contractColumn)) {
    signalsDetected.push(`Segment / Plan (${mapping.contractColumn})`);
  }

  if (signalsDetected.length === 0) {
    return null;
  }

  let minTs = Infinity;
  let maxTs = -Infinity;
  let validDateRows = 0;
  let invalidDateRows = 0;
  const rowDates: { idx: number; ts: number | null; rawDate: string | null }[] = [];

  if (dateCol) {
    rows.forEach((row, idx) => {
      const raw = row[dateCol];
      if (isMissingValue(raw)) {
        rowDates.push({ idx, ts: null, rawDate: null });
        return;
      }
      const trimmed = raw.trim();
      const ts = isLikelyDateString(trimmed) ? Date.parse(trimmed) : NaN;
      if (!Number.isNaN(ts)) {
        validDateRows++;
        if (ts < minTs) minTs = ts;
        if (ts > maxTs) maxTs = ts;
        rowDates.push({ idx, ts, rawDate: new Date(ts).toISOString().slice(0, 10) });
      } else {
        invalidDateRows++;
        rowDates.push({ idx, ts: null, rawDate: trimmed });
      }
    });
  }

  const inactivityThresholdDays =
    churnDefinition?.inactivityDays && churnDefinition.inactivityDays > 0
      ? churnDefinition.inactivityDays
      : null;

  const refTs = Number.isFinite(maxTs) ? maxTs : Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;

  let freqVals: number[] = [];
  if (freqCol) {
    for (const r of rows) {
      const v = Number(r[freqCol]);
      if (!isMissingValue(r[freqCol]) && !Number.isNaN(v) && Number.isFinite(v)) {
        freqVals.push(v);
      }
    }
    freqVals.sort((a, b) => a - b);
  }
  const lowFreqCutoff =
    freqVals.length >= 4 ? freqVals[Math.floor(freqVals.length * 0.2)] : freqVals.length > 0 ? 1 : 0;

  let inactivityWatchlistCount = 0;
  let lowEngagementCount = 0;
  const watchlistCandidates: BehaviourWatchlistItem[] = [];

  rows.forEach((row, idx) => {
    const customerId =
      mapping.idColumn && !isMissingValue(row[mapping.idColumn])
        ? row[mapping.idColumn].trim()
        : `ROW-${String(idx + 1).padStart(4, '0')}`;

    const dInfo = rowDates[idx];
    const daysSinceActivity =
      dInfo && dInfo.ts !== null ? Math.max(0, Math.round((refTs - dInfo.ts) / msPerDay)) : null;

    const engRaw = freqCol ? row[freqCol] : undefined;
    const engNum = engRaw !== undefined && !isMissingValue(engRaw) ? Number(engRaw) : NaN;
    const isLowEngagement =
      freqCol !== null &&
      !Number.isNaN(engNum) &&
      Number.isFinite(engNum) &&
      (engNum === 0 || engNum <= lowFreqCutoff);

    const exceedsInactivity =
      inactivityThresholdDays !== null &&
      daysSinceActivity !== null &&
      daysSinceActivity > inactivityThresholdDays;

    if (exceedsInactivity) inactivityWatchlistCount++;
    if (isLowEngagement) lowEngagementCount++;

    if (exceedsInactivity || isLowEngagement) {
      const reasons: string[] = [];
      if (exceedsInactivity && daysSinceActivity !== null) {
        reasons.push(`${daysSinceActivity}d since last activity (>${inactivityThresholdDays}d window)`);
      }
      if (isLowEngagement && freqCol) {
        reasons.push(`Low ${freqCol}: ${engNum}`);
      }
      watchlistCandidates.push({
        rowIndex: idx + 1,
        customerId,
        lastDate: dInfo?.rawDate || null,
        daysSinceActivity,
        engagementValue: engRaw && !isMissingValue(engRaw) ? engRaw.trim() : null,
        revenueValue:
          revCol && !isMissingValue(row[revCol]) ? row[revCol].trim() : null,
        reason: reasons.join(' · '),
      });
    }
  });

  watchlistCandidates.sort(
    (a, b) => (b.daysSinceActivity ?? -1) - (a.daysSinceActivity ?? -1)
  );

  return {
    mode: hasValidLabels ? 'labeled_and_behaviour' : 'cold_start_monitoring',
    activeAccountsCount: rows.length,
    signalsDetected,
    inactivityWatchlistCount,
    inactivityThresholdDays,
    lowEngagementCount,
    dateRange:
      dateCol && validDateRows > 0
        ? {
            minDate: new Date(minTs).toISOString().slice(0, 10),
            maxDate: new Date(maxTs).toISOString().slice(0, 10),
            validDateRows,
            invalidDateRows,
          }
        : null,
    watchlistSample: watchlistCandidates.slice(0, 15),
  };
}

export function assessDataReadiness(params: {
  columns: ColumnProfile[];
  rows: Record<string, string>[];
  mapping: ColumnMapping;
  churnDefinition?: ChurnDefinition;
  industry?: IndustryKey;
}): DataReadinessAssessment {
  const { columns, rows, mapping, churnDefinition, industry = 'telecommunications' } = params;
  const tmpl = getIndustryTemplate(industry);
  const templateCols = getIndustryDataTemplateColumns(industry);
  const totalRows = rows.length;
  const headers = columns.map((c) => c.name);
  const { duplicateCount, missingCellCount } = computeDatasetQualityStats(headers, rows);
  const totalCells = Math.max(1, totalRows * Math.max(1, columns.length));
  const missingCellPercent = Number(((missingCellCount / totalCells) * 100).toFixed(1));
  const invalidDateCount = columns.reduce((acc, c) => acc + (c.invalidDateCount || 0), 0);
  const inconsistentCategoryColumns = columns.filter(
    (c) => (c.inconsistentCategoryCount || 0) > 0
  ).length;

  const usableFeatures = mapping.featureColumns.filter((name) => {
    const col = columns.find((c) => c.name === name);
    return (
      col &&
      (col.dataType === 'numeric' || col.dataType === 'categorical') &&
      !looksLikeLeakageColumn(col.name)
    );
  });
  const usableFeatureCount = usableFeatures.length;

  let labeledRows = 0;
  let churnedCount = 0;
  let retainedCount = 0;
  const targetExists = Boolean(
    mapping.targetColumn && columns.some((c) => c.name === mapping.targetColumn)
  );
  if (targetExists && mapping.targetColumn) {
    for (const r of rows) {
      const v = r[mapping.targetColumn];
      if (!isMissingValue(v)) {
        labeledRows++;
        if (v.trim() === mapping.positiveClassValue) churnedCount++;
        else retainedCount++;
      }
    }
  }
  const unlabeledRows = Math.max(0, totalRows - labeledRows);
  const minorityClassCount =
    churnedCount > 0 && retainedCount > 0 ? Math.min(churnedCount, retainedCount) : 0;

  const dateProfile = mapping.dateColumn
    ? columns.find((c) => c.name === mapping.dateColumn)
    : undefined;
  let validDatesInMappedCol = 0;
  const distinctDateTs = new Set<number>();
  if (dateProfile) {
    for (const r of rows) {
      const raw = r[dateProfile.name];
      if (!isMissingValue(raw) && isLikelyDateString(raw)) {
        validDatesInMappedCol++;
        distinctDateTs.add(Date.parse(raw.trim()));
      }
    }
  }
  const hasValidDates =
    Boolean(dateProfile) &&
    totalRows > 0 &&
    validDatesInMappedCol >= Math.max(2, Math.floor(totalRows * 0.7)) &&
    distinctDateTs.size >= 2;

  const churnDefinitionConfirmed = Boolean(churnDefinition?.confirmedByUser);
  const hasBehaviourSignals = Boolean(
    hasValidDates ||
      (mapping.frequencyColumn && columns.some((c) => c.name === mapping.frequencyColumn)) ||
      (mapping.tenureColumn && columns.some((c) => c.name === mapping.tenureColumn)) ||
      (mapping.monthlyChargesColumn && columns.some((c) => c.name === mapping.monthlyChargesColumn))
  );

  // 1. Analytics Ready
  const analyticsVisuals: string[] = [];
  if (mapping.contractColumn) analyticsVisuals.push(`${tmpl.segmentLabel} distribution`);
  if (mapping.tenureColumn) analyticsVisuals.push(`${tmpl.tenureLabel} cohorts`);
  if (mapping.monthlyChargesColumn) analyticsVisuals.push(`${tmpl.revenueLabel} brackets`);
  if (mapping.frequencyColumn) analyticsVisuals.push(`${tmpl.frequencyLabel} comparison`);
  if (columns.some((c) => c.dataType === 'categorical' && c.name !== mapping.targetColumn)) {
    analyticsVisuals.push('Categorical attribute breakdown');
  }
  const analyticsOk = totalRows >= 1 && columns.length >= 2;
  const analyticsScore = analyticsOk ? Math.min(100, 60 + analyticsVisuals.length * 8) : 0;

  // 2. Behaviour Monitoring Ready
  const behaviourSummary = computeBehaviourMonitoring(
    columns,
    rows,
    mapping,
    churnDefinition,
    churnedCount > 0 && retainedCount > 0
  );
  const behaviourOk =
    totalRows >= 1 && hasBehaviourSignals && (behaviourSummary?.signalsDetected.length || 0) >= 1;
  const behaviourScore = behaviourOk
    ? Math.min(
        100,
        55 +
          (hasValidDates ? 20 : 0) +
          (mapping.frequencyColumn ? 15 : 0) +
          (mapping.monthlyChargesColumn ? 10 : 0)
      )
    : 20;

  // 3. Prediction Ready (Statistical & Structural Validation — no arbitrary fixed row rule!)
  const blockers: string[] = [];
  if (!churnDefinitionConfirmed) {
    blockers.push(
      'Organization churn definition has not yet been reviewed and confirmed prior to modeling.'
    );
  }
  if (!targetExists || !mapping.targetColumn) {
    blockers.push(
      'No historical churn outcome column is mapped. Running in Cold-Start / Active Customer mode until churn outcomes are recorded or uploaded.'
    );
  } else {
    if (churnedCount === 0 || retainedCount === 0) {
      blockers.push(
        `Historical labels require both churned and retained outcomes (found ${churnedCount} churned and ${retainedCount} retained).`
      );
    } else if (minorityClassCount < 4) {
      blockers.push(
        `Minority outcome class has only ${minorityClassCount} record(s); at least 4 examples of each outcome are needed so both training and held-out validation splits contain churn and retention cases.`
      );
    }
    const minRequiredForFeatures = Math.max(8, usableFeatureCount + 4);
    if (labeledRows < minRequiredForFeatures) {
      blockers.push(
        `${labeledRows} labeled records found for ${usableFeatureCount} mapped feature(s); at least ${minRequiredForFeatures} labeled records are needed to fit and hold out an unseen evaluation split reliably.`
      );
    }
  }
  if (usableFeatureCount === 0) {
    blockers.push(
      'No usable numeric or categorical customer attributes are mapped for prediction training.'
    );
  }
  if (mapping.dateColumn && invalidDateCount > Math.ceil(totalRows * 0.4)) {
    blockers.push(
      `Mapped date column "${mapping.dateColumn}" contains ${invalidDateCount} unparseable date values; repair date formatting before chronological validation.`
    );
  }

  let recommendedValidationStrategy: SplitStrategy = 'stratified';
  let validationStrategyReason =
    'Stratified 80/20 hold-out balances churn and retention proportions cleanly across training and unseen evaluation sets.';

  if (hasValidDates && mapping.dateColumn && labeledRows >= 10) {
    const datedValid = rows
      .map((r) => {
        const v = r[mapping.targetColumn];
        const ts = isLikelyDateString(r[mapping.dateColumn!] || '')
          ? Date.parse(r[mapping.dateColumn!])
          : NaN;
        return !isMissingValue(v) && !Number.isNaN(ts)
          ? { ts, isPos: v.trim() === mapping.positiveClassValue ? 1 : 0 }
          : null;
      })
      .filter((x): x is { ts: number; isPos: number } => x !== null)
      .sort((a, b) => a.ts - b.ts);

    const cut = Math.floor(datedValid.length * 0.8);
    const trainPart = datedValid.slice(0, cut);
    const testPart = datedValid.slice(cut);
    const trainHasBoth =
      trainPart.some((x) => x.isPos === 1) && trainPart.some((x) => x.isPos === 0);
    const testHasBoth =
      testPart.some((x) => x.isPos === 1) && testPart.some((x) => x.isPos === 0);

    if (trainHasBoth && testHasBoth) {
      recommendedValidationStrategy = 'chronological';
      validationStrategyReason = `Chronological hold-out on "${mapping.dateColumn}" (${validDatesInMappedCol}/${totalRows} valid dates) tests the model on future cohorts while preserving both outcomes in train and test folds.`;
    } else {
      validationStrategyReason = `Stratified 80/20 hold-out selected because chronological tail on "${mapping.dateColumn}" lacks both outcomes in one split window.`;
    }
  }

  const predictionOk = blockers.length === 0;
  const predictionScore = predictionOk
    ? Math.min(100, 75 + Math.min(15, minorityClassCount) + (hasValidDates ? 10 : 0))
    : Math.max(0, 40 - blockers.length * 10);

  // 4. More Data Required & Actionable Guidance
  const missingItems: string[] = [];
  const collectionGuidance: string[] = [];

  if (!churnDefinitionConfirmed) {
    missingItems.push('Confirmed business churn definition');
    collectionGuidance.push(
      `Confirm what triggers churn for ${tmpl.label} (cancellation, non-renewal, or inactivity threshold) in Step 1.`
    );
  }
  if (!targetExists || minorityClassCount < 4) {
    missingItems.push(
      !targetExists
        ? 'Historical churn outcome column (Churned vs Retained)'
        : `At least ${Math.max(0, 4 - minorityClassCount)} more minority-class labeled outcomes`
    );
    collectionGuidance.push(
      `Continue operating in Behaviour Monitoring mode and record observed churn/retention outcomes as ${tmpl.entityPlural.toLowerCase()} complete billing cycles, OR upload a historical export containing both churned and stayed ${tmpl.entityPlural.toLowerCase()}.`
    );
  }
  if (!mapping.idColumn) {
    missingItems.push('Unique customer identifier column');
    collectionGuidance.push(
      `Include a persistent ID (e.g., ${templateCols.find((c) => c.semanticRole === 'id')?.name || 'customer_id'}) so ChurnSight can track repeat activity and outcomes per account.`
    );
  }
  if (!mapping.dateColumn || !hasValidDates) {
    missingItems.push('Valid activity / renewal date column (ISO YYYY-MM-DD)');
    collectionGuidance.push(
      `Add an activity or renewal date column (${templateCols.find((c) => c.semanticRole === 'date')?.name || 'last_activity_date'}) in YYYY-MM-DD format to unlock time-based validation and inactivity watchlists.`
    );
  }
  if (invalidDateCount > 0) {
    missingItems.push(`${invalidDateCount} unparseable date value(s)`);
    collectionGuidance.push('Standardize date fields to ISO YYYY-MM-DD format before retraining.');
  }
  if (inconsistentCategoryColumns > 0) {
    missingItems.push(`${inconsistentCategoryColumns} column(s) with inconsistent category casing/whitespace`);
    collectionGuidance.push(
      'Normalize trailing spaces or mixed capitalization in category columns so segments aggregate cleanly.'
    );
  }

  // Score breakdown (100 pts total)
  const defPoints = churnDefinitionConfirmed ? 15 : 5;
  const mappedSignalsCount = [
    mapping.idColumn,
    mapping.contractColumn,
    mapping.tenureColumn,
    mapping.monthlyChargesColumn,
  ].filter(Boolean).length;
  const schemaPoints = Math.round((mappedSignalsCount / 4) * 20);
  const hygienePenalty =
    Math.min(8, Math.round(missingCellPercent * 0.4)) +
    Math.min(5, duplicateCount > 0 ? 3 : 0) +
    Math.min(5, invalidDateCount > 0 ? 4 : 0) +
    Math.min(4, inconsistentCategoryColumns * 2);
  const hygienePoints = totalRows > 0 ? Math.max(2, 20 - hygienePenalty) : 0;
  const behaviourPoints = Math.min(
    15,
    (hasValidDates ? 6 : 0) +
      (mapping.frequencyColumn ? 5 : 0) +
      (mapping.tenureColumn || mapping.monthlyChargesColumn ? 4 : 0)
  );
  const labelPoints = !targetExists
    ? 0
    : Math.min(
        30,
        (churnedCount > 0 && retainedCount > 0 ? 12 : 4) +
          Math.min(10, Math.round((minorityClassCount / 4) * 10)) +
          (predictionOk ? 8 : 0)
      );

  const scoreBreakdown: ReadinessScoreFactor[] = [
    {
      label: 'Churn Definition & Policy',
      score: defPoints,
      maxScore: 15,
      note: churnDefinitionConfirmed
        ? `Confirmed (${churnDefinition?.triggerType}, ${churnDefinition?.reportingPeriod})`
        : 'Pending user confirmation',
    },
    {
      label: 'Core Schema Coverage',
      score: schemaPoints,
      maxScore: 20,
      note: `${mappedSignalsCount}/4 core customer dimensions mapped (ID, Segment, Tenure, Value)`,
    },
    {
      label: 'Data Quality & Hygiene',
      score: hygienePoints,
      maxScore: 20,
      note: `${missingCellPercent}% missing cells, ${duplicateCount} duplicates, ${invalidDateCount} invalid dates, ${inconsistentCategoryColumns} inconsistent category col(s)`,
    },
    {
      label: 'Behavioural Signal Depth',
      score: behaviourPoints,
      maxScore: 15,
      note: `${behaviourSummary?.signalsDetected.length || 0} behavioural/lifecycle signal(s) active`,
    },
    {
      label: 'Supervised Label Sufficiency',
      score: labelPoints,
      maxScore: 30,
      note: targetExists
        ? `${churnedCount} churned / ${retainedCount} retained (${minorityClassCount} minority class)`
        : 'Unlabeled Cold-Start dataset',
    },
  ];

  const readinessScore = Math.max(
    0,
    Math.min(100, scoreBreakdown.reduce((s, f) => s + f.score, 0))
  );

  let overallStatus: OverallReadinessTier = 'more_data_required';
  let overallLabel = 'More Data Required';
  if (predictionOk) {
    overallStatus = 'prediction_ready';
    overallLabel = 'Prediction Ready';
  } else if (behaviourOk) {
    overallStatus = 'behaviour_monitoring_ready';
    overallLabel = 'Behaviour Monitoring Ready';
  } else if (analyticsOk) {
    overallStatus = 'analytics_ready';
    overallLabel = 'Analytics Ready';
  }

  const explanation = predictionOk
    ? `Dataset satisfies structural, data-hygiene, and statistical label requirements (${readinessScore}/100). Recommended validation: ${recommendedValidationStrategy}.`
    : behaviourOk
      ? `Running in Cold-Start & Behaviour Monitoring mode (${readinessScore}/100): descriptive analytics and rule-based engagement/inactivity watchlists are live while supervised churn prediction awaits labeled outcomes.`
      : analyticsOk
        ? `Descriptive analytics are available (${readinessScore}/100). Add activity dates, engagement metrics, or historical churn labels to unlock monitoring and prediction.`
        : 'Upload a valid customer dataset to begin readiness evaluation.';

  const nextActions = predictionOk
    ? [
        'Proceed to Churn Prediction & Retention Intelligence to review risk scores and key drivers.',
        ...(inconsistentCategoryColumns > 0
          ? ['Standardize category capitalization in future exports for cleaner segment reporting.']
          : []),
      ]
    : collectionGuidance.slice(0, 3);

  return {
    overallStatus,
    overallLabel,
    readinessScore,
    analyticsReady: {
      ready: analyticsOk,
      score: analyticsScore,
      summary: analyticsOk
        ? `${totalRows.toLocaleString()} records across ${columns.length} columns ready for segmentation and value analysis.`
        : 'Need at least 1 customer row and 2 columns for descriptive analytics.',
      details: analyticsVisuals,
      availableVisuals: analyticsVisuals,
    },
    behaviourMonitoringReady: {
      ready: behaviourOk,
      score: behaviourScore,
      summary: behaviourOk
        ? `Tracking ${behaviourSummary?.signalsDetected.length || 0} behavioural signals across ${totalRows.toLocaleString()} active accounts.`
        : 'Map an activity date, engagement frequency, tenure, or spend column to enable rule-based monitoring.',
      details: behaviourSummary?.signalsDetected || [],
      trackedSignals: behaviourSummary?.signalsDetected || [],
      inactivityWatchlistCount: behaviourSummary?.inactivityWatchlistCount || 0,
    },
    predictionReady: {
      ready: predictionOk,
      score: predictionScore,
      summary: predictionOk
        ? `Both outcomes satisfied (${churnedCount} churned, ${retainedCount} retained across ${usableFeatureCount} features).`
        : blockers[0] || 'Historical churn outcome labels are incomplete for supervised modeling.',
      details: predictionOk ? [validationStrategyReason] : blockers,
      blockers,
      recommendedValidationStrategy,
      validationStrategyReason,
    },
    moreDataRequired: {
      needed: !predictionOk,
      missingItems,
      collectionGuidance,
    },
    datasetProfile: {
      totalRows,
      labeledRows,
      unlabeledRows,
      churnedCount,
      retainedCount,
      minorityClassCount,
      usableFeatureCount,
      missingCellPercent,
      duplicateRowCount: duplicateCount,
      invalidDateCount,
      inconsistentCategoryColumns,
      hasValidDates,
      churnDefinitionConfirmed,
    },
    scoreBreakdown,
    explanation,
    nextActions,
  };
}

export function validateDataset(
  columns: ColumnProfile[],
  rows: Record<string, string>[],
  mapping: ColumnMapping
): { issues: ValidationIssue[]; isValid: boolean } {
  const issues: ValidationIssue[] = [];

  if (rows.length === 0) {
    issues.push({
      severity: 'error',
      message: 'Dataset contains zero rows.',
    });
  }

  const { duplicateCount } = computeDatasetQualityStats(
    columns.map((c) => c.name),
    rows
  );
  if (duplicateCount > 0) {
    issues.push({
      severity: 'warning',
      message: `Detected ${duplicateCount} exact duplicate row(s). Deduplicate historical exports to prevent over-counting or train/test leakage.`,
    });
  }

  const targetProfile = mapping.targetColumn
    ? columns.find((c) => c.name === mapping.targetColumn)
    : undefined;

  if (!mapping.targetColumn) {
    issues.push({
      severity: 'warning',
      message:
        'No churn outcome column is mapped. Running in Cold-Start mode: descriptive analytics and behavioural monitoring remain available, while supervised predictions are paused.',
    });
  } else if (!targetProfile) {
    issues.push({
      severity: 'error',
      message: `Mapped churn column "${mapping.targetColumn}" does not exist in this dataset.`,
    });
  } else {
    const uniqueTargetVals = new Set<string>();
    let missingTarget = 0;
    for (const r of rows) {
      const v = r[mapping.targetColumn];
      if (isMissingValue(v)) {
        missingTarget++;
      } else {
        uniqueTargetVals.add(v.trim());
      }
    }

    if (uniqueTargetVals.size < 2) {
      issues.push({
        severity: 'warning',
        column: mapping.targetColumn,
        message: `Target column "${mapping.targetColumn}" currently has ${uniqueTargetVals.size} distinct value(s). Both churned and retained outcomes are required before building a supervised model.`,
      });
    } else if (!uniqueTargetVals.has(mapping.positiveClassValue)) {
      issues.push({
        severity: 'error',
        column: mapping.targetColumn,
        message: `Positive churn value "${mapping.positiveClassValue}" was not found in target column "${mapping.targetColumn}". Available values: ${Array.from(uniqueTargetVals).join(', ')}.`,
      });
    } else if (uniqueTargetVals.size > 2) {
      issues.push({
        severity: 'warning',
        column: mapping.targetColumn,
        message: `Target column "${mapping.targetColumn}" has ${uniqueTargetVals.size} unique values. "${mapping.positiveClassValue}" is treated as Churned and other non-empty values as Retained.`,
      });
    }

    if (missingTarget > 0) {
      issues.push({
        severity: 'warning',
        column: mapping.targetColumn,
        message: `${missingTarget} row(s) have missing values in "${mapping.targetColumn}" and will be excluded from supervised training until outcomes are recorded.`,
      });
    }
  }

  if (mapping.featureColumns.length === 0) {
    issues.push({
      severity: 'error',
      message: 'At least one customer attribute column must be selected as a feature.',
    });
  }

  for (const colName of mapping.featureColumns) {
    if (looksLikeLeakageColumn(colName)) {
      issues.push({
        severity: 'warning',
        column: colName,
        message: `Selected feature "${colName}" resembles a post-churn or leakage column and is excluded from predictive modeling.`,
      });
    }
  }

  for (const col of columns) {
    if (col.missingCount > 0) {
      issues.push({
        severity: 'info',
        column: col.name,
        message: `Column "${col.name}" has ${col.missingCount} missing value(s) (${col.missingPercent}%). ${
          col.dataType === 'numeric'
            ? 'Numeric values are imputed using the training median.'
            : col.dataType === 'date'
              ? 'Rows without valid dates remain eligible for stratified validation.'
              : 'Categorical values are imputed using the training mode.'
        }`,
      });
    }
    if (col.invalidNumericCount > 0) {
      issues.push({
        severity: 'warning',
        column: col.name,
        message: `Numeric column "${col.name}" contains ${col.invalidNumericCount} non-numeric value(s), which are treated as missing.`,
      });
    }
    if ((col.invalidDateCount || 0) > 0) {
      issues.push({
        severity: 'warning',
        column: col.name,
        message: `Date column "${col.name}" contains ${col.invalidDateCount} unparseable date string(s). Expected ISO YYYY-MM-DD or MM/DD/YYYY.`,
      });
    }
    if ((col.inconsistentCategoryCount || 0) > 0) {
      const sampleText = col.inconsistentCategorySamples?.length
        ? ` (e.g. ${col.inconsistentCategorySamples.map((s) => `"${s}"`).join(', ')})`
        : '';
      issues.push({
        severity: 'warning',
        column: col.name,
        message: `Categorical column "${col.name}" has inconsistent casing or trailing spaces${sampleText}.`,
      });
    }
  }

  const hasError = issues.some((i) => i.severity === 'error');
  return { issues, isValid: !hasError };
}

function isRowChurned(row: Record<string, string>, mapping: ColumnMapping): boolean | null {
  const val = row[mapping.targetColumn];
  if (isMissingValue(val)) return null;
  return val.trim() === mapping.positiveClassValue;
}

const TENURE_BINS: { label: string; min: number; max: number }[] = [
  { label: '0–12 mo', min: -Infinity, max: 12 },
  { label: '13–24 mo', min: 12, max: 24 },
  { label: '25–36 mo', min: 24, max: 36 },
  { label: '37–48 mo', min: 36, max: 48 },
  { label: '49–60 mo', min: 48, max: 60 },
  { label: '61–72 mo', min: 60, max: 72 },
];

function getTenureGroupLabel(val: number): string {
  const found = TENURE_BINS.find((b) => val > b.min && val <= b.max);
  if (found) return found.label;
  return val > 72 ? '73+ mo' : '0–12 mo';
}

export function computeAnalytics(
  columns: ColumnProfile[],
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  filters: AnalyticsFilters = {},
  churnDefinition?: ChurnDefinition
): AnalyticsSummary {
  const headers = columns.map((c) => c.name);
  const hasContractCol = Boolean(
    mapping.contractColumn && columns.some((c) => c.name === mapping.contractColumn)
  );
  const hasTenureCol = Boolean(
    mapping.tenureColumn && columns.some((c) => c.name === mapping.tenureColumn)
  );
  const hasMonthlyCol = Boolean(
    mapping.monthlyChargesColumn && columns.some((c) => c.name === mapping.monthlyChargesColumn)
  );

  const paymentMethodColumn = findMatchingColumn(headers, [
    'paymentmethod',
    'payment_method',
    'payment_type',
    'payment',
    'billing_method',
  ]);
  const validPaymentCol =
    paymentMethodColumn && paymentMethodColumn !== mapping.targetColumn
      ? paymentMethodColumn
      : null;

  // Determine whether historical binary churn outcomes exist in this dataset
  let hasPositiveLabel = false;
  let hasNegativeLabel = false;
  let labeledRowCount = 0;
  for (const row of rows) {
    const c = isRowChurned(row, mapping);
    if (c !== null) {
      labeledRowCount++;
      if (c) hasPositiveLabel = true;
      else hasNegativeLabel = true;
    }
  }
  const isUnlabeledColdStart = labeledRowCount === 0 || !(hasPositiveLabel && hasNegativeLabel);

  // Build filter dropdown options before filtering
  const contractOptionsSet = new Set<string>();
  const tenureOptionsSet = new Set<string>();
  const paymentOptionsSet = new Set<string>();

  for (const row of rows) {
    if (!isUnlabeledColdStart && isRowChurned(row, mapping) === null) continue;
    if (hasContractCol && mapping.contractColumn) {
      const raw = row[mapping.contractColumn];
      contractOptionsSet.add(isMissingValue(raw) ? 'Missing' : raw.trim());
    }
    if (hasTenureCol && mapping.tenureColumn) {
      const val = Number(row[mapping.tenureColumn]);
      if (!isMissingValue(row[mapping.tenureColumn]) && !Number.isNaN(val) && Number.isFinite(val)) {
        tenureOptionsSet.add(getTenureGroupLabel(val));
      }
    }
    if (validPaymentCol) {
      const raw = row[validPaymentCol];
      paymentOptionsSet.add(isMissingValue(raw) ? 'Missing' : raw.trim());
    }
  }

  const orderedTenureLabels = [
    ...TENURE_BINS.map((b) => b.label),
    ...(tenureOptionsSet.has('73+ mo') ? ['73+ mo'] : []),
  ].filter((label) => tenureOptionsSet.has(label));

  const filterOptions: AnalyticsFilterOptions = {
    contracts: Array.from(contractOptionsSet).sort(),
    tenureGroups: orderedTenureLabels,
    paymentMethods: Array.from(paymentOptionsSet).sort(),
  };

  // Apply active filters
  const filteredRows: { row: Record<string, string>; churned: boolean }[] = [];
  for (const row of rows) {
    const rawChurn = isRowChurned(row, mapping);
    if (!isUnlabeledColdStart && rawChurn === null) continue;
    const churned = rawChurn === true;

    if (!isUnlabeledColdStart) {
      if (filters.churnStatus === 'Churned' && !churned) continue;
      if (filters.churnStatus === 'Stayed' && churned) continue;
    }

    if (filters.contract && filters.contract !== 'ALL' && hasContractCol && mapping.contractColumn) {
      const raw = row[mapping.contractColumn];
      const label = isMissingValue(raw) ? 'Missing' : raw.trim();
      if (label !== filters.contract) continue;
    }

    if (filters.tenureGroup && filters.tenureGroup !== 'ALL' && hasTenureCol && mapping.tenureColumn) {
      const raw = row[mapping.tenureColumn];
      const val = Number(raw);
      if (isMissingValue(raw) || Number.isNaN(val) || !Number.isFinite(val)) continue;
      if (getTenureGroupLabel(val) !== filters.tenureGroup) continue;
    }

    if (filters.paymentMethod && filters.paymentMethod !== 'ALL' && validPaymentCol) {
      const raw = row[validPaymentCol];
      const label = isMissingValue(raw) ? 'Missing' : raw.trim();
      if (label !== filters.paymentMethod) continue;
    }

    filteredRows.push({ row, churned });
  }

  const totalCustomers = filteredRows.length;
  let churnedCount = 0;
  let stayedCount = 0;
  for (const item of filteredRows) {
    if (isUnlabeledColdStart) {
      stayedCount++;
    } else if (item.churned) {
      churnedCount++;
    } else {
      stayedCount++;
    }
  }

  const churnRate =
    !isUnlabeledColdStart && totalCustomers > 0
      ? Number(((churnedCount / totalCustomers) * 100).toFixed(1))
      : 0;
  const churnedPercentage = churnRate;
  const stayedPercentage =
    !isUnlabeledColdStart && totalCustomers > 0
      ? Number(((stayedCount / totalCustomers) * 100).toFixed(1))
      : 0;

  // Helper to compute CategoryChurnStat[] for a categorical column
  const computeCategoryStats = (
    colName: string,
    formatValue?: (val: string) => string
  ): CategoryChurnStat[] => {
    const map = new Map<string, { total: number; churned: number; stayed: number }>();
    for (const { row, churned } of filteredRows) {
      const raw = row[colName];
      let label = isMissingValue(raw) ? 'Missing' : raw.trim();
      if (label !== 'Missing' && formatValue) {
        label = formatValue(label);
      }
      const entry = map.get(label) || { total: 0, churned: 0, stayed: 0 };
      entry.total++;
      if (churned) entry.churned++;
      else entry.stayed++;
      map.set(label, entry);
    }

    return Array.from(map.entries())
      .map(([category, counts]) => ({
        category,
        total: counts.total,
        churned: counts.churned,
        stayed: counts.stayed,
        churnRate:
          counts.total > 0 ? Number(((counts.churned / counts.total) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  };

  // Contract stats (only if mapped)
  const contractStats =
    hasContractCol && mapping.contractColumn
      ? computeCategoryStats(mapping.contractColumn)
      : null;

  // Tenure stats (6 required groups: 0-12, 13-24, 25-36, 37-48, 49-60, 61-72)
  let tenureStats: CategoryChurnStat[] | null = null;
  if (hasTenureCol && mapping.tenureColumn) {
    const activeBins = [...TENURE_BINS];
    let hasOver72 = false;
    for (const { row } of filteredRows) {
      const raw = row[mapping.tenureColumn];
      const val = Number(raw);
      if (!isMissingValue(raw) && !Number.isNaN(val) && Number.isFinite(val) && val > 72) {
        hasOver72 = true;
        break;
      }
    }
    if (hasOver72) {
      activeBins.push({ label: '73+ mo', min: 72, max: Infinity });
    }

    const binCounts = activeBins.map((b) => ({
      category: b.label,
      total: 0,
      churned: 0,
      stayed: 0,
    }));

    let validTenureRows = 0;
    for (const { row, churned } of filteredRows) {
      const raw = row[mapping.tenureColumn];
      const val = Number(raw);
      if (isMissingValue(raw) || Number.isNaN(val) || !Number.isFinite(val)) continue;
      validTenureRows++;
      const idx = activeBins.findIndex((b) => val > b.min && val <= b.max);
      const targetBin = idx >= 0 ? binCounts[idx] : binCounts[0];
      targetBin.total++;
      if (churned) targetBin.churned++;
      else targetBin.stayed++;
    }

    if (validTenureRows > 0) {
      tenureStats = binCounts.map((b) => ({
        ...b,
        churnRate: b.total > 0 ? Number(((b.churned / b.total) * 100).toFixed(1)) : 0,
      }));
    }
  }

  // Monthly charges stats & average comparison (only if mapped & numeric)
  let monthlyChargesStats: CategoryChurnStat[] | null = null;
  let monthlyChargesComparison: MonthlyChargesComparison | null = null;
  if (hasMonthlyCol && mapping.monthlyChargesColumn) {
    const numericVals: number[] = [];
    let sumAll = 0;
    let countAll = 0;
    let sumStayed = 0;
    let countStayed = 0;
    let sumChurned = 0;
    let countChurned = 0;

    for (const { row, churned } of filteredRows) {
      const raw = row[mapping.monthlyChargesColumn];
      const v = Number(raw);
      if (isMissingValue(raw) || Number.isNaN(v) || !Number.isFinite(v)) continue;
      numericVals.push(v);
      sumAll += v;
      countAll++;
      if (churned) {
        sumChurned += v;
        countChurned++;
      } else {
        sumStayed += v;
        countStayed++;
      }
    }

    if (countAll > 0) {
      monthlyChargesComparison = {
        columnName: mapping.monthlyChargesColumn,
        overallAvg: Number((sumAll / countAll).toFixed(2)),
        stayedAvg: countStayed > 0 ? Number((sumStayed / countStayed).toFixed(2)) : 0,
        churnedAvg: countChurned > 0 ? Number((sumChurned / countChurned).toFixed(2)) : 0,
        stayedCount: countStayed,
        churnedCount: countChurned,
      };
    }

    if (numericVals.length >= 4) {
      numericVals.sort((a, b) => a - b);
      const q1 = Math.round(numericVals[Math.floor(numericVals.length * 0.25)]);
      const q2 = Math.round(numericVals[Math.floor(numericVals.length * 0.5)]);
      const q3 = Math.round(numericVals[Math.floor(numericVals.length * 0.75)]);

      const brackets = [
        { label: `≤ $${q1}`, min: -Infinity, max: q1 },
        { label: `$${q1 + 1}–$${q2}`, min: q1, max: q2 },
        { label: `$${q2 + 1}–$${q3}`, min: q2, max: q3 },
        { label: `> $${q3}`, min: q3, max: Infinity },
      ];

      const bracketCounts = brackets.map((b) => ({
        category: b.label,
        total: 0,
        churned: 0,
        stayed: 0,
      }));

      for (const { row, churned } of filteredRows) {
        const raw = row[mapping.monthlyChargesColumn];
        const val = Number(raw);
        if (isMissingValue(raw) || Number.isNaN(val) || !Number.isFinite(val)) continue;
        const idx = brackets.findIndex((b) => val > b.min && val <= b.max);
        const targetBracket = idx >= 0 ? bracketCounts[idx] : bracketCounts[0];
        targetBracket.total++;
        if (churned) targetBracket.churned++;
        else targetBracket.stayed++;
      }

      monthlyChargesStats = bracketCounts.map((b) => ({
        ...b,
        churnRate: b.total > 0 ? Number(((b.churned / b.total) * 100).toFixed(1)) : 0,
      }));
    }
  }

  // Payment method stats
  const paymentMethodStats = validPaymentCol ? computeCategoryStats(validPaymentCol) : null;

  // Numeric comparisons (Churn vs Non-Churn averages)
  const numericComparisons: NumericComparisonStat[] = [];
  for (const col of columns) {
    if (col.dataType !== 'numeric' || col.name === mapping.targetColumn) continue;
    let sumAll = 0;
    let countAll = 0;
    let sumChurn = 0;
    let countChurn = 0;
    let sumStay = 0;
    let countStay = 0;

    for (const { row, churned } of filteredRows) {
      const raw = row[col.name];
      const val = Number(raw);
      if (isMissingValue(raw) || Number.isNaN(val) || !Number.isFinite(val)) continue;
      sumAll += val;
      countAll++;
      if (churned) {
        sumChurn += val;
        countChurn++;
      } else {
        sumStay += val;
        countStay++;
      }
    }

    if (countAll > 0) {
      numericComparisons.push({
        column: col.name,
        overallAvg: Number((sumAll / countAll).toFixed(2)),
        churnedAvg: countChurn > 0 ? Number((sumChurn / countChurn).toFixed(2)) : 0,
        stayedAvg: countStay > 0 ? Number((sumStay / countStay).toFixed(2)) : 0,
      });
    }
  }

  // Categorical breakdowns for interactive explorer
  const categoricalBreakdowns: Record<string, CategoryChurnStat[]> = {};
  for (const col of columns) {
    if (
      col.dataType === 'categorical' &&
      col.name !== mapping.targetColumn &&
      col.uniqueCount >= 2 &&
      col.uniqueCount <= 12
    ) {
      categoricalBreakdowns[col.name] = computeCategoryStats(col.name);
    }
  }

  // Additional domain visualisations (only created when matching column exists in dataset)
  const additionalSpecs: {
    key: AdditionalChartKey;
    title: string;
    candidates: string[];
    formatValue?: (v: string) => string;
  }[] = [
    {
      key: 'internetService',
      title: 'Churn by Internet Service',
      candidates: ['internetservice', 'internet_service', 'internet'],
    },
    {
      key: 'gender',
      title: 'Churn by Gender',
      candidates: ['gender', 'sex'],
    },
    {
      key: 'seniorCitizen',
      title: 'Churn by Senior Citizen Status',
      candidates: ['seniorcitizen', 'senior_citizen', 'is_senior', 'senior'],
      formatValue: (v: string) => {
        if (v === '1') return 'Yes (1)';
        if (v === '0') return 'No (0)';
        return v;
      },
    },
    {
      key: 'onlineSecurity',
      title: 'Churn by Online Security',
      candidates: ['onlinesecurity', 'online_security', 'security'],
    },
    {
      key: 'techSupport',
      title: 'Churn by Tech Support',
      candidates: ['techsupport', 'tech_support', 'support'],
    },
    {
      key: 'dependents',
      title: 'Churn by Dependents',
      candidates: ['dependents', 'has_dependents'],
    },
  ];

  const additionalCharts: AdditionalChartBreakdown[] = [];
  for (const spec of additionalSpecs) {
    const matchedCol = findMatchingColumn(headers, spec.candidates);
    if (!matchedCol || matchedCol === mapping.targetColumn) continue;
    const stats = computeCategoryStats(matchedCol, spec.formatValue);
    if (stats.length > 0) {
      additionalCharts.push({
        key: spec.key,
        title: spec.title,
        columnName: matchedCol,
        stats,
      });
    }
  }

  // Frequency / engagement metric comparison if mapped & numeric
  let frequencyComparison: MonthlyChargesComparison | null = null;
  if (mapping.frequencyColumn && columns.some((c) => c.name === mapping.frequencyColumn)) {
    let sumAll = 0;
    let countAll = 0;
    let sumStayed = 0;
    let countStayed = 0;
    let sumChurned = 0;
    let countChurned = 0;
    for (const { row, churned } of filteredRows) {
      const raw = row[mapping.frequencyColumn];
      const v = Number(raw);
      if (isMissingValue(raw) || Number.isNaN(v) || !Number.isFinite(v)) continue;
      sumAll += v;
      countAll++;
      if (churned) {
        sumChurned += v;
        countChurned++;
      } else {
        sumStayed += v;
        countStayed++;
      }
    }
    if (countAll > 0) {
      frequencyComparison = {
        columnName: mapping.frequencyColumn,
        overallAvg: Number((sumAll / countAll).toFixed(2)),
        stayedAvg: countStayed > 0 ? Number((sumStayed / countStayed).toFixed(2)) : 0,
        churnedAvg: countChurned > 0 ? Number((sumChurned / countChurned).toFixed(2)) : 0,
        stayedCount: countStayed,
        churnedCount: countChurned,
      };
    }
  }

  const calculationExplanation = isUnlabeledColdStart
    ? `Cold-Start / Active Customer Monitoring: ${totalCustomers.toLocaleString()} active accounts profiled. Historical churn rate and predictive risk scores remain withheld until both churned and retained outcomes are observed or uploaded.`
    : formatChurnCalculationExplanation(churnDefinition, churnedCount, totalCustomers);

  const behaviourMonitoring = computeBehaviourMonitoring(
    columns,
    filteredRows.map((f) => f.row),
    mapping,
    churnDefinition,
    !isUnlabeledColdStart
  );

  return {
    totalCustomers,
    churnedCount,
    stayedCount,
    churnRate,
    stayedPercentage,
    churnedPercentage,
    isUnlabeledColdStart,
    calculationExplanation,
    behaviourMonitoring,
    contractStats,
    tenureStats,
    monthlyChargesStats,
    monthlyChargesComparison,
    frequencyComparison,
    paymentMethodColumn: validPaymentCol,
    paymentMethodStats,
    numericComparisons,
    categoricalBreakdowns,
    additionalCharts,
    filterOptions,
    appliedFilters: filters,
  };
}

// Deterministic shuffle for reproducible train/test split
function seededShuffle<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  let s = seed >>> 0;
  for (let i = copy.length - 1; i > 0; i--) {
    s = (1664525 * s + 1013904223) >>> 0;
    const j = s % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function encodeRow(row: Record<string, string>, features: FeatureMeta[]): number[] {
  const vec: number[] = [];
  for (const feat of features) {
    const raw = row[feat.column];
    if (feat.kind === 'numeric') {
      const parsed = isMissingValue(raw) ? feat.median : Number(raw);
      const val = Number.isNaN(parsed) || !Number.isFinite(parsed) ? feat.median : parsed;
      vec.push(feat.std > 0 ? (val - feat.mean) / feat.std : 0);
    } else {
      const val = isMissingValue(raw) ? feat.mode : raw.trim();
      for (const cat of feat.categories) {
        vec.push(val === cat ? 1 : 0);
      }
    }
  }
  return vec;
}

function sigmoid(z: number): number {
  if (z > 35) return 1 - 1e-15;
  if (z < -35) return 1e-15;
  return 1 / (1 + Math.exp(-z));
}

function trainLogisticRegression(
  X: number[][],
  y: number[],
  featureNames: string[]
): {
  weights: number[];
  bias: number;
  predictProb: (x: number[]) => number;
  importances: FeatureImportance[];
} {
  const n = X.length;
  const d = X[0]?.length || 0;
  const weights = new Array<number>(d).fill(0);
  let bias = 0;

  const lr = 0.2;
  const lambda = 0.01;
  const epochs = 700;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array<number>(d).fill(0);
    let gradB = 0;

    for (let i = 0; i < n; i++) {
      let z = bias;
      const xi = X[i];
      for (let j = 0; j < d; j++) {
        z += weights[j] * xi[j];
      }
      const pred = sigmoid(z);
      const err = pred - y[i];
      gradB += err;
      for (let j = 0; j < d; j++) {
        gradW[j] += err * xi[j];
      }
    }

    bias -= (lr * gradB) / n;
    for (let j = 0; j < d; j++) {
      weights[j] -= lr * (gradW[j] / n + lambda * weights[j]);
    }
  }

  const predictProb = (x: number[]): number => {
    let z = bias;
    for (let j = 0; j < d; j++) {
      z += weights[j] * x[j];
    }
    return sigmoid(z);
  };

  const sumAbsWeight = Math.max(
    1e-9,
    weights.reduce((acc, w) => acc + Math.abs(w), 0)
  );
  const importances: FeatureImportance[] = weights
    .map((w, idx) => ({
      feature: featureNames[idx],
      importance: Number(((Math.abs(w) / sumAbsWeight) * 100).toFixed(1)),
      coefficient: Number(w.toFixed(3)),
      direction: (w >= 0 ? 'increases_churn' : 'decreases_churn') as
        | 'increases_churn'
        | 'decreases_churn',
    }))
    .sort((a, b) => Math.abs(b.coefficient || 0) - Math.abs(a.coefficient || 0))
    .slice(0, 10);

  return { weights, bias, predictProb, importances };
}

function giniImpurity(posCount: number, totalCount: number): number {
  if (totalCount === 0) return 0;
  const p = posCount / totalCount;
  return 1 - (p * p + (1 - p) * (1 - p));
}

function walkDecisionTree(node: DecisionTreeNode, x: number[]): number {
  if (node.isLeaf || node.featureIndex === undefined || node.threshold === undefined) {
    return node.churnProbability;
  }
  if (x[node.featureIndex] <= node.threshold) {
    return node.left ? walkDecisionTree(node.left, x) : node.churnProbability;
  }
  return node.right ? walkDecisionTree(node.right, x) : node.churnProbability;
}

function trainDecisionTree(
  X: number[][],
  y: number[],
  featureNames: string[],
  maxDepth = 4,
  sampleIndices?: number[],
  featureSubsampleSize?: number,
  seed = 101
): {
  tree: DecisionTreeNode;
  predictProb: (x: number[]) => number;
  importances: FeatureImportance[];
  rawGains: number[];
} {
  const d = X[0]?.length || 0;
  const featureGiniGain = new Array<number>(d).fill(0);
  const minSamplesSplit = 6;
  const minSamplesLeaf = 2;
  let rngState = seed >>> 0;
  const nextRand = () => {
    rngState = (1664525 * rngState + 1013904223) >>> 0;
    return rngState / 4294967296;
  };

  function pickCandidateFeatures(): number[] {
    const all = Array.from({ length: d }, (_, idx) => idx);
    if (!featureSubsampleSize || featureSubsampleSize >= d) return all;
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(nextRand() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, featureSubsampleSize);
  }

  function buildNode(indices: number[], depth: number): DecisionTreeNode {
    const total = indices.length;
    let pos = 0;
    for (const idx of indices) {
      if (y[idx] === 1) pos++;
    }
    const prob = total > 0 ? pos / total : 0;

    if (depth >= maxDepth || total < minSamplesSplit || pos === 0 || pos === total) {
      return { isLeaf: true, churnProbability: prob };
    }

    const parentGini = giniImpurity(pos, total);
    let bestGain = 0;
    let bestFeature = -1;
    let bestThreshold = 0;
    let bestLeft: number[] = [];
    let bestRight: number[] = [];

    const candidateFeatures = pickCandidateFeatures();

    for (const f of candidateFeatures) {
      const vals = Array.from(new Set(indices.map((idx) => X[idx][f]))).sort((a, b) => a - b);
      if (vals.length < 2) continue;

      const step = Math.max(1, Math.floor(vals.length / 16));
      for (let t = 0; t < vals.length - 1; t += step) {
        const threshold = (vals[t] + vals[t + 1]) / 2;
        const left: number[] = [];
        const right: number[] = [];
        let leftPos = 0;
        let rightPos = 0;

        for (const idx of indices) {
          if (X[idx][f] <= threshold) {
            left.push(idx);
            if (y[idx] === 1) leftPos++;
          } else {
            right.push(idx);
            if (y[idx] === 1) rightPos++;
          }
        }

        if (left.length < minSamplesLeaf || right.length < minSamplesLeaf) continue;

        const weightedGini =
          (left.length / total) * giniImpurity(leftPos, left.length) +
          (right.length / total) * giniImpurity(rightPos, right.length);
        const gain = parentGini - weightedGini;

        if (gain > bestGain) {
          bestGain = gain;
          bestFeature = f;
          bestThreshold = threshold;
          bestLeft = left;
          bestRight = right;
        }
      }
    }

    if (bestFeature === -1 || bestGain <= 1e-6) {
      return { isLeaf: true, churnProbability: prob };
    }

    featureGiniGain[bestFeature] += bestGain * total;

    return {
      isLeaf: false,
      churnProbability: prob,
      featureIndex: bestFeature,
      threshold: bestThreshold,
      left: buildNode(bestLeft, depth + 1),
      right: buildNode(bestRight, depth + 1),
    };
  }

  const allIndices = sampleIndices ?? X.map((_, idx) => idx);
  const tree = buildNode(allIndices, 0);

  const predictProb = (x: number[]): number => walkDecisionTree(tree, x);

  const sumGain = Math.max(
    1e-9,
    featureGiniGain.reduce((acc, g) => acc + g, 0)
  );
  const importances: FeatureImportance[] = featureGiniGain
    .map((gain, idx) => ({
      feature: featureNames[idx],
      importance: Number(((gain / sumGain) * 100).toFixed(1)),
      direction: 'non_linear' as const,
    }))
    .filter((item) => item.importance > 0)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 10);

  return { tree, predictProb, importances, rawGains: featureGiniGain };
}

function trainRandomForest(
  X: number[][],
  y: number[],
  featureNames: string[],
  nEstimators = 25,
  maxDepth = 5
): {
  forest: DecisionTreeNode[];
  predictProb: (x: number[]) => number;
  importances: FeatureImportance[];
} {
  const n = X.length;
  const d = X[0]?.length || 0;
  const featureSubsample = Math.max(1, Math.round(Math.sqrt(d)));
  const totalGains = new Array<number>(d).fill(0);
  const forest: DecisionTreeNode[] = [];

  let rngState = 20261114;
  const nextRand = () => {
    rngState = (1664525 * rngState + 1013904223) >>> 0;
    return rngState / 4294967296;
  };

  for (let t = 0; t < nEstimators; t++) {
    const bootIndices: number[] = [];
    for (let i = 0; i < n; i++) {
      bootIndices.push(Math.floor(nextRand() * n));
    }
    const built = trainDecisionTree(
      X,
      y,
      featureNames,
      maxDepth,
      bootIndices,
      featureSubsample,
      300 + t * 17
    );
    forest.push(built.tree);
    for (let j = 0; j < d; j++) {
      totalGains[j] += built.rawGains[j];
    }
  }

  const predictProb = (x: number[]): number => {
    if (forest.length === 0) return 0.5;
    let sum = 0;
    for (const tree of forest) {
      sum += walkDecisionTree(tree, x);
    }
    return sum / forest.length;
  };

  const sumGain = Math.max(
    1e-9,
    totalGains.reduce((acc, g) => acc + g, 0)
  );
  const importances: FeatureImportance[] = totalGains
    .map((gain, idx) => ({
      feature: featureNames[idx],
      importance: Number(((gain / sumGain) * 100).toFixed(1)),
      direction: 'non_linear' as const,
    }))
    .filter((item) => item.importance > 0)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 10);

  return { forest, predictProb, importances };
}

export function classifyRisk(prob: number): RiskCategory {
  if (prob < 0.35) return 'Low Estimated Churn Risk';
  if (prob < 0.65) return 'Moderate Estimated Churn Risk';
  return 'Higher Estimated Churn Risk';
}

export function trainAndEvaluateModel(
  dataset: StoredDataset,
  request: TrainModelRequest,
  versionNumber = 1
): TrainedModelArtifact {
  const { columns, mapping } = dataset.state;
  const validRows: { rowIndex: number; row: Record<string, string>; label: number }[] = [];

  dataset.rows.forEach((row, idx) => {
    const churned = isRowChurned(row, mapping);
    if (churned !== null) {
      validRows.push({
        rowIndex: idx + 1,
        row,
        label: churned ? 1 : 0,
      });
    }
  });

  const posCountTotal = validRows.filter((r) => r.label === 1).length;
  const negCountTotal = validRows.length - posCountTotal;
  if (posCountTotal === 0 || negCountTotal === 0) {
    throw new Error(
      'Dataset contains only a single class. Supervised classification requires both churned and retained historical examples.'
    );
  }

  const minorityTotal = Math.min(posCountTotal, negCountTotal);
  if (minorityTotal < 4) {
    throw new Error(
      `Minority outcome class has only ${minorityTotal} record(s). At least 4 records in both churned and retained classes are needed to construct training and unseen evaluation folds.`
    );
  }

  const usableFeatureCount = mapping.featureColumns.filter((colName) => {
    const c = columns.find((col) => col.name === colName);
    return c && (c.dataType === 'numeric' || c.dataType === 'categorical') && !looksLikeLeakageColumn(colName);
  }).length;
  const minSampleFloor = Math.max(8, usableFeatureCount + 4);
  if (validRows.length < minSampleFloor) {
    throw new Error(
      `Dataset has ${validRows.length} labeled records across ${usableFeatureCount} mapped feature(s). At least ${minSampleFloor} labeled records are needed for statistical train/test validation.`
    );
  }

  const splitRatio = Math.min(0.4, Math.max(0.1, request.testSplitRatio || 0.2));
  const requestedStrategy: SplitStrategy =
    request.splitStrategy === 'chronological' ? 'chronological' : 'stratified';

  let splitStrategyUsed: SplitStrategy = 'stratified';
  let dateColumnUsed: string | null = null;
  let trainItems: { rowIndex: number; row: Record<string, string>; label: number }[] = [];
  let testItems: { rowIndex: number; row: Record<string, string>; label: number }[] = [];

  if (requestedStrategy === 'chronological' && mapping.dateColumn) {
    const dated = validRows
      .map((item) => ({
        item,
        ts: isLikelyDateString(item.row[mapping.dateColumn!] || '')
          ? Date.parse(item.row[mapping.dateColumn!] || '')
          : NaN,
      }))
      .filter((d) => !Number.isNaN(d.ts));

    if (dated.length >= Math.max(8, Math.floor(validRows.length * 0.7))) {
      dated.sort((a, b) => a.ts - b.ts);
      const splitIdx = Math.max(
        6,
        Math.min(dated.length - 2, Math.floor(dated.length * (1 - splitRatio)))
      );
      const candidateTrain = dated.slice(0, splitIdx).map((d) => d.item);
      const candidateTest = dated.slice(splitIdx).map((d) => d.item);
      const trainBoth =
        candidateTrain.some((x) => x.label === 1) && candidateTrain.some((x) => x.label === 0);
      const testBoth =
        candidateTest.some((x) => x.label === 1) && candidateTest.some((x) => x.label === 0);
      if (trainBoth && testBoth) {
        trainItems = candidateTrain;
        testItems = candidateTest;
        splitStrategyUsed = 'chronological';
        dateColumnUsed = mapping.dateColumn;
      }
    }
  }

  if (splitStrategyUsed !== 'chronological') {
    const positives = seededShuffle(
      validRows.filter((r) => r.label === 1),
      42
    );
    const negatives = seededShuffle(
      validRows.filter((r) => r.label === 0),
      43
    );

    const posTestCount = Math.max(1, Math.round(positives.length * splitRatio));
    const negTestCount = Math.max(1, Math.round(negatives.length * splitRatio));

    testItems = seededShuffle(
      [...positives.slice(0, posTestCount), ...negatives.slice(0, negTestCount)],
      44
    );
    trainItems = seededShuffle(
      [...positives.slice(posTestCount), ...negatives.slice(negTestCount)],
      45
    );
  }

  const testCount = testItems.length;
  const trainCount = trainItems.length;

  // Target leakage check on selected features
  const leakageWarnings: string[] = [];
  for (const colName of mapping.featureColumns) {
    if (looksLikeLeakageColumn(colName)) {
      leakageWarnings.push(
        `Feature "${colName}" matches a post-outcome / cancellation column pattern and may cause target leakage.`
      );
    }
    let exactMatch = 0;
    let inverseMatch = 0;
    for (const item of validRows) {
      const raw = (item.row[colName] || '').trim();
      const positive = raw === mapping.positiveClassValue ? 1 : 0;
      if (positive === item.label) exactMatch++;
      else inverseMatch++;
    }
    const maxAgreement = Math.max(exactMatch, inverseMatch) / validRows.length;
    if (maxAgreement >= 0.98) {
      leakageWarnings.push(
        `Feature "${colName}" exhibits ${(maxAgreement * 100).toFixed(1)}% direct agreement with target "${mapping.targetColumn}", indicating potential target leakage.`
      );
    }
  }

  // Fit preprocessing strictly on trainItems
  const features: FeatureMeta[] = [];
  const encodedFeatureNames: string[] = [];

  for (const colName of mapping.featureColumns) {
    const colProfile = columns.find((c) => c.name === colName);
    if (!colProfile || colProfile.dataType === 'identifier' || colProfile.dataType === 'date') {
      continue;
    }

    if (colProfile.dataType === 'numeric') {
      const nums: number[] = [];
      for (const item of trainItems) {
        const v = Number(item.row[colName]);
        if (!isMissingValue(item.row[colName]) && !Number.isNaN(v) && Number.isFinite(v)) {
          nums.push(v);
        }
      }
      nums.sort((a, b) => a - b);
      const median = nums.length > 0 ? nums[Math.floor(nums.length / 2)] : 0;

      const imputed = trainItems.map((item) => {
        const v = Number(item.row[colName]);
        return !isMissingValue(item.row[colName]) && !Number.isNaN(v) && Number.isFinite(v)
          ? v
          : median;
      });
      const mean = imputed.reduce((acc, v) => acc + v, 0) / imputed.length;
      const variance =
        imputed.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / imputed.length;
      const std = Math.sqrt(variance) || 1;

      features.push({ kind: 'numeric', column: colName, median, mean, std });
      encodedFeatureNames.push(colName);
    } else {
      const counts = new Map<string, number>();
      for (const item of trainItems) {
        const raw = item.row[colName];
        if (!isMissingValue(raw)) {
          const val = raw.trim();
          counts.set(val, (counts.get(val) || 0) + 1);
        }
      }
      const sortedCats = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([cat]) => cat);

      const mode = sortedCats[0] || 'Unknown';
      const topCats = sortedCats.slice(0, 12);

      features.push({ kind: 'categorical', column: colName, mode, categories: topCats });
      for (const cat of topCats) {
        encodedFeatureNames.push(`${colName} = ${cat}`);
      }
    }
  }

  if (features.length === 0) {
    throw new Error('No usable numeric or categorical feature columns are mapped for training.');
  }

  const XTrain = trainItems.map((item) => encodeRow(item.row, features));
  const yTrain = trainItems.map((item) => item.label);

  const XTest = testItems.map((item) => encodeRow(item.row, features));
  const yTest = testItems.map((item) => item.label);

  let predictProb: (x: number[]) => number;
  let importances: FeatureImportance[] = [];
  let weights: number[] | undefined;
  let bias: number | undefined;
  let tree: DecisionTreeNode | undefined;
  let forest: DecisionTreeNode[] | undefined;

  const modelType: MLModelType =
    request.modelType === 'decision_tree'
      ? 'decision_tree'
      : request.modelType === 'random_forest'
        ? 'random_forest'
        : 'logistic_regression';

  if (modelType === 'decision_tree') {
    const maxDepth = Math.min(8, Math.max(2, request.maxDepth || 4));
    const dt = trainDecisionTree(XTrain, yTrain, encodedFeatureNames, maxDepth);
    predictProb = dt.predictProb;
    importances = dt.importances;
    tree = dt.tree;
  } else if (modelType === 'random_forest') {
    const nEstimators = Math.min(40, Math.max(10, request.nEstimators || 25));
    const maxDepth = Math.min(8, Math.max(3, request.maxDepth || 5));
    const rf = trainRandomForest(XTrain, yTrain, encodedFeatureNames, nEstimators, maxDepth);
    predictProb = rf.predictProb;
    importances = rf.importances;
    forest = rf.forest;
  } else {
    const lr = trainLogisticRegression(XTrain, yTrain, encodedFeatureNames);
    predictProb = lr.predictProb;
    importances = lr.importances;
    weights = lr.weights;
    bias = lr.bias;
  }

  // Evaluate on held-out Test Set
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  let testPositives = 0;

  for (let i = 0; i < XTest.length; i++) {
    const prob = predictProb(XTest[i]);
    const pred = prob >= 0.5 ? 1 : 0;
    const actual = yTest[i];
    if (actual === 1) testPositives++;

    if (actual === 1 && pred === 1) tp++;
    else if (actual === 0 && pred === 0) tn++;
    else if (actual === 0 && pred === 1) fp++;
    else if (actual === 1 && pred === 0) fn++;
  }

  const confusionMatrix: ConfusionMatrix = { tp, tn, fp, fn };
  const rawAccuracy = testCount > 0 ? (tp + tn) / testCount : 0;
  const rawPrecision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const rawRecall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const rawF1 =
    rawPrecision + rawRecall > 0
      ? (2 * rawPrecision * rawRecall) / (rawPrecision + rawRecall)
      : 0;

  const accuracy = Number((rawAccuracy * 100).toFixed(1));
  const precision = Number((rawPrecision * 100).toFixed(1));
  const recall = Number((rawRecall * 100).toFixed(1));
  const f1Score = Number((rawF1 * 100).toFixed(1));

  const testChurnRate = Number(((testPositives / Math.max(1, testCount)) * 100).toFixed(1));

  // Majority-class baseline determined strictly from training set, evaluated on test set
  const trainPositives = yTrain.reduce((acc, v) => acc + v, 0);
  const trainMajorityClass = trainPositives >= trainCount - trainPositives ? 1 : 0;
  let baseTp = 0;
  let baseTn = 0;
  let baseFp = 0;
  let baseFn = 0;
  for (const actual of yTest) {
    if (actual === 1 && trainMajorityClass === 1) baseTp++;
    else if (actual === 0 && trainMajorityClass === 0) baseTn++;
    else if (actual === 0 && trainMajorityClass === 1) baseFp++;
    else if (actual === 1 && trainMajorityClass === 0) baseFn++;
  }
  const baseRawAcc = testCount > 0 ? (baseTp + baseTn) / testCount : 0;
  const baseRawPrec = baseTp + baseFp > 0 ? baseTp / (baseTp + baseFp) : 0;
  const baseRawRec = baseTp + baseFn > 0 ? baseTp / (baseTp + baseFn) : 0;
  const baseRawF1 =
    baseRawPrec + baseRawRec > 0
      ? (2 * baseRawPrec * baseRawRec) / (baseRawPrec + baseRawRec)
      : 0;

  const majorityBaselineAccuracy = Number((baseRawAcc * 100).toFixed(1));
  const baselineMetrics = {
    majorityClassLabel: (trainMajorityClass === 1 ? 'Churned' : 'Stayed') as
      | 'Churned'
      | 'Stayed',
    accuracy: majorityBaselineAccuracy,
    precision: Number((baseRawPrec * 100).toFixed(1)),
    recall: Number((baseRawRec * 100).toFixed(1)),
    f1Score: Number((baseRawF1 * 100).toFixed(1)),
  };

  const testRowIndices = new Set(testItems.map((t) => t.rowIndex));

  const predictions: CustomerPrediction[] = validRows.map((item) => {
    const x = encodeRow(item.row, features);
    const prob = Number(predictProb(x).toFixed(4));
    const customerId =
      mapping.idColumn && item.row[mapping.idColumn]
        ? item.row[mapping.idColumn]
        : `CUST-${String(item.rowIndex).padStart(4, '0')}`;

    return {
      rowIndex: item.rowIndex,
      customerId,
      split: testRowIndices.has(item.rowIndex) ? 'Unseen Test' : 'Training',
      actualChurn: item.label === 1 ? 'Churned' : 'Stayed',
      predictedChurn: prob >= 0.5 ? 'Likely to Churn' : 'Likely to Stay',
      churnProbability: prob,
      riskCategory: classifyRisk(prob),
      attributes: item.row,
    };
  });

  const modelName =
    modelType === 'decision_tree'
      ? `Decision Tree Classifier (Max Depth ${request.maxDepth || 4})`
      : modelType === 'random_forest'
        ? `Random Forest Ensemble (${request.nEstimators || 25} Trees)`
        : 'Logistic Regression (L2 Regularized)';

  const evaluation: ModelEvaluationResult = {
    modelId: `model_${Date.now()}`,
    version: `v${versionNumber}`,
    modelType,
    modelName,
    trainedAt: new Date().toISOString(),
    datasetId: dataset.state.datasetId,
    datasetSize: validRows.length,
    splitStrategy: splitStrategyUsed,
    dateColumnUsed,
    leakageWarnings,
    trainCount,
    testCount,
    testSplitRatio: splitRatio,
    accuracy,
    precision,
    recall,
    f1Score,
    majorityBaselineAccuracy,
    baselineMetrics,
    testChurnRate,
    confusionMatrix,
    featureImportances: importances,
    predictions,
  };

  return {
    evaluation,
    mapping,
    features,
    encodedFeatureNames,
    modelType,
    weights,
    bias,
    tree,
    forest,
  };
}

export function scoreArtifactVector(artifact: TrainedModelArtifact, x: number[]): number {
  if (artifact.modelType === 'random_forest' && artifact.forest && artifact.forest.length > 0) {
    let sum = 0;
    for (const tree of artifact.forest) {
      sum += walkDecisionTree(tree, x);
    }
    return sum / artifact.forest.length;
  }
  if (artifact.modelType === 'decision_tree' && artifact.tree) {
    return walkDecisionTree(artifact.tree, x);
  }
  if (artifact.weights && artifact.bias !== undefined) {
    let z = artifact.bias;
    for (let j = 0; j < artifact.weights.length; j++) {
      z += artifact.weights[j] * x[j];
    }
    return sigmoid(z);
  }
  return 0.5;
}

export function predictSingleCustomer(
  artifact: TrainedModelArtifact,
  attributes: Record<string, string>
): {
  churnProbability: number;
  predictedChurn: 'Likely to Churn' | 'Likely to Stay';
  riskCategory: RiskCategory;
} {
  const x = encodeRow(attributes, artifact.features);
  const prob = scoreArtifactVector(artifact, x);
  const rounded = Number(prob.toFixed(4));
  return {
    churnProbability: rounded,
    predictedChurn: rounded >= 0.5 ? 'Likely to Churn' : 'Likely to Stay',
    riskCategory: classifyRisk(rounded),
  };
}

export function scoreBatchRecords(
  artifact: TrainedModelArtifact,
  fileName: string,
  rows: Record<string, string>[]
): BatchScoreResult {
  let highRiskCount = 0;
  let moderateRiskCount = 0;
  let lowRiskCount = 0;
  let sumProb = 0;

  const records: BatchScoredRecord[] = rows.map((row, idx) => {
    const x = encodeRow(row, artifact.features);
    const prob = Number(scoreArtifactVector(artifact, x).toFixed(4));
    const riskCategory = classifyRisk(prob);
    if (riskCategory === 'Higher Estimated Churn Risk') highRiskCount++;
    else if (riskCategory === 'Moderate Estimated Churn Risk') moderateRiskCount++;
    else lowRiskCount++;
    sumProb += prob;

    const customerId =
      artifact.mapping.idColumn && row[artifact.mapping.idColumn]
        ? row[artifact.mapping.idColumn]
        : `BATCH-${String(idx + 1).padStart(4, '0')}`;

    return {
      rowIndex: idx + 1,
      customerId,
      predictedChurn: prob >= 0.5 ? 'Likely to Churn' : 'Likely to Stay',
      churnProbability: prob,
      riskCategory,
      attributes: row,
    };
  });

  return {
    batchId: `batch_${Date.now()}`,
    fileName,
    scoredAt: new Date().toISOString(),
    modelId: artifact.evaluation.modelId,
    modelName: artifact.evaluation.modelName,
    modelVersion: artifact.evaluation.version || 'v1',
    totalRows: records.length,
    highRiskCount,
    moderateRiskCount,
    lowRiskCount,
    averageProbability: records.length > 0 ? Number(((sumProb / records.length) * 100).toFixed(1)) : 0,
    records,
  };
}
