import type { SubscriptionPlanSpec, SubscriptionPlanTier } from '../types/churn.ts';

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanTier, SubscriptionPlanSpec> = {
  free_trial: {
    tier: 'free_trial',
    name: 'Free Trial',
    monthlyPriceLabel: '$0 / 14-day evaluation',
    tagline: 'Core workspace exploration for initial dataset profiling and baseline classification.',
    maxRecords: 1000,
    maxUsers: 3,
    maxStorageBytes: 5 * 1024 * 1024, // 5 MB
    allowedModels: ['logistic_regression', 'decision_tree'],
    allowBatchScoring: false,
    allowPdfReports: false,
    allowAuditLogs: false,
    allowChronologicalSplit: false,
  },
  starter: {
    tier: 'starter',
    name: 'Starter',
    monthlyPriceLabel: '$79 / month',
    tagline: 'Single-team retention analytics with Random Forest, batch scoring, and PDF reporting.',
    maxRecords: 10000,
    maxUsers: 10,
    maxStorageBytes: 25 * 1024 * 1024, // 25 MB
    allowedModels: ['logistic_regression', 'decision_tree', 'random_forest'],
    allowBatchScoring: true,
    allowPdfReports: true,
    allowAuditLogs: false,
    allowChronologicalSplit: true,
  },
  professional: {
    tier: 'professional',
    name: 'Professional',
    monthlyPriceLabel: '$249 / month',
    tagline: 'Multi-analyst enterprise intelligence with full model governance and audit trails.',
    maxRecords: 100000,
    maxUsers: 50,
    maxStorageBytes: 100 * 1024 * 1024, // 100 MB
    allowedModels: ['logistic_regression', 'decision_tree', 'random_forest'],
    allowBatchScoring: true,
    allowPdfReports: true,
    allowAuditLogs: true,
    allowChronologicalSplit: true,
  },
  enterprise: {
    tier: 'enterprise',
    name: 'Enterprise',
    monthlyPriceLabel: 'Custom SLA',
    tagline: 'High-volume tenant isolation, extended storage, and dedicated retention architecture.',
    maxRecords: 1000000,
    maxUsers: 500,
    maxStorageBytes: 500 * 1024 * 1024, // 500 MB
    allowedModels: ['logistic_regression', 'decision_tree', 'random_forest'],
    allowBatchScoring: true,
    allowPdfReports: true,
    allowAuditLogs: true,
    allowChronologicalSplit: true,
  },
};

export const SUBSCRIPTION_PLAN_LIST: SubscriptionPlanSpec[] = [
  SUBSCRIPTION_PLANS.free_trial,
  SUBSCRIPTION_PLANS.starter,
  SUBSCRIPTION_PLANS.professional,
  SUBSCRIPTION_PLANS.enterprise,
];

export function getSubscriptionPlanSpec(tier?: SubscriptionPlanTier | null): SubscriptionPlanSpec {
  if (tier && SUBSCRIPTION_PLANS[tier]) {
    return SUBSCRIPTION_PLANS[tier];
  }
  // Existing workspaces created prior to tiering default cleanly to Professional so all academic/demo features remain accessible
  return SUBSCRIPTION_PLANS.professional;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
