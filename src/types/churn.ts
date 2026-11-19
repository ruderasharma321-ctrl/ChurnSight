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

export interface ChurnDefinition {
  triggerType: ChurnTriggerType;
  churnEventDescription: string;
  calculationMethod: ChurnCalculationMethod;
  denominatorPopulation: ChurnDenominatorType;
  reportingPeriod: ReportingPeriod;
  inactivityDays: number | null;
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
  tier: TemplateColumnTier;
  dataType: ColumnDataType;
  semanticRole: ColumnSemanticRole;
  acceptedFormats: string;
  description: string;
  exampleValue: string;
  coldStartNote?: string;
}

export type ColumnDataType = 'numeric' | 'categorical' | 'identifier' | 'date';

export type ColumnSemanticRole =
  | 'id'
  | 'target'
  | 'date'
  | 'revenue'
  | 'tenure'
  | 'segment'
  | 'frequency'
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
  dateColumn?: string | null; // Event / Last Activity / Signup / Transaction Date
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

export interface DatasetState {
  datasetId: string;
  fileName: string;
  sourceFormat?: 'csv' | 'xlsx';
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
  previewRows: Record<string, string>[];
}

export interface StagedDatasetImport {
  stagedId: string;
  fileName: string;
  sourceFormat: 'csv' | 'xlsx';
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

export interface AnalyticsFilters {
  contract?: string;
  churnStatus?: 'ALL' | 'Churned' | 'Stayed';
  tenureGroup?: string;
  paymentMethod?: string;
}

export interface AnalyticsFilterOptions {
  contracts: string[];
  tenureGroups: string[];
  paymentMethods: string[];
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
  split: 'Training' | 'Unseen Test';
  actualChurn: 'Churned' | 'Stayed';
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
  churnDefinition: ChurnDefinition;
  privacySettings?: DataPrivacySettings;
  createdAt: string;
}

export interface AuthSessionPayload {
  user: UserAccount;
  company: CompanyWorkspaceInfo;
  expiresAt: string;
  sessionToken?: string;
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
  | 'intelligence'
  | 'data'
  | 'analytics'
  | 'predictions'
  | 'performance'
  | 'reports'
  | 'settings'
  | 'technical'
  | 'platform'
  | 'about';

