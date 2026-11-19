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

export function generateSampleTelecomCsv(rowCount = 250): string {
  const rng = createSeededRng(20260411);

  const headers = [
    'customerID',
    'gender',
    'SeniorCitizen',
    'Partner',
    'Dependents',
    'tenure',
    'PhoneService',
    'MultipleLines',
    'InternetService',
    'OnlineSecurity',
    'TechSupport',
    'Contract',
    'PaperlessBilling',
    'PaymentMethod',
    'MonthlyCharges',
    'TotalCharges',
    'Churn',
  ];

  const lines: string[] = [headers.join(',')];

  const contracts = ['Month-to-month', 'One year', 'Two year'];
  const internetServices = ['DSL', 'Fiber optic', 'No'];
  const paymentMethods = [
    'Electronic check',
    'Mailed check',
    'Bank transfer (automatic)',
    'Credit card (automatic)',
  ];

  for (let i = 1; i <= rowCount; i++) {
    const idNum = 1000 + i * 7;
    const customerID = `TEL-${idNum}-${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i * 3) % 26))}`;
    const gender = rng() < 0.5 ? 'Female' : 'Male';
    const seniorCitizen = rng() < 0.18 ? 'Yes' : 'No';
    const partner = rng() < 0.48 ? 'Yes' : 'No';
    const dependents = partner === 'Yes' && rng() < 0.55 ? 'Yes' : rng() < 0.15 ? 'Yes' : 'No';

    const contractRoll = rng();
    const contract =
      contractRoll < 0.54
        ? contracts[0]
        : contractRoll < 0.78
          ? contracts[1]
          : contracts[2];

    let tenure: number;
    if (contract === 'Month-to-month') {
      tenure = Math.max(1, Math.min(72, Math.round(Math.pow(rng(), 1.5) * 42)));
    } else if (contract === 'One year') {
      tenure = Math.max(6, Math.min(72, Math.round(12 + rng() * 48)));
    } else {
      tenure = Math.max(18, Math.min(72, Math.round(24 + rng() * 48)));
    }

    const phoneService = rng() < 0.9 ? 'Yes' : 'No';
    const multipleLines =
      phoneService === 'No' ? 'No phone service' : rng() < 0.45 ? 'Yes' : 'No';

    const internetRoll = rng();
    const internetService =
      internetRoll < 0.35
        ? internetServices[0]
        : internetRoll < 0.78
          ? internetServices[1]
          : internetServices[2];

    const onlineSecurity =
      internetService === 'No'
        ? 'No internet service'
        : rng() < (contract === 'Two year' ? 0.65 : 0.3)
          ? 'Yes'
          : 'No';

    const techSupport =
      internetService === 'No'
        ? 'No internet service'
        : rng() < (contract === 'Two year' ? 0.62 : 0.28)
          ? 'Yes'
          : 'No';

    const paperlessBilling =
      internetService === 'Fiber optic' ? (rng() < 0.75 ? 'Yes' : 'No') : rng() < 0.5 ? 'Yes' : 'No';

    let paymentMethod: string;
    if (contract === 'Month-to-month' && rng() < 0.48) {
      paymentMethod = paymentMethods[0];
    } else {
      paymentMethod = paymentMethods[Math.floor(rng() * paymentMethods.length)];
    }

    let monthly = 20;
    if (phoneService === 'Yes') monthly += 5;
    if (multipleLines === 'Yes') monthly += 8;
    if (internetService === 'DSL') monthly += 25;
    if (internetService === 'Fiber optic') monthly += 52;
    if (onlineSecurity === 'Yes') monthly += 6;
    if (techSupport === 'Yes') monthly += 6;
    monthly += (rng() - 0.5) * 6;
    const monthlyCharges = Number(Math.max(18.5, monthly).toFixed(2));

    const isMissingTotal = i === 14 || i === 47 || i === 89 || i === 132 || i === 178 || i === 219;
    const totalCharges = isMissingTotal
      ? ''
      : Number((monthlyCharges * tenure * (0.96 + rng() * 0.08)).toFixed(2)).toFixed(2);

    let logit = -1.65;
    if (contract === 'Month-to-month') logit += 1.45;
    else if (contract === 'Two year') logit -= 1.35;

    if (internetService === 'Fiber optic') logit += 0.85;
    else if (internetService === 'No') logit -= 0.9;

    if (paymentMethod === 'Electronic check') logit += 0.65;
    if (onlineSecurity === 'No') logit += 0.42;
    if (techSupport === 'No') logit += 0.38;
    if (seniorCitizen === 'Yes') logit += 0.32;
    if (paperlessBilling === 'Yes') logit += 0.25;
    if (partner === 'Yes') logit -= 0.22;
    if (dependents === 'Yes') logit -= 0.28;

    logit -= (tenure / 72) * 1.85;
    logit += ((monthlyCharges - 55) / 50) * 0.45;

    const prob = 1 / (1 + Math.exp(-logit));
    const churn = rng() < prob ? 'Yes' : 'No';

    lines.push(
      [
        customerID,
        gender,
        seniorCitizen,
        partner,
        dependents,
        String(tenure),
        phoneService,
        multipleLines,
        internetService,
        onlineSecurity,
        techSupport,
        contract,
        paperlessBilling,
        paymentMethod,
        monthlyCharges.toFixed(2),
        totalCharges,
        churn,
      ].join(',')
    );
  }

  return lines.join('\n');
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

export function generateSampleIndustryCsv(
  industry: IndustryKey = 'telecommunications',
  rowCount = 250
): { fileName: string; csvText: string } {
  switch (industry) {
    case 'retail_ecommerce':
      return {
        fileName: 'ecommerce_customer_churn_250.csv',
        csvText: generateSampleEcommerceCsv(rowCount),
      };
    case 'saas_technology':
      return {
        fileName: 'saas_subscription_churn_250.csv',
        csvText: generateSampleSaasCsv(rowCount),
      };
    case 'banking_finance':
      return {
        fileName: 'banking_account_churn_250.csv',
        csvText: generateSampleBankingCsv(rowCount),
      };
    case 'fitness_membership':
      return {
        fileName: 'fitness_member_churn_250.csv',
        csvText: generateSampleFitnessCsv(rowCount),
      };
    default:
      return {
        fileName: 'telecom_customer_churn_250.csv',
        csvText: generateSampleTelecomCsv(rowCount),
      };
  }
}
