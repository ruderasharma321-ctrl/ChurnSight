import * as XLSX from 'xlsx';
import type { IndustryKey, TemplateMode } from '../src/types/churn.ts';
import {
  getIndustryDataTemplateColumns,
  getIndustryTemplate,
} from '../src/utils/industryConfig.ts';
import type { TrainedModelArtifact } from './mlEngine.ts';

export type { TemplateMode };
export type LegacyCompatibleTemplateMode = TemplateMode | 'labeled' | 'cold_start';
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

export interface ImportGuideFieldSpec {
  name: string;
  category: string;
  tier: 'Required' | 'Recommended' | 'Optional' | 'If Available';
  acceptedFormat: string;
  description: string;
  exampleValue: string;
  usedFor: string;
}

export const COMPREHENSIVE_FIELD_GUIDE_SPECS: ImportGuideFieldSpec[] = [
  // Category 1 — Customer Identification
  {
    name: 'customer_id',
    category: 'Customer Identification',
    tier: 'Required',
    acceptedFormat: 'Unique alphanumeric text (e.g. CUST-1001)',
    description: 'Primary unique identifier per customer. Used to match tickets and deduplicate records.',
    exampleValue: 'CUST-1001',
    usedFor: 'Deduplication, Prediction Lookup, Ticket Matching',
  },
  {
    name: 'customer_name',
    category: 'Customer Identification',
    tier: 'Optional',
    acceptedFormat: 'Text (Synthetic example rows include [Example])',
    description: 'Display name or organization account name.',
    exampleValue: '[Example] Northwind Retail Ltd',
    usedFor: 'Customer Directory & Retention Outreach Lists',
  },
  {
    name: 'email',
    category: 'Customer Identification',
    tier: 'Optional',
    acceptedFormat: 'Valid email (name@company.example)',
    description: 'Primary customer contact email validated during import.',
    exampleValue: 'billing@northwind.example',
    usedFor: 'Account Verification & Contact Hygiene Checks',
  },
  {
    name: 'company_name',
    category: 'Customer Identification',
    tier: 'Optional',
    acceptedFormat: 'Text (B2B organization)',
    description: 'Organization or workspace entity for B2B accounts.',
    exampleValue: 'Northwind Operations',
    usedFor: 'B2B Account Value Aggregation',
  },
  {
    name: 'customer_type',
    category: 'Customer Identification',
    tier: 'Optional',
    acceptedFormat: 'B2B / B2C / SMB / Enterprise',
    description: 'Commercial classification of the customer account.',
    exampleValue: 'B2B',
    usedFor: 'Cohort Churn Segmentation',
  },
  {
    name: 'country_region',
    category: 'Customer Identification',
    tier: 'Optional',
    acceptedFormat: 'Country or Region name / ISO code',
    description: 'Primary operating country or regional market.',
    exampleValue: 'Malaysia',
    usedFor: 'Regional Retention Analysis',
  },
  // Category 2 — Relationship & Subscription
  {
    name: 'customer_status',
    category: 'Relationship & Subscription',
    tier: 'Recommended',
    acceptedFormat: 'Active / Trial / Paused / Cancelled / Churned',
    description: 'Current operational status of the customer relationship.',
    exampleValue: 'Active',
    usedFor: 'Behaviour Monitoring & Renewal Consistency Checks',
  },
  {
    name: 'registration_date',
    category: 'Relationship & Subscription',
    tier: 'Recommended',
    acceptedFormat: 'YYYY-MM-DD',
    description: 'Initial account sign-up or contract start date.',
    exampleValue: '2025-04-12',
    usedFor: 'Cohort Tenure Verification',
  },
  {
    name: 'observation_date',
    category: 'Relationship & Subscription',
    tier: 'Recommended',
    acceptedFormat: 'YYYY-MM-DD',
    description: 'Point-in-time snapshot date when customer features were observed.',
    exampleValue: '2026-08-15',
    usedFor: 'Chronological Train/Test Validation Split',
  },
  {
    name: 'subscription_end_date',
    category: 'Relationship & Subscription',
    tier: 'Optional',
    acceptedFormat: 'YYYY-MM-DD (blank if ongoing)',
    description: 'Scheduled contract or subscription expiration date.',
    exampleValue: '2026-12-31',
    usedFor: 'Renewal Window & Expired-Active Consistency Warnings',
  },
  {
    name: 'tenure_months',
    category: 'Relationship & Subscription',
    tier: 'Recommended',
    acceptedFormat: 'Non-negative number (months)',
    description: 'Total length of customer relationship in months.',
    exampleValue: '18',
    usedFor: 'Lifecycle Churn Curves, ML Feature & Value Scoring',
  },
  {
    name: 'plan_tier',
    category: 'Relationship & Subscription',
    tier: 'Recommended',
    acceptedFormat: 'Starter / Growth / Enterprise / Month-to-month',
    description: 'Commercial plan, tier, contract length, or segment.',
    exampleValue: 'Growth',
    usedFor: 'Segment Breakdown Charts & Retention Targeting',
  },
  {
    name: 'billing_cycle',
    category: 'Relationship & Subscription',
    tier: 'Optional',
    acceptedFormat: 'Monthly / Quarterly / Annual / Usage',
    description: 'Billing cadence or contract renewal frequency.',
    exampleValue: 'Annual',
    usedFor: 'Renewal Risk Segmentation',
  },
  {
    name: 'payment_method',
    category: 'Relationship & Subscription',
    tier: 'Recommended',
    acceptedFormat: 'Credit Card / Auto-Debit / Bank Transfer / Manual Invoice',
    description: 'Primary payment instrument on file.',
    exampleValue: 'Credit Card',
    usedFor: 'Involuntary Churn & Payment Friction Analysis',
  },
  // Category 3 — Financial & Revenue
  {
    name: 'monthly_revenue',
    category: 'Financial & Revenue',
    tier: 'Recommended',
    acceptedFormat: 'Non-negative numeric (e.g. 249.00, no currency symbol needed)',
    description: 'Monthly recurring revenue (MRR) or average monthly customer spend.',
    exampleValue: '249.00',
    usedFor: 'Customer Value Intelligence & Revenue Exposure',
  },
  {
    name: 'total_revenue',
    category: 'Financial & Revenue',
    tier: 'Recommended',
    acceptedFormat: 'Non-negative numeric',
    description: 'Cumulative revenue collected across the customer lifetime.',
    exampleValue: '4482.00',
    usedFor: 'Value Segmentation & Concentration Analytics',
  },
  {
    name: 'annual_revenue',
    category: 'Financial & Revenue',
    tier: 'Optional',
    acceptedFormat: 'Non-negative numeric',
    description: 'Annualized recurring revenue (ARR) or 12-month billing total.',
    exampleValue: '2988.00',
    usedFor: 'Direct Annual Exposure Calculations',
  },
  {
    name: 'average_transaction_value',
    category: 'Financial & Revenue',
    tier: 'Optional',
    acceptedFormat: 'Non-negative numeric',
    description: 'Average invoice or order size for transactional businesses.',
    exampleValue: '124.50',
    usedFor: 'Value Estimation when MRR is absent',
  },
  {
    name: 'contract_value',
    category: 'Financial & Revenue',
    tier: 'Optional',
    acceptedFormat: 'Non-negative numeric',
    description: 'Total committed contract or renewal value.',
    exampleValue: '3200.00',
    usedFor: 'Contract Renewal Value Exposure',
  },
  {
    name: 'profit_margin',
    category: 'Financial & Revenue',
    tier: 'If Available',
    acceptedFormat: 'Numeric percentage (0-100 or 0.0-1.0)',
    description: 'Net or gross profit margin if cost accounting is tracked. Never assumed from revenue.',
    exampleValue: '42.5',
    usedFor: 'True Profit Contribution Analysis',
  },
  {
    name: 'payment_status',
    category: 'Financial & Revenue',
    tier: 'Recommended',
    acceptedFormat: 'Paid / Current / Pending / Late / Overdue / Failed',
    description: 'Recent billing settlement health.',
    exampleValue: 'Paid',
    usedFor: 'Payment Reliability Scoring',
  },
  {
    name: 'late_payment_count',
    category: 'Financial & Revenue',
    tier: 'Optional',
    acceptedFormat: 'Non-negative integer',
    description: 'Number of delayed or missed invoices during observation window.',
    exampleValue: '0',
    usedFor: 'Payment Health Penalty & Churn Signal',
  },
  {
    name: 'outstanding_balance',
    category: 'Financial & Revenue',
    tier: 'Optional',
    acceptedFormat: 'Non-negative numeric',
    description: 'Unpaid overdue balance currently owed.',
    exampleValue: '0.00',
    usedFor: 'Billing Risk Assessment',
  },
  // Category 4 — Customer Satisfaction & Feedback
  {
    name: 'customer_satisfaction_score',
    category: 'Satisfaction & Feedback',
    tier: 'Recommended',
    acceptedFormat: 'Numeric matching workspace scale (1-5, 1-10, 0-100, or NPS -100..100)',
    description: 'Latest CSAT, NPS, or survey score reported by the customer.',
    exampleValue: '4.4',
    usedFor: 'Satisfaction vs Churn Comparison & Risk Drivers',
  },
  {
    name: 'last_feedback_date',
    category: 'Satisfaction & Feedback',
    tier: 'Optional',
    acceptedFormat: 'YYYY-MM-DD',
    description: 'Date of most recent CSAT/NPS survey response.',
    exampleValue: '2026-08-20',
    usedFor: 'Feedback Recency Tracking',
  },
  {
    name: 'survey_response_status',
    category: 'Satisfaction & Feedback',
    tier: 'Optional',
    acceptedFormat: 'Responded / Pending / Declined / Not Sent',
    description: 'Whether customer participated in recent satisfaction surveys.',
    exampleValue: 'Responded',
    usedFor: 'Feedback Coverage Monitoring',
  },
  // Category 5 — Complaints & Support Tickets Summary
  {
    name: 'total_complaints',
    category: 'Complaints & Support Tickets',
    tier: 'Recommended',
    acceptedFormat: 'Non-negative integer',
    description: 'Count of formal complaints logged by the customer.',
    exampleValue: '0',
    usedFor: 'Customer Intelligence Friction Alerts & ML Prediction',
  },
  {
    name: 'total_tickets_raised',
    category: 'Complaints & Support Tickets',
    tier: 'Recommended',
    acceptedFormat: 'Non-negative integer',
    description: 'Total support tickets submitted (auto-reconciled with Ticket_Data to prevent double-counting).',
    exampleValue: '1',
    usedFor: 'Support Load Benchmarking & Churn Drivers',
  },
  {
    name: 'open_tickets',
    category: 'Complaints & Support Tickets',
    tier: 'Recommended',
    acceptedFormat: 'Non-negative integer',
    description: 'Currently active open support tickets.',
    exampleValue: '0',
    usedFor: 'Active Escalation Watchlist',
  },
  {
    name: 'resolved_tickets',
    category: 'Complaints & Support Tickets',
    tier: 'Optional',
    acceptedFormat: 'Non-negative integer',
    description: 'Total closed/resolved support requests.',
    exampleValue: '1',
    usedFor: 'Ticket Resolution Ratio',
  },
  {
    name: 'unresolved_tickets',
    category: 'Complaints & Support Tickets',
    tier: 'Optional',
    acceptedFormat: 'Non-negative integer',
    description: 'Pending or stalled unresolved support tickets.',
    exampleValue: '0',
    usedFor: 'Urgent Retention Intervention Queue',
  },
  {
    name: 'average_resolution_days',
    category: 'Complaints & Support Tickets',
    tier: 'Optional',
    acceptedFormat: 'Non-negative numeric (days)',
    description: 'Mean time in days to resolve customer support tickets.',
    exampleValue: '1.5',
    usedFor: 'Service SLA Churn Correlation',
  },
  // Category 6 — Engagement & Behaviour
  {
    name: 'purchase_frequency',
    category: 'Engagement & Behaviour',
    tier: 'Recommended',
    acceptedFormat: 'Non-negative numeric',
    description: 'Orders, check-ins, visits, or usage sessions per period.',
    exampleValue: '12',
    usedFor: 'Behaviour Monitoring & Customer Value Scoring',
  },
  {
    name: 'last_activity_date',
    category: 'Engagement & Behaviour',
    tier: 'Recommended',
    acceptedFormat: 'YYYY-MM-DD',
    description: 'Most recent purchase, login, check-in, or billing interaction.',
    exampleValue: '2026-09-18',
    usedFor: 'Inactivity Watchlist Detection',
  },
  {
    name: 'usage_score',
    category: 'Engagement & Behaviour',
    tier: 'Optional',
    acceptedFormat: 'Numeric 0-100',
    description: 'Product adoption or feature engagement index.',
    exampleValue: '78',
    usedFor: 'Engagement Drop Monitoring',
  },
  {
    name: 'spend_growth',
    category: 'Engagement & Behaviour',
    tier: 'Optional',
    acceptedFormat: 'Numeric percentage (e.g. 8.5 or -12.0)',
    description: 'Period-over-period change in customer spending.',
    exampleValue: '6.5',
    usedFor: 'Customer Value Expansion / Contraction Signal',
  },
  // Category 7 — Churn & Retention
  {
    name: 'churn_status',
    category: 'Churn & Retention',
    tier: 'Required',
    acceptedFormat: 'Churned / Retained / Unknown (or Yes / No — optional for New Businesses)',
    description: 'Confirmed historical outcome label. Leave Unknown or omit for New Business monitoring.',
    exampleValue: 'Retained',
    usedFor: 'Descriptive Churn Rate & Supervised ML Training',
  },
  {
    name: 'churn_date',
    category: 'Churn & Retention',
    tier: 'Optional',
    acceptedFormat: 'YYYY-MM-DD (blank for retained customers)',
    description: 'Date customer left. Automatically excluded from ML prediction inputs to prevent target leakage.',
    exampleValue: '',
    usedFor: 'Churn Timeline Audit (Excluded from ML)',
  },
  {
    name: 'churn_reason',
    category: 'Churn & Retention',
    tier: 'Optional',
    acceptedFormat: 'Text (e.g. Pricing, Support Delays, Low Usage)',
    description: 'Post-cancellation exit reason. Automatically excluded from ML inputs to prevent leakage.',
    exampleValue: '',
    usedFor: 'Post-Outcome Attribution Review Only',
  },
];

export const TICKET_LEVEL_COLUMN_SPECS: ImportGuideFieldSpec[] = [
  {
    name: 'ticket_id',
    category: 'Ticket Record',
    tier: 'Required',
    acceptedFormat: 'Unique ticket identifier (e.g. TKT-9001)',
    description: 'Unique support case ID used to deduplicate tickets and prevent double-counting.',
    exampleValue: 'TKT-9001',
    usedFor: 'Ticket Deduplication & Audit Trail',
  },
  {
    name: 'customer_id',
    category: 'Ticket Record',
    tier: 'Required',
    acceptedFormat: 'Matching Customer_ID from Customer_Data',
    description: 'Foreign key linking ticket to customer profile.',
    exampleValue: 'CUST-1001',
    usedFor: 'Customer Ticket Aggregation',
  },
  {
    name: 'ticket_created_date',
    category: 'Ticket Record',
    tier: 'Required',
    acceptedFormat: 'YYYY-MM-DD',
    description: 'Date support ticket or complaint was opened.',
    exampleValue: '2026-08-12',
    usedFor: 'Ticket Recency & Resolution SLA Calculation',
  },
  {
    name: 'ticket_category',
    category: 'Ticket Record',
    tier: 'Recommended',
    acceptedFormat: 'Billing / Technical / Service Quality / Cancellation Request / General',
    description: 'Primary classification of customer support issue.',
    exampleValue: 'Billing',
    usedFor: 'Friction Root-Cause Categorisation',
  },
  {
    name: 'ticket_priority',
    category: 'Ticket Record',
    tier: 'Recommended',
    acceptedFormat: 'Low / Medium / High / Urgent',
    description: 'Severity or urgency assigned to the ticket.',
    exampleValue: 'High',
    usedFor: 'Escalation Prioritisation',
  },
  {
    name: 'ticket_status',
    category: 'Ticket Record',
    tier: 'Required',
    acceptedFormat: 'Open / Pending / Resolved / Closed',
    description: 'Current resolution state of the ticket.',
    exampleValue: 'Open',
    usedFor: 'Open vs Resolved Counts per Customer',
  },
  {
    name: 'ticket_resolved_date',
    category: 'Ticket Record',
    tier: 'Optional',
    acceptedFormat: 'YYYY-MM-DD (blank if still open)',
    description: 'Date ticket was resolved or closed.',
    exampleValue: '2026-08-15',
    usedFor: 'Automatic Resolution Time Calculation',
  },
  {
    name: 'resolution_duration_days',
    category: 'Ticket Record',
    tier: 'Optional',
    acceptedFormat: 'Non-negative numeric (days)',
    description: 'Elapsed days to resolve ticket.',
    exampleValue: '3.0',
    usedFor: 'Customer Avg Resolution Days',
  },
  {
    name: 'escalated',
    category: 'Ticket Record',
    tier: 'Optional',
    acceptedFormat: 'Yes / No',
    description: 'Indicates whether ticket required management/tier-2 escalation.',
    exampleValue: 'Yes',
    usedFor: 'Escalation Count per Customer',
  },
];

function buildTicketSampleRows(customerIds: string[]): Record<string, string>[] {
  const c0 = customerIds[0] || 'CUST-1001';
  const c1 = customerIds[1] || 'CUST-1002';
  const c2 = customerIds[2] || 'CUST-1003';
  const c3 = customerIds[3] || 'CUST-1004';
  return [
    {
      ticket_id: 'TKT-9001',
      customer_id: c0,
      ticket_created_date: '2026-08-10',
      ticket_category: 'Billing',
      ticket_priority: 'High',
      ticket_status: 'Open',
      ticket_resolved_date: '',
      resolution_duration_days: '',
      escalated: 'Yes',
    },
    {
      ticket_id: 'TKT-9002',
      customer_id: c0,
      ticket_created_date: '2026-07-14',
      ticket_category: 'Service Quality',
      ticket_priority: 'Urgent',
      ticket_status: 'Resolved',
      ticket_resolved_date: '2026-07-21',
      resolution_duration_days: '7',
      escalated: 'Yes',
    },
    {
      ticket_id: 'TKT-9003',
      customer_id: c1,
      ticket_created_date: '2026-08-22',
      ticket_category: 'Technical',
      ticket_priority: 'Low',
      ticket_status: 'Resolved',
      ticket_resolved_date: '2026-08-23',
      resolution_duration_days: '1',
      escalated: 'No',
    },
    {
      ticket_id: 'TKT-9004',
      customer_id: c2,
      ticket_created_date: '2026-09-01',
      ticket_category: 'General',
      ticket_priority: 'Medium',
      ticket_status: 'Resolved',
      ticket_resolved_date: '2026-09-03',
      resolution_duration_days: '2',
      escalated: 'No',
    },
    {
      ticket_id: 'TKT-9005',
      customer_id: c3,
      ticket_created_date: '2026-08-28',
      ticket_category: 'Cancellation Request',
      ticket_priority: 'High',
      ticket_status: 'Open',
      ticket_resolved_date: '',
      resolution_duration_days: '',
      escalated: 'Yes',
    },
  ];
}

function escapeCsvField(val: string): string {
  const safe = /^[=+\-@]/.test(val) ? `'${val}` : val;
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function normalizeTemplateMode(mode?: string): TemplateMode {
  const lower = String(mode || '').trim().toLowerCase();
  if (lower === 'new_business' || lower === 'cold_start') {
    return 'new_business';
  }
  if (lower === 'tickets' || lower === 'ticket_data' || lower === 'support_tickets') {
    return 'tickets';
  }
  if (lower === 'prediction_input') {
    return 'prediction_input';
  }
  return 'established_historical';
}

function getTargetValueFromSample(sample: Record<string, string>): string {
  return (
    sample.churn ??
    sample.exited ??
    sample.churned ??
    sample.discontinued ??
    sample.lapsed ??
    sample.dropped ??
    'No'
  );
}

export function generateIndustryTemplateExport(params: {
  industry: IndustryKey;
  format: TemplateFormat;
  mode?: LegacyCompatibleTemplateMode;
  scope?: 'comprehensive' | 'tickets' | 'pathway';
  customIndustryName?: string | null;
}): {
  fileName: string;
  contentType: string;
  body: string | Uint8Array;
} {
  const {
    industry,
    format,
    mode = 'established_historical',
    scope = 'comprehensive',
    customIndustryName,
  } = params;
  const resolvedMode = normalizeTemplateMode(mode);
  const profile = getIndustryTemplate(industry, customIndustryName);
  const slug = industry.replace(/[^a-z0-9_]/gi, '_');

  // Standalone Ticket-Level Export
  if (resolvedMode === 'tickets' || scope === 'tickets') {
    const ticketHeaders = TICKET_LEVEL_COLUMN_SPECS.map((s) => s.name);
    const ticketRows = buildTicketSampleRows(['CUST-1001', 'CUST-1002', 'CUST-1003', 'CUST-1004']);

    if (format === 'xlsx') {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(ticketRows, { header: ticketHeaders }),
        'Ticket_Data'
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          TICKET_LEVEL_COLUMN_SPECS.map((s) => ({
            Field_Name: s.name,
            Category: s.category,
            Requirement_Tier: s.tier,
            Accepted_Format: s.acceptedFormat,
            Description: s.description,
            Example: s.exampleValue,
            Used_For: s.usedFor,
          }))
        ),
        'Field_Guide'
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet([
          {
            Topic: 'Ticket Aggregation Rule',
            Guidance:
              'Upload Ticket_Data to link individual tickets to Customer_IDs. ChurnSight automatically computes Total_Tickets_Raised, Open_Tickets, Resolved_Tickets, and Average_Resolution_Days.',
          },
          {
            Topic: 'Double-Counting Protection',
            Guidance:
              'Duplicate Ticket_IDs are deduplicated automatically and never added on top of pre-existing customer-level ticket counts.',
          },
          {
            Topic: 'Synthetic Sample Marker',
            Guidance:
              'Replace the sample TKT-9001..TKT-9005 rows with your company support tickets using YYYY-MM-DD dates.',
          },
        ]),
        'Instructions'
      );
      const raw = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array;
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      return {
        fileName: `churnsight_${slug}_ticket_import_template.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: bytes,
      };
    }

    const csvLines = [
      ticketHeaders.map(escapeCsvField).join(','),
      ...ticketRows.map((r) => ticketHeaders.map((h) => escapeCsvField(r[h] ?? '')).join(',')),
    ];
    return {
      fileName: `churnsight_${slug}_ticket_import_template.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: csvLines.join('\n'),
    };
  }

  const templateColMode: 'new_business' | 'established_historical' =
    resolvedMode === 'new_business' ? 'new_business' : 'established_historical';
  const columnSpecs = getIndustryDataTemplateColumns(industry, templateColMode);
  const baseSampleRows = SAMPLE_ROWS_BY_INDUSTRY[industry] || SAMPLE_ROWS_BY_INDUSTRY.other;

  const hasIdCol = columnSpecs.some((s) => s.semanticRole === 'id');
  const hasTenureCol = columnSpecs.some((s) => s.semanticRole === 'tenure');
  const hasSegmentCol = columnSpecs.some((s) => s.semanticRole === 'segment');
  const hasRevenueCol = columnSpecs.some((s) => s.semanticRole === 'revenue');
  const hasFreqCol = columnSpecs.some((s) => s.semanticRole === 'frequency');
  const hasDateCol = columnSpecs.some((s) => s.semanticRole === 'date');
  const hasTargetCol = columnSpecs.some((s) => s.semanticRole === 'target');

  // Include ALL supported customer fields from COMPREHENSIVE_FIELD_GUIDE_SPECS alongside industry-tailored headers
  const extraImportCols =
    scope === 'comprehensive'
      ? COMPREHENSIVE_FIELD_GUIDE_SPECS.map((g) => g.name).filter((colName) => {
          if (columnSpecs.some((s) => s.name === colName)) return false;
          if (colName === 'customer_id' && hasIdCol) return false;
          if (colName === 'tenure_months' && hasTenureCol) return false;
          if (colName === 'plan_tier' && hasSegmentCol) return false;
          if (colName === 'monthly_revenue' && hasRevenueCol) return false;
          if (colName === 'purchase_frequency' && hasFreqCol) return false;
          if (colName === 'last_activity_date' && hasDateCol) return false;
          if (colName === 'churn_status' && (hasTargetCol || templateColMode === 'new_business')) {
            return false;
          }
          if (
            (colName === 'observation_date' || colName === 'churn_date' || colName === 'churn_reason') &&
            templateColMode === 'new_business'
          ) {
            return false;
          }
          return true;
        })
      : [];

  const baseHeaders = columnSpecs.map((c) => c.name);
  const headers = [...baseHeaders, ...extraImportCols];
  const sampleNames = [
    '[Example] Acme Horizon Corp',
    '[Example] Meridian Retail Group',
    '[Example] Crestline Logistics',
    '[Example] Harborview Studio',
    '[Example] Summit Cloud Partners',
    '[Example] Cedarbrook Health',
  ];
  const sampleCountries = ['United States', 'United Kingdom', 'Malaysia', 'Canada', 'Singapore', 'Australia'];
  const sampleTicketSummaries = [
    { total: '2', open: '1', resolved: '1', unresolved: '1', avgDays: '7.0' },
    { total: '1', open: '0', resolved: '1', unresolved: '0', avgDays: '1.0' },
    { total: '1', open: '0', resolved: '1', unresolved: '0', avgDays: '2.0' },
    { total: '1', open: '1', resolved: '0', unresolved: '1', avgDays: '' },
    { total: '0', open: '0', resolved: '0', unresolved: '0', avgDays: '' },
    { total: '0', open: '0', resolved: '0', unresolved: '0', avgDays: '' },
  ];

  const rows = baseSampleRows.map((sample, idx) => {
    const outcomeVal = getTargetValueFromSample(sample);
    const isChurned =
      templateColMode !== 'new_business' &&
      (outcomeVal === 'Yes' || outcomeVal === '1' || outcomeVal === 'Churned');
    const row: Record<string, string> = {};

    for (const col of columnSpecs) {
      if (col.name === 'registration_date') {
        const regDates = [
          '2026-06-14',
          '2024-09-10',
          '2025-11-02',
          '2026-03-21',
          '2023-08-05',
          '2025-07-18',
        ];
        row[col.name] = regDates[idx % regDates.length];
      } else if (col.name === 'customer_status') {
        const statuses = ['At-Risk', 'Active', 'Active', 'Trial', 'Active', 'Active'];
        row[col.name] = statuses[idx % statuses.length];
      } else if (col.name === 'observation_date') {
        const obsDates = [
          '2026-08-01',
          '2026-08-05',
          '2026-08-12',
          '2026-08-18',
          '2026-08-25',
          '2026-08-29',
        ];
        row[col.name] = obsDates[idx % obsDates.length];
      } else if (col.name === 'churn_status') {
        row[col.name] = isChurned ? 'Churned' : 'Retained';
      } else if (col.name === 'churn_date') {
        row[col.name] = isChurned ? `2026-09-${String(10 + idx * 3).padStart(2, '0')}` : '';
      } else {
        row[col.name] = sample[col.name] ?? col.exampleValue;
      }
    }

    if (scope === 'comprehensive') {
      const tenureNum = Number(
        sample.tenure_months ||
          sample.months_enrolled ||
          sample.months_subscribed ||
          sample.customer_lifetime_months ||
          12
      );
      const revNum = Number(
        sample.monthly_charges ||
          sample.mrr ||
          sample.monthly_dues ||
          sample.monthly_premium ||
          sample.tuition_fee ||
          sample.avg_order_value ||
          sample.revenue ||
          95
      );
      const totalRev = Number((revNum * Math.max(1, tenureNum)).toFixed(2));
      const annualRev = Number((revNum * 12).toFixed(2));
      const tktSummary = sampleTicketSummaries[idx % sampleTicketSummaries.length];

      const regDates = [
        '2026-06-14',
        '2024-09-10',
        '2025-11-02',
        '2026-03-21',
        '2023-08-05',
        '2025-07-18',
      ];
      const obsDates = [
        '2026-08-01',
        '2026-08-05',
        '2026-08-12',
        '2026-08-18',
        '2026-08-25',
        '2026-08-29',
      ];
      const billingCycles = ['Monthly', 'Annual', 'Annual', 'Monthly', 'Annual', 'Quarterly'];
      const margins = ['28.5', '44.0', '39.5', '24.0', '48.2', '36.8'];
      const usageScores = ['34', '88', '76', '41', '93', '81'];
      const spendGrowths = ['-14.5', '11.2', '6.8', '-8.0', '14.5', '4.2'];

      const extras: Record<string, string> = {
        customer_name: sampleNames[idx % sampleNames.length],
        email: `contact${idx + 1}@example-customer.test`,
        company_name: sampleNames[idx % sampleNames.length].replace('[Example] ', ''),
        customer_type: idx % 2 === 0 ? 'B2B' : 'SMB',
        country_region: sampleCountries[idx % sampleCountries.length],
        customer_status: isChurned ? 'Cancelled' : idx === 3 ? 'At-Risk' : 'Active',
        registration_date: regDates[idx % regDates.length],
        observation_date: obsDates[idx % obsDates.length],
        subscription_end_date: isChurned ? '' : '2027-06-30',
        billing_cycle: billingCycles[idx % billingCycles.length],
        payment_method: sample.payment_method || (idx % 2 === 0 ? 'Credit Card' : 'Auto-Debit'),
        total_revenue: String(totalRev),
        annual_revenue: String(annualRev),
        average_transaction_value: String(Number(revNum.toFixed(2))),
        contract_value: String(annualRev),
        profit_margin: margins[idx % margins.length],
        payment_status: isChurned ? 'Late' : 'Paid',
        late_payment_count: isChurned ? '2' : '0',
        outstanding_balance: isChurned ? String(Number(revNum.toFixed(2))) : '0.00',
        customer_satisfaction_score: isChurned ? (idx % 2 === 0 ? '2.1' : '2.6') : idx % 2 === 0 ? '4.7' : '4.3',
        last_feedback_date: '2026-08-20',
        survey_response_status: idx % 3 === 0 ? 'Pending' : 'Responded',
        total_complaints: isChurned ? '3' : '0',
        total_tickets_raised: tktSummary.total,
        open_tickets: tktSummary.open,
        resolved_tickets: tktSummary.resolved,
        unresolved_tickets: tktSummary.unresolved,
        average_resolution_days: tktSummary.avgDays,
        usage_score: usageScores[idx % usageScores.length],
        spend_growth: spendGrowths[idx % spendGrowths.length],
        churn_reason: isChurned ? 'Service Escalation / Pricing' : '',
      };

      for (const extraCol of extraImportCols) {
        if (row[extraCol] === undefined) {
          row[extraCol] = extras[extraCol] ?? '';
        }
      }
    }

    return row;
  });

  const sampleCustomerIds = rows.map(
    (r) =>
      r.customer_id ||
      r.account_id ||
      r.workspace_id ||
      r.member_id ||
      r.patient_id ||
      r.policyholder_id ||
      r.learner_id ||
      'CUST-1001'
  );

  const suffix =
    templateColMode === 'new_business'
      ? 'new_business_monitoring_template'
      : scope === 'comprehensive'
        ? 'import_centre_template'
        : 'established_historical_template';

  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new();
    const dataSheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    XLSX.utils.book_append_sheet(wb, dataSheet, 'Customer_Data');

    const ticketRows = buildTicketSampleRows(sampleCustomerIds);
    const ticketSheet = XLSX.utils.json_to_sheet(ticketRows, {
      header: TICKET_LEVEL_COLUMN_SPECS.map((s) => s.name),
    });
    XLSX.utils.book_append_sheet(wb, ticketSheet, 'Ticket_Data');

    const guideRows = [
      ...COMPREHENSIVE_FIELD_GUIDE_SPECS.map((g) => ({
        Field_Name: g.name,
        Category: g.category,
        Requirement_Tier: g.tier,
        Accepted_Format: g.acceptedFormat,
        Description: g.description,
        Example: g.exampleValue,
        Used_For: g.usedFor,
      })),
      ...TICKET_LEVEL_COLUMN_SPECS.map((g) => ({
        Field_Name: g.name,
        Category: `Ticket_Data Sheet · ${g.category}`,
        Requirement_Tier: g.tier,
        Accepted_Format: g.acceptedFormat,
        Description: g.description,
        Example: g.exampleValue,
        Used_For: g.usedFor,
      })),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(guideRows), 'Field_Guide');

    const instructionRows = [
      {
        Rule_Area: 'Date Formats',
        Instructions: 'Use ISO YYYY-MM-DD format (e.g. 2026-09-15). Avoid ambiguous text dates.',
      },
      {
        Rule_Area: 'Currency & Revenue Values',
        Instructions:
          'Enter plain non-negative numbers (e.g. 249.50). Currency symbols are optional but must not mix text notes.',
      },
      {
        Rule_Area: 'Churn_Status Accepted Values',
        Instructions:
          templateColMode === 'new_business'
            ? 'New Business mode: Do not fabricate churn outcomes. Leave Unknown or omit churn_status until real outcomes occur.'
            : 'Use Churned, Retained, or Unknown (Yes / No and 1 / 0 are also supported).',
      },
      {
        Rule_Area: 'Satisfaction Score Scales',
        Instructions:
          'Match your configured ChurnSight workspace scale: CSAT 1–5, 1–10, 0–100, or NPS (-100 to +100).',
      },
      {
        Rule_Area: 'Missing Values & Duplicates',
        Instructions:
          'Each Customer_ID and Ticket_ID should appear only once. Leave unavailable metrics blank rather than entering zeros unless the true value is 0.',
      },
      {
        Rule_Area: 'Multi-Sheet Ticket Linking',
        Instructions:
          'Rows in Ticket_Data are automatically aggregated per Customer_ID during upload and reconciled without double-counting customer summary ticket columns.',
      },
      {
        Rule_Area: 'Industry Adaptation',
        Instructions: `Tailored for ${profile.label}. Rename or map additional industry-specific columns in the Import Centre Column Mapping step.`,
      },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(instructionRows), 'Instructions');

    const raw = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array;
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    return {
      fileName: `churnsight_${slug}_${suffix}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: bytes,
    };
  }

  const csvLines = [
    headers.map(escapeCsvField).join(','),
    ...rows.map((r) => headers.map((h) => escapeCsvField(r[h] ?? '')).join(',')),
  ];

  return {
    fileName: `churnsight_${slug}_${suffix}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: csvLines.join('\n'),
  };
}

export function generatePredictionInputTemplateExport(params: {
  industry: IndustryKey;
  format: TemplateFormat;
  artifact: TrainedModelArtifact;
  customIndustryName?: string | null;
}): {
  fileName: string;
  contentType: string;
  body: string | Uint8Array;
  columns: { name: string; kind: string; exampleValue: string; acceptedValues: string }[];
} {
  const { industry, format, artifact, customIndustryName } = params;
  const profile = getIndustryTemplate(industry, customIndustryName);
  const idColName = artifact.mapping.idColumn || 'customer_id';

  const featureMetaList = artifact.features;
  const headers = [idColName, ...featureMetaList.map((f) => f.column)];

  const columns = [
    {
      name: idColName,
      kind: 'identifier',
      exampleValue: 'CURR-1001',
      acceptedValues: 'Unique current customer ID',
    },
    ...featureMetaList.map((feat) => {
      if (feat.kind === 'numeric') {
        return {
          name: feat.column,
          kind: 'numeric',
          exampleValue: String(Number(feat.median.toFixed(2))),
          acceptedValues: `Numeric value (training median: ${Number(feat.median.toFixed(2))})`,
        };
      }
      return {
        name: feat.column,
        kind: 'categorical',
        exampleValue: feat.mode || feat.categories[0] || 'Standard',
        acceptedValues: feat.categories.slice(0, 8).join(', ') || feat.mode,
      };
    }),
  ];

  const sampleCount = 3;
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const row: Record<string, string> = {};
    row[idColName] = `CURR-${1001 + i}`;
    for (const feat of featureMetaList) {
      if (feat.kind === 'numeric') {
        const delta = i === 0 ? 0 : i === 1 ? feat.std * 0.5 : -feat.std * 0.5;
        const val = Math.max(0, feat.median + delta);
        row[feat.column] = String(Number(val.toFixed(2)));
      } else {
        const cats = feat.categories.length > 0 ? feat.categories : [feat.mode];
        row[feat.column] = cats[i % cats.length] || feat.mode;
      }
    }
    rows.push(row);
  }

  const slug = industry.replace(/[^a-z0-9_]/gi, '_');
  const versionTag = (artifact.evaluation.version || 'v1').replace(/[^a-z0-9_]/gi, '_');
  const baseName = `churnsight_${slug}_prediction_input_${versionTag}`;

  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new();
    const inputSheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    XLSX.utils.book_append_sheet(wb, inputSheet, 'Current_Customers_To_Score');

    const specRows = [
      {
        Column_Name: idColName,
        Input_Role: 'Customer Identifier (Required)',
        Data_Type: 'identifier',
        Accepted_Values_Or_Range: 'Unique current customer ID',
        Example: 'CURR-1001',
      },
      ...columns.slice(1).map((c) => ({
        Column_Name: c.name,
        Input_Role: `Model Input Feature (${artifact.evaluation.modelName} ${artifact.evaluation.version})`,
        Data_Type: c.kind,
        Accepted_Values_Or_Range: c.acceptedValues,
        Example: c.exampleValue,
      })),
    ];
    const specSheet = XLSX.utils.json_to_sheet(specRows);
    XLSX.utils.book_append_sheet(wb, specSheet, 'Model_Input_Specification');

    const noteSheet = XLSX.utils.json_to_sheet([
      {
        Rule: 'No Future Outcome Columns',
        Detail: `This Current Customer Prediction Template is tailored for ${profile.label} (${artifact.evaluation.modelName} ${artifact.evaluation.version}) and intentionally excludes Churn_Status and Churn_Date.`,
      },
      {
        Rule: 'Upload Destination',
        Detail:
          'Fill in active customers and upload this file in Churn Predictions → Batch Scoring to generate forward-looking churn risk probabilities.',
      },
    ]);
    XLSX.utils.book_append_sheet(wb, noteSheet, 'Scoring_Instructions');

    const raw = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array;
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    return {
      fileName: `${baseName}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: bytes,
      columns,
    };
  }

  const csvLines = [
    headers.map(escapeCsvField).join(','),
    ...rows.map((r) => headers.map((h) => escapeCsvField(r[h] ?? '')).join(',')),
  ];

  return {
    fileName: `${baseName}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: csvLines.join('\n'),
    columns,
  };
}
