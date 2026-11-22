import type {
  ActiveCustomerRiskSummary,
  ActiveProbabilityBucket,
  ChurnDefinition,
  ColumnMapping,
  ColumnProfile,
  CustomerActualStatus,
  CustomerPrediction,
  HistoricalChurnPerformance,
  HistoricalPeriodPoint,
  InconsistentCustomerRecord,
  PredictedRiskLabel,
  ReportingPeriod,
  RiskCategory,
} from '../src/types/churn.ts';

const STATUS_MISSING_TOKENS = new Set([
  '',
  'null',
  'na',
  'n/a',
  'nan',
  'none',
  'undefined',
  '?',
  '-',
  '—',
]);

function isMissingCell(val: string | undefined): boolean {
  if (val === undefined || val === null) return true;
  return STATUS_MISSING_TOKENS.has(val.trim().toLowerCase());
}

function parseDateTimestamp(raw: string | undefined): { isoDate: string; ts: number } | null {
  if (isMissingCell(raw)) return null;
  const trimmed = String(raw).trim();
  // Require at least year/month/day structure so random numbers don't parse as dates
  if (!/(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/.test(trimmed)) {
    return null;
  }
  const ts = Date.parse(trimmed);
  if (Number.isNaN(ts) || !Number.isFinite(ts)) return null;
  return {
    isoDate: new Date(ts).toISOString().slice(0, 10),
    ts,
  };
}

function findColumnIgnoreCase(headers: string[], candidates: string[]): string | null {
  const byNorm = new Map<string, string>();
  for (const h of headers) {
    byNorm.set(h.toLowerCase().replace(/[^a-z0-9]/g, ''), h);
  }
  for (const cand of candidates) {
    const exact = byNorm.get(cand.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (exact) return exact;
  }
  return null;
}

const NAME_PRIORITY = [
  'customername',
  'fullname',
  'membername',
  'clientname',
  'accountname',
  'subscribername',
  'studentname',
  'patientname',
  'contactname',
  'companyname',
  'username',
  'name',
];

function extractName(row: Record<string, string>): string {
  const normalized = Object.entries(row).map(([k, v]) => ({
    norm: k.toLowerCase().replace(/[^a-z0-9]/g, ''),
    val: (v || '').trim(),
  }));
  for (const key of NAME_PRIORITY) {
    const match = normalized.find((e) => e.norm === key && !STATUS_MISSING_TOKENS.has(e.val.toLowerCase()));
    if (match) return match.val;
  }
  const first =
    normalized.find((e) => e.norm === 'firstname' && !STATUS_MISSING_TOKENS.has(e.val.toLowerCase()))?.val || '';
  const last =
    normalized.find((e) => e.norm === 'lastname' && !STATUS_MISSING_TOKENS.has(e.val.toLowerCase()))?.val || '';
  return `${first} ${last}`.trim();
}

const CHURNED_TOKENS = new Set([
  'churned',
  'yes',
  'true',
  '1',
  'cancelled',
  'canceled',
  'terminated',
  'stopped',
  'exited',
  'lapsed',
  'closed',
  'inactive',
  'left',
  'discontinued',
  'dropped',
]);

const ACTIVE_TOKENS = new Set([
  'active',
  'retained',
  'no',
  'false',
  '0',
  'stayed',
  'current',
  'enrolled',
  'subscribed',
  'open',
  'renewed',
  'trial',
  'paused',
]);

function interpretChurnToken(raw: string | undefined, positiveClassValue?: string): 'Churned' | 'Active' | null {
  if (isMissingCell(raw)) return null;
  const trimmed = String(raw).trim();
  const lower = trimmed.toLowerCase();
  if (positiveClassValue && lower === positiveClassValue.trim().toLowerCase()) {
    return 'Churned';
  }
  if (CHURNED_TOKENS.has(lower)) return 'Churned';
  if (ACTIVE_TOKENS.has(lower)) return 'Active';
  // If a custom positive class is mapped on targetColumn and row has a valid non-positive value, treat as Active
  if (positiveClassValue) return 'Active';
  return null;
}

export interface ResolvedCustomerStatus {
  rowIndex: number; // 1-indexed
  customerId: string;
  customerName: string;
  actualStatus: CustomerActualStatus;
  conflicts: string[];
  conflictReason: string | null;
  isActualChurned: boolean;
  isActive: boolean;
  isInconsistent: boolean;
  churnDate: string | null;
  churnDateTs: number | null;
  registrationDate: string | null;
  registrationDateTs: number | null;
  observationDate: string | null;
  observationDateTs: number | null;
}

export interface StatusColumnHints {
  targetCol: string | null;
  positiveClassValue: string;
  secondaryChurnCol: string | null;
  statusCol: string | null;
  churnDateCol: string | null;
  registrationDateCol: string | null;
  observationDateCol: string | null;
  idCol: string | null;
}

export function detectStatusColumnHints(
  columns: ColumnProfile[],
  mapping: ColumnMapping
): StatusColumnHints {
  const headers = columns.map((c) => c.name);
  const targetCol = mapping.targetColumn || null;
  const secondaryCandidate = findColumnIgnoreCase(headers, [
    'is_churned',
    'is_churn',
    'churn_flag',
    'churned',
    'churn_status',
  ]);
  const secondaryChurnCol =
    secondaryCandidate && secondaryCandidate !== targetCol ? secondaryCandidate : null;

  const statusCandidate =
    mapping.statusColumn ||
    findColumnIgnoreCase(headers, [
      'customer_status',
      'account_status',
      'subscription_status',
      'membership_status',
      'lifecycle_status',
    ]);
  const statusCol = statusCandidate && statusCandidate !== targetCol ? statusCandidate : null;

  const churnDateCol =
    mapping.churnDateColumn ||
    findColumnIgnoreCase(headers, [
      'churn_date',
      'cancellation_date',
      'cancel_date',
      'subscription_end_date',
      'end_date',
      'exit_date',
      'termination_date',
      'closure_date',
    ]);

  const registrationDateCol =
    mapping.registrationDateColumn ||
    findColumnIgnoreCase(headers, [
      'registration_date',
      'signup_date',
      'join_date',
      'created_at',
      'start_date',
      'enrollment_date',
    ]);

  const observationDateCol =
    mapping.observationDateColumn ||
    mapping.dateColumn ||
    findColumnIgnoreCase(headers, [
      'observation_date',
      'snapshot_date',
      'as_of_date',
      'last_activity_date',
      'billing_date',
    ]);

  return {
    targetCol,
    positiveClassValue: mapping.positiveClassValue || '',
    secondaryChurnCol,
    statusCol,
    churnDateCol,
    registrationDateCol,
    observationDateCol,
    idCol: mapping.idColumn || null,
  };
}

export function resolveCustomerStatusRecord(
  row: Record<string, string>,
  rowIndex: number,
  hints: StatusColumnHints,
  _churnDefinition?: ChurnDefinition
): ResolvedCustomerStatus {
  const customerId =
    hints.idCol && !isMissingCell(row[hints.idCol])
      ? row[hints.idCol].trim()
      : `CUST-${String(rowIndex).padStart(4, '0')}`;
  const customerName = extractName(row);

  const targetRaw = hints.targetCol ? row[hints.targetCol] : undefined;
  const targetIndicates = hints.targetCol
    ? interpretChurnToken(targetRaw, hints.positiveClassValue)
    : null;

  const secondaryRaw = hints.secondaryChurnCol ? row[hints.secondaryChurnCol] : undefined;
  const secondaryIndicates = hints.secondaryChurnCol
    ? interpretChurnToken(secondaryRaw)
    : null;

  const statusRaw = hints.statusCol ? row[hints.statusCol] : undefined;
  const statusIndicates = hints.statusCol ? interpretChurnToken(statusRaw) : null;

  const churnDateParsed = hints.churnDateCol ? parseDateTimestamp(row[hints.churnDateCol]) : null;
  const regDateParsed = hints.registrationDateCol
    ? parseDateTimestamp(row[hints.registrationDateCol])
    : null;
  const obsDateParsed = hints.observationDateCol
    ? parseDateTimestamp(row[hints.observationDateCol])
    : null;

  const conflicts: string[] = [];

  if (targetIndicates === 'Active' && churnDateParsed !== null) {
    conflicts.push(
      `Target outcome (${hints.targetCol}="${String(targetRaw).trim()}") says Active/Retained, but ${hints.churnDateCol} (${churnDateParsed.isoDate}) is populated.`
    );
  }
  if (targetIndicates === 'Churned' && statusIndicates === 'Active') {
    conflicts.push(
      `Target outcome (${hints.targetCol}="${String(targetRaw).trim()}") says Churned, while ${hints.statusCol}="${String(statusRaw).trim()}" says Active.`
    );
  }
  if (targetIndicates === 'Active' && statusIndicates === 'Churned') {
    conflicts.push(
      `Target outcome (${hints.targetCol}="${String(targetRaw).trim()}") says Active/Retained, while ${hints.statusCol}="${String(statusRaw).trim()}" indicates Churned.`
    );
  }
  if (targetIndicates !== null && secondaryIndicates !== null && targetIndicates !== secondaryIndicates) {
    conflicts.push(
      `${hints.targetCol}="${String(targetRaw).trim()}" disagrees with ${hints.secondaryChurnCol}="${String(secondaryRaw).trim()}".`
    );
  }
  if (statusIndicates === 'Active' && churnDateParsed !== null) {
    conflicts.push(
      `${hints.statusCol}="${String(statusRaw).trim()}" indicates Active, but ${hints.churnDateCol} (${churnDateParsed.isoDate}) is populated.`
    );
  }
  if (
    churnDateParsed !== null &&
    regDateParsed !== null &&
    churnDateParsed.ts < regDateParsed.ts
  ) {
    conflicts.push(
      `${hints.churnDateCol} (${churnDateParsed.isoDate}) is earlier than ${hints.registrationDateCol} (${regDateParsed.isoDate}).`
    );
  }

  let actualStatus: CustomerActualStatus = 'Unknown';
  if (conflicts.length > 0) {
    actualStatus = 'Inconsistent';
  } else if (
    targetIndicates === 'Churned' ||
    secondaryIndicates === 'Churned' ||
    statusIndicates === 'Churned' ||
    churnDateParsed !== null
  ) {
    actualStatus = 'Churned';
  } else if (
    targetIndicates === 'Active' ||
    secondaryIndicates === 'Active' ||
    statusIndicates === 'Active'
  ) {
    actualStatus = 'Active';
  }

  return {
    rowIndex,
    customerId,
    customerName,
    actualStatus,
    conflicts,
    conflictReason: conflicts.length > 0 ? conflicts.join(' ') : null,
    isActualChurned: actualStatus === 'Churned',
    isActive: actualStatus === 'Active',
    isInconsistent: actualStatus === 'Inconsistent',
    churnDate: churnDateParsed?.isoDate || null,
    churnDateTs: churnDateParsed?.ts ?? null,
    registrationDate: regDateParsed?.isoDate || null,
    registrationDateTs: regDateParsed?.ts ?? null,
    observationDate: obsDateParsed?.isoDate || null,
    observationDateTs: obsDateParsed?.ts ?? null,
  };
}

export function getPeriodKey(ts: number, granularity: ReportingPeriod): string {
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  if (granularity === 'annual') {
    return String(year);
  }
  if (granularity === 'quarterly') {
    const q = Math.floor((month - 1) / 3) + 1;
    return `${year}-Q${q}`;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function getPeriodBounds(
  periodKey: string,
  granularity: ReportingPeriod
): { startTs: number; endTs: number; label: string } | null {
  if (!periodKey || periodKey === 'ALL') return null;

  if (granularity === 'annual' && /^\d{4}$/.test(periodKey)) {
    const year = Number(periodKey);
    return {
      startTs: Date.UTC(year, 0, 1, 0, 0, 0, 0),
      endTs: Date.UTC(year, 11, 31, 23, 59, 59, 999),
      label: periodKey,
    };
  }

  const qMatch = periodKey.match(/^(\d{4})-Q([1-4])$/);
  if (qMatch) {
    const year = Number(qMatch[1]);
    const quarter = Number(qMatch[2]);
    const startMonth = (quarter - 1) * 3;
    const endDate = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999));
    return {
      startTs: Date.UTC(year, startMonth, 1, 0, 0, 0, 0),
      endTs: endDate.getTime(),
      label: periodKey,
    };
  }

  const mMatch = periodKey.match(/^(\d{4})-(\d{2})$/);
  if (mMatch) {
    const year = Number(mMatch[1]);
    const monthIdx = Number(mMatch[2]) - 1;
    const endDate = new Date(Date.UTC(year, monthIdx + 1, 0, 23, 59, 59, 999));
    return {
      startTs: Date.UTC(year, monthIdx, 1, 0, 0, 0, 0),
      endTs: endDate.getTime(),
      label: periodKey,
    };
  }

  return null;
}

export function computeHistoricalPerformance(params: {
  resolvedRows: ResolvedCustomerStatus[];
  churnDefinition?: ChurnDefinition;
  selectedPeriod?: string;
  isUnlabeledColdStart: boolean;
  hasTargetMapping: boolean;
}): HistoricalChurnPerformance {
  const {
    resolvedRows,
    churnDefinition,
    selectedPeriod = 'ALL',
    isUnlabeledColdStart,
    hasTargetMapping,
  } = params;

  const granularity: ReportingPeriod = churnDefinition?.reportingPeriod || 'monthly';

  const inconsistentRecordsSample: InconsistentCustomerRecord[] = [];
  let inconsistentRecordsCount = 0;
  let unknownStatusCount = 0;
  let allTimeChurned = 0;
  let allTimeActive = 0;
  let hasAnyChurnDates = false;
  let hasAnyRegOrObsDates = false;

  const periodSet = new Set<string>();

  for (const r of resolvedRows) {
    if (r.isInconsistent) {
      inconsistentRecordsCount++;
      if (inconsistentRecordsSample.length < 25) {
        inconsistentRecordsSample.push({
          rowIndex: r.rowIndex,
          customerId: r.customerId,
          customerName: r.customerName || undefined,
          reason: r.conflictReason || 'Conflicting status or date fields.',
        });
      }
    } else if (r.isActualChurned) {
      allTimeChurned++;
    } else if (r.isActive) {
      allTimeActive++;
    } else {
      unknownStatusCount++;
    }

    if (r.churnDateTs !== null) {
      hasAnyChurnDates = true;
      periodSet.add(getPeriodKey(r.churnDateTs, granularity));
    }
    if (r.registrationDateTs !== null) {
      hasAnyRegOrObsDates = true;
      periodSet.add(getPeriodKey(r.registrationDateTs, granularity));
    }
    if (r.observationDateTs !== null) {
      hasAnyRegOrObsDates = true;
      periodSet.add(getPeriodKey(r.observationDateTs, granularity));
    }
  }

  const availablePeriods = Array.from(periodSet).sort();
  const hasDateColumns = hasAnyChurnDates || hasAnyRegOrObsDates;

  // Build historical trends per discovered period when churn dates exist
  const historicalTrends: HistoricalPeriodPoint[] = [];
  if (hasAnyChurnDates && !isUnlabeledColdStart) {
    for (const pKey of availablePeriods) {
      const bounds = getPeriodBounds(pKey, granularity);
      if (!bounds) continue;

      let startCount = 0;
      let lostCount = 0;

      for (const r of resolvedRows) {
        if (r.isInconsistent || r.actualStatus === 'Unknown') continue;
        // Was the customer active at the start of this period?
        const joinedBeforeOrAtStart =
          r.registrationDateTs === null || r.registrationDateTs <= bounds.startTs;
        const notChurnedBeforeStart =
          !(r.isActualChurned && r.churnDateTs !== null && r.churnDateTs < bounds.startTs);

        if (joinedBeforeOrAtStart && notChurnedBeforeStart) {
          startCount++;
          if (
            r.isActualChurned &&
            r.churnDateTs !== null &&
            r.churnDateTs >= bounds.startTs &&
            r.churnDateTs <= bounds.endTs
          ) {
            lostCount++;
          }
        }
      }

      const retained = Math.max(0, startCount - lostCount);
      const reliable = startCount > 0;
      const rate = reliable ? Number(((lostCount / startCount) * 100).toFixed(1)) : null;

      historicalTrends.push({
        period: pKey,
        label: bounds.label,
        customersAtStart: startCount,
        actualChurned: lostCount,
        retainedCount: retained,
        churnRate: rate,
        reliable,
      });
    }
  }

  const normalizedPeriod = selectedPeriod && selectedPeriod !== 'ALL' ? selectedPeriod : 'ALL';

  // Period-filtered calculation
  if (normalizedPeriod !== 'ALL') {
    const bounds = getPeriodBounds(normalizedPeriod, granularity);
    if (!bounds) {
      return {
        reportingPeriodGranularity: granularity,
        selectedPeriod: normalizedPeriod,
        availablePeriods,
        customersAtStartOfPeriod: 0,
        actualChurnedCount: 0,
        retainedCount: 0,
        historicalChurnRate: null,
        historicalRateReliable: false,
        historicalRateNotice: `Selected reporting period "${normalizedPeriod}" is not valid for ${granularity} reporting.`,
        inconsistentRecordsCount,
        inconsistentRecordsSample,
        unknownStatusCount,
        hasDateColumns,
        historicalTrends,
        formulaDescription: 'Historical Churn Rate = (Actual Customers Lost During Period / Customers at Start of Period) × 100',
      };
    }

    if (isUnlabeledColdStart || !hasTargetMapping) {
      return {
        reportingPeriodGranularity: granularity,
        selectedPeriod: normalizedPeriod,
        availablePeriods,
        customersAtStartOfPeriod: 0,
        actualChurnedCount: 0,
        retainedCount: allTimeActive,
        historicalChurnRate: null,
        historicalRateReliable: false,
        historicalRateNotice:
          'Historical churn rate cannot be reliably calculated because the dataset lacks confirmed Churned and Retained outcome records.',
        inconsistentRecordsCount,
        inconsistentRecordsSample,
        unknownStatusCount,
        hasDateColumns,
        historicalTrends,
        formulaDescription: 'Historical Churn Rate = (Actual Customers Lost During Period / Customers at Start of Period) × 100',
      };
    }

    if (!hasAnyChurnDates) {
      return {
        reportingPeriodGranularity: granularity,
        selectedPeriod: normalizedPeriod,
        availablePeriods,
        customersAtStartOfPeriod: 0,
        actualChurnedCount: 0,
        retainedCount: 0,
        historicalChurnRate: null,
        historicalRateReliable: false,
        historicalRateNotice:
          'Period-filtered churn rate cannot be reliably calculated because this dataset does not contain Churn_Date or Cancellation_Date records.',
        inconsistentRecordsCount,
        inconsistentRecordsSample,
        unknownStatusCount,
        hasDateColumns,
        historicalTrends,
        formulaDescription: 'Historical Churn Rate = (Actual Customers Lost During Period / Customers at Start of Period) × 100',
      };
    }

    let customersAtStart = 0;
    let actualLost = 0;
    for (const r of resolvedRows) {
      if (r.isInconsistent || r.actualStatus === 'Unknown') continue;
      const joinedBeforeOrAtStart =
        r.registrationDateTs === null || r.registrationDateTs <= bounds.startTs;
      const notChurnedBeforeStart =
        !(r.isActualChurned && r.churnDateTs !== null && r.churnDateTs < bounds.startTs);

      if (joinedBeforeOrAtStart && notChurnedBeforeStart) {
        customersAtStart++;
        if (
          r.isActualChurned &&
          r.churnDateTs !== null &&
          r.churnDateTs >= bounds.startTs &&
          r.churnDateTs <= bounds.endTs
        ) {
          actualLost++;
        }
      }
    }

    const retained = Math.max(0, customersAtStart - actualLost);
    if (customersAtStart === 0) {
      return {
        reportingPeriodGranularity: granularity,
        selectedPeriod: normalizedPeriod,
        availablePeriods,
        customersAtStartOfPeriod: 0,
        actualChurnedCount: actualLost,
        retainedCount: retained,
        historicalChurnRate: null,
        historicalRateReliable: false,
        historicalRateNotice: `Historical churn rate cannot be reliably calculated for ${normalizedPeriod} because 0 customers were active at the start of the period.`,
        inconsistentRecordsCount,
        inconsistentRecordsSample,
        unknownStatusCount,
        hasDateColumns,
        historicalTrends,
        formulaDescription: 'Historical Churn Rate = (Actual Customers Lost During Period / Customers at Start of Period) × 100',
      };
    }

    const rate = Number(((actualLost / customersAtStart) * 100).toFixed(1));
    return {
      reportingPeriodGranularity: granularity,
      selectedPeriod: normalizedPeriod,
      availablePeriods,
      customersAtStartOfPeriod: customersAtStart,
      actualChurnedCount: actualLost,
      retainedCount: retained,
      historicalChurnRate: rate,
      historicalRateReliable: true,
      historicalRateNotice: null,
      inconsistentRecordsCount,
      inconsistentRecordsSample,
      unknownStatusCount,
      hasDateColumns,
      historicalTrends,
      formulaDescription: `(${actualLost.toLocaleString()} actual lost ÷ ${customersAtStart.toLocaleString()} active at start of ${normalizedPeriod}) × 100 = ${rate.toFixed(1)}%`,
    };
  }

  // 'ALL' observed window
  const cleanCohortDenominator = allTimeActive + allTimeChurned;
  if (isUnlabeledColdStart || !hasTargetMapping) {
    return {
      reportingPeriodGranularity: granularity,
      selectedPeriod: 'ALL',
      availablePeriods,
      customersAtStartOfPeriod: cleanCohortDenominator,
      actualChurnedCount: allTimeChurned,
      retainedCount: allTimeActive,
      historicalChurnRate: null,
      historicalRateReliable: false,
      historicalRateNotice:
        'Historical churn rate cannot be reliably calculated until both Churned and Retained historical outcomes are present in the dataset.',
      inconsistentRecordsCount,
      inconsistentRecordsSample,
      unknownStatusCount,
      hasDateColumns,
      historicalTrends,
      formulaDescription: 'Historical Churn Rate = (Actual Customers Lost During Period / Customers at Start of Period) × 100',
    };
  }

  if (cleanCohortDenominator === 0) {
    return {
      reportingPeriodGranularity: granularity,
      selectedPeriod: 'ALL',
      availablePeriods,
      customersAtStartOfPeriod: 0,
      actualChurnedCount: 0,
      retainedCount: 0,
      historicalChurnRate: null,
      historicalRateReliable: false,
      historicalRateNotice:
        inconsistentRecordsCount > 0
          ? 'Historical churn rate cannot be reliably calculated because all records contain conflicting status or date labels.'
          : 'Historical churn rate cannot be reliably calculated because 0 valid active or churned customers exist in the dataset.',
      inconsistentRecordsCount,
      inconsistentRecordsSample,
      unknownStatusCount,
      hasDateColumns,
      historicalTrends,
      formulaDescription: 'Historical Churn Rate = (Actual Customers Lost During Period / Customers at Start of Period) × 100',
    };
  }

  const allRate = Number(((allTimeChurned / cleanCohortDenominator) * 100).toFixed(1));
  return {
    reportingPeriodGranularity: granularity,
    selectedPeriod: 'ALL',
    availablePeriods,
    customersAtStartOfPeriod: cleanCohortDenominator,
    actualChurnedCount: allTimeChurned,
    retainedCount: allTimeActive,
    historicalChurnRate: allRate,
    historicalRateReliable: true,
    historicalRateNotice: null,
    inconsistentRecordsCount,
    inconsistentRecordsSample,
    unknownStatusCount,
    hasDateColumns,
    historicalTrends,
    formulaDescription: `(${allTimeChurned.toLocaleString()} actual churned ÷ ${cleanCohortDenominator.toLocaleString()} eligible customers at start of window) × 100 = ${allRate.toFixed(1)}%`,
  };
}

export function classifyPredictedRiskLabel(riskCategory: RiskCategory): Exclude<PredictedRiskLabel, 'Not Applicable'> {
  if (riskCategory === 'Higher Estimated Churn Risk') return 'High Risk';
  if (riskCategory === 'Moderate Estimated Churn Risk') return 'Medium Risk';
  return 'Low Risk';
}

export function computeActiveCustomerRiskSummary(params: {
  resolvedRows: ResolvedCustomerStatus[];
  predictions?: CustomerPrediction[] | null;
  highValueAtRiskCount?: number | null;
  highValueAtRiskRevenue?: number | null;
}): ActiveCustomerRiskSummary | null {
  const { resolvedRows, predictions, highValueAtRiskCount = null, highValueAtRiskRevenue = null } = params;
  if (!predictions || predictions.length === 0) return null;

  const statusByRow = new Map<number, ResolvedCustomerStatus>();
  const statusById = new Map<string, ResolvedCustomerStatus>();
  for (const r of resolvedRows) {
    statusByRow.set(r.rowIndex, r);
    statusById.set(r.customerId.toLowerCase(), r);
  }

  let totalActiveCustomers = 0;
  let excludedChurnedCount = 0;
  let excludedInconsistentCount = 0;
  for (const r of resolvedRows) {
    if (r.isActualChurned) excludedChurnedCount++;
    else if (r.isInconsistent) excludedInconsistentCount++;
    else totalActiveCustomers++;
  }

  const bucketDefs = [
    { bucket: '0–20%', rangeLabel: '0–20%', min: 0, max: 0.2 },
    { bucket: '20–40%', rangeLabel: '20–40%', min: 0.2, max: 0.4 },
    { bucket: '40–60%', rangeLabel: '40–60%', min: 0.4, max: 0.6 },
    { bucket: '60–80%', rangeLabel: '60–80%', min: 0.6, max: 0.8 },
    { bucket: '80–100%', rangeLabel: '80–100%', min: 0.8, max: 1.0001 },
  ];
  const bucketCounts = new Array<number>(bucketDefs.length).fill(0);

  let scoredActiveCustomers = 0;
  let activeHighRiskCount = 0;
  let activeMediumRiskCount = 0;
  let activeLowRiskCount = 0;

  for (const p of predictions) {
    const resolved =
      statusByRow.get(p.rowIndex) ||
      statusById.get((p.customerId || '').trim().toLowerCase());
    const isChurned =
      resolved ? resolved.isActualChurned : p.actualStatus === 'Churned' || p.actualChurn === 'Churned';
    const isInconsistent = resolved ? resolved.isInconsistent : p.actualStatus === 'Inconsistent';

    if (isChurned || isInconsistent) {
      continue;
    }

    scoredActiveCustomers++;
    if (p.riskCategory === 'Higher Estimated Churn Risk') activeHighRiskCount++;
    else if (p.riskCategory === 'Moderate Estimated Churn Risk') activeMediumRiskCount++;
    else activeLowRiskCount++;

    const prob = Math.max(0, Math.min(1, p.churnProbability));
    const bIdx = bucketDefs.findIndex((b, idx) =>
      idx === bucketDefs.length - 1 ? prob >= b.min && prob <= b.max : prob >= b.min && prob < b.max
    );
    if (bIdx >= 0) bucketCounts[bIdx]++;
  }

  const activeProbabilityDistribution: ActiveProbabilityBucket[] = bucketDefs.map((b, idx) => ({
    bucket: b.bucket,
    rangeLabel: b.rangeLabel,
    count: bucketCounts[idx],
    percentage:
      scoredActiveCustomers > 0
        ? Number(((bucketCounts[idx] / scoredActiveCustomers) * 100).toFixed(1))
        : 0,
  }));

  return {
    totalActiveCustomers: Math.max(totalActiveCustomers, scoredActiveCustomers),
    scoredActiveCustomers,
    activeHighRiskCount,
    activeMediumRiskCount,
    activeLowRiskCount,
    excludedChurnedCount,
    excludedInconsistentCount,
    activeProbabilityDistribution,
    highValueActiveAtRiskCount: highValueAtRiskCount,
    highValueActiveAtRiskRevenue: highValueAtRiskRevenue,
  };
}
