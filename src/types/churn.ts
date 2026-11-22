export type IndustryKey =
  | 'telecommunications'
  | 'banking_finance'
  | 'retail_ecommerce'
  | 'saas_technology'
  | 'healthcare'
  | 'insurance'
  | 'education'
  | 'fitness_membership'
  | 'other';

export type BusinessType = 'B2C' | 'B2B' | 'B2B2C' | 'Non-Profit / Public';

export type BusinessModel =
  | 'Subscription / Recurring'
  | 'Transactional / Repeat Purchase'
  | 'Contract / Retainer'
  | 'Membership / Hybrid';

export type CustomerRelationshipType =
  | 'Contractual / Recurring Subscription'
  | 'Repeat Purchase / Transactional'
  | 'Fixed-Term Renewal / Policy'
  | 'Long-Term Care / Advisory'
  | 'Membership / Attendance-Based';

export type SubscriptionPlanTier =
  | 'free_trial'
  | 'starter'
  | 'professional'
  | 'enterprise';

export type ChurnTriggerType =
  | 'cancellation'
  | 'non_renewal'
  | 'inactivity'
  | 'custom_status';

export type ChurnCalculationMethod = 'customer_based' | 'period_based';

export type ChurnDenominatorType =
  | 'all_active_start'
  | 'all_customers'
  | 'eligible_renewals'
  | 'active_subscribers';

export type ReportingPeriod = 'monthly' | 'quarterly' | 'annual' | 'custom';

export type UploadPathway =
  | 'new_business'
  | 'established_historical'
  | 'current_prediction'
  | 'existing_custom';

export type TemplateMode =
  | 'new_business'
  | 'established_historical'
  | 'prediction_input'
  | 'tickets';

export type SatisfactionScale = '1-5' | '1-10' | '0-100' | 'nps';

export interface ChurnDefinition {
  triggerType: ChurnTriggerType;
  churnEventDescription: string;
  calculationMethod: ChurnCalculationMethod;
  denominatorPopulation: ChurnDenominatorType;
  reportingPeriod: ReportingPeriod;
  inactivityDays: number | null;
  churnStatusColumnHint?: string | null;
  cancellationDateColumnHint?: string | null;
  confirmedByUser: boolean;
  confirmedAt: string | null;
}

export interface DataPrivacySettings {
  allowSharedModelContribution: boolean;
  optInCrossCompanyBaseline: boolean;
  crossCompanyValidationStatus:
    | 'not_enabled'
    | 'awaiting_opt_in_and_validation'
    | 'unvalidated_architecture_only';
  consentUpdatedAt: string | null;
  isolationGuarantee: string;
}

export type TemplateColumnTier = 'required' | 'recommended' | 'optional';

export interface IndustryTemplateColumnSpec {
  name: string;
  displayName: string;
  category?: string;
  tier: TemplateColumnTier;
  dataType: ColumnDataType;
  semanticRole: ColumnSemanticRole;
  acceptedFormats: string;
  description: string;
  exampleValue: string;
  usedFor?: string;
  coldStartNote?: string;
}

export type ColumnDataType = 'numeric' | 'categorical' | 'identifier' | 'date';

export type ColumnSemanticRole =
  | 'id'
  | 'target'
  | 'status'
  | 'date'
  | 'observation_date'
  | 'registration_date'
  | 'churn_date'
  | 'revenue'
  | 'tenure'
  | 'segment'
  | 'frequency'
  | 'satisfaction'
  | 'complaints'
  | 'tickets'
  | 'resolution_days'
  | 'profit'
  | 'cost'
  | 'payment_health'
  | 'other';

export interface ColumnProfile {
  name: string;
  dataType: ColumnDataType;
  semanticRole?: ColumnSemanticRole;
  missingCount: number;
  missingPercent: number;
  uniqueCount: number;
  sampleValues: string[];
  categories?: string[];
  invalidNumericCount: number;
  invalidDateCount?: number;
  inconsistentCategoryCount?: number;
  inconsistentCategorySamples?: string[];
}

export interface ColumnMapping {
  targetColumn: string;
  positiveClassValue: string;
  idColumn: string | null;
  contractColumn: string | null; // Segment / Plan / Contract / Tier column
  tenureColumn: string | null; // Tenure / Lifetime / Membership Duration column
  monthlyChargesColumn: string | null; // Revenue / MRR / Avg Order Value / Fee column
  dateColumn?: string | null; // Activity / Event / Observation / Renewal Date
  observationDateColumn?: string | null; // Historical Snapshot Observation_Date
  registrationDateColumn?: string | null; // Account Registration_Date
  churnDateColumn?: string | null; // Post-outcome Churn_Date / Cancellation_Date (excluded from ML features)
  statusColumn?: string | null; // Current Customer_Status (e.g., Active / Trial / Paused)
  frequencyColumn?: string | null; // Purchase Frequency / Visits / Usage Count
  featureColumns: string[];
}

export interface MappingSuggestionRationale {
  field: keyof ColumnMapping;
  suggestedColumn: string | null;
  confidence: 'high' | 'medium' | 'unmapped';
  reason: string;
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  column?: string;
  message: string;
}

export type OverallReadinessTier =
  | 'prediction_ready'
  | 'behaviour_monitoring_ready'
  | 'analytics_ready'
  | 'more_data_required';

export interface ReadinessOutcomeStatus {
  ready: boolean;
  score: number;
  summary: string;
  details: string[];
}

export interface ReadinessScoreFactor {
  label: string;
  score: number;
  maxScore: number;
  note: string;
}

export interface DataReadinessAssessment {
  overallStatus: OverallReadinessTier;
  overallLabel: string;
  readinessScore: number;
  analyticsReady: ReadinessOutcomeStatus & {
    availableVisuals: string[];
  };
  behaviourMonitoringReady: ReadinessOutcomeStatus & {
    trackedSignals: string[];
    inactivityWatchlistCount: number;
  };
  predictionReady: ReadinessOutcomeStatus & {
    blockers: string[];
    recommendedValidationStrategy: SplitStrategy;
    validationStrategyReason: string;
  };
  moreDataRequired: {
    needed: boolean;
    missingItems: string[];
    collectionGuidance: string[];
  };
  datasetProfile: {
    totalRows: number;
    labeledRows: number;
    unlabeledRows: number;
    churnedCount: number;
    retainedCount: number;
    minorityClassCount: number;
    classImbalanceWarning?: string | null;
    leakageColumnsExcluded?: string[];
    usableFeatureCount: number;
    missingCellPercent: number;
    duplicateRowCount: number;
    invalidDateCount: number;
    inconsistentCategoryColumns: number;
    hasValidDates: boolean;
    churnDefinitionConfirmed: boolean;
  };
  scoreBreakdown: ReadinessScoreFactor[];
  explanation: string;
  nextActions: string[];
}

export interface RowValidationIssue {
  rowIndex: number;
  customerId: string;
  status: 'warning' | 'error';
  messages: string[];
}

export interface RowValidationPreviewItem {
  rowIndex: number;
  customerId: string;
  customerName: string;
  subscriptionStatus: string;
  tenure: string;
  satisfactionScore: string;
  complaints: string;
  ticketsRaised: string;
  avgResolutionTime: string;
  revenue: string;
  churnStatus: string;
  validationStatus: 'Valid' | 'Warning' | 'Error';
  validationNotes: string[];
}

export interface RowValidationReport {
  totalRows: number;
  validCount: number;
  warningCount: number;
  errorCount: number;
  duplicateCustomerIds: number;
  duplicateTicketIds: number;
  missingValuesCount: number;
  mappedFieldsCount: number;
  unmappedColumns: string[];
  issuesSummary: { label: string; count: number; severity: 'warning' | 'error' }[];
  rowErrors: RowValidationIssue[];
  previewRecords: RowValidationPreviewItem[];
  hasRejectedRowsCsv: boolean;
}

export interface TicketAggregationSummary {
  source: 'embedded_sheet' | 'standalone_ticket_upload';
  ticketRowsCount: number;
  validTicketRows?: number;
  warningTicketRows?: number;
  errorTicketRows?: number;
  duplicateTicketIds: number;
  invalidTicketRows: number;
  matchedCustomersCount: number;
  unmatchedTicketCount: number;
  unmatchedTicketRowsCount?: number;
  doubleCountingPrevented: boolean;
  ticketIssues?: RowValidationIssue[];
  note: string;
}

export interface ModelCompatibilityReport {
  modelAvailable: boolean;
  modelVersion: string | null;
  modelName: string | null;
  compatible: boolean;
  requiredFeatures: string[];
  matchedFeatures: string[];
  missingFeatures: string[];
  message: string;
}

export type DuplicateIdHandlingMode = 'skip' | 'update' | 'replace';

export interface DuplicateCustomerConflictSummary {
  existingCount: number;
  conflictCount: number;
  sampleDuplicateIds: string[];
  existingDatasetFileName: string | null;
}

export interface UploadedDatasetSummary {
  datasetId: string;
  fileName: string;
  sourceFormat: 'csv' | 'xlsx';
  uploadPathway?: UploadPathway;
  uploadMode?: 'customer' | 'tickets';
  uploadedAt: string;
  customerCount: number;
  ticketCount: number;
  importStatus: 'Active' | 'Imported' | 'Partial (Errors Excluded)';
  isActive: boolean;
  isSample?: boolean;
}

export interface DatasetState {
  datasetId: string;
  fileName: string;
  sourceFormat?: 'csv' | 'xlsx';
  uploadPathway?: UploadPathway;
  satisfactionScale?: SatisfactionScale;
  isSample: boolean;
  uploadedAt: string;
  rowCount: number;
  columnCount: number;
  duplicateCount?: number;
  missingCellCount?: number;
  invalidDateCount?: number;
  inconsistentCategoryCount?: number;
  columns: ColumnProfile[];
  mapping: ColumnMapping;
  mappingRationales?: MappingSuggestionRationale[];
  targetUniqueValues: string[];
  issues: ValidationIssue[];
  isValid: boolean;
  hasValidChurnLabels?: boolean;
  churnReadinessMessage?: string | null;
  readiness?: DataReadinessAssessment;
  churnDefinition?: ChurnDefinition;
  rowValidation?: RowValidationReport;
  ticketAggregation?: TicketAggregationSummary | null;
  previewRows: Record<string, string>[];
}

export interface StagedDatasetImport {
  stagedId: string;
  fileName: string;
  sourceFormat: 'csv' | 'xlsx';
  uploadPathway?: UploadPathway;
  uploadMode?: 'customer' | 'tickets';
  satisfactionScale?: SatisfactionScale;
  isSample: boolean;
  uploadedAt: string;
  rowCount: number;
  columnCount: number;
  duplicateCount: number;
  missingCellCount: number;
  invalidDateCount?: number;
  inconsistentCategoryCount?: number;
  columns: ColumnProfile[];
  suggestedMapping: ColumnMapping;
  mappingRationales?: MappingSuggestionRationale[];
  suggestedChurnDefinition: ChurnDefinition;
  targetUniqueValues: string[];
  previewRows: Record<string, string>[];
  issues: ValidationIssue[];
  isValid: boolean;
  hasValidChurnLabels: boolean;
  churnReadinessMessage: string | null;
  readiness?: DataReadinessAssessment;
  rowValidation?: RowValidationReport;
  ticketAggregation?: TicketAggregationSummary | null;
  modelCompatibility?: ModelCompatibilityReport | null;
  duplicateConflict?: DuplicateCustomerConflictSummary | null;
}

export interface BehaviourWatchlistItem {
  rowIndex: number;
  customerId: string;
  lastDate: string | null;
  daysSinceActivity: number | null;
  engagementValue: string | null;
  revenueValue: string | null;
  reason: string;
}

export interface BehaviourMonitoringSummary {
  mode: 'labeled_and_behaviour' | 'cold_start_monitoring';
  activeAccountsCount: number;
  signalsDetected: string[];
  inactivityWatchlistCount: number;
  inactivityThresholdDays: number | null;
  lowEngagementCount: number;
  dateRange: {
    minDate: string;
    maxDate: string;
    validDateRows: number;
    invalidDateRows: number;
  } | null;
  watchlistSample: BehaviourWatchlistItem[];
}

export interface CategoryChurnStat {
  category: string;
  total: number;
  churned: number;
  stayed: number;
  churnRate: number;
}

export interface NumericComparisonStat {
  column: string;
  overallAvg: number;
  churnedAvg: number;
  stayedAvg: number;
}

export interface MonthlyChargesComparison {
  columnName: string;
  stayedAvg: number;
  churnedAvg: number;
  overallAvg: number;
  stayedCount: number;
  churnedCount: number;
}

export type AdditionalChartKey =
  | 'internetService'
  | 'gender'
  | 'seniorCitizen'
  | 'onlineSecurity'
  | 'techSupport'
  | 'dependents'
  | 'customSegment';

export interface AdditionalChartBreakdown {
  key: AdditionalChartKey;
  title: string;
  columnName: string;
  stats: CategoryChurnStat[];
}

export type CustomerActualStatus = 'Active' | 'Churned' | 'Inconsistent' | 'Unknown';

export type PredictedRiskLabel = 'High Risk' | 'Medium Risk' | 'Low Risk' | 'Not Applicable';

export interface InconsistentCustomerRecord {
  rowIndex: number;
  customerId: string;
  customerName?: string;
  reason: string;
}

export interface HistoricalPeriodPoint {
  period: string;
  label: string;
  customersAtStart: number;
  actualChurned: number;
  retainedCount: number;
  churnRate: number | null;
  reliable: boolean;
}

export interface HistoricalChurnPerformance {
  reportingPeriodGranularity: ReportingPeriod;
  selectedPeriod: string; // 'ALL' or specific period key (e.g. '2026-09', '2026-Q3', '2026')
  availablePeriods: string[];
  customersAtStartOfPeriod: number;
  actualChurnedCount: number;
  retainedCount: number;
  historicalChurnRate: number | null;
  historicalRateReliable: boolean;
  historicalRateNotice: string | null;
  inconsistentRecordsCount: number;
  inconsistentRecordsSample: InconsistentCustomerRecord[];
  unknownStatusCount: number;
  hasDateColumns: boolean;
  historicalTrends: HistoricalPeriodPoint[];
  formulaDescription: string;
}

export interface ActiveProbabilityBucket {
  bucket: string;
  rangeLabel: string;
  count: number;
  percentage: number;
}

export interface ActiveCustomerRiskSummary {
  totalActiveCustomers: number;
  scoredActiveCustomers: number;
  activeHighRiskCount: number;
  activeMediumRiskCount: number;
  activeLowRiskCount: number;
  excludedChurnedCount: number;
  excludedInconsistentCount: number;
  activeProbabilityDistribution: ActiveProbabilityBucket[];
  highValueActiveAtRiskCount: number | null;
  highValueActiveAtRiskRevenue: number | null;
}

export interface AnalyticsFilters {
  contract?: string;
  churnStatus?: 'ALL' | 'Churned' | 'Stayed';
  tenureGroup?: string;
  paymentMethod?: string;
  reportingPeriod?: string;
}

export interface AnalyticsFilterOptions {
  contracts: string[];
  tenureGroups: string[];
  paymentMethods: string[];
  reportingPeriods?: string[];
}

export interface AnalyticsSummary {
  totalCustomers: number;
  churnedCount: number;
  stayedCount: number;
  churnRate: number;
  stayedPercentage: number;
  churnedPercentage: number;
  isUnlabeledColdStart?: boolean;
  calculationExplanation?: string;
  behaviourMonitoring?: BehaviourMonitoringSummary | null;
  historicalPerformance?: HistoricalChurnPerformance;
  activeRiskSummary?: ActiveCustomerRiskSummary | null;
  contractStats: CategoryChurnStat[] | null;
  tenureStats: CategoryChurnStat[] | null;
  monthlyChargesStats: CategoryChurnStat[] | null;
  monthlyChargesComparison: MonthlyChargesComparison | null;
  frequencyComparison?: MonthlyChargesComparison | null;
  paymentMethodColumn: string | null;
  paymentMethodStats: CategoryChurnStat[] | null;
  numericComparisons: NumericComparisonStat[];
  categoricalBreakdowns: Record<string, CategoryChurnStat[]>;
  additionalCharts: AdditionalChartBreakdown[];
  filterOptions: AnalyticsFilterOptions;
  appliedFilters: AnalyticsFilters;
}

export type MLModelType = 'logistic_regression' | 'decision_tree' | 'random_forest';

export type SplitStrategy = 'stratified' | 'chronological';

export interface TrainModelRequest {
  modelType: MLModelType;
  testSplitRatio: number; // e.g., 0.2 or 0.3
  maxDepth?: number; // for decision tree / random forest
  nEstimators?: number; // for random forest
  splitStrategy?: SplitStrategy;
}

export interface ConfusionMatrix {
  tp: number; // Actual Churn, Predicted Churn
  tn: number; // Actual Stayed, Predicted Stayed
  fp: number; // Actual Stayed, Predicted Churn
  fn: number; // Actual Churn, Predicted Stayed
}

export interface FeatureImportance {
  feature: string;
  importance: number; // relative share % (0..100)
  coefficient?: number; // signed Logistic Regression weight (log-odds)
  direction?: 'increases_churn' | 'decreases_churn' | 'non_linear';
}

export type RiskCategory =
  | 'Low Estimated Churn Risk'
  | 'Moderate Estimated Churn Risk'
  | 'Higher Estimated Churn Risk';

export interface CustomerPrediction {
  rowIndex: number;
  customerId: string;
  customerName?: string;
  split: 'Training' | 'Unseen Test';
  actualChurn: 'Churned' | 'Stayed';
  actualStatus?: CustomerActualStatus;
  statusConflictReason?: string | null;
  riskApplicable?: boolean;
  predictedRiskLabel?: PredictedRiskLabel;
  predictedChurn: 'Likely to Churn' | 'Likely to Stay';
  churnProbability: number; // 0..1
  riskCategory: RiskCategory;
  attributes: Record<string, string>;
}

export interface BatchScoredRecord {
  rowIndex: number;
  customerId: string;
  predictedChurn: 'Likely to Churn' | 'Likely to Stay';
  churnProbability: number;
  riskCategory: RiskCategory;
  attributes: Record<string, string>;
}

export interface BatchScoreResult {
  batchId: string;
  fileName: string;
  scoredAt: string;
  modelId: string;
  modelName: string;
  modelVersion: string;
  totalRows: number;
  highRiskCount: number;
  moderateRiskCount: number;
  lowRiskCount: number;
  averageProbability: number;
  records: BatchScoredRecord[];
}

export interface BaselineMetrics {
  majorityClassLabel: 'Churned' | 'Stayed';
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
}

export interface ModelEvaluationResult {
  modelId: string;
  version: string;
  modelType: MLModelType;
  modelName: string;
  trainedAt: string;
  datasetId?: string;
  datasetSize?: number;
  isOutdated?: boolean;
  outdatedReason?: string | null;
  splitStrategy?: SplitStrategy;
  dateColumnUsed?: string | null;
  leakageWarnings?: string[];
  trainCount: number;
  testCount: number;
  testSplitRatio: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  majorityBaselineAccuracy: number;
  baselineMetrics: BaselineMetrics;
  testChurnRate: number;
  confusionMatrix: ConfusionMatrix;
  featureImportances: FeatureImportance[];
  predictions: CustomerPrediction[];
}

export type UserRole = 'PLATFORM_OWNER' | 'FIRM_ADMIN' | 'ANALYST';

export interface UserPermissions {
  canUploadAndAnalyse: boolean;
  canGeneratePredictions: boolean;
}

export interface UserAccount {
  id: string;
  companyId: string;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  avatarDataUrl: string | null;
  permissions: UserPermissions;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface CompanyWorkspaceInfo {
  id: string;
  name: string;
  email: string;
  registrationNumber: string | null;
  logoDataUrl: string | null;
  industry: IndustryKey;
  customIndustryName?: string | null;
  country: string;
  businessType: BusinessType;
  businessModel: BusinessModel;
  customerRelationshipType?: CustomerRelationshipType;
  subscriptionPlan: SubscriptionPlanTier;
  satisfactionScale?: SatisfactionScale;
  churnDefinition: ChurnDefinition;
  privacySettings?: DataPrivacySettings;
  createdAt: string;
}

export interface AuthSessionPayload {
  user: UserAccount;
  company: CompanyWorkspaceInfo;
  expiresAt: string;
  sessionToken?: string;
  rememberMe?: boolean;
}

export interface RegisterCompanyRequest {
  companyName: string;
  companyEmail: string;
  registrationNumber?: string;
  industry?: IndustryKey;
  customIndustryName?: string;
  country?: string;
  businessType?: BusinessType;
  businessModel?: BusinessModel;
  customerRelationshipType?: CustomerRelationshipType;
  adminFullName: string;
  adminEmail: string;
  password: string;
  confirmPassword: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface SubscriptionPlanSpec {
  tier: SubscriptionPlanTier;
  name: string;
  monthlyPriceLabel: string;
  tagline: string;
  maxRecords: number;
  maxUsers: number;
  maxStorageBytes: number;
  allowedModels: MLModelType[];
  allowBatchScoring: boolean;
  allowPdfReports: boolean;
  allowAuditLogs: boolean;
  allowChronologicalSplit: boolean;
}

export interface WorkspaceUsageSummary {
  plan: SubscriptionPlanSpec;
  userCount: number;
  recordCount: number;
  storageBytesUsed: number;
  trainedModelsCount: number;
  datasetUploaded: boolean;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  companyId: string;
  actorId: string;
  actorEmail: string;
  actorRole: UserRole;
  action: string;
  resource: string;
  details: string;
}

export interface PlatformCompanySummary {
  company: CompanyWorkspaceInfo;
  userCount: number;
  activeUserCount: number;
  hasDataset: boolean;
  datasetFileName: string | null;
  recordCount: number;
  trainedModelsCount: number;
  lastModelTrainedAt: string | null;
  storageBytesUsed: number;
}

export type AutomationPipelineStage =
  | 'dataset_uploaded'
  | 'data_validation_complete'
  | 'preparing_customer_data'
  | 'building_prediction_model'
  | 'checking_prediction_quality'
  | 'predictions_ready'
  | 'more_historical_data_required'
  | 'setup_failed';

export interface PredictionPipelineStep {
  key: string;
  label: string;
  status: 'completed' | 'active' | 'warning' | 'failed' | 'pending';
  detail: string;
}

export interface PredictionPipelineStatus {
  stage: AutomationPipelineStage;
  headline: string;
  summary: string;
  predictionAvailable: boolean;
  needsRefresh: boolean;
  refreshNotice: string | null;
  failureReason: string | null;
  recommendedAction: string | null;
  selectedAlgorithmReason: string | null;
  updatedAt: string;
  steps: PredictionPipelineStep[];
}

export type NavTab =
  | 'overview'
  | 'customers'
  | 'churn_analysis'
  | 'data'
  | 'reports'
  | 'settings'
  // Backward-compatible section aliases routed automatically to the 6 primary tabs
  | 'intelligence'
  | 'value'
  | 'analytics'
  | 'predictions'
  | 'performance'
  | 'technical'
  | 'platform'
  | 'about';

// ---------------------------------------------------------------------------
// Customer Value Intelligence Types
// ---------------------------------------------------------------------------

export interface CustomerValueConfig {
  weights: {
    revenue: number;
    frequency: number;
    tenure: number;
    paymentHealth: number;
    profit: number;
    growth: number;
  };
  highValuePercentile: number; // e.g. 75 (top 25% of composite scores)
  mediumValuePercentile: number; // e.g. 35 (middle 40%)
  highRiskCutoff: number; // e.g. 0.50 (50% churn probability cutoff)
  annualizationMonths: number; // default 12 when monthly revenue is scaled to annualized view
}

export interface ValueCriterionAvailability {
  key: 'revenue' | 'frequency' | 'tenure' | 'paymentHealth' | 'profit' | 'growth';
  label: string;
  available: boolean;
  sourceColumn: string | null;
  configuredWeight: number;
  effectiveWeight: number;
  note: string;
}

export type ValueSegmentTier = 'High Value' | 'Medium Value' | 'Low Value';

export type ValueMatrixQuadrant =
  | 'critical_retention_priority'
  | 'protect_and_maintain'
  | 'monitor_and_assess'
  | 'normal_monitoring'
  | 'risk_unavailable';

export interface CustomerValueFactorContribution {
  label: string;
  rawDisplay: string;
  percentileScore: number;
  weightPct: number;
}

export interface CustomerValueRecord {
  rowIndex: number;
  customerId: string;
  customerName: string;
  segment: string;
  actualStatus?: CustomerActualStatus;
  statusConflictReason?: string | null;
  riskApplicable?: boolean;
  predictedRiskLabel?: PredictedRiskLabel;
  valueScore: number; // 0..100 composite weighted percentile
  valueSegment: ValueSegmentTier;
  valueFactors: CustomerValueFactorContribution[];
  revenueContribution: number | null;
  revenueLabel: string | null;
  annualizedRevenue: number | null;
  profitContribution: number | null;
  profitMarginPct: number | null;
  churnProbability: number | null; // null when no validated model prediction applies or customer already churned
  riskCategory: RiskCategory | null;
  riskAvailable: boolean;
  quadrant: ValueMatrixQuadrant;
  quadrantLabel: string;
  expectedRevenueExposure: number | null; // annualizedRevenue * churnProbability ONLY when both exist and customer is Active
  riskFactors: string[];
  retentionPriority: 'Critical' | 'High' | 'Medium' | 'Low' | 'Unavailable';
}

export interface ValueDistributionBucket {
  segment: ValueSegmentTier;
  count: number;
  sharePercent: number;
  totalRevenue: number | null;
  avgValueScore: number;
  highRiskCount: number;
}

export interface ValueMatrixGroupCount {
  quadrant: ValueMatrixQuadrant;
  label: string;
  description: string;
  count: number;
  totalRevenue: number | null;
  expectedExposure: number | null;
}

export interface CustomerValueRecommendation {
  id: string;
  priority: 'Critical' | 'High' | 'Moderate';
  title: string;
  targetSegment: string;
  affectedCustomers: number;
  estimatedRevenueAtRisk: number | null;
  evidence: string;
  recommendedAction: string;
}

export interface CustomerValueSummary {
  datasetId: string;
  generatedAt: string;
  totalCustomers: number;
  activeCustomersCount?: number;
  churnedCustomersCount?: number;
  inconsistentCustomersCount?: number;
  valueAssessmentAvailable: boolean;
  unavailableReason: string | null;
  revenueAvailable: boolean;
  revenueBasisNote: string;
  profitAvailable: boolean;
  profitUnavailableReason: string | null;
  riskPredictionsAvailable: boolean;
  riskUnavailableReason: string | null;
  highValueCount: number;
  mediumValueCount: number;
  lowValueCount: number;
  highValueAtRiskCount: number | null;
  totalPortfolioRevenue: number | null;
  totalPortfolioProfit: number | null;
  atRiskCustomersRevenue: number | null; // Full revenue of ACTIVE customers above highRiskCutoff
  estimatedExpectedRevenueExposure: number | null; // Sum(annualRevenue * P(churn)) across ACTIVE customers
  highValueAtRiskRevenue: number | null;
  config: CustomerValueConfig;
  criteriaAvailability: ValueCriterionAvailability[];
  segmentDistribution: ValueDistributionBucket[];
  fourGroupMatrix: ValueMatrixGroupCount[];
  recommendations: CustomerValueRecommendation[];
  customers: CustomerValueRecord[];
}

