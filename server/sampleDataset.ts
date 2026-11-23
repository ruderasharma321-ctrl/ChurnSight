import type { IndustryKey } from '../src/types/churn.ts';

// Deterministic pseudo-random generator so demonstration datasets are
// reproducible across server restarts while exhibiting realistic domain churn patterns.
function createSeededRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function escapeCsvCell(value: string): string {
  if (value === '') return '';
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function addDaysIso(isoDate: string, deltaDays: number): string {
  const baseMs = Date.parse(`${isoDate}T00:00:00Z`);
  return new Date(baseMs + deltaDays * 86400000).toISOString().slice(0, 10);
}

function pickWeighted<T>(rng: () => number, items: { value: T; weight: number }[]): T {
  const total = items.reduce((acc, item) => acc + item.weight, 0);
  let roll = rng() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function slugifyDomain(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(pte|ltd|inc|corp|llc|sdn|bhd|gmbh|co|group)\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 26);
}

export interface SampleIndustryDatasetBundle {
  fileName: string;
  csvText: string;
  ticketHeaders: string[];
  ticketRows: Record<string, string>[];
}

type RiskTier = 'low' | 'medium' | 'high';
type ValueTier = 'low' | 'medium' | 'high';
type CustomerSegmentType = 'B2C' | 'SMB' | 'B2B' | 'Enterprise';

const FIRST_NAMES = [
  'Daniel', 'Priya', 'Hannah', 'Marcus', 'Wei Lin', 'Sofia', 'Amina', 'Lucas',
  'Rachel', 'Kieran', 'Nadia', 'Ethan', 'Maya', 'Oliver', 'Farah', 'Sebastian',
  'Chloe', 'Arjun', 'Tessa', 'Devon', 'Mei Ling', 'Gabriel', 'Ananya', 'Noah',
  'Clara', 'Hafiz', 'Elena', 'Julian', 'Siti', 'Benjamin', 'Zoe', 'Tariq',
  'Isabelle', 'Nikhil', 'Lauren', 'Mateo', 'Aisyah', 'Dominic', 'Grace', 'Rohan',
];

const LAST_NAMES = [
  'Mercer', 'Nair', 'Lindqvist', 'Vance', 'Tan', 'Alvarez', 'Okafor', 'Dubois',
  'Kowalski', 'gallagher', 'Rahman', 'Thornton', 'Chong', 'Morales', 'Ibrahim', 'Keller',
  'Bennett', 'Subramaniam', 'Hawkins', 'Park', 'Lim', 'Fontaine', 'Kapoor', 'Reynolds',
  'Hofmann', 'Aziz', 'Petrova', 'Sinclair', 'Yusof', 'Whitaker', 'Chen', 'Mansour',
  'Sullivan', 'Desai', 'Callahan', 'Reyes', 'Zulkifli', 'brennan', 'hartman', 'verma',
].map((name) => name.charAt(0).toUpperCase() + name.slice(1));

const COMPANY_PREFIXES = [
  'Northbridge', 'Crestline', 'Meridian', 'Pacific', 'Halcyon', 'Silverwood', 'Keystone',
  'Veridian', 'Bayside', 'Summit', 'Harborview', 'Redwood', 'Ironclad', 'Bluewater',
  'Oakridge', 'Vanguard', 'Clearwater', 'Westgate', 'Bridgeport', 'Sunridge',
  'Camberwell', 'Beacon', 'Kestrel', 'Broadleaf', 'Alderbrook', 'Fairmont', 'Sterling',
  'Stonebridge', 'Windward', 'Riverbend', 'Highland', 'Cornerstone',
];

const COMPANY_SECTORS = [
  'Logistics', 'Retail', 'Healthcare', 'Manufacturing', 'Advisory', 'Engineering',
  'Hospitality', 'Analytics', 'Freight', 'Distribution', 'Properties', 'Media',
  'Commerce', 'Foods', 'Clinical', 'Solutions', 'Ventures', 'Systems',
];

const COMPANY_SUFFIXES_BY_COUNTRY: Record<string, string[]> = {
  'United States': ['Inc', 'LLC', 'Corp', 'Group'],
  Canada: ['Inc', 'Ltd', 'Group', 'Corp'],
  'United Kingdom': ['Ltd', 'LLP', 'Group', 'Plc'],
  Singapore: ['Pte Ltd', 'Holdings Pte Ltd', 'Group'],
  Malaysia: ['Sdn Bhd', 'Enterprise', 'Group Sdn Bhd'],
  Australia: ['Pty Ltd', 'Group', 'Services Pty Ltd'],
  Germany: ['GmbH', 'AG', 'Systems GmbH'],
};

const CONSUMER_EMAIL_DOMAINS = [
  'harbor-mail.example',
  'crest-inbox.example',
  'pacific-mail.example',
  'metro-post.example',
  'northstar-mail.example',
  'ridge-mail.example',
];

const COUNTRIES = [
  { value: 'United States', weight: 28 },
  { value: 'United Kingdom', weight: 16 },
  { value: 'Singapore', weight: 14 },
  { value: 'Malaysia', weight: 14 },
  { value: 'Canada', weight: 11 },
  { value: 'Australia', weight: 10 },
  { value: 'Germany', weight: 7 },
];

function generateUniqueCustomerNames(count: number, rng: () => number): string[] {
  const combos: string[] = [];
  for (const first of FIRST_NAMES) {
    for (const last of LAST_NAMES) {
      combos.push(`${first} ${last}`);
    }
  }
  shuffleInPlace(combos, rng);
  return combos.slice(0, count);
}

function generateUniqueCompanyNames(count: number, rng: () => number): { prefix: string; sector: string }[] {
  const combos: { prefix: string; sector: string }[] = [];
  for (const prefix of COMPANY_PREFIXES) {
    for (const sector of COMPANY_SECTORS) {
      combos.push({ prefix, sector });
    }
  }
  shuffleInPlace(combos, rng);
  return combos.slice(0, count);
}

export function generateSampleTelecomBundle(rowCount = 250): SampleIndustryDatasetBundle {
  const rng = createSeededRng(20261123);

  const customerHeaders = [
    'customer_id',
    'customer_name',
    'company_name',
    'email',
    'customer_type',
    'country_region',
    'contract_type',
    'tenure_months',
    'monthly_charges',
    'total_revenue',
    'annual_revenue',
    'average_transaction_value',
    'contract_value',
    'profit_margin',
    'payment_method',
    'payment_status',
    'late_payment_count',
    'outstanding_balance',
    'internet_service',
    'phone_service',
    'multiple_lines',
    'online_security',
    'tech_support',
    'paperless_billing',
    'data_usage',
    'usage_score',
    'spend_growth',
    'support_calls',
    'total_complaints',
    'total_tickets_raised',
    'open_tickets',
    'resolved_tickets',
    'unresolved_tickets',
    'average_resolution_days',
    'customer_satisfaction_score',
    'observation_date',
    'registration_date',
    'last_activity_date',
    'customer_status',
    'churn_status',
    'churn_date',
    'churn_reason',
  ];

  const ticketHeaders = [
    'ticket_id',
    'customer_id',
    'ticket_created_date',
    'ticket_category',
    'ticket_priority',
    'ticket_status',
    'ticket_resolved_date',
    'resolution_duration_days',
    'escalated',
  ];

  // Build an independent 3x3 Value x Risk stratification matrix so every combination
  // (e.g., High Value + High Risk, High Value + Low Risk, Low Value + High Risk, etc.)
  // has strong, realistic representation.
  const baseDistribution: { valueTier: ValueTier; riskTier: RiskTier; share: number }[] = [
    { valueTier: 'high', riskTier: 'low', share: 32 / 250 },
    { valueTier: 'high', riskTier: 'medium', share: 25 / 250 },
    { valueTier: 'high', riskTier: 'high', share: 23 / 250 },
    { valueTier: 'medium', riskTier: 'low', share: 34 / 250 },
    { valueTier: 'medium', riskTier: 'medium', share: 30 / 250 },
    { valueTier: 'medium', riskTier: 'high', share: 26 / 250 },
    { valueTier: 'low', riskTier: 'low', share: 30 / 250 },
    { valueTier: 'low', riskTier: 'medium', share: 25 / 250 },
    { valueTier: 'low', riskTier: 'high', share: 25 / 250 },
  ];

  const strataQueue: { valueTier: ValueTier; riskTier: RiskTier }[] = [];
  for (const cell of baseDistribution) {
    const targetCount = Math.round(cell.share * rowCount);
    for (let k = 0; k < targetCount && strataQueue.length < rowCount; k++) {
      strataQueue.push({ valueTier: cell.valueTier, riskTier: cell.riskTier });
    }
  }
  while (strataQueue.length < rowCount) {
    const fallback = baseDistribution[strataQueue.length % baseDistribution.length];
    strataQueue.push({ valueTier: fallback.valueTier, riskTier: fallback.riskTier });
  }
  shuffleInPlace(strataQueue, rng);

  const uniqueNames = generateUniqueCustomerNames(rowCount, rng);
  const companyPool = generateUniqueCompanyNames(rowCount, rng);
  let companyCursor = 0;
  const usedEmails = new Set<string>();
  const usedCompanyNames = new Set<string>();

  const customerLines: string[] = [customerHeaders.join(',')];
  const ticketRows: Record<string, string>[] = [];
  let nextTicketNum = 5001;

  for (let i = 0; i < rowCount; i++) {
    const customerId = `TEL-${1001 + i}`;
    const customerName = uniqueNames[i];
    const { valueTier, riskTier } = strataQueue[i];
    const country = pickWeighted(rng, COUNTRIES);

    const customerType: CustomerSegmentType =
      valueTier === 'high'
        ? pickWeighted(rng, [
            { value: 'Enterprise' as const, weight: 38 },
            { value: 'B2B' as const, weight: 38 },
            { value: 'SMB' as const, weight: 18 },
            { value: 'B2C' as const, weight: 6 },
          ])
        : valueTier === 'medium'
          ? pickWeighted(rng, [
              { value: 'SMB' as const, weight: 42 },
              { value: 'B2C' as const, weight: 34 },
              { value: 'B2B' as const, weight: 21 },
              { value: 'Enterprise' as const, weight: 3 },
            ])
          : pickWeighted(rng, [
              { value: 'B2C' as const, weight: 84 },
              { value: 'SMB' as const, weight: 16 },
            ]);

    let companyName = '';
    let emailDomain = CONSUMER_EMAIL_DOMAINS[i % CONSUMER_EMAIL_DOMAINS.length];
    if (customerType !== 'B2C') {
      const suffixes = COMPANY_SUFFIXES_BY_COUNTRY[country] || ['Ltd', 'Group', 'Inc'];
      let candidate = '';
      while (companyCursor < companyPool.length) {
        const pair = companyPool[companyCursor++];
        const suffix = suffixes[Math.floor(rng() * suffixes.length)];
        const attempt = `${pair.prefix} ${pair.sector} ${suffix}`;
        if (!usedCompanyNames.has(attempt.toLowerCase())) {
          usedCompanyNames.add(attempt.toLowerCase());
          candidate = attempt;
          emailDomain = `${slugifyDomain(pair.prefix + '-' + pair.sector)}.example`;
          break;
        }
      }
      companyName = candidate;
    }

    const emailLocalBase = customerName
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .trim()
      .replace(/\s+/g, '.');
    let email = `${emailLocalBase}@${emailDomain}`;
    let emailAttempt = 1;
    while (usedEmails.has(email.toLowerCase())) {
      emailAttempt++;
      email = `${emailLocalBase}.${emailAttempt}@${emailDomain}`;
    }
    usedEmails.add(email.toLowerCase());

    // Contract type driven primarily by risk tier (independent of Value Tier)
    const contractType =
      riskTier === 'low'
        ? pickWeighted(rng, [
            { value: 'Two year', weight: 46 },
            { value: 'One year', weight: 36 },
            { value: 'Month-to-month', weight: 18 },
          ])
        : riskTier === 'medium'
          ? pickWeighted(rng, [
              { value: 'Month-to-month', weight: 52 },
              { value: 'One year', weight: 36 },
              { value: 'Two year', weight: 12 },
            ])
          : pickWeighted(rng, [
              { value: 'Month-to-month', weight: 74 },
              { value: 'One year', weight: 20 },
              { value: 'Two year', weight: 6 },
            ]);

    // Tenure in months: high-value accounts span established tenures across all risk tiers
    let tenureMonths: number;
    if (valueTier === 'high') {
      tenureMonths = Math.round(18 + rng() * 52);
    } else if (riskTier === 'low') {
      tenureMonths = Math.round(14 + rng() * 56);
    } else if (riskTier === 'medium') {
      tenureMonths = Math.round(6 + rng() * 42);
    } else {
      tenureMonths = Math.round(2 + Math.pow(rng(), 1.15) * 32);
    }
    tenureMonths = clamp(tenureMonths, 1, 72);

    // Service configuration
    const internetService =
      valueTier === 'high'
        ? pickWeighted(rng, [
            { value: 'Fiber optic', weight: 82 },
            { value: 'DSL', weight: 18 },
          ])
        : valueTier === 'medium'
          ? pickWeighted(rng, [
              { value: 'Fiber optic', weight: 56 },
              { value: 'DSL', weight: 36 },
              { value: 'No', weight: 8 },
            ])
          : pickWeighted(rng, [
              { value: 'DSL', weight: 46 },
              { value: 'No', weight: 34 },
              { value: 'Fiber optic', weight: 20 },
            ]);

    const phoneService =
      customerType !== 'B2C' || valueTier === 'high'
        ? rng() < 0.96
          ? 'Yes'
          : 'No'
        : rng() < 0.85
          ? 'Yes'
          : 'No';

    const multipleLines =
      phoneService === 'No'
        ? 'No phone service'
        : valueTier === 'high'
          ? rng() < 0.86
            ? 'Yes'
            : 'No'
          : valueTier === 'medium'
            ? rng() < 0.48
              ? 'Yes'
              : 'No'
            : rng() < 0.18
              ? 'Yes'
              : 'No';

    const onlineSecurity =
      internetService === 'No'
        ? 'No internet service'
        : rng() < (riskTier === 'low' ? 0.68 : riskTier === 'medium' ? 0.42 : 0.22)
          ? 'Yes'
          : 'No';

    const techSupport =
      internetService === 'No'
        ? 'No internet service'
        : rng() < (riskTier === 'low' ? 0.65 : riskTier === 'medium' ? 0.38 : 0.18)
          ? 'Yes'
          : 'No';

    const paperlessBilling =
      customerType === 'Enterprise' || customerType === 'B2B' || internetService === 'Fiber optic'
        ? rng() < 0.78
          ? 'Yes'
          : 'No'
        : rng() < 0.56
          ? 'Yes'
          : 'No';

    // Monthly charges independent of risk tier (driven strictly by Value Tier + Segment)
    let monthlyCharges: number;
    if (valueTier === 'high') {
      const segFloor =
        customerType === 'Enterprise' ? 520 : customerType === 'B2B' ? 350 : 265;
      const segCeil =
        customerType === 'Enterprise' ? 980 : customerType === 'B2B' ? 660 : 420;
      monthlyCharges = segFloor + rng() * (segCeil - segFloor);
    } else if (valueTier === 'medium') {
      const segFloor = customerType === 'B2B' ? 95 : 68;
      const segCeil = customerType === 'B2B' ? 172 : 150;
      monthlyCharges = segFloor + rng() * (segCeil - segFloor);
    } else {
      monthlyCharges = 24 + rng() * 39;
    }
    monthlyCharges = Number(monthlyCharges.toFixed(2));

    const annualRevenue = Number((monthlyCharges * 12 * (0.95 + rng() * 0.1)).toFixed(2));
    const totalRevenue = Number(
      Math.max(monthlyCharges, monthlyCharges * tenureMonths * (0.93 + rng() * 0.14)).toFixed(2)
    );
    const avgTransactionValue = Number((monthlyCharges * (0.95 + rng() * 0.12)).toFixed(2));
    const contractMonths = contractType === 'Two year' ? 24 : contractType === 'One year' ? 12 : 1;
    const contractValue = Number(
      (monthlyCharges * contractMonths * (0.97 + rng() * 0.06)).toFixed(2)
    );

    // Profit margin (%) reflects plan economics independently of current risk tier with natural variance
    const baseMargin =
      valueTier === 'high'
        ? 40 + rng() * 18
        : valueTier === 'medium'
          ? 25 + rng() * 19
          : 18 + rng() * 18;
    const supportDrag = riskTier === 'high' ? -2.0 : riskTier === 'medium' ? -0.8 : 1.0;
    const profitMargin = Number(clamp(baseMargin + supportDrag, 15.0, 58.0).toFixed(1));

    // Payment method & billing health
    const paymentMethod =
      customerType === 'Enterprise' || customerType === 'B2B'
        ? pickWeighted(rng, [
            { value: 'Corporate ACH / Wire', weight: riskTier === 'low' ? 48 : 30 },
            { value: 'Bank transfer (automatic)', weight: 28 },
            { value: 'Credit card (automatic)', weight: 18 },
            { value: 'Electronic check', weight: riskTier === 'high' ? 24 : 8 },
          ])
        : pickWeighted(rng, [
            { value: 'Bank transfer (automatic)', weight: riskTier === 'low' ? 38 : 18 },
            { value: 'Credit card (automatic)', weight: riskTier === 'low' ? 38 : 20 },
            { value: 'Electronic check', weight: riskTier === 'high' ? 48 : 20 },
            { value: 'Mailed check', weight: riskTier === 'high' ? 14 : 8 },
          ]);

    const paymentStatus =
      riskTier === 'low'
        ? pickWeighted(rng, [
            { value: 'Paid', weight: 68 },
            { value: 'Current', weight: 28 },
            { value: 'Pending', weight: 4 },
          ])
        : riskTier === 'medium'
          ? pickWeighted(rng, [
              { value: 'Current', weight: 40 },
              { value: 'Paid', weight: 26 },
              { value: 'Pending', weight: 22 },
              { value: 'Late', weight: 12 },
            ])
          : valueTier === 'high'
            ? pickWeighted(rng, [
                { value: 'Paid', weight: 28 },
                { value: 'Current', weight: 28 },
                { value: 'Pending', weight: 22 },
                { value: 'Late', weight: 14 },
                { value: 'Overdue', weight: 8 },
              ])
            : pickWeighted(rng, [
                { value: 'Overdue', weight: 34 },
                { value: 'Late', weight: 34 },
                { value: 'Pending', weight: 18 },
                { value: 'Current', weight: 14 },
              ]);

    const latePaymentCount =
      riskTier === 'low'
        ? rng() < 0.88
          ? 0
          : 1
        : riskTier === 'medium'
          ? Math.floor(rng() * 3)
          : valueTier === 'high'
            ? pickWeighted(rng, [
                { value: 0, weight: 22 },
                { value: 1, weight: 38 },
                { value: 2, weight: 28 },
                { value: 3, weight: 12 },
              ])
            : Math.round(1 + rng() * 4);

    let outstandingBalance = 0;
    if (paymentStatus === 'Overdue') {
      outstandingBalance = monthlyCharges * (1.2 + rng() * 2.1);
    } else if (paymentStatus === 'Late') {
      outstandingBalance = monthlyCharges * (0.85 + rng() * 1.4);
    } else if (paymentStatus === 'Pending') {
      outstandingBalance = monthlyCharges * (0.45 + rng() * 0.65);
    }
    outstandingBalance = Number(outstandingBalance.toFixed(2));

    // Satisfaction (1-5 scale), usage score (0-100), data usage (GB), spend growth (%)
    const csat =
      riskTier === 'low'
        ? 3.8 + rng() * 1.2
        : riskTier === 'medium'
          ? 2.7 + rng() * 1.4
          : 1.2 + rng() * 1.5;
    const customerSatisfactionScore = Number(clamp(csat, 1.0, 5.0).toFixed(1));

    const usageScore = Math.round(
      clamp(
        riskTier === 'low'
          ? 64 + rng() * 34
          : riskTier === 'medium'
            ? 38 + rng() * 35
            : 10 + rng() * 32,
        8,
        99
      )
    );

    const baseDataCap =
      internetService === 'No'
        ? 14
        : internetService === 'DSL'
          ? 125
          : valueTier === 'high'
            ? 500
            : customerType === 'B2B'
              ? 320
              : 240;
    const engagementFactor =
      valueTier === 'high'
        ? 0.72 + (usageScore / 100) * 0.42
        : 0.3 + (usageScore / 100) * 0.85;
    const dataUsage = Number(
      Math.max(2.5, baseDataCap * engagementFactor * (0.85 + rng() * 0.3)).toFixed(1)
    );

    const spendGrowth = Number(
      (riskTier === 'low'
        ? 1.0 + rng() * 21.0
        : riskTier === 'medium'
          ? -8.5 + rng() * 17.5
          : valueTier === 'high'
            ? -18.0 + rng() * 16.0
            : -26.0 + rng() * 22.0
      ).toFixed(1)
    );

    const supportCalls =
      riskTier === 'low'
        ? Math.floor(rng() * 3)
        : riskTier === 'medium'
          ? Math.round(1 + rng() * 3)
          : Math.round(3 + rng() * 6);

    const totalComplaints =
      riskTier === 'low'
        ? rng() < 0.86
          ? 0
          : 1
        : riskTier === 'medium'
          ? pickWeighted(rng, [
              { value: 0, weight: 42 },
              { value: 1, weight: 42 },
              { value: 2, weight: 16 },
            ])
          : pickWeighted(rng, [
              { value: 1, weight: 22 },
              { value: 2, weight: 34 },
              { value: 3, weight: 28 },
              { value: 4, weight: 12 },
              { value: 5, weight: 4 },
            ]);

    // Observation date spread smoothly across July–September 2026
    const obsDayOffset = Math.floor(rng() * 72); // 0..71 days after 2026-07-05 -> up to 2026-09-14
    const observationDate = addDaysIso('2026-07-05', obsDayOffset);
    const registrationDaysBack = Math.max(25, Math.round(tenureMonths * 30.4));
    const registrationDate = addDaysIso(observationDate, -registrationDaysBack);

    const quietDays =
      riskTier === 'low'
        ? Math.round(1 + rng() * 6)
        : riskTier === 'medium'
          ? Math.round(4 + rng() * 14)
          : Math.round(8 + rng() * 24);
    const clampedQuiet = Math.min(quietDays, Math.max(1, registrationDaysBack - 1));
    const lastActivityDate = addDaysIso(observationDate, -clampedQuiet);

    // Support ticket count + detailed linked Ticket_Data rows
    const ticketCount =
      riskTier === 'low'
        ? pickWeighted(rng, [
            { value: 0, weight: 62 },
            { value: 1, weight: 33 },
            { value: 2, weight: 5 },
          ])
        : riskTier === 'medium'
          ? pickWeighted(rng, [
              { value: 0, weight: 24 },
              { value: 1, weight: 45 },
              { value: 2, weight: 23 },
              { value: 3, weight: 8 },
            ])
          : pickWeighted(rng, [
              { value: 1, weight: 22 },
              { value: 2, weight: 44 },
              { value: 3, weight: 25 },
              { value: 4, weight: 9 },
            ]);

    let openTickets = 0;
    let resolvedTickets = 0;
    let unresolvedTickets = 0;
    const resolutionDurations: number[] = [];

    for (let t = 0; t < ticketCount; t++) {
      const ticketId = `TKT-${nextTicketNum++}`;
      const maxLookback = Math.min(90, Math.max(5, registrationDaysBack - 2));
      const createdBack = Math.round(2 + rng() * (maxLookback - 2));
      const ticketCreatedDate = addDaysIso(observationDate, -createdBack);

      const isOpen =
        riskTier === 'low'
          ? rng() < 0.08
          : riskTier === 'medium'
            ? rng() < 0.28
            : rng() < 0.56;

      const ticketStatus = isOpen
        ? pickWeighted(rng, [
            { value: 'Open', weight: 50 },
            { value: 'In Progress', weight: 30 },
            { value: 'Pending', weight: 20 },
          ])
        : pickWeighted(rng, [
            { value: 'Resolved', weight: 74 },
            { value: 'Closed', weight: 26 },
          ]);

      const durDays = Number(
        (riskTier === 'low'
          ? 0.6 + rng() * 1.6
          : riskTier === 'medium'
            ? 1.4 + rng() * 3.1
            : 3.0 + rng() * 6.2
        ).toFixed(1)
      );

      let ticketResolvedDate = '';
      if (isOpen) {
        openTickets++;
        unresolvedTickets++;
      } else {
        resolvedTickets++;
        const resolvedOffset = Math.max(1, Math.round(durDays));
        const candidateResolved = addDaysIso(ticketCreatedDate, resolvedOffset);
        ticketResolvedDate = candidateResolved > observationDate ? observationDate : candidateResolved;
      }
      resolutionDurations.push(durDays);

      const ticketCategory =
        paymentStatus === 'Overdue' || paymentStatus === 'Late'
          ? pickWeighted(rng, [
              { value: 'Billing', weight: 45 },
              { value: 'Technical', weight: 25 },
              { value: 'Service Quality', weight: 15 },
              { value: 'Cancellation Request', weight: riskTier === 'high' ? 15 : 5 },
            ])
          : pickWeighted(rng, [
              { value: 'Technical', weight: 38 },
              { value: 'Service Quality', weight: 26 },
              { value: 'Billing', weight: 18 },
              { value: 'General', weight: 10 },
              { value: 'Cancellation Request', weight: riskTier === 'high' ? 18 : 4 },
            ]);

      const ticketPriority =
        riskTier === 'high'
          ? pickWeighted(rng, [
              { value: 'High', weight: 48 },
              { value: 'Critical', weight: 24 },
              { value: 'Medium', weight: 28 },
            ])
          : riskTier === 'medium'
            ? pickWeighted(rng, [
                { value: 'Medium', weight: 52 },
                { value: 'High', weight: 28 },
                { value: 'Low', weight: 20 },
              ])
            : pickWeighted(rng, [
                { value: 'Low', weight: 58 },
                { value: 'Medium', weight: 34 },
                { value: 'High', weight: 8 },
              ]);

      const escalated =
        riskTier === 'high' && (ticketPriority === 'Critical' || rng() < 0.42)
          ? 'Yes'
          : riskTier === 'medium' && rng() < 0.14
            ? 'Yes'
            : 'No';

      ticketRows.push({
        ticket_id: ticketId,
        customer_id: customerId,
        ticket_created_date: ticketCreatedDate,
        ticket_category: ticketCategory,
        ticket_priority: ticketPriority,
        ticket_status: ticketStatus,
        ticket_resolved_date: ticketResolvedDate,
        resolution_duration_days: String(durDays),
        escalated,
      });
    }

    const averageResolutionDays =
      resolutionDurations.length > 0
        ? (
            resolutionDurations.reduce((acc, v) => acc + v, 0) / resolutionDurations.length
          ).toFixed(2)
        : '';

    // Realistic historical churn outcome strictly from behavioural/contract/service signals
    // Independent of Value Tier / Monthly Revenue so High-Value + High-Risk and Low-Value + Low-Risk
    // are equally represented in both historical outcomes and active risk predictions.
    let churnLogit = -2.2;
    churnLogit += (3.1 - customerSatisfactionScore) * 0.62;
    churnLogit += ((50 - usageScore) / 28) * 0.48;
    churnLogit += contractType === 'Month-to-month' ? 0.6 : contractType === 'Two year' ? -0.7 : -0.15;
    churnLogit += latePaymentCount * 0.18;
    churnLogit += totalComplaints * 0.24;
    churnLogit += unresolvedTickets * 0.34;
    churnLogit += supportCalls * 0.06;
    churnLogit -= (spendGrowth / 22) * 0.22;
    if (paymentStatus === 'Overdue') churnLogit += 0.25;
    else if (paymentStatus === 'Late') churnLogit += 0.15;

    const churnProb = 1 / (1 + Math.exp(-churnLogit));
    const isChurned = rng() < churnProb;

    const churnStatus = isChurned ? 'Churned' : 'Retained';
    const customerStatus = isChurned ? 'Cancelled' : 'Active';
    const churnDate = isChurned ? addDaysIso(observationDate, 1 + Math.floor(rng() * 12)) : '';

    let churnReason = '';
    if (isChurned) {
      if (latePaymentCount >= 2 || paymentStatus === 'Overdue' || paymentStatus === 'Late') {
        churnReason = 'Billing & Late Fee Disputes';
      } else if (unresolvedTickets >= 1 || (resolutionDurations.length > 0 && Number(averageResolutionDays) >= 4.0)) {
        churnReason = 'Poor Support Resolution';
      } else if (totalComplaints >= 2 || supportCalls >= 4) {
        churnReason = 'Unresolved Service Outages';
      } else if (contractType === 'Month-to-month' && spendGrowth < 0) {
        churnReason = 'Competitor Fiber Offer';
      } else {
        churnReason = rng() < 0.55 ? 'Price Increase Sensitivity' : 'Relocation / Line Consolidation';
      }
    }

    const rowValues = [
      customerId,
      customerName,
      companyName,
      email,
      customerType,
      country,
      contractType,
      String(tenureMonths),
      monthlyCharges.toFixed(2),
      totalRevenue.toFixed(2),
      annualRevenue.toFixed(2),
      avgTransactionValue.toFixed(2),
      contractValue.toFixed(2),
      profitMargin.toFixed(1),
      paymentMethod,
      paymentStatus,
      String(latePaymentCount),
      outstandingBalance.toFixed(2),
      internetService,
      phoneService,
      multipleLines,
      onlineSecurity,
      techSupport,
      paperlessBilling,
      dataUsage.toFixed(1),
      String(usageScore),
      spendGrowth.toFixed(1),
      String(supportCalls),
      String(totalComplaints),
      String(ticketCount),
      String(openTickets),
      String(resolvedTickets),
      String(unresolvedTickets),
      averageResolutionDays,
      customerSatisfactionScore.toFixed(1),
      observationDate,
      registrationDate,
      lastActivityDate,
      customerStatus,
      churnStatus,
      churnDate,
      churnReason,
    ];

    customerLines.push(rowValues.map(escapeCsvCell).join(','));
  }

  return {
    fileName: 'telecom_customer_churn_250.csv',
    csvText: customerLines.join('\n'),
    ticketHeaders,
    ticketRows,
  };
}

export function generateSampleTelecomCsv(rowCount = 250): string {
  return generateSampleTelecomBundle(rowCount).csvText;
}

export function generateSampleEcommerceCsv(rowCount = 250): string {
  const rng = createSeededRng(20260721);
  const headers = [
    'customer_id',
    'loyalty_tier',
    'channel',
    'payment_method',
    'customer_lifetime_months',
    'purchase_frequency',
    'avg_order_value',
    'days_since_last_purchase',
    'returns_count',
    'last_purchase_date',
    'churn',
  ];
  const lines: string[] = [headers.join(',')];
  const tiers = ['Standard', 'Silver', 'Gold VIP'];
  const channels = ['Web Store', 'Mobile App', 'Marketplace'];
  const payments = ['Credit Card', 'Digital Wallet', 'Buy Now Pay Later', 'Bank Transfer'];

  const baseDate = new Date('2026-10-01T00:00:00Z').getTime();

  for (let i = 1; i <= rowCount; i++) {
    const id = `ECOM-${2000 + i}`;
    const tierRoll = rng();
    const tier = tierRoll < 0.52 ? tiers[0] : tierRoll < 0.82 ? tiers[1] : tiers[2];
    const channel = channels[Math.floor(rng() * channels.length)];
    const payment = payments[Math.floor(rng() * payments.length)];
    const lifetimeMonths = Math.max(1, Math.min(60, Math.round(2 + rng() * 48)));
    const frequency = Math.max(1, Math.round((tier === 'Gold VIP' ? 6 : 2) + rng() * 10));
    const aov = Number((35 + (tier === 'Gold VIP' ? 65 : 15) + rng() * 90).toFixed(2));
    const daysSince = Math.max(1, Math.round(Math.pow(rng(), 1.3) * 165));
    const returnsCount = rng() < 0.25 ? Math.ceil(rng() * 3) : 0;
    const lastDate = new Date(baseDate - daysSince * 86400000).toISOString().slice(0, 10);

    let logit = -1.9;
    if (tier === 'Standard') logit += 0.95;
    else if (tier === 'Gold VIP') logit -= 1.25;
    if (daysSince > 90) logit += 1.55;
    else if (daysSince > 60) logit += 0.7;
    if (returnsCount >= 2) logit += 0.75;
    if (payment === 'Buy Now Pay Later') logit += 0.45;
    logit -= (frequency / 16) * 1.15;
    logit -= (lifetimeMonths / 60) * 0.8;

    const prob = 1 / (1 + Math.exp(-logit));
    const churn = rng() < prob ? 'Yes' : 'No';

    lines.push(
      [
        id,
        tier,
        channel,
        payment,
        String(lifetimeMonths),
        String(frequency),
        aov.toFixed(2),
        String(daysSince),
        String(returnsCount),
        lastDate,
        churn,
      ].join(',')
    );
  }

  return lines.join('\n');
}

export function generateSampleSaasCsv(rowCount = 250): string {
  const rng = createSeededRng(20260903);
  const headers = [
    'workspace_id',
    'plan_tier',
    'billing_cycle',
    'payment_method',
    'months_subscribed',
    'seats_licensed',
    'weekly_active_users',
    'support_tickets',
    'mrr',
    'renewal_date',
    'churned',
  ];
  const lines: string[] = [headers.join(',')];
  const plans = ['Starter', 'Growth', 'Enterprise'];
  const billingCycles = ['Monthly', 'Annual'];
  const payments = ['Corporate Card', 'ACH / Wire', 'Invoice Net-30'];
  const baseDate = new Date('2026-01-15T00:00:00Z').getTime();

  for (let i = 1; i <= rowCount; i++) {
    const id = `SAAS-${4000 + i}`;
    const planRoll = rng();
    const plan = planRoll < 0.48 ? plans[0] : planRoll < 0.84 ? plans[1] : plans[2];
    const billing = plan === 'Enterprise' ? 'Annual' : rng() < 0.62 ? 'Monthly' : 'Annual';
    const payment = payments[Math.floor(rng() * payments.length)];
    const months = Math.max(1, Math.round(1 + rng() * 44));
    const seats = plan === 'Enterprise' ? Math.round(25 + rng() * 95) : Math.round(2 + rng() * 20);
    const wau = Math.max(1, Math.min(seats, Math.round(seats * (0.25 + rng() * 0.72))));
    const tickets = Math.round(rng() * 8);
    const mrr = Number(((plan === 'Starter' ? 49 : plan === 'Growth' ? 199 : 650) + seats * 12).toFixed(2));
    const renewalDate = new Date(baseDate + i * 86400000).toISOString().slice(0, 10);

    const utilization = wau / Math.max(1, seats);
    let logit = -1.75;
    if (billing === 'Monthly') logit += 1.1;
    else logit -= 1.05;
    if (utilization < 0.45) logit += 1.4;
    if (tickets >= 5) logit += 0.85;
    if (plan === 'Starter') logit += 0.45;
    logit -= (months / 48) * 1.25;

    const prob = 1 / (1 + Math.exp(-logit));
    const churned = rng() < prob ? 'Yes' : 'No';

    lines.push(
      [
        id,
        plan,
        billing,
        payment,
        String(months),
        String(seats),
        String(wau),
        String(tickets),
        mrr.toFixed(2),
        renewalDate,
        churned,
      ].join(',')
    );
  }

  return lines.join('\n');
}

export function generateSampleBankingCsv(rowCount = 250): string {
  const rng = createSeededRng(20261108);
  const headers = [
    'account_id',
    'account_tier',
    'region',
    'payment_method',
    'tenure_months',
    'credit_score',
    'balance',
    'num_products',
    'monthly_transactions',
    'exited',
  ];
  const lines: string[] = [headers.join(',')];
  const tiers = ['Basic Checking', 'Premier Savings', 'Private Wealth'];
  const regions = ['Kuala Lumpur', 'Singapore', 'Jakarta', 'Bangkok'];
  const payments = ['Autopay Enabled', 'Manual Transfer', 'Branch Assisted'];

  for (let i = 1; i <= rowCount; i++) {
    const id = `BNK-${6000 + i}`;
    const tierRoll = rng();
    const tier = tierRoll < 0.5 ? tiers[0] : tierRoll < 0.85 ? tiers[1] : tiers[2];
    const region = regions[Math.floor(rng() * regions.length)];
    const payment = payments[Math.floor(rng() * payments.length)];
    const tenure = Math.max(3, Math.round(3 + rng() * 68));
    const creditScore = Math.round(520 + rng() * 310);
    const balance = Number((tier === 'Private Wealth' ? 45000 + rng() * 90000 : 1200 + rng() * 28000).toFixed(2));
    const products = Math.max(1, Math.min(4, Math.round(1 + rng() * 3)));
    const tx = Math.max(0, Math.round(rng() * 36));

    let logit = -1.65;
    if (products === 1) logit += 0.95;
    if (tx < 5) logit += 1.15;
    if (creditScore < 600) logit += 0.65;
    if (tier === 'Private Wealth') logit -= 0.95;
    logit -= (tenure / 72) * 1.1;

    const prob = 1 / (1 + Math.exp(-logit));
    const exited = rng() < prob ? 'Yes' : 'No';

    lines.push(
      [
        id,
        tier,
        region,
        payment,
        String(tenure),
        String(creditScore),
        balance.toFixed(2),
        String(products),
        String(tx),
        exited,
      ].join(',')
    );
  }

  return lines.join('\n');
}

export function generateSampleFitnessCsv(rowCount = 250): string {
  const rng = createSeededRng(20261202);
  const headers = [
    'member_id',
    'membership_tier',
    'contract_type',
    'payment_method',
    'tenure_months',
    'monthly_checkins',
    'classes_attended',
    'monthly_dues',
    'churn',
  ];
  const lines: string[] = [headers.join(',')];
  const tiers = ['Off-Peak', 'All-Access', 'Personal Coaching'];
  const contracts = ['Month-to-month', 'Annual Commitment'];
  const payments = ['Credit Card (Autopay)', 'Debit Card', 'Cash / Counter'];

  for (let i = 1; i <= rowCount; i++) {
    const id = `FIT-${8000 + i}`;
    const tier = tiers[Math.floor(rng() * tiers.length)];
    const contract = rng() < 0.62 ? contracts[0] : contracts[1];
    const payment = payments[Math.floor(rng() * payments.length)];
    const tenure = Math.max(1, Math.round(1 + rng() * 48));
    const checkins = Math.max(0, Math.round(rng() * 22));
    const classes = Math.max(0, Math.round(checkins * 0.4));
    const dues = Number((tier === 'Off-Peak' ? 45 : tier === 'All-Access' ? 79 : 169).toFixed(2));

    let logit = -1.5;
    if (contract === 'Month-to-month') logit += 1.05;
    if (checkins <= 3) logit += 1.6;
    else if (checkins >= 12) logit -= 1.2;
    if (payment === 'Cash / Counter') logit += 0.6;
    logit -= (tenure / 48) * 1.1;

    const prob = 1 / (1 + Math.exp(-logit));
    const churn = rng() < prob ? 'Yes' : 'No';

    lines.push(
      [
        id,
        tier,
        contract,
        payment,
        String(tenure),
        String(checkins),
        String(classes),
        dues.toFixed(2),
        churn,
      ].join(',')
    );
  }

  return lines.join('\n');
}

export function generateSampleIndustryBundle(
  industry: IndustryKey = 'telecommunications',
  rowCount = 250
): SampleIndustryDatasetBundle {
  switch (industry) {
    case 'retail_ecommerce':
      return {
        fileName: 'ecommerce_customer_churn_250.csv',
        csvText: generateSampleEcommerceCsv(rowCount),
        ticketHeaders: [],
        ticketRows: [],
      };
    case 'saas_technology':
      return {
        fileName: 'saas_subscription_churn_250.csv',
        csvText: generateSampleSaasCsv(rowCount),
        ticketHeaders: [],
        ticketRows: [],
      };
    case 'banking_finance':
      return {
        fileName: 'banking_account_churn_250.csv',
        csvText: generateSampleBankingCsv(rowCount),
        ticketHeaders: [],
        ticketRows: [],
      };
    case 'fitness_membership':
      return {
        fileName: 'fitness_member_churn_250.csv',
        csvText: generateSampleFitnessCsv(rowCount),
        ticketHeaders: [],
        ticketRows: [],
      };
    default:
      return generateSampleTelecomBundle(rowCount);
  }
}

export function generateSampleIndustryCsv(
  industry: IndustryKey = 'telecommunications',
  rowCount = 250
): { fileName: string; csvText: string } {
  const bundle = generateSampleIndustryBundle(industry, rowCount);
  return {
    fileName: bundle.fileName,
    csvText: bundle.csvText,
  };
}
