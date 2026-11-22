import type {
  BatchScoreResult,
  ColumnMapping,
  ColumnProfile,
  CustomerValueConfig,
  CustomerValueFactorContribution,
  CustomerValueRecommendation,
  CustomerValueRecord,
  CustomerValueSummary,
  ModelEvaluationResult,
  RiskCategory,
  ValueCriterionAvailability,
  ValueDistributionBucket,
  ValueMatrixGroupCount,
  ValueMatrixQuadrant,
  ValueSegmentTier,
} from '../src/types/churn.ts';
import type { StoredDataset, TrainedModelArtifact } from './mlEngine.ts';
import { isMissingValue } from './mlEngine.ts';

export const DEFAULT_CUSTOMER_VALUE_CONFIG: CustomerValueConfig = {
  weights: {
    revenue: 40,
    frequency: 20,
    tenure: 15,
    paymentHealth: 10,
    profit: 10,
    growth: 5,
  },
  highValuePercentile: 75,
  mediumValuePercentile: 35,
  highRiskCutoff: 0.5,
  annualizationMonths: 12,
};

export function normalizeValueConfig(
  incoming?: Partial<CustomerValueConfig> | null
): CustomerValueConfig {
  const w = incoming?.weights || ({} as Partial<CustomerValueConfig['weights']>);
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(100, n) : fallback;
  };
  const highPct = Math.max(50, Math.min(95, Number(incoming?.highValuePercentile) || 75));
  const medPct = Math.max(10, Math.min(highPct - 10, Number(incoming?.mediumValuePercentile) || 35));
  const riskCutoff = Math.max(
    0.2,
    Math.min(0.85, Number(incoming?.highRiskCutoff) || DEFAULT_CUSTOMER_VALUE_CONFIG.highRiskCutoff)
  );
  const annMonths = Math.max(
    1,
    Math.min(36, Math.round(Number(incoming?.annualizationMonths) || 12))
  );

  return {
    weights: {
      revenue: num(w.revenue, DEFAULT_CUSTOMER_VALUE_CONFIG.weights.revenue),
      frequency: num(w.frequency, DEFAULT_CUSTOMER_VALUE_CONFIG.weights.frequency),
      tenure: num(w.tenure, DEFAULT_CUSTOMER_VALUE_CONFIG.weights.tenure),
      paymentHealth: num(w.paymentHealth, DEFAULT_CUSTOMER_VALUE_CONFIG.weights.paymentHealth),
      profit: num(w.profit, DEFAULT_CUSTOMER_VALUE_CONFIG.weights.profit),
      growth: num(w.growth, DEFAULT_CUSTOMER_VALUE_CONFIG.weights.growth),
    },
    highValuePercentile: highPct,
    mediumValuePercentile: medPct,
    highRiskCutoff: Number(riskCutoff.toFixed(2)),
    annualizationMonths: annMonths,
  };
}

function parseNumeric(val: string | undefined): number | null {
  if (isMissingValue(val)) return null;
  const cleaned = String(val).replace(/[$,%\s,]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function findColumnByCandidates(
  columns: ColumnProfile[],
  candidates: string[],
  numericOnly = false
): string | null {
  const pool = numericOnly
    ? columns.filter((c) => c.dataType === 'numeric')
    : columns;
  const byLower = new Map(pool.map((c) => [c.name.toLowerCase(), c.name]));
  for (const cand of candidates) {
    const exact = byLower.get(cand.toLowerCase());
    if (exact) return exact;
  }
  for (const cand of candidates) {
    const partial = pool.find((c) => c.name.toLowerCase().includes(cand.toLowerCase()));
    if (partial) return partial.name;
  }
  return null;
}

function computePercentileRanks(values: (number | null)[], invert = false): (number | null)[] {
  const validIndices: { idx: number; val: number }[] = [];
  values.forEach((v, idx) => {
    if (v !== null && Number.isFinite(v)) {
      validIndices.push({ idx, val: v });
    }
  });
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (validIndices.length === 0) return out;
  if (validIndices.length === 1) {
    out[validIndices[0].idx] = 50;
    return out;
  }

  validIndices.sort((a, b) => a.val - b.val);
  const n = validIndices.length;

  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && validIndices[j + 1].val === validIndices[i].val) {
      j++;
    }
    const avgRank = (i + j) / 2;
    const pct = (avgRank / (n - 1)) * 100;
    const finalScore = invert ? 100 - pct : pct;
    for (let k = i; k <= j; k++) {
      out[validIndices[k].idx] = Number(finalScore.toFixed(1));
    }
    i = j + 1;
  }

  return out;
}

function scorePaymentStatusText(raw: string | undefined): number | null {
  if (isMissingValue(raw)) return null;
  const s = String(raw).trim().toLowerCase();
  if (/(on[-\s]?time|paid|current|good|clean|active|auto)/.test(s)) return 100;
  if (/(pending|grace|partial)/.test(s)) return 60;
  if (/(late|overdue|delinquent|past due|failed|missed|default)/.test(s)) return 15;
  return null;
}

interface DetectedValueColumns {
  totalRevenueCol: string | null;
  annualRevenueCol: string | null;
  monthlyRevenueCol: string | null;
  contractValueCol: string | null;
  avgTransactionCol: string | null;
  frequencyCol: string | null;
  tenureCol: string | null;
  paymentStatusCol: string | null;
  latePaymentsCol: string | null;
  outstandingBalanceCol: string | null;
  profitMarginCol: string | null;
  directProfitCol: string | null;
  costCol: string | null;
  acquisitionCostCol: string | null;
  growthCol: string | null;
  satisfactionCol: string | null;
  complaintsCol: string | null;
  ticketsCol: string | null;
  unresolvedTicketsCol: string | null;
  resolutionDaysCol: string | null;
  nameCol: string | null;
}

function detectValueColumns(
  columns: ColumnProfile[],
  mapping: ColumnMapping
): DetectedValueColumns {
  const totalRevenueCol = findColumnByCandidates(
    columns,
    ['total_revenue', 'lifetime_revenue', 'lifetime_spend', 'total_spend', 'ltv', 'clv'],
    true
  );
  const annualRevenueCol = findColumnByCandidates(
    columns,
    ['annual_revenue', 'arr', 'yearly_revenue', 'annual_spend', 'annual_value'],
    true
  );
  const contractValueCol = findColumnByCandidates(
    columns,
    ['contract_value', 'acv', 'renewal_value', 'policy_value'],
    true
  );
  const nonGrowthCols = columns.filter(
    (c) => !/(growth|change|pct|percent|margin|ratio)/i.test(c.name)
  );
  const monthlyRevenueCol =
    (mapping.monthlyChargesColumn &&
    columns.some((c) => c.name === mapping.monthlyChargesColumn && c.dataType === 'numeric')
      ? mapping.monthlyChargesColumn
      : null) ||
    findColumnByCandidates(
      nonGrowthCols,
      [
        'monthly_revenue',
        'mrr',
        'monthly_charges',
        'monthlycharges',
        'monthly_fee',
        'monthly_dues',
        'monthly_premium',
        'tuition_fee',
        'revenue',
        'charges',
      ],
      true
    );
  const avgTransactionCol = findColumnByCandidates(
    columns,
    ['average_transaction_value', 'avg_order_value', 'aov', 'avg_visit_billing', 'order_value'],
    true
  );
  const frequencyCol =
    (mapping.frequencyColumn &&
    columns.some((c) => c.name === mapping.frequencyColumn && c.dataType === 'numeric')
      ? mapping.frequencyColumn
      : null) ||
    findColumnByCandidates(
      columns,
      [
        'purchase_frequency',
        'total_purchases',
        'monthly_transactions',
        'monthly_checkins',
        'usage_frequency',
        'login_frequency',
        'sessions_per_week',
        'engagement_frequency',
        'annual_appointments',
        'weekly_active_users',
      ],
      true
    );
  const tenureCol =
    (mapping.tenureColumn &&
    columns.some((c) => c.name === mapping.tenureColumn && c.dataType === 'numeric')
      ? mapping.tenureColumn
      : null) ||
    findColumnByCandidates(
      columns,
      [
        'customer_tenure_months',
        'subscription_tenure_months',
        'tenure_months',
        'customer_lifetime_months',
        'months_subscribed',
        'months_enrolled',
        'policy_tenure_months',
        'tenure',
      ],
      true
    );

  const paymentStatusCol = findColumnByCandidates(columns, [
    'payment_status',
    'billing_status',
    'invoice_status',
  ]);
  const latePaymentsCol = findColumnByCandidates(
    columns,
    ['late_payment_count', 'late_payments', 'overdue_count', 'missed_payments', 'failed_payments'],
    true
  );
  const outstandingBalanceCol = findColumnByCandidates(
    columns,
    ['outstanding_balance', 'past_due_balance', 'unpaid_balance'],
    true
  );

  const profitMarginCol = findColumnByCandidates(
    columns,
    ['profit_margin', 'gross_margin', 'margin_pct', 'net_margin'],
    true
  );
  const directProfitCandidates = columns.filter(
    (c) =>
      c.name !== profitMarginCol &&
      !/(margin|pct|percent|ratio|rate)/i.test(c.name)
  );
  const directProfitCol = findColumnByCandidates(
    directProfitCandidates,
    ['profit_contribution', 'net_profit', 'gross_profit', 'customer_profit', 'profit'],
    true
  );
  const costCol = findColumnByCandidates(
    columns,
    ['service_cost', 'cost_to_serve', 'cogs', 'operating_cost', 'total_cost', 'customer_cost'],
    true
  );
  const acquisitionCostCol = findColumnByCandidates(
    columns,
    ['acquisition_cost', 'cac', 'onboarding_cost'],
    true
  );
  const growthCol = findColumnByCandidates(
    columns,
    ['spend_growth', 'spending_growth', 'revenue_growth', 'mrr_growth', 'growth_pct', 'spend_change'],
    true
  );

  const satisfactionCol = findColumnByCandidates(
    columns,
    ['customer_satisfaction_score', 'csat_score', 'csat', 'nps_score', 'nps', 'satisfaction_score'],
    true
  );
  const complaintsCol = findColumnByCandidates(
    columns,
    ['total_complaints', 'complaints', 'complaint_count'],
    true
  );
  const ticketsCol = findColumnByCandidates(
    columns,
    ['total_tickets_raised', 'support_tickets', 'tickets_raised', 'support_calls', 'tickets'],
    true
  );
  const unresolvedTicketsCol = findColumnByCandidates(
    columns,
    ['unresolved_tickets', 'open_tickets', 'pending_tickets'],
    true
  );
  const resolutionDaysCol = findColumnByCandidates(
    columns,
    ['average_resolution_days', 'resolution_time_days', 'avg_resolution_days', 'resolution_days'],
    true
  );
  const nameCol = findColumnByCandidates(columns, [
    'customer_name',
    'full_name',
    'account_name',
    'company_name',
    'name',
  ]);

  return {
    totalRevenueCol,
    annualRevenueCol,
    monthlyRevenueCol,
    contractValueCol,
    avgTransactionCol,
    frequencyCol,
    tenureCol,
    paymentStatusCol,
    latePaymentsCol,
    outstandingBalanceCol,
    profitMarginCol,
    directProfitCol,
    costCol,
    acquisitionCostCol,
    growthCol,
    satisfactionCol,
    complaintsCol,
    ticketsCol,
    unresolvedTicketsCol,
    resolutionDaysCol,
    nameCol,
  };
}

export function computeCustomerValueIntelligence(params: {
  dataset: StoredDataset | null;
  activeArtifact?: TrainedModelArtifact | null;
  batchScores?: BatchScoreResult[];
  valueConfig?: Partial<CustomerValueConfig> | null;
}): CustomerValueSummary {
  const config = normalizeValueConfig(params.valueConfig);

  if (!params.dataset || params.dataset.rows.length === 0) {
    return {
      datasetId: 'none',
      generatedAt: new Date().toISOString(),
      totalCustomers: 0,
      valueAssessmentAvailable: false,
      unavailableReason:
        'Upload a customer dataset in Data Management to analyse customer value, revenue concentration, and churn exposure.',
      revenueAvailable: false,
      revenueBasisNote: 'No customer dataset is loaded.',
      profitAvailable: false,
      profitUnavailableReason: 'No customer dataset is loaded.',
      riskPredictionsAvailable: false,
      riskUnavailableReason: 'No customer dataset or validated churn model is active.',
      highValueCount: 0,
      mediumValueCount: 0,
      lowValueCount: 0,
      highValueAtRiskCount: null,
      totalPortfolioRevenue: null,
      totalPortfolioProfit: null,
      atRiskCustomersRevenue: null,
      estimatedExpectedRevenueExposure: null,
      highValueAtRiskRevenue: null,
      config,
      criteriaAvailability: [],
      segmentDistribution: [],
      fourGroupMatrix: [],
      recommendations: [],
      customers: [],
    };
  }

  const { state, rows } = params.dataset;
  const mapping = state.mapping;
  const cols = state.columns;
  const detected = detectValueColumns(cols, mapping);

  // Build real prediction lookup ONLY from activeModelArtifact.predictions or latest batchScores
  const predByCustomerId = new Map<
    string,
    { prob: number; riskCategory: RiskCategory; predictedChurn: string }
  >();
  const predByRowIndex = new Map<
    number,
    { prob: number; riskCategory: RiskCategory; predictedChurn: string }
  >();

  if (params.activeArtifact?.evaluation?.predictions?.length) {
    for (const p of params.activeArtifact.evaluation.predictions) {
      const entry = {
        prob: p.churnProbability,
        riskCategory: p.riskCategory,
        predictedChurn: p.predictedChurn,
      };
      predByRowIndex.set(p.rowIndex, entry);
      if (p.customerId) {
        predByCustomerId.set(p.customerId.trim().toLowerCase(), entry);
      }
    }
  } else if (params.batchScores && params.batchScores.length > 0) {
    const latestBatch = params.batchScores[0];
    for (const rec of latestBatch.records || []) {
      const entry = {
        prob: rec.churnProbability,
        riskCategory: rec.riskCategory,
        predictedChurn: rec.predictedChurn,
      };
      predByRowIndex.set(rec.rowIndex, entry);
      if (rec.customerId) {
        predByCustomerId.set(rec.customerId.trim().toLowerCase(), entry);
      }
    }
  }

  const hasModelPredictions = predByCustomerId.size > 0 || predByRowIndex.size > 0;

  // Determine exact revenue basis strictly from available fields
  const hasAnyRevenueField = Boolean(
    detected.annualRevenueCol ||
      detected.totalRevenueCol ||
      detected.contractValueCol ||
      detected.monthlyRevenueCol ||
      detected.avgTransactionCol
  );

  let revenueBasisNote = 'No financial or revenue columns were detected in this dataset.';
  if (detected.annualRevenueCol) {
    revenueBasisNote = `Using "${detected.annualRevenueCol}" directly for annual customer revenue comparison.`;
  } else if (detected.monthlyRevenueCol && detected.contractValueCol) {
    revenueBasisNote = `Using "${detected.contractValueCol}" or ${config.annualizationMonths}× "${detected.monthlyRevenueCol}" for annualized revenue exposure.`;
  } else if (detected.monthlyRevenueCol) {
    revenueBasisNote = `Using "${detected.monthlyRevenueCol}" (${config.annualizationMonths}-month annualized view for exposure estimates).`;
  } else if (detected.totalRevenueCol) {
    revenueBasisNote = `Using "${detected.totalRevenueCol}" cumulative customer spend.`;
  } else if (detected.avgTransactionCol) {
    revenueBasisNote = detected.frequencyCol
      ? `Estimating spend from "${detected.avgTransactionCol}" × "${detected.frequencyCol}".`
      : `Using "${detected.avgTransactionCol}" average transaction value.`;
  }

  // Extract raw metric vectors per row strictly from uploaded dataset
  const primaryValueMetric: (number | null)[] = [];
  const annualizedRevenues: (number | null)[] = [];
  const displayRevenues: { value: number | null; label: string | null }[] = [];
  const frequencyMetric: (number | null)[] = [];
  const tenureMetric: (number | null)[] = [];
  const paymentHealthMetric: (number | null)[] = [];
  const profitMetric: (number | null)[] = [];
  const profitMarginPcts: (number | null)[] = [];
  const growthMetric: (number | null)[] = [];

  for (const row of rows) {
    const annualRev = detected.annualRevenueCol ? parseNumeric(row[detected.annualRevenueCol]) : null;
    const totalRev = detected.totalRevenueCol ? parseNumeric(row[detected.totalRevenueCol]) : null;
    const contractVal = detected.contractValueCol ? parseNumeric(row[detected.contractValueCol]) : null;
    const monthlyRev = detected.monthlyRevenueCol ? parseNumeric(row[detected.monthlyRevenueCol]) : null;
    const avgTx = detected.avgTransactionCol ? parseNumeric(row[detected.avgTransactionCol]) : null;
    const freqVal = detected.frequencyCol ? parseNumeric(row[detected.frequencyCol]) : null;
    const tenureVal = detected.tenureCol ? parseNumeric(row[detected.tenureCol]) : null;

    // Best single-row revenue figure for value ranking & exposure
    let rowAnnualizedRev: number | null = null;
    let rowDisplayRev: number | null = null;
    let rowRevLabel: string | null = null;

    if (annualRev !== null) {
      rowAnnualizedRev = Math.max(0, annualRev);
      rowDisplayRev = Math.max(0, annualRev);
      rowRevLabel = `${detected.annualRevenueCol} (Annual)`;
    } else if (contractVal !== null && contractVal > 0) {
      rowAnnualizedRev = contractVal;
      rowDisplayRev = contractVal;
      rowRevLabel = `${detected.contractValueCol}`;
    } else if (monthlyRev !== null) {
      rowAnnualizedRev = Math.max(0, monthlyRev * config.annualizationMonths);
      rowDisplayRev = Math.max(0, monthlyRev);
      rowRevLabel = `${detected.monthlyRevenueCol}`;
    } else if (totalRev !== null) {
      rowAnnualizedRev =
        tenureVal && tenureVal > 0
          ? Math.max(0, (totalRev / Math.max(1, tenureVal)) * config.annualizationMonths)
          : Math.max(0, totalRev);
      rowDisplayRev = Math.max(0, totalRev);
      rowRevLabel = `${detected.totalRevenueCol}`;
    } else if (avgTx !== null) {
      rowAnnualizedRev =
        freqVal !== null ? Math.max(0, avgTx * freqVal * config.annualizationMonths) : Math.max(0, avgTx);
      rowDisplayRev = Math.max(0, avgTx);
      rowRevLabel = `${detected.avgTransactionCol}`;
    }

    const rankingRevenue = totalRev ?? annualRev ?? contractVal ?? rowAnnualizedRev;
    primaryValueMetric.push(rankingRevenue);
    annualizedRevenues.push(rowAnnualizedRev);
    displayRevenues.push({ value: rowDisplayRev, label: rowRevLabel });
    frequencyMetric.push(freqVal);
    tenureMetric.push(tenureVal);

    // Payment health score (0..100) only from real columns
    let payScore: number | null = null;
    if (detected.paymentStatusCol) {
      payScore = scorePaymentStatusText(row[detected.paymentStatusCol]);
    }
    if (detected.latePaymentsCol) {
      const late = parseNumeric(row[detected.latePaymentsCol]);
      if (late !== null) {
        const latePenaltyScore = Math.max(0, 100 - late * 22);
        payScore = payScore !== null ? (payScore + latePenaltyScore) / 2 : latePenaltyScore;
      }
    }
    if (detected.outstandingBalanceCol) {
      const bal = parseNumeric(row[detected.outstandingBalanceCol]);
      if (bal !== null) {
        const balScore = bal <= 0 ? 100 : Math.max(10, 85 - Math.min(75, bal / 20));
        payScore = payScore !== null ? (payScore + balScore) / 2 : balScore;
      }
    }
    paymentHealthMetric.push(payScore);

    // Profit contribution: ONLY if explicit profit, margin %, or cost fields exist (NEVER assume revenue = profit)
    let rowProfit: number | null = null;
    let rowMarginPct: number | null = null;
    if (detected.directProfitCol) {
      const p = parseNumeric(row[detected.directProfitCol]);
      if (p !== null) {
        rowProfit = p;
        if (rowDisplayRev && rowDisplayRev > 0) {
          rowMarginPct = Number(((p / rowDisplayRev) * 100).toFixed(1));
        }
      }
    } else if (detected.profitMarginCol && rowAnnualizedRev !== null) {
      const rawMargin = parseNumeric(row[detected.profitMarginCol]);
      if (rawMargin !== null) {
        const pct = Math.abs(rawMargin) <= 1 ? rawMargin * 100 : rawMargin;
        rowMarginPct = Number(pct.toFixed(1));
        rowProfit = Number(((rowAnnualizedRev * pct) / 100).toFixed(2));
      }
    } else if (detected.costCol && (rowDisplayRev !== null || rowAnnualizedRev !== null)) {
      const c = parseNumeric(row[detected.costCol]);
      const baseRev = rowDisplayRev ?? rowAnnualizedRev;
      if (c !== null && baseRev !== null) {
        rowProfit = Number((baseRev - c).toFixed(2));
        if (baseRev > 0) {
          rowMarginPct = Number(((rowProfit / baseRev) * 100).toFixed(1));
        }
      }
    }
    profitMetric.push(rowProfit);
    profitMarginPcts.push(rowMarginPct);

    const growthVal = detected.growthCol ? parseNumeric(row[detected.growthCol]) : null;
    growthMetric.push(growthVal);
  }

  const revenuePct = computePercentileRanks(primaryValueMetric);
  const frequencyPct = computePercentileRanks(frequencyMetric);
  const tenurePct = computePercentileRanks(tenureMetric);
  const profitPct = computePercentileRanks(profitMetric);
  const growthPct = computePercentileRanks(growthMetric);

  const hasValidRevenue = revenuePct.some((v) => v !== null);
  const hasValidFreq = frequencyPct.some((v) => v !== null);
  const hasValidTenure = tenurePct.some((v) => v !== null);
  const hasValidPay = paymentHealthMetric.some((v) => v !== null);
  const profitAvailable = profitMetric.some((v) => v !== null);
  const hasValidGrowth = growthPct.some((v) => v !== null);

  const profitUnavailableReason = profitAvailable
    ? null
    : 'Cost, acquisition cost, or profit margin fields are not present in the uploaded dataset. ChurnSight never treats revenue as profit.';

  const rawCriteriaDefs: {
    key: ValueCriterionAvailability['key'];
    label: string;
    available: boolean;
    sourceColumn: string | null;
    configuredWeight: number;
    note: string;
  }[] = [
    {
      key: 'revenue',
      label: 'Revenue & Contract Value',
      available: hasValidRevenue,
      sourceColumn:
        detected.totalRevenueCol ||
        detected.annualRevenueCol ||
        detected.contractValueCol ||
        detected.monthlyRevenueCol ||
        detected.avgTransactionCol,
      configuredWeight: config.weights.revenue,
      note: hasValidRevenue ? revenueBasisNote : 'No revenue or transaction spend column detected.',
    },
    {
      key: 'frequency',
      label: 'Purchase / Usage Frequency',
      available: hasValidFreq,
      sourceColumn: detected.frequencyCol,
      configuredWeight: config.weights.frequency,
      note: hasValidFreq
        ? `Using "${detected.frequencyCol}".`
        : 'No purchase or engagement frequency column detected.',
    },
    {
      key: 'tenure',
      label: 'Customer Lifetime / Tenure',
      available: hasValidTenure,
      sourceColumn: detected.tenureCol,
      configuredWeight: config.weights.tenure,
      note: hasValidTenure
        ? `Using "${detected.tenureCol}".`
        : 'No tenure or lifetime duration column detected.',
    },
    {
      key: 'paymentHealth',
      label: 'Payment Reliability',
      available: hasValidPay,
      sourceColumn:
        detected.paymentStatusCol || detected.latePaymentsCol || detected.outstandingBalanceCol,
      configuredWeight: config.weights.paymentHealth,
      note: hasValidPay
        ? 'Derived from payment status, late payment count, or outstanding balance.'
        : 'No payment history or balance columns detected.',
    },
    {
      key: 'profit',
      label: 'Profit Contribution',
      available: profitAvailable,
      sourceColumn: detected.directProfitCol || detected.profitMarginCol || detected.costCol,
      configuredWeight: config.weights.profit,
      note: profitAvailable
        ? `Computed from "${detected.directProfitCol || detected.profitMarginCol || detected.costCol}".`
        : 'Unavailable — no profit margin or cost column uploaded.',
    },
    {
      key: 'growth',
      label: 'Spending Growth',
      available: hasValidGrowth,
      sourceColumn: detected.growthCol,
      configuredWeight: config.weights.growth,
      note: hasValidGrowth
        ? `Using "${detected.growthCol}".`
        : 'No spending or revenue growth column detected.',
    },
  ];

  const activeWeightSum = rawCriteriaDefs
    .filter((c) => c.available && c.configuredWeight > 0)
    .reduce((acc, c) => acc + c.configuredWeight, 0);

  const criteriaAvailability: ValueCriterionAvailability[] = rawCriteriaDefs.map((c) => ({
    ...c,
    effectiveWeight:
      c.available && activeWeightSum > 0
        ? Number(((c.configuredWeight / activeWeightSum) * 100).toFixed(1))
        : 0,
  }));

  const valueAssessmentAvailable = criteriaAvailability.some((c) => c.available && c.effectiveWeight > 0);
  if (!valueAssessmentAvailable) {
    return {
      datasetId: state.datasetId,
      generatedAt: new Date().toISOString(),
      totalCustomers: rows.length,
      valueAssessmentAvailable: false,
      unavailableReason:
        'No numeric value attributes (revenue, spend, frequency, tenure, payment history, or profit) were detected in this dataset. Map numeric customer attributes in Data Management to enable Customer Value Intelligence.',
      revenueAvailable: false,
      revenueBasisNote,
      profitAvailable: false,
      profitUnavailableReason,
      riskPredictionsAvailable: hasModelPredictions,
      riskUnavailableReason: hasModelPredictions
        ? null
        : 'Risk classification unavailable — no validated churn prediction model or scored predictions are active.',
      highValueCount: 0,
      mediumValueCount: 0,
      lowValueCount: 0,
      highValueAtRiskCount: null,
      totalPortfolioRevenue: null,
      totalPortfolioProfit: null,
      atRiskCustomersRevenue: null,
      estimatedExpectedRevenueExposure: null,
      highValueAtRiskRevenue: null,
      config,
      criteriaAvailability,
      segmentDistribution: [],
      fourGroupMatrix: [],
      recommendations: [],
      customers: [],
    };
  }

  // First pass: compute weighted composite score for every customer
  const preliminary = rows.map((row, idx) => {
    const customerId =
      mapping.idColumn && !isMissingValue(row[mapping.idColumn])
        ? row[mapping.idColumn].trim()
        : `CUST-${String(idx + 1).padStart(4, '0')}`;
    const customerName =
      detected.nameCol && !isMissingValue(row[detected.nameCol])
        ? row[detected.nameCol].trim()
        : '—';
    const segment =
      mapping.contractColumn && !isMissingValue(row[mapping.contractColumn])
        ? row[mapping.contractColumn].trim()
        : 'Unassigned';

    const factorInputs: {
      key: ValueCriterionAvailability['key'];
      label: string;
      score: number | null;
      rawDisplay: string;
    }[] = [
      {
        key: 'revenue',
        label: 'Revenue & Value',
        score: revenuePct[idx],
        rawDisplay:
          displayRevenues[idx].value !== null
            ? `$${displayRevenues[idx].value!.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
            : 'N/A',
      },
      {
        key: 'frequency',
        label: 'Purchase / Usage Frequency',
        score: frequencyPct[idx],
        rawDisplay: frequencyMetric[idx] !== null ? String(frequencyMetric[idx]) : 'N/A',
      },
      {
        key: 'tenure',
        label: 'Customer Lifetime',
        score: tenurePct[idx],
        rawDisplay: tenureMetric[idx] !== null ? `${tenureMetric[idx]} mo` : 'N/A',
      },
      {
        key: 'paymentHealth',
        label: 'Payment Reliability',
        score: paymentHealthMetric[idx],
        rawDisplay:
          paymentHealthMetric[idx] !== null ? `${paymentHealthMetric[idx]!.toFixed(0)}/100` : 'N/A',
      },
      {
        key: 'profit',
        label: 'Profit Contribution',
        score: profitPct[idx],
        rawDisplay:
          profitMetric[idx] !== null
            ? `$${profitMetric[idx]!.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
            : 'Unavailable',
      },
      {
        key: 'growth',
        label: 'Spending Growth',
        score: growthPct[idx],
        rawDisplay: growthMetric[idx] !== null ? `${growthMetric[idx]}%` : 'N/A',
      },
    ];

    let weightedSum = 0;
    let usedWeight = 0;
    const valueFactors: CustomerValueFactorContribution[] = [];

    for (const f of factorInputs) {
      const crit = criteriaAvailability.find((c) => c.key === f.key);
      if (crit && crit.available && crit.effectiveWeight > 0 && f.score !== null) {
        weightedSum += f.score * crit.effectiveWeight;
        usedWeight += crit.effectiveWeight;
        valueFactors.push({
          label: f.label,
          rawDisplay: f.rawDisplay,
          percentileScore: Number(f.score.toFixed(1)),
          weightPct: crit.effectiveWeight,
        });
      }
    }

    const valueScore = usedWeight > 0 ? Number((weightedSum / usedWeight).toFixed(1)) : 0;

    return {
      idx,
      rowIndex: idx + 1,
      customerId,
      customerName,
      segment,
      valueScore,
      valueFactors,
      revenueContribution: displayRevenues[idx].value,
      revenueLabel: displayRevenues[idx].label,
      annualizedRevenue: annualizedRevenues[idx],
      profitContribution: profitMetric[idx],
      profitMarginPct: profitMarginPcts[idx],
      row,
    };
  });

  // Data-driven segment cutoffs using quantiles of actual computed value scores
  const sortedScores = [...preliminary].map((p) => p.valueScore).sort((a, b) => a - b);
  const highCutoffScore =
    sortedScores[
      Math.min(
        sortedScores.length - 1,
        Math.floor((config.highValuePercentile / 100) * sortedScores.length)
      )
    ] ?? 75;
  const medCutoffScore =
    sortedScores[
      Math.min(
        sortedScores.length - 1,
        Math.floor((config.mediumValuePercentile / 100) * sortedScores.length)
      )
    ] ?? 35;

  // Build medians for complaint / satisfaction factor explanations
  const satMedian = (() => {
    if (!detected.satisfactionCol) return null;
    const vals = rows
      .map((r) => parseNumeric(r[detected.satisfactionCol!]))
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    return vals.length ? vals[Math.floor(vals.length / 2)] : null;
  })();

  const customers: CustomerValueRecord[] = preliminary.map((item) => {
    const valueSegment: ValueSegmentTier =
      item.valueScore >= highCutoffScore
        ? 'High Value'
        : item.valueScore >= medCutoffScore
          ? 'Medium Value'
          : 'Low Value';

    const predMatch =
      predByRowIndex.get(item.rowIndex) ||
      predByCustomerId.get(item.customerId.toLowerCase()) ||
      null;

    const riskAvailable = Boolean(predMatch);
    const churnProbability = predMatch ? predMatch.prob : null;
    const riskCategory = predMatch ? predMatch.riskCategory : null;

    let quadrant: ValueMatrixQuadrant = 'risk_unavailable';
    let quadrantLabel = 'Risk classification unavailable';
    let retentionPriority: CustomerValueRecord['retentionPriority'] = 'Unavailable';

    if (riskAvailable && churnProbability !== null) {
      const isHighRisk = churnProbability >= config.highRiskCutoff;
      if (valueSegment === 'High Value' && isHighRisk) {
        quadrant = 'critical_retention_priority';
        quadrantLabel = 'Critical retention priority';
        retentionPriority = 'Critical';
      } else if (valueSegment === 'High Value' && !isHighRisk) {
        quadrant = 'protect_and_maintain';
        quadrantLabel = 'Protect and maintain';
        retentionPriority = 'Medium';
      } else if (valueSegment !== 'High Value' && isHighRisk) {
        quadrant = 'monitor_and_assess';
        quadrantLabel = 'Monitor and assess';
        retentionPriority = valueSegment === 'Medium Value' ? 'High' : 'Medium';
      } else {
        quadrant = 'normal_monitoring';
        quadrantLabel = 'Normal monitoring';
        retentionPriority = 'Low';
      }
    }

    const expectedRevenueExposure =
      churnProbability !== null && item.annualizedRevenue !== null
        ? Number((item.annualizedRevenue * churnProbability).toFixed(2))
        : null;

    // Grounded per-customer risk factors from actual fields present
    const riskFactors: string[] = [];
    if (churnProbability !== null && churnProbability >= config.highRiskCutoff) {
      riskFactors.push(`Model risk ${(churnProbability * 100).toFixed(1)}%`);
    }
    if (detected.complaintsCol) {
      const c = parseNumeric(item.row[detected.complaintsCol]);
      if (c !== null && c >= 2) {
        riskFactors.push(`${c} complaint(s) logged`);
      }
    }
    if (detected.unresolvedTicketsCol) {
      const ut = parseNumeric(item.row[detected.unresolvedTicketsCol]);
      if (ut !== null && ut > 0) {
        riskFactors.push(`${ut} unresolved ticket(s)`);
      }
    } else if (detected.ticketsCol) {
      const tk = parseNumeric(item.row[detected.ticketsCol]);
      if (tk !== null && tk >= 3) {
        riskFactors.push(`${tk} support tickets`);
      }
    }
    if (detected.resolutionDaysCol) {
      const rd = parseNumeric(item.row[detected.resolutionDaysCol]);
      if (rd !== null && rd >= 5) {
        riskFactors.push(`${rd}d avg ticket resolution`);
      }
    }
    if (detected.satisfactionCol && satMedian !== null) {
      const sat = parseNumeric(item.row[detected.satisfactionCol]);
      if (sat !== null && sat < satMedian) {
        riskFactors.push(`Below-median satisfaction (${sat})`);
      }
    }
    if (detected.latePaymentsCol) {
      const lp = parseNumeric(item.row[detected.latePaymentsCol]);
      if (lp !== null && lp > 0) {
        riskFactors.push(`${lp} late payment(s)`);
      }
    }
    if (tenureMetric[item.idx] !== null && tenureMetric[item.idx]! <= 6) {
      riskFactors.push(`Early tenure (${tenureMetric[item.idx]} mo)`);
    }
    if (riskFactors.length === 0) {
      riskFactors.push(
        riskAvailable ? 'No acute service or billing friction signals' : 'Prediction model required for churn factors'
      );
    }

    return {
      rowIndex: item.rowIndex,
      customerId: item.customerId,
      customerName: item.customerName,
      segment: item.segment,
      valueScore: item.valueScore,
      valueSegment,
      valueFactors: item.valueFactors,
      revenueContribution: item.revenueContribution,
      revenueLabel: item.revenueLabel,
      annualizedRevenue: item.annualizedRevenue,
      profitContribution: item.profitContribution,
      profitMarginPct: item.profitMarginPct,
      churnProbability,
      riskCategory,
      riskAvailable,
      quadrant,
      quadrantLabel,
      expectedRevenueExposure,
      riskFactors,
      retentionPriority,
    };
  });

  // Sort customers by priority: expected exposure desc, then valueScore desc
  customers.sort((a, b) => {
    const expDiff = (b.expectedRevenueExposure ?? -1) - (a.expectedRevenueExposure ?? -1);
    if (expDiff !== 0) return expDiff;
    return b.valueScore - a.valueScore;
  });

  const highCustomers = customers.filter((c) => c.valueSegment === 'High Value');
  const medCustomers = customers.filter((c) => c.valueSegment === 'Medium Value');
  const lowCustomers = customers.filter((c) => c.valueSegment === 'Low Value');

  const highValueAtRiskCount = hasModelPredictions
    ? highCustomers.filter(
        (c) => c.churnProbability !== null && c.churnProbability >= config.highRiskCutoff
      ).length
    : null;

  const totalPortfolioRevenue = hasAnyRevenueField
    ? Number(
        customers.reduce((acc, c) => acc + (c.annualizedRevenue ?? 0), 0).toFixed(2)
      )
    : null;

  const totalPortfolioProfit = profitAvailable
    ? Number(
        customers.reduce((acc, c) => acc + (c.profitContribution ?? 0), 0).toFixed(2)
      )
    : null;

  const atRiskCustomersList = hasModelPredictions
    ? customers.filter(
        (c) => c.churnProbability !== null && c.churnProbability >= config.highRiskCutoff
      )
    : [];

  const atRiskCustomersRevenue =
    hasModelPredictions && hasAnyRevenueField
      ? Number(
          atRiskCustomersList.reduce((acc, c) => acc + (c.annualizedRevenue ?? 0), 0).toFixed(2)
        )
      : null;

  const estimatedExpectedRevenueExposure =
    hasModelPredictions && hasAnyRevenueField
      ? Number(
          customers.reduce((acc, c) => acc + (c.expectedRevenueExposure ?? 0), 0).toFixed(2)
        )
      : null;

  const highValueAtRiskRevenue =
    hasModelPredictions && hasAnyRevenueField
      ? Number(
          highCustomers
            .filter(
              (c) => c.churnProbability !== null && c.churnProbability >= config.highRiskCutoff
            )
            .reduce((acc, c) => acc + (c.annualizedRevenue ?? 0), 0)
            .toFixed(2)
        )
      : null;

  const segmentTiers: ValueSegmentTier[] = ['High Value', 'Medium Value', 'Low Value'];
  const segmentDistribution: ValueDistributionBucket[] = segmentTiers.map((seg) => {
    const group = customers.filter((c) => c.valueSegment === seg);
    const totalRev = hasAnyRevenueField
      ? Number(group.reduce((acc, c) => acc + (c.annualizedRevenue ?? 0), 0).toFixed(2))
      : null;
    const avgScore =
      group.length > 0
        ? Number((group.reduce((acc, c) => acc + c.valueScore, 0) / group.length).toFixed(1))
        : 0;
    const highRiskCount = group.filter(
      (c) => c.churnProbability !== null && c.churnProbability >= config.highRiskCutoff
    ).length;

    return {
      segment: seg,
      count: group.length,
      sharePercent: customers.length > 0 ? Number(((group.length / customers.length) * 100).toFixed(1)) : 0,
      totalRevenue: totalRev,
      avgValueScore: avgScore,
      highRiskCount,
    };
  });

  const quadrantDefs: {
    quadrant: ValueMatrixQuadrant;
    label: string;
    description: string;
  }[] = [
    {
      quadrant: 'critical_retention_priority',
      label: 'Critical retention priority',
      description: 'High value + High churn risk — immediate account executive outreach',
    },
    {
      quadrant: 'protect_and_maintain',
      label: 'Protect and maintain',
      description: 'High value + Low churn risk — loyalty recognition & proactive reviews',
    },
    {
      quadrant: 'monitor_and_assess',
      label: 'Monitor and assess',
      description: 'Medium / Low value + High churn risk — targeted automated retention & cost fit',
    },
    {
      quadrant: 'normal_monitoring',
      label: 'Normal monitoring',
      description: 'Medium / Low value + Low churn risk — standard lifecycle cadence',
    },
  ];

  const fourGroupMatrix: ValueMatrixGroupCount[] = hasModelPredictions
    ? quadrantDefs.map((qd) => {
        const group = customers.filter((c) => c.quadrant === qd.quadrant);
        return {
          quadrant: qd.quadrant,
          label: qd.label,
          description: qd.description,
          count: group.length,
          totalRevenue: hasAnyRevenueField
            ? Number(group.reduce((acc, c) => acc + (c.annualizedRevenue ?? 0), 0).toFixed(2))
            : null,
          expectedExposure:
            hasAnyRevenueField && group.some((c) => c.expectedRevenueExposure !== null)
              ? Number(
                  group.reduce((acc, c) => acc + (c.expectedRevenueExposure ?? 0), 0).toFixed(2)
                )
              : null,
        };
      })
    : [];

  // Evidence-based, honest recommendations (never claiming guaranteed prevention)
  const recommendations: CustomerValueRecommendation[] = [];

  if (hasModelPredictions) {
    const criticalGroup = customers.filter((c) => c.quadrant === 'critical_retention_priority');
    if (criticalGroup.length > 0) {
      const critRev = hasAnyRevenueField
        ? Number(criticalGroup.reduce((acc, c) => acc + (c.annualizedRevenue ?? 0), 0).toFixed(2))
        : null;
      recommendations.push({
        id: 'val-rec-critical',
        priority: 'Critical',
        title: `Prioritise Outreach for ${criticalGroup.length} High-Value At-Risk Accounts`,
        targetSegment: 'High Value + High Churn Risk',
        affectedCustomers: criticalGroup.length,
        estimatedRevenueAtRisk: critRev,
        evidence: `${criticalGroup.length} top-tier accounts exceed ${(config.highRiskCutoff * 100).toFixed(0)}% estimated churn probability${
          critRev !== null ? `, representing $${critRev.toLocaleString()} in annualized revenue associated with elevated churn risk` : ''
        }.`,
        recommendedAction:
          'Assign executive or account-manager review calls within 7 days, resolve open support escalations first, and test tailored renewal terms. Outcomes should be tracked as outreach responses are recorded.',
      });
    }

    const protectGroup = customers.filter((c) => c.quadrant === 'protect_and_maintain');
    if (protectGroup.length > 0) {
      const protRev = hasAnyRevenueField
        ? Number(protectGroup.reduce((acc, c) => acc + (c.annualizedRevenue ?? 0), 0).toFixed(2))
        : null;
      recommendations.push({
        id: 'val-rec-protect',
        priority: 'Moderate',
        title: `Safeguard ${protectGroup.length} Stable High-Value Accounts`,
        targetSegment: 'High Value + Low Churn Risk',
        affectedCustomers: protectGroup.length,
        estimatedRevenueAtRisk: protRev,
        evidence: `${protectGroup.length} high-value accounts currently exhibit lower churn risk under the active model.`,
        recommendedAction:
          'Maintain quarterly business reviews and monitor service ticket delays or usage drops early so stability is preserved.',
      });
    }
  } else {
    recommendations.push({
      id: 'val-rec-model-needed',
      priority: 'High',
      title: 'Enable Validated Churn Model to Unlock Revenue Exposure Matrix',
      targetSegment: 'All Value Segments',
      affectedCustomers: highCustomers.length,
      estimatedRevenueAtRisk: null,
      evidence: `${highCustomers.length} High-Value accounts are segmented from your financial and behavioural attributes, while churn probabilities await a validated prediction model.`,
      recommendedAction:
        'Upload historical churn outcomes or record observed customer outcomes in Data Management to pair High-Value accounts with validated churn probabilities.',
    });
  }

  // Service friction among high-value accounts (complaints / unresolved tickets)
  if (detected.complaintsCol || detected.unresolvedTicketsCol) {
    const highValueServiceFriction = highCustomers.filter((c) => {
      const idx = c.rowIndex - 1;
      const comp = detected.complaintsCol ? parseNumeric(rows[idx]?.[detected.complaintsCol]) : null;
      const unres = detected.unresolvedTicketsCol
        ? parseNumeric(rows[idx]?.[detected.unresolvedTicketsCol])
        : null;
      return (comp !== null && comp >= 2) || (unres !== null && unres > 0);
    });
    if (highValueServiceFriction.length > 0) {
      const svcRev = hasAnyRevenueField
        ? Number(
            highValueServiceFriction
              .reduce((acc, c) => acc + (c.annualizedRevenue ?? 0), 0)
              .toFixed(2)
          )
        : null;
      recommendations.push({
        id: 'val-rec-service-friction',
        priority: 'High',
        title: `Resolve Support Friction on ${highValueServiceFriction.length} High-Value Accounts`,
        targetSegment: 'High Value with Open Tickets / Complaints',
        affectedCustomers: highValueServiceFriction.length,
        estimatedRevenueAtRisk: svcRev,
        evidence: `${highValueServiceFriction.length} high-value customers show unresolved support tickets or repeated complaints in the uploaded records.`,
        recommendedAction:
          'Route these accounts to priority support queues and audit average resolution delays before their next renewal checkpoint.',
      });
    }
  }

  return {
    datasetId: state.datasetId,
    generatedAt: new Date().toISOString(),
    totalCustomers: customers.length,
    valueAssessmentAvailable: true,
    unavailableReason: null,
    revenueAvailable: hasAnyRevenueField,
    revenueBasisNote,
    profitAvailable,
    profitUnavailableReason,
    riskPredictionsAvailable: hasModelPredictions,
    riskUnavailableReason: hasModelPredictions
      ? null
      : 'Risk classification unavailable — no validated churn prediction model or scored customer batch is active yet.',
    highValueCount: highCustomers.length,
    mediumValueCount: medCustomers.length,
    lowValueCount: lowCustomers.length,
    highValueAtRiskCount,
    totalPortfolioRevenue,
    totalPortfolioProfit,
    atRiskCustomersRevenue,
    estimatedExpectedRevenueExposure,
    highValueAtRiskRevenue,
    config,
    criteriaAvailability,
    segmentDistribution,
    fourGroupMatrix,
    recommendations,
    customers,
  };
}
