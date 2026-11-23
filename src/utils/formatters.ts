import type {
  ColumnDataType,
  ColumnMapping,
  ColumnProfile,
  ColumnSemanticRole,
  CompanyWorkspaceInfo,
  DatasetState,
  SatisfactionScale,
} from '../types/churn';

export interface FormatFieldContext {
  dataset?: Pick<
    DatasetState,
    'columns' | 'mapping' | 'satisfactionScale'
  > | null;
  company?: Pick<CompanyWorkspaceInfo, 'industry' | 'satisfactionScale'> | null;
  columns?: ColumnProfile[];
  mapping?: Partial<ColumnMapping>;
  satisfactionScale?: SatisfactionScale;
  observedMax?: number;
  dataType?: ColumnDataType;
  semanticRole?: ColumnSemanticRole;
}

const MONTH_ABBRS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const INVALID_VALUE_STRINGS = new Set([
  '',
  'na',
  'n/a',
  'null',
  'undefined',
  'nan',
  'none',
  'unavailable',
  'not available',
  '—',
  '-',
  '-- [object object] --',
  '[object object]',
]);

const FIELD_LABEL_OVERRIDES: Record<string, string> = {
  customer_id: 'Customer ID',
  cust_id: 'Customer ID',
  account_id: 'Account ID',
  member_id: 'Member ID',
  patient_id: 'Patient ID',
  policy_id: 'Policy ID',
  student_id: 'Student ID',
  customer_name: 'Customer Name',
  full_name: 'Full Name',
  account_name: 'Account Name',
  company_name: 'Company Name',
  total_revenue: 'Total Revenue',
  annual_revenue: 'Annual Revenue',
  annualized_revenue: 'Annualized Revenue',
  monthly_revenue: 'Monthly Revenue',
  monthly_charges: 'Monthly Charges',
  total_charges: 'Total Charges',
  average_transaction_value: 'Average Transaction Value',
  avg_transaction_value: 'Average Transaction Value',
  avg_order_value: 'Average Order Value',
  average_order_value: 'Average Order Value',
  contract_value: 'Contract Value',
  annual_contract_value: 'Annual Contract Value',
  acv: 'Annual Contract Value (ACV)',
  mrr: 'Monthly Recurring Revenue (MRR)',
  arr: 'Annual Recurring Revenue (ARR)',
  ltv: 'Lifetime Value (LTV)',
  clv: 'Customer Lifetime Value (CLV)',
  monthly_dues: 'Monthly Dues',
  monthly_premium: 'Monthly Premium',
  tuition_fee: 'Tuition Fee',
  avg_visit_billing: 'Average Visit Billing',
  profit_margin: 'Profit Margin',
  gross_margin: 'Gross Margin',
  net_margin: 'Net Margin',
  margin_pct: 'Profit Margin',
  profit_contribution: 'Profit Contribution',
  net_profit: 'Net Profit',
  gross_profit: 'Gross Profit',
  service_cost: 'Service Cost',
  acquisition_cost: 'Acquisition Cost',
  cac: 'Customer Acquisition Cost (CAC)',
  outstanding_balance: 'Outstanding Balance',
  account_balance: 'Account Balance',
  spend_growth: 'Spend Growth',
  spending_growth: 'Spending Growth',
  revenue_growth: 'Revenue Growth',
  growth_pct: 'Growth Rate',
  discount_pct: 'Discount Rate',
  churn_rate: 'Churn Rate',
  assignments_completed_pct: 'Assignments Completed',
  tenure_months: 'Customer Tenure',
  customer_tenure_months: 'Customer Tenure',
  tenure: 'Customer Tenure',
  months_subscribed: 'Months Subscribed',
  membership_months: 'Membership Duration',
  average_resolution_days: 'Average Resolution Time',
  avg_resolution_days: 'Average Resolution Time',
  avg_resolution_time: 'Average Resolution Time',
  resolution_days: 'Resolution Time',
  days_since_last_purchase: 'Days Since Last Purchase',
  days_since_last_activity: 'Days Since Last Activity',
  days_quiet: 'Days Since Last Activity',
  inactivity_days: 'Inactivity Days',
  customer_satisfaction_score: 'Customer Satisfaction',
  csat_score: 'Customer Satisfaction',
  satisfaction_score: 'Customer Satisfaction',
  feedback_score: 'Feedback Score',
  nps_score: 'Net Promoter Score (NPS)',
  usage_score: 'Usage Score',
  data_usage: 'Monthly Data Usage (GB)',
  engagement_score: 'Engagement Score',
  risk_score: 'Risk Score',
  value_score: 'Value Score',
  composite_score: 'Composite Score',
  support_calls: 'Support Calls',
  service_calls: 'Service Calls',
  late_payment_count: 'Late Payments',
  late_payments: 'Late Payments',
  missed_payments: 'Missed Payments',
  failed_payments: 'Failed Payments',
  total_complaints: 'Total Complaints',
  complaint_count: 'Complaints',
  complaints: 'Complaints',
  total_tickets_raised: 'Tickets Raised',
  tickets_raised: 'Tickets Raised',
  ticket_count: 'Support Tickets',
  support_tickets: 'Support Tickets',
  open_tickets: 'Open Tickets',
  resolved_tickets: 'Resolved Tickets',
  unresolved_tickets: 'Unresolved Tickets',
  purchase_frequency: 'Purchase Frequency',
  monthly_transactions: 'Monthly Transactions',
  transaction_count: 'Transactions',
  monthly_visits: 'Monthly Visits',
  internet_service: 'Internet Service',
  phone_service: 'Phone Service',
  multiple_lines: 'Multiple Lines',
  online_security: 'Online Security',
  online_backup: 'Online Backup',
  device_protection: 'Device Protection',
  tech_support: 'Tech Support',
  streaming_tv: 'Streaming TV',
  streaming_movies: 'Streaming Movies',
  contract_type: 'Contract Type',
  contract: 'Contract Type',
  customer_type: 'Customer Type',
  country_region: 'Country / Region',
  senior_citizen: 'Senior Citizen',
  payment_method: 'Payment Method',
  payment_status: 'Payment Status',
  paperless_billing: 'Paperless Billing',
  auto_pay: 'Auto-Pay',
  autopay: 'Auto-Pay',
  auto_renewal: 'Auto-Renewal',
  plan_tier: 'Plan Tier',
  subscription_plan: 'Subscription Plan',
  customer_segment: 'Customer Segment',
  segment: 'Segment',
  churn_status: 'Churn Status',
  customer_status: 'Customer Status',
  actual_status: 'Actual Status',
  observation_date: 'Observation Date',
  registration_date: 'Registration Date',
  last_activity_date: 'Last Activity Date',
  last_purchase_date: 'Last Purchase Date',
  subscription_end_date: 'Subscription End Date',
  churn_date: 'Churn Date',
  cancellation_date: 'Cancellation Date',
  renewal_date: 'Renewal Date',
  payment_due_date: 'Payment Due Date',
  created_at: 'Created Date',
  uploaded_at: 'Upload Date',
};

const ACRONYMS = new Set([
  'ID',
  'USD',
  'MRR',
  'ARR',
  'LTV',
  'CLV',
  'CAC',
  'ACV',
  'CSAT',
  'NPS',
  'SLA',
  'B2B',
  'B2C',
  'B2B2C',
  'API',
  'TV',
  'DSL',
  'VIP',
]);

export function normalizeFieldKey(fieldName: string): string {
  return String(fieldName || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function isMissingDisplayValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  if (typeof value === 'boolean') return false;
  if (typeof value === 'object') {
    if (value instanceof Date) return Number.isNaN(value.getTime());
    return true;
  }
  const str = String(value).trim().toLowerCase();
  return INVALID_VALUE_STRINGS.has(str);
}

export function parseNumericValue(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'object') return null;
  const raw = String(value).trim();
  if (!raw || INVALID_VALUE_STRINGS.has(raw.toLowerCase())) return null;

  // Strip surrounding $, USD, %, commas, and whitespace safely without mutating sign
  const cleaned = raw
    .replace(/\bUSD\b/gi, '')
    .replace(/[$%,\s]/g, '');
  if (!cleaned || !/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(cleaned)) {
    return null;
  }
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

export function formatCurrencyUSD(
  value: unknown,
  options: { fallback?: string; decimals?: number } = {}
): string {
  const { fallback = '—', decimals = 2 } = options;
  if (isMissingDisplayValue(value)) return fallback;
  const num = parseNumericValue(value);
  if (num === null) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }
  if (Math.abs(num) < 1e-9) {
    return `$${(0).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  }
  const absFormatted = Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return num < 0 ? `-$${absFormatted}` : `$${absFormatted}`;
}

export function formatPercentage(
  value: unknown,
  decimals = 1,
  options: { fallback?: string } = {}
): string {
  const { fallback = '—' } = options;
  if (isMissingDisplayValue(value)) return fallback;
  const num = parseNumericValue(value);
  if (num === null) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }
  const normalizedZero = Math.abs(num) < 1e-9 ? 0 : num;
  const formatted = normalizedZero.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${formatted}%`;
}

export function formatDuration(
  value: unknown,
  unit: 'month' | 'day' | 'hour' | 'year',
  decimals?: number
): string {
  if (isMissingDisplayValue(value)) return '—';
  let num = parseNumericValue(value);
  if (num === null && typeof value === 'string') {
    const match = value
      .trim()
      .match(/^([+-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:months?|mos?|days?|d|hours?|hrs?|h|years?|yrs?|y)$/i);
    if (match) {
      num = parseNumericValue(match[1]);
    }
  }
  if (num === null) {
    return typeof value === 'string' && value.trim() ? value.trim() : '—';
  }
  const resolvedDecimals =
    decimals !== undefined ? decimals : Number.isInteger(num) ? 0 : 1;
  const rounded = Number(num.toFixed(resolvedDecimals));
  const formattedNumber = rounded.toLocaleString('en-US', {
    minimumFractionDigits: resolvedDecimals,
    maximumFractionDigits: resolvedDecimals,
  });
  const label = Math.abs(rounded) === 1 ? unit : `${unit}s`;
  return `${formattedNumber} ${label}`;
}

export function formatCount(
  value: unknown,
  singular: string,
  plural = `${singular}s`
): string {
  if (isMissingDisplayValue(value)) return '—';
  let num = parseNumericValue(value);
  if (num === null && typeof value === 'string') {
    const stripped = value
      .trim()
      .replace(new RegExp(`\\s*(?:${singular}|${plural})$`, 'i'), '');
    num = parseNumericValue(stripped);
  }
  if (num === null) {
    return typeof value === 'string' && value.trim() ? value.trim() : '—';
  }
  const decimals = Number.isInteger(num) ? 0 : 1;
  const rounded = Number(num.toFixed(decimals));
  const formattedNumber = rounded.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const unit = Math.abs(rounded) === 1 ? singular : plural;
  return `${formattedNumber} ${unit}`;
}

export function resolveSatisfactionScale(
  fieldOrScale?: string,
  context?: FormatFieldContext,
  numericValue?: number | null
): SatisfactionScale {
  if (
    fieldOrScale === '1-5' ||
    fieldOrScale === '1-10' ||
    fieldOrScale === '0-100' ||
    fieldOrScale === 'nps'
  ) {
    return fieldOrScale;
  }

  const norm = fieldOrScale ? normalizeFieldKey(fieldOrScale) : '';
  if (norm.includes('nps') || norm.includes('net_promoter')) {
    return 'nps';
  }

  const configuredScale =
    context?.satisfactionScale ||
    context?.dataset?.satisfactionScale ||
    context?.company?.satisfactionScale;

  if (configuredScale) {
    if (
      configuredScale === '1-5' &&
      ((numericValue !== null && numericValue !== undefined && numericValue > 5) ||
        (context?.observedMax !== undefined && context.observedMax > 5))
    ) {
      const peak = Math.max(numericValue ?? 0, context?.observedMax ?? 0);
      return peak <= 10 ? '1-10' : '0-100';
    }
    return configuredScale;
  }

  const peak = Math.max(numericValue ?? 0, context?.observedMax ?? 0);
  if (peak > 10) return '0-100';
  if (peak > 5) return '1-10';
  return '1-5';
}

export function formatScore(
  value: unknown,
  fieldOrScale?: string,
  context?: FormatFieldContext
): string {
  if (isMissingDisplayValue(value)) return '—';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+(?:\.\d+)?\s*\/\s*(?:5|10|100)$/.test(trimmed)) {
      const [rawN, rawMax] = trimmed.split('/').map((s) => s.trim());
      const n = parseNumericValue(rawN);
      if (n !== null) {
        const numText = Number.isInteger(n) ? String(n) : n.toFixed(1);
        return `${numText}/${rawMax}`;
      }
      return trimmed;
    }
    if (/NPS/i.test(trimmed)) return trimmed;
  }

  const num = parseNumericValue(value);
  if (num === null) {
    return typeof value === 'string' && value.trim() ? value.trim() : '—';
  }

  const norm = fieldOrScale ? normalizeFieldKey(fieldOrScale) : '';
  const isHundredPointScore =
    fieldOrScale === '0-100' ||
    /(usage_score|engagement_score|risk_score|value_score|composite_score|health_score|loyalty_score|readiness_score)/.test(
      norm
    );

  const formattedNum = Number.isInteger(num)
    ? num.toLocaleString('en-US')
    : Number(num.toFixed(1)).toLocaleString('en-US', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });

  if (isHundredPointScore) {
    return `${formattedNum}/100`;
  }

  const scale = resolveSatisfactionScale(fieldOrScale, context, num);
  if (scale === 'nps') {
    const signed = num > 0 ? `+${formattedNum}` : formattedNum;
    return `${signed} NPS (-100 to 100)`;
  }
  if (scale === '0-100') return `${formattedNum}/100`;
  if (scale === '1-10') return `${formattedNum}/10`;
  return `${formattedNum}/5`;
}

export function formatReadableDate(
  value: unknown,
  options: { includeTime?: boolean } = {}
): string {
  const { includeTime = false } = options;
  if (isMissingDisplayValue(value)) return '—';

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '—';
    const base = `${value.getUTCDate()} ${MONTH_ABBRS[value.getUTCMonth()]} ${value.getUTCFullYear()}`;
    if (!includeTime) return base;
    const hh = String(value.getHours()).padStart(2, '0');
    const mm = String(value.getMinutes()).padStart(2, '0');
    return `${base}, ${hh}:${mm}`;
  }

  const str = String(value).trim();
  if (!str) return '—';

  // Already formatted like "23 Nov 2026"
  if (/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}(?:,\s*\d{2}:\d{2})?$/.test(str)) {
    return str;
  }

  // Timezone-safe YYYY-MM-DD or YYYY/MM/DD (with optional ISO timestamp)
  const isoMatch = str.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/
  );
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      if (includeTime && isoMatch[4] && isoMatch[5]) {
        const parsed = new Date(str);
        if (!Number.isNaN(parsed.getTime())) {
          const d = parsed.getDate();
          const m = MONTH_ABBRS[parsed.getMonth()];
          const y = parsed.getFullYear();
          const hh = String(parsed.getHours()).padStart(2, '0');
          const mm = String(parsed.getMinutes()).padStart(2, '0');
          return `${d} ${m} ${y}, ${hh}:${mm}`;
        }
      }
      return `${day} ${MONTH_ABBRS[month - 1]} ${year}`;
    }
  }

  // Generic date fallback (for full RFC/JS timestamps)
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    const base = `${parsed.getDate()} ${MONTH_ABBRS[parsed.getMonth()]} ${parsed.getFullYear()}`;
    if (!includeTime) return base;
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mm = String(parsed.getMinutes()).padStart(2, '0');
    return `${base}, ${hh}:${mm}`;
  }

  return str;
}

export function formatCategoricalValue(fieldName: string, value: unknown): string {
  if (isMissingDisplayValue(value)) return '—';
  const raw = String(value).trim();
  const normField = normalizeFieldKey(fieldName);
  const normVal = raw.toLowerCase().replace(/\s+/g, ' ').trim();

  if (normField === 'internet_service' || normField === 'internetservice') {
    if (normVal === 'no' || normVal === 'none' || normVal === '0' || normVal === 'false') {
      return 'No internet service';
    }
    if (normVal === 'dsl') return 'DSL';
    if (normVal === 'fiber_optic' || normVal === 'fiber optic' || normVal === 'fiber') {
      return 'Fiber optic';
    }
  }

  if (normField === 'phone_service' || normField === 'phoneservice') {
    if (normVal === 'no' || normVal === '0' || normVal === 'false') return 'No phone service';
    if (normVal === 'yes' || normVal === '1' || normVal === 'true') return 'Yes';
  }

  if (
    /(multiple_lines|online_security|online_backup|device_protection|tech_support|streaming_tv|streaming_movies)/.test(
      normField
    )
  ) {
    if (normVal === 'no internet service' || normVal === 'no_internet_service') {
      return 'No internet service';
    }
    if (normVal === 'no phone service' || normVal === 'no_phone_service') {
      return 'No phone service';
    }
    if (normVal === 'yes' || normVal === '1' || normVal === 'true') return 'Yes';
    if (normVal === 'no' || normVal === '0' || normVal === 'false') return 'No';
  }

  if (
    normField === 'customer_type' ||
    normField === 'client_type' ||
    normField === 'account_type'
  ) {
    if (normVal === 'b2b') return 'Business customer (B2B)';
    if (normVal === 'b2c') return 'Consumer (B2C)';
    if (normVal === 'b2b2c') return 'Partner / Hybrid (B2B2C)';
  }

  if (
    normField === 'senior_citizen' ||
    normField === 'seniorcitizen' ||
    normField === 'is_senior'
  ) {
    if (normVal === '1' || normVal === 'yes' || normVal === 'true' || normVal === 'senior citizen') {
      return 'Senior citizen';
    }
    if (normVal === '0' || normVal === 'no' || normVal === 'false' || normVal === 'not senior citizen') {
      return 'Not senior citizen';
    }
  }

  if (
    /(paperless_billing|auto_pay|autopay|auto_renewal|is_active|verified)/.test(normField)
  ) {
    if (normVal === '1' || normVal === 'true' || normVal === 'yes') return 'Yes';
    if (normVal === '0' || normVal === 'false' || normVal === 'no') return 'No';
  }

  if (normField === 'payment_status') {
    if (normVal === 'paid') return 'Paid';
    if (normVal === 'unpaid') return 'Unpaid';
    if (normVal === 'overdue') return 'Overdue';
    if (normVal === 'late') return 'Late';
    if (normVal === 'pending') return 'Pending';
  }

  if (normField === 'churn_status' || normField === 'customer_status' || normField === 'status') {
    if (normVal === 'active') return 'Active';
    if (normVal === 'retained') return 'Retained';
    if (normVal === 'churned') return 'Churned';
    if (normVal === 'paused') return 'Paused';
    if (normVal === 'trial') return 'Trial';
  }

  return raw;
}

export function parseFeatureIdentifier(feature: string): {
  baseField: string;
  categoryValue: string | null;
  isOneHot: boolean;
} {
  const raw = String(feature || '').trim();
  const eqIdx = raw.indexOf(' = ');
  if (eqIdx > 0) {
    return {
      baseField: raw.slice(0, eqIdx).trim(),
      categoryValue: raw.slice(eqIdx + 3).trim(),
      isOneHot: true,
    };
  }
  const tightEqIdx = raw.indexOf('=');
  if (tightEqIdx > 0 && !raw.includes('==')) {
    return {
      baseField: raw.slice(0, tightEqIdx).trim(),
      categoryValue: raw.slice(tightEqIdx + 1).trim(),
      isOneHot: true,
    };
  }
  return {
    baseField: raw,
    categoryValue: null,
    isOneHot: false,
  };
}

export function getHumanReadableFieldLabel(
  fieldName: string,
  _context?: FormatFieldContext
): string {
  const raw = String(fieldName || '').trim();
  if (!raw) return 'Field';

  const { baseField, categoryValue, isOneHot } = parseFeatureIdentifier(raw);
  const norm = normalizeFieldKey(baseField);

  let baseLabel = FIELD_LABEL_OVERRIDES[norm];
  if (!baseLabel) {
    const words = baseField
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_\-]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    baseLabel = words
      .map((w) => {
        const upper = w.toUpperCase();
        if (ACRONYMS.has(upper)) return upper;
        if (w.toLowerCase() === 'avg') return 'Average';
        if (w.toLowerCase() === 'pct') return 'Percentage';
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      })
      .join(' ');
  }

  if (isOneHot && categoryValue !== null) {
    const formattedCat = formatCategoricalValue(baseField, categoryValue);
    return `${baseLabel} (${formattedCat})`;
  }

  return baseLabel;
}

export function formatFeatureDisplayName(
  feature: string,
  context?: FormatFieldContext
): string {
  const { baseField, categoryValue, isOneHot } = parseFeatureIdentifier(feature);
  const label = getHumanReadableFieldLabel(baseField, context);
  if (isOneHot && categoryValue !== null) {
    return `${label} (${formatCategoricalValue(baseField, categoryValue)})`;
  }
  return label;
}

export type InferredFieldKind =
  | 'identifier'
  | 'percentage'
  | 'satisfaction_score'
  | 'hundred_score'
  | 'duration_months'
  | 'duration_days'
  | 'duration_hours'
  | 'duration_years'
  | 'count_calls'
  | 'count_payments'
  | 'count_complaints'
  | 'count_open_tickets'
  | 'count_resolved_tickets'
  | 'count_unresolved_tickets'
  | 'count_tickets'
  | 'count_transactions'
  | 'currency_usd'
  | 'date'
  | 'categorical'
  | 'numeric';

function resolveProfileAndMapping(
  fieldName: string,
  context?: FormatFieldContext
): {
  profile?: ColumnProfile;
  mapping?: Partial<ColumnMapping>;
} {
  const norm = normalizeFieldKey(fieldName);
  const columns = context?.columns || context?.dataset?.columns || [];
  const profile = columns.find(
    (c) => c.name === fieldName || normalizeFieldKey(c.name) === norm
  );
  const mapping = context?.mapping || context?.dataset?.mapping;
  return { profile, mapping };
}

export function inferFieldKind(
  fieldName: string,
  context?: FormatFieldContext
): InferredFieldKind {
  const norm = normalizeFieldKey(fieldName);
  const { profile, mapping } = resolveProfileAndMapping(fieldName, context);
  const dataType = context?.dataType ?? profile?.dataType;
  const semanticRole = context?.semanticRole ?? profile?.semanticRole;

  if (
    semanticRole === 'id' ||
    dataType === 'identifier' ||
    mapping?.idColumn === fieldName ||
    /(^|_)(id|email|phone|zip|postal|code)$/.test(norm) ||
    /(customer_name|full_name|account_name|company_name)/.test(norm)
  ) {
    return 'identifier';
  }

  if (
    semanticRole === 'date' ||
    semanticRole === 'observation_date' ||
    semanticRole === 'registration_date' ||
    semanticRole === 'churn_date' ||
    dataType === 'date' ||
    mapping?.dateColumn === fieldName ||
    mapping?.observationDateColumn === fieldName ||
    mapping?.registrationDateColumn === fieldName ||
    mapping?.churnDateColumn === fieldName ||
    /(^|_)(date|dob|created_at|updated_at|uploaded_at)$/.test(norm) ||
    /^(last_activity|last_purchase|subscription_end|renewal|cancellation|observation|registration)_date$/.test(
      norm
    )
  ) {
    return 'date';
  }

  if (
    semanticRole === 'target' ||
    semanticRole === 'status' ||
    semanticRole === 'segment' ||
    mapping?.targetColumn === fieldName ||
    mapping?.statusColumn === fieldName ||
    mapping?.contractColumn === fieldName
  ) {
    return 'categorical';
  }

  if (
    /(margin|churn_rate|discount_pct|spend_growth|spending_growth|revenue_growth|growth_pct|utilization_rate|completion_rate|attendance_rate|claim_ratio|dropout_risk|assignments_completed_pct)/.test(
      norm
    ) ||
    /_(pct|percent|percentage|rate)$/.test(norm)
  ) {
    return 'percentage';
  }

  if (
    /(usage_score|engagement_score|risk_score|value_score|composite_score|health_score|loyalty_score|readiness_score)/.test(
      norm
    )
  ) {
    return 'hundred_score';
  }

  if (
    semanticRole === 'satisfaction' ||
    /(satisfaction|csat|nps|feedback_score|net_promoter)/.test(norm)
  ) {
    return 'satisfaction_score';
  }

  if (
    semanticRole === 'resolution_days' ||
    /(resolution_days|resolution_time|days_since|days_quiet|inactivity_days|days_overdue)/.test(
      norm
    ) ||
    /_days$/.test(norm)
  ) {
    return 'duration_days';
  }

  if (/_hours$/.test(norm) || /response_time_hours/.test(norm)) {
    return 'duration_hours';
  }

  if (/_years$/.test(norm)) {
    return 'duration_years';
  }

  if (
    semanticRole === 'tenure' ||
    mapping?.tenureColumn === fieldName ||
    /(tenure_months|customer_tenure|months_subscribed|membership_months|subscription_months)/.test(
      norm
    ) ||
    norm === 'tenure' ||
    /_months$/.test(norm)
  ) {
    return 'duration_months';
  }

  if (/(late_payment|missed_payment|failed_payment)/.test(norm)) {
    return 'count_payments';
  }

  if (/(support_calls|service_calls|calls_count|call_count)/.test(norm)) {
    return 'count_calls';
  }

  if (semanticRole === 'complaints' || /(complaint)/.test(norm)) {
    return 'count_complaints';
  }

  if (/open_tickets/.test(norm)) {
    return 'count_open_tickets';
  }

  if (/unresolved_tickets/.test(norm)) {
    return 'count_unresolved_tickets';
  }

  if (/resolved_tickets/.test(norm)) {
    return 'count_resolved_tickets';
  }

  if (semanticRole === 'tickets' || /(tickets_raised|ticket_count|support_tickets)/.test(norm)) {
    return 'count_tickets';
  }

  if (
    semanticRole === 'revenue' ||
    semanticRole === 'profit' ||
    semanticRole === 'cost' ||
    mapping?.monthlyChargesColumn === fieldName ||
    /(revenue|charges|transaction_value|order_value|contract_value|profit|service_cost|acquisition_cost|outstanding_balance|balance|mrr|arr|ltv|clv|cac|acv|tuition_fee|monthly_dues|monthly_premium|visit_billing|total_spend|monthly_spend|refund_amount|discount_amount)/.test(
      norm
    )
  ) {
    return 'currency_usd';
  }

  if (/(transactions|orders_count|purchase_frequency)/.test(norm)) {
    return dataType === 'numeric' ? 'count_transactions' : 'numeric';
  }

  if (dataType === 'categorical') {
    return 'categorical';
  }

  if (dataType === 'numeric') {
    return 'numeric';
  }

  return 'categorical';
}

export function formatAttributeValue(
  fieldName: string,
  rawValue: unknown,
  context?: FormatFieldContext
): string {
  if (isMissingDisplayValue(rawValue)) return '—';

  const kind = inferFieldKind(fieldName, context);

  switch (kind) {
    case 'identifier':
      return String(rawValue).trim();
    case 'currency_usd':
      return formatCurrencyUSD(rawValue);
    case 'percentage':
      return formatPercentage(rawValue, 1);
    case 'satisfaction_score':
      return formatScore(rawValue, fieldName, context);
    case 'hundred_score':
      return formatScore(rawValue, '0-100', context);
    case 'duration_months':
      return formatDuration(rawValue, 'month');
    case 'duration_days':
      return formatDuration(rawValue, 'day');
    case 'duration_hours':
      return formatDuration(rawValue, 'hour');
    case 'duration_years':
      return formatDuration(rawValue, 'year');
    case 'count_calls':
      return formatCount(rawValue, 'call', 'calls');
    case 'count_payments':
      return formatCount(rawValue, 'payment', 'payments');
    case 'count_complaints':
      return formatCount(rawValue, 'complaint', 'complaints');
    case 'count_open_tickets':
      return formatCount(rawValue, 'open ticket', 'open tickets');
    case 'count_resolved_tickets':
      return formatCount(rawValue, 'resolved ticket', 'resolved tickets');
    case 'count_unresolved_tickets':
      return formatCount(rawValue, 'unresolved ticket', 'unresolved tickets');
    case 'count_tickets':
      return formatCount(rawValue, 'ticket', 'tickets');
    case 'count_transactions': {
      const n = parseNumericValue(rawValue);
      if (n !== null) {
        return Number.isInteger(n)
          ? n.toLocaleString('en-US')
          : Number(n.toFixed(1)).toLocaleString('en-US', {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            });
      }
      return String(rawValue).trim();
    }
    case 'date':
      return formatReadableDate(rawValue);
    case 'numeric': {
      const n = parseNumericValue(rawValue);
      if (n !== null) {
        return Number.isInteger(n)
          ? n.toLocaleString('en-US')
          : Number(n.toFixed(2)).toLocaleString('en-US', {
              maximumFractionDigits: 2,
            });
      }
      return formatCategoricalValue(fieldName, rawValue);
    }
    case 'categorical':
    default: {
      // Check if it looks like a contextual category first, otherwise if numeric string on an untyped field, return nicely
      return formatCategoricalValue(fieldName, rawValue);
    }
  }
}

export function getFieldUnitHint(
  fieldName: string,
  context?: FormatFieldContext
): string | null {
  const kind = inferFieldKind(fieldName, context);
  switch (kind) {
    case 'currency_usd':
      return 'USD ($)';
    case 'percentage':
      return '%';
    case 'duration_months':
      return 'months';
    case 'duration_days':
      return 'days';
    case 'duration_hours':
      return 'hours';
    case 'duration_years':
      return 'years';
    case 'hundred_score':
      return '0–100';
    case 'satisfaction_score': {
      const scale = resolveSatisfactionScale(fieldName, context);
      return scale === 'nps' ? '-100 to 100 NPS' : scale;
    }
    default:
      return null;
  }
}
