import * as XLSX from 'xlsx';
import type { IndustryKey } from '../src/types/churn.ts';
import {
  getIndustryDataTemplateColumns,
  getIndustryTemplate,
} from '../src/utils/industryConfig.ts';

export type TemplateMode = 'labeled' | 'cold_start';
export type TemplateFormat = 'csv' | 'xlsx';

const SAMPLE_ROWS_BY_INDUSTRY: Record<IndustryKey, Record<string, string>[]> = {
  telecommunications: [
    {
      customer_id: 'TEL-1001-AA',
      contract_type: 'Month-to-month',
      tenure_months: '3',
      monthly_charges: '89.50',
      last_bill_date: '2026-09-12',
      support_calls: '4',
      internet_service: 'Fiber optic',
      payment_method: 'Electronic check',
      churn: 'Yes',
    },
    {
      customer_id: 'TEL-1002-BB',
      contract_type: 'Two year',
      tenure_months: '48',
      monthly_charges: '64.20',
      last_bill_date: '2026-09-20',
      support_calls: '0',
      internet_service: 'DSL',
      payment_method: 'Bank transfer (automatic)',
      churn: 'No',
    },
    {
      customer_id: 'TEL-1003-CC',
      contract_type: 'One year',
      tenure_months: '22',
      monthly_charges: '76.00',
      last_bill_date: '2026-09-18',
      support_calls: '1',
      internet_service: 'Fiber optic',
      payment_method: 'Credit card (automatic)',
      churn: 'No',
    },
    {
      customer_id: 'TEL-1004-DD',
      contract_type: 'Month-to-month',
      tenure_months: '7',
      monthly_charges: '94.10',
      last_bill_date: '2026-09-05',
      support_calls: '3',
      internet_service: 'Fiber optic',
      payment_method: 'Electronic check',
      churn: 'Yes',
    },
    {
      customer_id: 'TEL-1005-EE',
      contract_type: 'Two year',
      tenure_months: '61',
      monthly_charges: '52.40',
      last_bill_date: '2026-09-25',
      support_calls: '0',
      internet_service: 'DSL',
      payment_method: 'Credit card (automatic)',
      churn: 'No',
    },
    {
      customer_id: 'TEL-1006-FF',
      contract_type: 'One year',
      tenure_months: '15',
      monthly_charges: '45.00',
      last_bill_date: '2026-09-19',
      support_calls: '1',
      internet_service: 'No',
      payment_method: 'Mailed check',
      churn: 'No',
    },
  ],
  banking_finance: [
    {
      account_id: 'BNK-6001',
      account_tier: 'Basic Checking',
      tenure_months: '9',
      balance: '1420.50',
      monthly_transactions: '2',
      last_transaction_date: '2026-06-14',
      num_products: '1',
      payment_method: 'Manual Transfer',
      exited: 'Yes',
    },
    {
      account_id: 'BNK-6002',
      account_tier: 'Premier Savings',
      tenure_months: '42',
      balance: '24800.00',
      monthly_transactions: '18',
      last_transaction_date: '2026-09-24',
      num_products: '3',
      payment_method: 'Autopay Enabled',
      exited: 'No',
    },
    {
      account_id: 'BNK-6003',
      account_tier: 'Private Wealth',
      tenure_months: '68',
      balance: '112500.00',
      monthly_transactions: '26',
      last_transaction_date: '2026-09-26',
      num_products: '4',
      payment_method: 'Autopay Enabled',
      exited: 'No',
    },
    {
      account_id: 'BNK-6004',
      account_tier: 'Basic Checking',
      tenure_months: '6',
      balance: '680.00',
      monthly_transactions: '1',
      last_transaction_date: '2026-05-19',
      num_products: '1',
      payment_method: 'Branch Assisted',
      exited: 'Yes',
    },
    {
      account_id: 'BNK-6005',
      account_tier: 'Premier Savings',
      tenure_months: '29',
      balance: '16900.00',
      monthly_transactions: '14',
      last_transaction_date: '2026-09-21',
      num_products: '2',
      payment_method: 'Autopay Enabled',
      exited: 'No',
    },
    {
      account_id: 'BNK-6006',
      account_tier: 'Basic Checking',
      tenure_months: '34',
      balance: '5400.00',
      monthly_transactions: '12',
      last_transaction_date: '2026-09-18',
      num_products: '2',
      payment_method: 'Manual Transfer',
      exited: 'No',
    },
  ],
  retail_ecommerce: [
    {
      customer_id: 'ECOM-2001',
      loyalty_tier: 'Standard',
      avg_order_value: '46.50',
      purchase_frequency: '1',
      last_purchase_date: '2026-04-12',
      customer_lifetime_months: '5',
      returns_count: '2',
      payment_method: 'Buy Now Pay Later',
      churn: 'Yes',
    },
    {
      customer_id: 'ECOM-2002',
      loyalty_tier: 'Gold VIP',
      avg_order_value: '138.00',
      purchase_frequency: '11',
      last_purchase_date: '2026-09-23',
      customer_lifetime_months: '32',
      returns_count: '0',
      payment_method: 'Credit Card',
      churn: 'No',
    },
    {
      customer_id: 'ECOM-2003',
      loyalty_tier: 'Silver',
      avg_order_value: '78.20',
      purchase_frequency: '6',
      last_purchase_date: '2026-09-10',
      customer_lifetime_months: '19',
      returns_count: '0',
      payment_method: 'Digital Wallet',
      churn: 'No',
    },
    {
      customer_id: 'ECOM-2004',
      loyalty_tier: 'Standard',
      avg_order_value: '39.90',
      purchase_frequency: '2',
      last_purchase_date: '2026-05-03',
      customer_lifetime_months: '8',
      returns_count: '3',
      payment_method: 'Buy Now Pay Later',
      churn: 'Yes',
    },
    {
      customer_id: 'ECOM-2005',
      loyalty_tier: 'Gold VIP',
      avg_order_value: '164.00',
      purchase_frequency: '14',
      last_purchase_date: '2026-09-27',
      customer_lifetime_months: '41',
      returns_count: '1',
      payment_method: 'Credit Card',
      churn: 'No',
    },
    {
      customer_id: 'ECOM-2006',
      loyalty_tier: 'Silver',
      avg_order_value: '91.40',
      purchase_frequency: '5',
      last_purchase_date: '2026-09-02',
      customer_lifetime_months: '24',
      returns_count: '0',
      payment_method: 'Bank Transfer',
      churn: 'No',
    },
  ],
  saas_technology: [
    {
      workspace_id: 'SAAS-4001',
      plan_tier: 'Starter',
      mrr: '85.00',
      months_subscribed: '4',
      weekly_active_users: '1',
      renewal_date: '2026-10-05',
      billing_cycle: 'Monthly',
      support_tickets: '6',
      churned: 'Yes',
    },
    {
      workspace_id: 'SAAS-4002',
      plan_tier: 'Enterprise',
      mrr: '1290.00',
      months_subscribed: '34',
      weekly_active_users: '46',
      renewal_date: '2027-02-15',
      billing_cycle: 'Annual',
      support_tickets: '1',
      churned: 'No',
    },
    {
      workspace_id: 'SAAS-4003',
      plan_tier: 'Growth',
      mrr: '349.00',
      months_subscribed: '18',
      weekly_active_users: '11',
      renewal_date: '2026-11-20',
      billing_cycle: 'Annual',
      support_tickets: '0',
      churned: 'No',
    },
    {
      workspace_id: 'SAAS-4004',
      plan_tier: 'Starter',
      mrr: '73.00',
      months_subscribed: '3',
      weekly_active_users: '2',
      renewal_date: '2026-10-08',
      billing_cycle: 'Monthly',
      support_tickets: '5',
      churned: 'Yes',
    },
    {
      workspace_id: 'SAAS-4005',
      plan_tier: 'Growth',
      mrr: '415.00',
      months_subscribed: '26',
      weekly_active_users: '16',
      renewal_date: '2027-01-12',
      billing_cycle: 'Annual',
      support_tickets: '1',
      churned: 'No',
    },
    {
      workspace_id: 'SAAS-4006',
      plan_tier: 'Enterprise',
      mrr: '1580.00',
      months_subscribed: '40',
      weekly_active_users: '62',
      renewal_date: '2027-04-01',
      billing_cycle: 'Annual',
      support_tickets: '0',
      churned: 'No',
    },
  ],
  healthcare: [
    {
      patient_id: 'PAT-3001',
      care_program: 'Wellness',
      months_enrolled: '4',
      avg_visit_billing: '95.00',
      annual_appointments: '1',
      last_visit_date: '2026-02-11',
      missed_appointments: '3',
      payment_method: 'Self-Pay',
      discontinued: 'Yes',
    },
    {
      patient_id: 'PAT-3002',
      care_program: 'Chronic Care',
      months_enrolled: '28',
      avg_visit_billing: '165.00',
      annual_appointments: '8',
      last_visit_date: '2026-09-18',
      missed_appointments: '0',
      payment_method: 'Corporate Insurance',
      discontinued: 'No',
    },
    {
      patient_id: 'PAT-3003',
      care_program: 'Telehealth Plus',
      months_enrolled: '16',
      avg_visit_billing: '120.00',
      annual_appointments: '6',
      last_visit_date: '2026-09-10',
      missed_appointments: '0',
      payment_method: 'Corporate Insurance',
      discontinued: 'No',
    },
    {
      patient_id: 'PAT-3004',
      care_program: 'Primary Care',
      months_enrolled: '5',
      avg_visit_billing: '110.00',
      annual_appointments: '1',
      last_visit_date: '2026-03-04',
      missed_appointments: '2',
      payment_method: 'Self-Pay',
      discontinued: 'Yes',
    },
    {
      patient_id: 'PAT-3005',
      care_program: 'Chronic Care',
      months_enrolled: '36',
      avg_visit_billing: '185.00',
      annual_appointments: '10',
      last_visit_date: '2026-09-22',
      missed_appointments: '0',
      payment_method: 'Panel Clinic',
      discontinued: 'No',
    },
    {
      patient_id: 'PAT-3006',
      care_program: 'Primary Care',
      months_enrolled: '21',
      avg_visit_billing: '130.00',
      annual_appointments: '5',
      last_visit_date: '2026-08-29',
      missed_appointments: '1',
      payment_method: 'Corporate Insurance',
      discontinued: 'No',
    },
  ],
  insurance: [
    {
      policyholder_id: 'INS-7001',
      policy_type: 'Auto Comprehensive',
      policy_tenure_months: '11',
      monthly_premium: '185.00',
      renewal_date: '2026-10-15',
      claims_count: '3',
      payment_method: 'Credit Card',
      lapsed: 'Yes',
    },
    {
      policyholder_id: 'INS-7002',
      policy_type: 'Health Shield',
      policy_tenure_months: '48',
      monthly_premium: '240.00',
      renewal_date: '2027-01-20',
      claims_count: '0',
      payment_method: 'Auto-Debit',
      lapsed: 'No',
    },
    {
      policyholder_id: 'INS-7003',
      policy_type: 'Life Term',
      policy_tenure_months: '60',
      monthly_premium: '145.00',
      renewal_date: '2027-03-10',
      claims_count: '0',
      payment_method: 'Auto-Debit',
      lapsed: 'No',
    },
    {
      policyholder_id: 'INS-7004',
      policy_type: 'Auto Comprehensive',
      policy_tenure_months: '12',
      monthly_premium: '215.00',
      renewal_date: '2026-09-30',
      claims_count: '2',
      payment_method: 'Annual Invoice',
      lapsed: 'Yes',
    },
    {
      policyholder_id: 'INS-7005',
      policy_type: 'Commercial',
      policy_tenure_months: '36',
      monthly_premium: '690.00',
      renewal_date: '2027-02-01',
      claims_count: '1',
      payment_method: 'Auto-Debit',
      lapsed: 'No',
    },
    {
      policyholder_id: 'INS-7006',
      policy_type: 'Health Shield',
      policy_tenure_months: '27',
      monthly_premium: '220.00',
      renewal_date: '2026-12-18',
      claims_count: '1',
      payment_method: 'Auto-Debit',
      lapsed: 'No',
    },
  ],
  education: [
    {
      learner_id: 'EDU-5001',
      program_track: 'Full-Time Bootcamp',
      months_enrolled: '2',
      tuition_fee: '480.00',
      sessions_per_week: '1',
      last_login_date: '2026-07-08',
      assignments_completed_pct: '32',
      dropped: 'Yes',
    },
    {
      learner_id: 'EDU-5002',
      program_track: 'Part-Time Degree',
      months_enrolled: '18',
      tuition_fee: '320.00',
      sessions_per_week: '5',
      last_login_date: '2026-09-25',
      assignments_completed_pct: '94',
      dropped: 'No',
    },
    {
      learner_id: 'EDU-5003',
      program_track: 'Executive Cert',
      months_enrolled: '9',
      tuition_fee: '260.00',
      sessions_per_week: '4',
      last_login_date: '2026-09-23',
      assignments_completed_pct: '88',
      dropped: 'No',
    },
    {
      learner_id: 'EDU-5004',
      program_track: 'Full-Time Bootcamp',
      months_enrolled: '3',
      tuition_fee: '480.00',
      sessions_per_week: '1',
      last_login_date: '2026-07-21',
      assignments_completed_pct: '40',
      dropped: 'Yes',
    },
    {
      learner_id: 'EDU-5005',
      program_track: 'Part-Time Degree',
      months_enrolled: '24',
      tuition_fee: '320.00',
      sessions_per_week: '6',
      last_login_date: '2026-09-26',
      assignments_completed_pct: '97',
      dropped: 'No',
    },
    {
      learner_id: 'EDU-5006',
      program_track: 'Executive Cert',
      months_enrolled: '6',
      tuition_fee: '260.00',
      sessions_per_week: '3',
      last_login_date: '2026-09-20',
      assignments_completed_pct: '81',
      dropped: 'No',
    },
  ],
  fitness_membership: [
    {
      member_id: 'FIT-8001',
      membership_tier: 'Off-Peak',
      tenure_months: '3',
      monthly_dues: '45.00',
      monthly_checkins: '2',
      last_checkin_date: '2026-07-19',
      payment_method: 'Cash / Counter',
      churn: 'Yes',
    },
    {
      member_id: 'FIT-8002',
      membership_tier: 'All-Access',
      tenure_months: '22',
      monthly_dues: '79.00',
      monthly_checkins: '14',
      last_checkin_date: '2026-09-25',
      payment_method: 'Credit Card (Autopay)',
      churn: 'No',
    },
    {
      member_id: 'FIT-8003',
      membership_tier: 'Personal Coaching',
      tenure_months: '31',
      monthly_dues: '169.00',
      monthly_checkins: '18',
      last_checkin_date: '2026-09-26',
      payment_method: 'Credit Card (Autopay)',
      churn: 'No',
    },
    {
      member_id: 'FIT-8004',
      membership_tier: 'All-Access',
      tenure_months: '4',
      monthly_dues: '79.00',
      monthly_checkins: '1',
      last_checkin_date: '2026-06-30',
      payment_method: 'Debit Card',
      churn: 'Yes',
    },
    {
      member_id: 'FIT-8005',
      membership_tier: 'All-Access',
      tenure_months: '19',
      monthly_dues: '79.00',
      monthly_checkins: '12',
      last_checkin_date: '2026-09-24',
      payment_method: 'Credit Card (Autopay)',
      churn: 'No',
    },
    {
      member_id: 'FIT-8006',
      membership_tier: 'Off-Peak',
      tenure_months: '15',
      monthly_dues: '45.00',
      monthly_checkins: '9',
      last_checkin_date: '2026-09-21',
      payment_method: 'Debit Card',
      churn: 'No',
    },
  ],
  other: [
    {
      customer_id: 'CUST-1001',
      segment: 'Standard',
      tenure_months: '4',
      revenue: '85.00',
      engagement_frequency: '2',
      last_activity_date: '2026-06-15',
      payment_method: 'Manual Invoice',
      churn: 'Yes',
    },
    {
      customer_id: 'CUST-1002',
      segment: 'Enterprise',
      tenure_months: '32',
      revenue: '490.00',
      engagement_frequency: '18',
      last_activity_date: '2026-09-24',
      payment_method: 'Autopay',
      churn: 'No',
    },
    {
      customer_id: 'CUST-1003',
      segment: 'Growth',
      tenure_months: '19',
      revenue: '210.00',
      engagement_frequency: '11',
      last_activity_date: '2026-09-22',
      payment_method: 'Autopay',
      churn: 'No',
    },
    {
      customer_id: 'CUST-1004',
      segment: 'Standard',
      tenure_months: '5',
      revenue: '95.00',
      engagement_frequency: '1',
      last_activity_date: '2026-05-20',
      payment_method: 'Manual Invoice',
      churn: 'Yes',
    },
    {
      customer_id: 'CUST-1005',
      segment: 'Enterprise',
      tenure_months: '45',
      revenue: '560.00',
      engagement_frequency: '21',
      last_activity_date: '2026-09-26',
      payment_method: 'Autopay',
      churn: 'No',
    },
    {
      customer_id: 'CUST-1006',
      segment: 'Growth',
      tenure_months: '14',
      revenue: '180.00',
      engagement_frequency: '9',
      last_activity_date: '2026-09-18',
      payment_method: 'Autopay',
      churn: 'No',
    },
  ],
};

function escapeCsvField(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function generateIndustryTemplateExport(params: {
  industry: IndustryKey;
  format: TemplateFormat;
  mode?: TemplateMode;
  customIndustryName?: string | null;
}): {
  fileName: string;
  contentType: string;
  body: string | Buffer;
} {
  const { industry, format, mode = 'labeled', customIndustryName } = params;
  const profile = getIndustryTemplate(industry, customIndustryName);
  const columnSpecs = getIndustryDataTemplateColumns(industry);

  // In cold_start mode, omit the historical churn outcome column so new companies see a clean active-tracking template
  const activeSpecs =
    mode === 'cold_start'
      ? columnSpecs.filter((col) => col.semanticRole !== 'target')
      : columnSpecs;

  const baseSampleRows = SAMPLE_ROWS_BY_INDUSTRY[industry] || SAMPLE_ROWS_BY_INDUSTRY.other;
  const headers = activeSpecs.map((c) => c.name);
  const rows = baseSampleRows.map((sample) => {
    const row: Record<string, string> = {};
    for (const col of activeSpecs) {
      row[col.name] = sample[col.name] ?? col.exampleValue;
    }
    return row;
  });

  const slug = industry.replace(/[^a-z0-9_]/gi, '_');
  const suffix = mode === 'cold_start' ? 'cold_start_template' : 'historical_template';

  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new();
    const dataSheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    XLSX.utils.book_append_sheet(wb, dataSheet, 'Customer_Data_Template');

    const guideRows = columnSpecs.map((spec) => ({
      Column_Name: spec.name,
      Display_Label: spec.displayName,
      Requirement_Tier: spec.tier.toUpperCase(),
      Data_Type: spec.dataType,
      Semantic_Role: spec.semanticRole,
      Accepted_Formats: spec.acceptedFormats,
      Description: spec.description,
      Example_Value: spec.exampleValue,
      Cold_Start_Guidance:
        spec.coldStartNote ||
        (spec.tier === 'required'
          ? 'Include for analytics and customer tracking.'
          : 'Recommended when available.'),
    }));

    const guideSheet = XLSX.utils.json_to_sheet(guideRows);
    XLSX.utils.book_append_sheet(wb, guideSheet, 'Column_Guide_and_Formats');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return {
      fileName: `churnsight_${slug}_${suffix}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: buffer,
    };
  }

  const csvLines = [
    headers.map(escapeCsvField).join(','),
    ...rows.map((r) => headers.map((h) => escapeCsvField(r[h] ?? '')).join(',')),
  ];

  // Keep customIndustryName referenced cleanly for future metadata extensions
  void profile;

  return {
    fileName: `churnsight_${slug}_${suffix}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: csvLines.join('\n'),
  };
}
