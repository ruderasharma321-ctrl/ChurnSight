import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  HelpCircle,
  Info,
  LifeBuoy,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Table2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  AnalyticsSummary,
  ChurnCalculationMethod,
  ChurnDefinition,
  ChurnDenominatorType,
  ChurnTriggerType,
  ColumnMapping,
  CompanyWorkspaceInfo,
  DatasetState,
  DuplicateIdHandlingMode,
  IndustryKey,
  ModelEvaluationResult,
  NavTab,
  PredictionPipelineStatus,
  ReportingPeriod,
  SatisfactionScale,
  StagedDatasetImport,
  TemplateColumnTier,
  UploadedDatasetSummary,
  UploadPathway,
} from '../types/churn';
import { apiFetch, downloadProtectedCsv } from '../utils/apiClient';
import {
  CALCULATION_METHOD_OPTIONS,
  CHURN_TRIGGER_OPTIONS,
  DENOMINATOR_OPTIONS,
  INDUSTRY_OPTIONS,
  REPORTING_PERIOD_OPTIONS,
  buildDefaultChurnDefinition,
  formatChurnCalculationExplanation,
  getIndustryDataTemplateColumns,
  getIndustryTemplate,
} from '../utils/industryConfig';
import { exportDatasetSummaryCsv } from '../utils/reportExporter';
import { DataReadinessPanel } from './DataReadinessPanel';
import { PredictionPipelineBanner } from './PredictionPipelineBanner';
import { TableRowsSkeleton } from './PremiumUI';

interface CustomerDataViewProps {
  company: CompanyWorkspaceInfo;
  dataset: DatasetState | null;
  uploadedDatasets?: UploadedDatasetSummary[];
  analytics?: AnalyticsSummary | null;
  activeModel?: ModelEvaluationResult | null;
  stagedImport: StagedDatasetImport | null;
  automationStatus?: PredictionPipelineStatus | null;
  isPipelineRunning?: boolean;
  isLoading: boolean;
  canUploadAndAnalyse?: boolean;
  canGeneratePredictions?: boolean;
  onLoadSample: () => void;
  onStageUpload: (
    fileName: string,
    payload: { csvText?: string; fileBase64?: string },
    uploadPathway?: UploadPathway,
    uploadMode?: 'customer' | 'tickets',
    satisfactionScale?: SatisfactionScale
  ) => Promise<void>;
  onCommitStaged: (req: {
    stagedId: string;
    mapping: ColumnMapping;
    churnDefinition: ChurnDefinition;
    importMode?: 'valid_only' | 'all';
    duplicateStrategy?: DuplicateIdHandlingMode;
    satisfactionScale?: SatisfactionScale;
  }) => Promise<void>;
  onCancelStaged: () => void;
  onDeleteDataset?: (datasetId: string) => Promise<void>;
  onActivateDataset?: (datasetId: string) => Promise<void>;
  onUpdateMapping: (mapping: Partial<ColumnMapping>) => Promise<void>;
  onSaveChurnDefinition?: (def: ChurnDefinition) => Promise<void>;
  onRecordOutcome?: (
    updates: { customerId: string; outcome: 'Churned' | 'Retained' }[]
  ) => Promise<void>;
  onAutoBuild?: () => void;
  onNavigate?: (tab: NavTab) => void;
  onWorkspaceMutated?: (data: Record<string, any>) => void;
}

interface PredictionTemplateMeta {
  available: boolean;
  modelVersion: string | null;
  modelName: string | null;
  columns: { name: string; kind: string; exampleValue: string; acceptedValues: string }[];
  reason: string | null;
}

const PATHWAY_LABELS: Record<UploadPathway, string> = {
  new_business: 'Option 1 · New Business (No Historical Churn Outcomes)',
  established_historical: 'Option 2 · Established Business (Historical Churn Data)',
  current_prediction: 'Option 3 · Current Customers (Churn Risk Scoring)',
  existing_custom: 'Option 4 · Existing Spreadsheet (Custom Mapping)',
};

const SATISFACTION_SCALE_OPTIONS: { value: SatisfactionScale; label: string; rangeHint: string }[] = [
  { value: '1-5', label: '1 to 5 (CSAT)', rangeHint: '1.0 – 5.0' },
  { value: '1-10', label: '1 to 10 (Rating)', rangeHint: '1.0 – 10.0' },
  { value: '0-100', label: '0 to 100 (Index)', rangeHint: '0 – 100' },
  { value: 'nps', label: 'NPS (-100 to +100)', rangeHint: '-100 to +100' },
];

const IMPORT_FIELD_CATEGORIES: {
  category: string;
  usedFor: string;
  fields: { name: string; requirement: 'Required' | 'Recommended' | 'Optional'; format: string; example: string }[];
}[] = [
  {
    category: '1. Customer Identification',
    usedFor: 'Deduplication, multi-sheet ticket linking, and customer traceability',
    fields: [
      { name: 'customer_id', requirement: 'Required', format: 'Unique string/ID', example: 'CUST-1001' },
      { name: 'customer_name', requirement: 'Recommended', format: 'Text name or company', example: '[Example] Acme Horizon Corp' },
      { name: 'email', requirement: 'Optional', format: 'Valid email address', example: 'contact@acme.test' },
    ],
  },
  {
    category: '2. Subscription & Lifecycle',
    usedFor: 'Cohort retention curves, contract risk breakdown, and status monitoring',
    fields: [
      { name: 'registration_date / observation_date', requirement: 'Required', format: 'YYYY-MM-DD', example: '2026-08-31' },
      { name: 'subscription_end_date', requirement: 'Optional', format: 'YYYY-MM-DD', example: '2027-06-30' },
      { name: 'customer_status', requirement: 'Recommended', format: 'Active, Trial, Paused, At-Risk', example: 'Active' },
      { name: 'contract_type / plan_tier', requirement: 'Recommended', format: 'Consistent category text', example: 'Month-to-month' },
      { name: 'tenure_months', requirement: 'Recommended', format: 'Non-negative number', example: '14' },
    ],
  },
  {
    category: '3. Revenue & Customer Value',
    usedFor: 'Customer Value Intelligence, revenue at risk, and margin analysis (profit never assumed)',
    fields: [
      { name: 'monthly_charges / mrr', requirement: 'Recommended', format: 'Non-negative decimal', example: '129.00' },
      { name: 'total_revenue', requirement: 'Recommended', format: 'Non-negative decimal', example: '1548.00' },
      { name: 'cost / profit / profit_margin', requirement: 'Optional', format: 'Numeric (only if cost data exists)', example: '38.5' },
      { name: 'payment_status / payment_method', requirement: 'Optional', format: 'Paid, Late, Overdue / Card, Autopay', example: 'Paid' },
    ],
  },
  {
    category: '4. Usage & Engagement',
    usedFor: 'Inactivity watchlists, cold-start behaviour baselines, and leading attrition drivers',
    fields: [
      { name: 'engagement_frequency / monthly_transactions', requirement: 'Recommended', format: 'Non-negative number', example: '12' },
      { name: 'last_activity_date', requirement: 'Recommended', format: 'YYYY-MM-DD', example: '2026-09-20' },
    ],
  },
  {
    category: '5. Support, Complaints & Experience',
    usedFor: 'Customer friction alerts, resolution SLA impact, and CSAT correlation analysis',
    fields: [
      { name: 'customer_satisfaction_score', requirement: 'Recommended', format: 'Matches selected workspace scale', example: '4.4' },
      { name: 'total_complaints', requirement: 'Recommended', format: 'Non-negative integer', example: '1' },
      { name: 'total_tickets_raised', requirement: 'Optional', format: 'Auto-synced from Ticket_Data if uploaded', example: '3' },
      { name: 'average_resolution_days', requirement: 'Optional', format: 'Non-negative decimal days', example: '2.4' },
    ],
  },
  {
    category: '6. Historical Churn Outcomes',
    usedFor: 'Supervised ML model training and validated churn rate reporting (excluded in Cold-Start)',
    fields: [
      { name: 'churn_status / churn', requirement: 'Required', format: 'Churned / Retained / Yes / No / 1 / 0', example: 'Retained' },
      { name: 'churn_date', requirement: 'Optional', format: 'YYYY-MM-DD (blank when retained)', example: '2026-09-12' },
    ],
  },
  {
    category: '7. Ticket_Data Sheet (Multi-Sheet or Standalone)',
    usedFor: 'Automatic per-customer ticket roll-up without double-counting customer summary columns',
    fields: [
      { name: 'Ticket_ID', requirement: 'Required', format: 'Unique ticket identifier', example: 'TKT-9001' },
      { name: 'Customer_ID', requirement: 'Required', format: 'Matches Customer_Data ID', example: 'CUST-1001' },
      { name: 'Ticket_Status', requirement: 'Required', format: 'Open, In Progress, Resolved, Closed', example: 'Resolved' },
      { name: 'Resolution_Days', requirement: 'Optional', format: 'Non-negative decimal', example: '2.5' },
    ],
  },
];

const SAMPLE_PREVIEW_RECORDS = [
  {
    customer_id: 'CUST-1001',
    customer_name: '[Example] Acme Horizon Corp',
    customer_status: 'At-Risk',
    tenure_months: '4',
    customer_satisfaction_score: '2.1',
    total_complaints: '3',
    total_tickets_raised: '4',
    average_resolution_days: '6.5',
    total_revenue: '358.00',
    churn_status: 'Churned',
  },
  {
    customer_id: 'CUST-1002',
    customer_name: '[Example] Meridian Retail Group',
    customer_status: 'Active',
    tenure_months: '36',
    customer_satisfaction_score: '4.7',
    total_complaints: '0',
    total_tickets_raised: '1',
    average_resolution_days: '1.2',
    total_revenue: '4644.00',
    churn_status: 'Retained',
  },
  {
    customer_id: 'CUST-1003',
    customer_name: '[Example] Crestline Logistics',
    customer_status: 'Active',
    tenure_months: '19',
    customer_satisfaction_score: '4.2',
    total_complaints: '1',
    total_tickets_raised: '2',
    average_resolution_days: '2.0',
    total_revenue: '1824.00',
    churn_status: 'Retained',
  },
];

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read Excel spreadsheet binary payload.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read spreadsheet file.'));
    reader.readAsDataURL(file);
  });
}

export const CustomerDataView: React.FC<CustomerDataViewProps> = ({
  company,
  dataset,
  uploadedDatasets = [],
  analytics = null,
  activeModel = null,
  stagedImport,
  automationStatus = null,
  isPipelineRunning = false,
  isLoading,
  canUploadAndAnalyse = true,
  canGeneratePredictions = true,
  onLoadSample,
  onStageUpload,
  onCommitStaged,
  onCancelStaged,
  onDeleteDataset,
  onActivateDataset,
  onUpdateMapping,
  onSaveChurnDefinition,
  onRecordOutcome,
  onAutoBuild,
  onNavigate,
  onWorkspaceMutated,
}) => {
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadSectionRef = useRef<HTMLDivElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateIdHandlingMode>('replace');
  const [deleteTarget, setDeleteTarget] = useState<UploadedDatasetSummary | null>(null);
  const [isDeletingDataset, setIsDeletingDataset] = useState(false);
  const [activatingDatasetId, setActivatingDatasetId] = useState<string | null>(null);
  const [datasetActionNotice, setDatasetActionNotice] = useState<string | null>(null);

  // Pre-upload Churn Definition, Upload Mode, Satisfaction Scale & Pathway states
  const [preUploadChurnDef, setPreUploadChurnDef] = useState<ChurnDefinition>(
    company.churnDefinition || buildDefaultChurnDefinition(company.industry)
  );
  const [isSavingChurnDef, setIsSavingChurnDef] = useState(false);
  const [churnDefMessage, setChurnDefMessage] = useState<string | null>(null);
  const [showPreDefEditor, setShowPreDefEditor] = useState(
    !company.churnDefinition?.confirmedByUser && !dataset
  );
  const [selectedPathway, setSelectedPathway] = useState<UploadPathway>(
    dataset?.uploadPathway || 'established_historical'
  );
  const [uploadMode, setUploadMode] = useState<'customer' | 'tickets'>('customer');
  const [satisfactionScale, setSatisfactionScale] = useState<SatisfactionScale>(
    company.satisfactionScale || dataset?.satisfactionScale || '1-5'
  );
  const [isSavingScale, setIsSavingScale] = useState(false);
  const [scaleMessage, setScaleMessage] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'valid_only' | 'all'>('valid_only');
  const [showSampleModal, setShowSampleModal] = useState(false);
  const [showRequirementsModal, setShowRequirementsModal] = useState(false);

  const [templateIndustry, setTemplateIndustry] = useState<IndustryKey>(company.industry);
  const [referenceMode, setReferenceMode] = useState<'new_business' | 'established_historical'>(
    'established_historical'
  );
  const [showTemplateSpec, setShowTemplateSpec] = useState(false);
  const [predictionTemplateMeta, setPredictionTemplateMeta] =
    useState<PredictionTemplateMeta | null>(null);

  // Staged import review states
  const [stagedMapping, setStagedMapping] = useState<ColumnMapping | null>(null);
  const [stagedChurnDef, setStagedChurnDef] = useState<ChurnDefinition | null>(null);

  // Paginated table state
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRow, setSelectedRow] = useState<Record<string, string> | null>(null);
  const [showMapper, setShowMapper] = useState(false);
  const [isFetchingRows, setIsFetchingRows] = useState(false);

  useEffect(() => {
    setPreUploadChurnDef(company.churnDefinition || buildDefaultChurnDefinition(company.industry));
    setTemplateIndustry(company.industry);
    if (company.satisfactionScale) {
      setSatisfactionScale(company.satisfactionScale);
    }
  }, [company.churnDefinition, company.industry, company.satisfactionScale]);

  useEffect(() => {
    if (selectedPathway === 'new_business') {
      setReferenceMode('new_business');
    } else if (selectedPathway === 'established_historical') {
      setReferenceMode('established_historical');
    }
  }, [selectedPathway]);

  useEffect(() => {
    let cancelled = false;
    const fetchPredictionMeta = async () => {
      try {
        const res = await apiFetch('/api/dataset/prediction-template?meta=1');
        if (!res.ok) return;
        const data = (await res.json()) as PredictionTemplateMeta;
        if (!cancelled) {
          setPredictionTemplateMeta(data);
        }
      } catch {
        // Ignore transient lookup error
      }
    };
    fetchPredictionMeta();
    return () => {
      cancelled = true;
    };
  }, [activeModel?.version, automationStatus?.predictionAvailable]);

  useEffect(() => {
    if (stagedImport) {
      setStagedMapping({ ...stagedImport.suggestedMapping });
      setStagedChurnDef({
        ...stagedImport.suggestedChurnDefinition,
        confirmedByUser: Boolean(company.churnDefinition?.confirmedByUser),
      });
      setDuplicateStrategy(stagedImport.duplicateConflict ? 'update' : 'replace');
      setUploadError(null);
      setDatasetActionNotice(null);
    } else {
      setStagedMapping(null);
      setStagedChurnDef(null);
    }
  }, [stagedImport, company.churnDefinition?.confirmedByUser]);

  useEffect(() => {
    if (!dataset) {
      setRows([]);
      return;
    }

    let cancelled = false;
    const fetchRows = async () => {
      setIsFetchingRows(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: '15',
          search: searchQuery,
        });
        const res = await apiFetch(`/api/dataset/rows?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setRows(data.items || []);
          setTotalPages(data.totalPages || 1);
          setTotalRows(data.total || 0);
        }
      } catch {
        // Ignore transient fetch errors
      } finally {
        if (!cancelled) setIsFetchingRows(false);
      }
    };

    fetchRows();
    return () => {
      cancelled = true;
    };
  }, [dataset, page, searchQuery]);

  const handleSaveSatisfactionScale = async (nextScale: SatisfactionScale) => {
    setSatisfactionScale(nextScale);
    setScaleMessage(null);
    if (!canUploadAndAnalyse) return;
    setIsSavingScale(true);
    try {
      const res = await apiFetch('/api/company/satisfaction-scale', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ satisfactionScale: nextScale }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update satisfaction scale.');
      }
      if (data.company && onWorkspaceMutated) {
        onWorkspaceMutated({ company: data.company });
      }
      setScaleMessage(`Satisfaction validation range set to ${nextScale.toUpperCase()}.`);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Unable to update satisfaction scale.');
    } finally {
      setIsSavingScale(false);
    }
  };

  const handleFile = async (file: File) => {
    setUploadError(null);
    const lower = file.name.toLowerCase();
    const isCsv = lower.endsWith('.csv') || file.type === 'text/csv';
    const isExcel =
      lower.endsWith('.xlsx') ||
      lower.endsWith('.xls') ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel';

    if (!isCsv && !isExcel) {
      setUploadError('Please upload a valid .csv, .xlsx, or .xls spreadsheet file.');
      return;
    }

    try {
      setImportMode('valid_only');
      if (isExcel) {
        const fileBase64 = await readFileAsBase64(file);
        await onStageUpload(
          file.name,
          { fileBase64 },
          selectedPathway,
          uploadMode,
          satisfactionScale
        );
      } else {
        const csvText = await file.text();
        await onStageUpload(
          file.name,
          { csvText },
          selectedPathway,
          uploadMode,
          satisfactionScale
        );
      }
      setPage(1);
      setSearchQuery('');
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Failed to parse spreadsheet.');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const canCommitWithoutChurnDef =
    stagedImport?.uploadMode === 'tickets' ||
    stagedImport?.uploadPathway === 'current_prediction' ||
    stagedImport?.uploadPathway === 'new_business';

  const handleCommitStaged = async () => {
    if (!stagedImport || !stagedMapping || !stagedChurnDef) return;
    if (!canCommitWithoutChurnDef && !stagedChurnDef.confirmedByUser) {
      setUploadError(
        'Please confirm that the configured churn definition accurately represents your dataset before importing.'
      );
      return;
    }
    setUploadError(null);
    setDatasetActionNotice(null);
    setIsCommitting(true);
    try {
      await onCommitStaged({
        stagedId: stagedImport.stagedId,
        mapping: stagedMapping,
        churnDefinition: {
          ...stagedChurnDef,
          confirmedByUser: canCommitWithoutChurnDef
            ? Boolean(company.churnDefinition?.confirmedByUser || stagedChurnDef.confirmedByUser)
            : true,
          confirmedAt: stagedChurnDef.confirmedAt || new Date().toISOString(),
        },
        importMode,
        duplicateStrategy: stagedImport.duplicateConflict ? duplicateStrategy : 'replace',
        satisfactionScale,
      });
      setPage(1);
      setSearchQuery('');
      setDatasetActionNotice(`Imported "${stagedImport.fileName}" successfully.`);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Failed to commit dataset.');
    } finally {
      setIsCommitting(false);
    }
  };

  const handleConfirmDeleteDataset = async () => {
    if (!deleteTarget || !onDeleteDataset) return;
    setUploadError(null);
    setDatasetActionNotice(null);
    setIsDeletingDataset(true);
    const deletedName = deleteTarget.fileName;
    try {
      await onDeleteDataset(deleteTarget.datasetId);
      setDeleteTarget(null);
      setPage(1);
      setSearchQuery('');
      setDatasetActionNotice(
        `Deleted "${deletedName}". Associated exclusive records and dependent predictions were removed.`
      );
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Failed to delete dataset.');
    } finally {
      setIsDeletingDataset(false);
    }
  };

  const handleTriggerActivateDataset = async (dsEntry: UploadedDatasetSummary) => {
    if (!onActivateDataset) return;
    setUploadError(null);
    setDatasetActionNotice(null);
    setActivatingDatasetId(dsEntry.datasetId);
    try {
      await onActivateDataset(dsEntry.datasetId);
      setPage(1);
      setSearchQuery('');
      setDatasetActionNotice(`Loaded "${dsEntry.fileName}" as the active workspace dataset.`);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Failed to load selected dataset.');
    } finally {
      setActivatingDatasetId(null);
    }
  };

  const handleScrollToUpload = () => {
    if (stagedImport) {
      onCancelStaged();
    }
    uploadSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const toggleStagedFeatureColumn = (colName: string) => {
    if (!stagedMapping) return;
    const current = stagedMapping.featureColumns;
    const next = current.includes(colName)
      ? current.filter((c) => c !== colName)
      : [...current, colName];
    setStagedMapping({ ...stagedMapping, featureColumns: next });
  };

  const toggleFeatureColumn = (colName: string) => {
    if (!dataset) return;
    const current = dataset.mapping.featureColumns;
    const next = current.includes(colName)
      ? current.filter((c) => c !== colName)
      : [...current, colName];
    onUpdateMapping({ featureColumns: next });
  };

  const handleConfirmPreUploadChurnDef = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSaveChurnDefinition) return;
    setUploadError(null);
    setChurnDefMessage(null);
    setIsSavingChurnDef(true);
    try {
      await onSaveChurnDefinition({
        ...preUploadChurnDef,
        confirmedByUser: true,
        confirmedAt: new Date().toISOString(),
      });
      setChurnDefMessage(
        'Churn definition confirmed and locked for this workspace. You can now download an industry template or upload customer data.'
      );
      setShowPreDefEditor(false);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Unable to save churn definition.');
    } finally {
      setIsSavingChurnDef(false);
    }
  };

  const activeTemplateMode: 'new_business' | 'established_historical' =
    selectedPathway === 'new_business'
      ? 'new_business'
      : selectedPathway === 'established_historical'
        ? 'established_historical'
        : referenceMode;

  const handleDownloadTemplate = (
    format: 'csv' | 'xlsx',
    explicitMode?: 'new_business' | 'established_historical' | 'tickets',
    scope: 'comprehensive' | 'tickets' | 'pathway' = 'comprehensive'
  ) => {
    setUploadError(null);
    const modeToUse = explicitMode || activeTemplateMode;
    const ext = format === 'xlsx' ? 'xlsx' : 'csv';
    const url = `/api/dataset/template?industry=${encodeURIComponent(
      templateIndustry
    )}&format=${format}&mode=${modeToUse}&scope=${scope}`;
    const filenameSlug =
      scope === 'tickets' || modeToUse === 'tickets'
        ? `churnsight_${templateIndustry}_ticket_import_template.${ext}`
        : `churnsight_${templateIndustry}_${modeToUse}_import_template.${ext}`;
    downloadProtectedCsv(url, filenameSlug).catch((err: unknown) => {
      setUploadError(err instanceof Error ? err.message : 'Failed to download template.');
    });
  };

  const handleDownloadPredictionTemplate = (format: 'csv' | 'xlsx') => {
    setUploadError(null);
    const ext = format === 'xlsx' ? 'xlsx' : 'csv';
    const versionTag = activeModel?.version || 'active';
    downloadProtectedCsv(
      `/api/dataset/prediction-template?format=${format}`,
      `churnsight_${company.industry}_prediction_input_${versionTag}.${ext}`
    ).catch((err: unknown) => {
      setUploadError(
        err instanceof Error ? err.message : 'Failed to download prediction input template.'
      );
    });
  };

  const templateColumns = getIndustryDataTemplateColumns(templateIndustry, activeTemplateMode);
  const templateGroups: { tier: TemplateColumnTier; label: string; summary: string }[] = [
    {
      tier: 'required',
      label: 'Required Columns',
      summary:
        activeTemplateMode === 'new_business'
          ? 'Core customer identifiers, start date, live customer status, and segment/revenue structure.'
          : 'Core identifiers, point-in-time observation snapshot date, segment/revenue/tenure, and historical churn outcome.',
    },
    {
      tier: 'recommended',
      label: 'Recommended Columns',
      summary: 'Behavioural engagement, satisfaction, complaints, and activity timestamps that strengthen baselines and risk separation.',
    },
    {
      tier: 'optional',
      label: 'Optional Columns',
      summary:
        activeTemplateMode === 'established_historical'
          ? 'Secondary profile fields plus audit-only churn_date (automatically excluded from model training features).'
          : 'Additional contextual customer attributes for segment slicing.',
    },
  ];
  const visibleHeaders = dataset ? dataset.columns.slice(0, 7).map((c) => c.name) : [];

  const stagedTargetUniqueValues = (() => {
    if (!stagedImport || !stagedMapping?.targetColumn) return [];
    if (stagedMapping.targetColumn === stagedImport.suggestedMapping.targetColumn) {
      return stagedImport.targetUniqueValues;
    }
    const vals = new Set<string>();
    for (const row of stagedImport.previewRows) {
      const v = (row[stagedMapping.targetColumn] || '').trim();
      if (v) vals.add(v);
    }
    return Array.from(vals);
  })();

  const selectedScaleSpec =
    SATISFACTION_SCALE_OPTIONS.find((opt) => opt.value === satisfactionScale) ||
    SATISFACTION_SCALE_OPTIONS[0];

  return (
    <div className="w-full min-w-0 space-y-6">
      {/* A. Full-Width Page Heading & B. Template Downloads Toolbar */}
      <section className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 sm:p-6 space-y-5">
        {/* A. Page Heading */}
        <div className="w-full min-w-0 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="space-y-1">
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-[#15152F] tracking-tight">
              Data Management
            </h1>
            <p className="text-sm text-slate-600">
              Import Excel or CSV datasets, validate quality, and manage uploaded files for {company.name}.
            </p>
          </div>
          {canUploadAndAnalyse && (
            <button
              type="button"
              onClick={handleScrollToUpload}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#7655E8] to-[#E84FA8] hover:opacity-95 text-white text-xs font-bold rounded-xl shadow-sm transition-all whitespace-nowrap shrink-0 self-start lg:self-auto cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload New Dataset</span>
            </button>
          )}
        </div>

        {/* B. Template Downloads & Sample Data Toolbar */}
        <div className="pt-4 border-t border-purple-100 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-[0.12em] text-[#4C4A6E]">
              Templates &amp; Quick Start
            </div>
            <button
              type="button"
              onClick={() => setShowRequirementsModal(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Data Requirements</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => handleDownloadTemplate('xlsx', undefined, 'comprehensive')}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-bold rounded-xl shadow-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-[#35C5E8]" />
              <span>Download Excel Template (.xlsx)</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSampleModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#F6F3FF] hover:bg-purple-100 text-[#5B3AD6] border border-purple-200/80 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>Preview Sample</span>
            </button>

            <button
              type="button"
              disabled={!dataset}
              title={
                dataset
                  ? 'Export active column schema and missing value audit as CSV'
                  : 'Upload or load a dataset first to export its schema CSV'
              }
              onClick={() => dataset && exportDatasetSummaryCsv(company, dataset)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#F6F3FF] text-[#15152F] border border-purple-200 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#397BFF]" />
              <span>Export Schema CSV</span>
            </button>

            <button
              type="button"
              onClick={() => {
                downloadProtectedCsv(
                  '/api/dataset/sample-csv',
                  `${company.industry}_sample_churn_250.csv`
                ).catch((err: unknown) => {
                  setUploadError(
                    err instanceof Error ? err.message : 'Failed to download sample CSV.'
                  );
                });
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#F6F3FF] text-[#15152F] border border-purple-200 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#7655E8]" />
              <span>Sample CSV</span>
            </button>

            {canUploadAndAnalyse && (
              <button
                type="button"
                onClick={onLoadSample}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#F5F3FF] hover:bg-purple-100 text-[#7655E8] border border-purple-200 text-xs font-bold rounded-xl transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Database className="w-3.5 h-3.5" />
                <span>{isLoading ? 'Loading...' : tmpl.demoDatasetLabel}</span>
              </button>
            )}
          </div>

          <p className="text-xs text-slate-500">
            Single Excel workbook with <span className="font-mono font-semibold text-[#15152F]">Customer_Data</span> and{' '}
            <span className="font-mono font-semibold text-[#15152F]">Ticket_Data</span> sheets (<span className="font-mono">.csv</span> also supported).
          </p>
        </div>
      </section>

      {datasetActionNotice && (
        <div className="bg-[#16C995]/12 border border-[#16C995]/35 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 text-xs text-[#065F46]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#16C995] shrink-0" />
            <span className="font-medium">{datasetActionNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setDatasetActionNotice(null)}
            className="text-xs font-semibold underline cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* UPLOADED DATASETS MANAGEMENT */}
      <section className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 sm:p-6 space-y-4 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#15152F]">Uploaded Datasets</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {uploadedDatasets.length === 0
                ? 'No datasets uploaded in this workspace yet.'
                : `${uploadedDatasets.length} dataset${uploadedDatasets.length === 1 ? '' : 's'} stored in workspace`}
            </p>
          </div>
          {canUploadAndAnalyse && uploadedDatasets.length > 0 && (
            <button
              type="button"
              onClick={handleScrollToUpload}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-purple-200 bg-[#F5F3FF] hover:bg-purple-100 text-xs font-semibold text-[#5B3AD6] cursor-pointer whitespace-nowrap self-start sm:self-auto"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Replacement</span>
            </button>
          )}
        </div>

        {uploadedDatasets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-purple-200 bg-[#F5F3FF]/40 px-4 py-6 text-center text-xs text-slate-500">
            Upload an Excel or CSV file below or load the demonstration dataset to begin.
          </div>
        ) : (
          <div className="overflow-x-auto border border-purple-100 rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#F5F3FF] text-[#4C4A6E] border-b border-purple-100">
                <tr>
                  <th className="py-2.5 px-4 font-semibold whitespace-nowrap">Filename</th>
                  <th className="py-2.5 px-4 font-semibold whitespace-nowrap">Upload Date</th>
                  <th className="py-2.5 px-4 font-semibold text-right whitespace-nowrap">Customers</th>
                  <th className="py-2.5 px-4 font-semibold text-right whitespace-nowrap">Tickets</th>
                  <th className="py-2.5 px-4 font-semibold whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-4 font-semibold text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-purple-50">
                {uploadedDatasets.map((dsItem) => {
                  const statusColor =
                    dsItem.importStatus === 'Active'
                      ? 'text-[#0E9F6E] font-bold'
                      : dsItem.importStatus === 'Partial (Errors Excluded)'
                        ? 'text-amber-700 font-semibold'
                        : 'text-[#397BFF] font-semibold';
                  return (
                    <tr key={dsItem.datasetId} className="hover:bg-[#F5F3FF]/45 transition-colors">
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-[#15152F]">{dsItem.fileName}</div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {dsItem.sourceFormat.toUpperCase()}
                          {dsItem.uploadMode === 'tickets' ? ' · Ticket History' : ''}
                          {dsItem.isSample ? ' · Sample' : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {new Date(dsItem.uploadedAt).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-[#15152F] whitespace-nowrap">
                        {dsItem.uploadMode === 'tickets'
                          ? '—'
                          : dsItem.customerCount.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {dsItem.ticketCount > 0 ? dsItem.ticketCount.toLocaleString() : '—'}
                      </td>
                      <td className={`py-2.5 px-4 whitespace-nowrap ${statusColor}`}>
                        {dsItem.importStatus}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-2">
                          {canUploadAndAnalyse &&
                            dsItem.importStatus !== 'Active' &&
                            dsItem.uploadMode !== 'tickets' &&
                            onActivateDataset && (
                              <button
                                type="button"
                                disabled={activatingDatasetId === dsItem.datasetId || isLoading}
                                onClick={() => handleTriggerActivateDataset(dsItem)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-purple-200 bg-white hover:bg-[#F5F3FF] text-[#5B3AD6] font-semibold cursor-pointer disabled:opacity-50"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>
                                  {activatingDatasetId === dsItem.datasetId ? 'Loading...' : 'Load'}
                                </span>
                              </button>
                            )}
                          {canUploadAndAnalyse && onDeleteDataset && (
                            <button
                              type="button"
                              disabled={isDeletingDataset || isLoading}
                              onClick={() => setDeleteTarget(dsItem)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#FF786B]/50 bg-[#FF786B]/10 hover:bg-[#FF786B]/20 text-[#9A2E25] font-semibold cursor-pointer disabled:opacity-50"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Delete</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* C. Satisfaction Score Scale Configuration & D. Upload Mode Selection */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        {/* C. Satisfaction Score Scale Configuration */}
        <section className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 flex flex-col justify-between space-y-3 min-w-0">
          <div className="space-y-1">
            <h2 className="text-sm sm:text-base font-bold text-[#15152F]">
              Satisfaction Score Scale
            </h2>
            <p className="text-xs text-slate-500">
              Validation range for CSAT/NPS columns ({selectedScaleSpec.rangeHint}).
            </p>
          </div>

          <div className="space-y-2">
            <select
              id="satisfaction-scale-select"
              aria-label="Satisfaction validation scale"
              value={satisfactionScale}
              disabled={isSavingScale || !canUploadAndAnalyse}
              onChange={(e) => handleSaveSatisfactionScale(e.target.value as SatisfactionScale)}
              className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/60 px-3.5 py-2.5 text-xs font-semibold text-[#15152F] disabled:opacity-60 focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
            >
              {SATISFACTION_SCALE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} — Valid range: {opt.rangeHint}
                </option>
              ))}
            </select>
            {scaleMessage && (
              <div className="bg-[#16C995]/10 border border-[#16C995]/30 rounded-xl px-3.5 py-2 text-xs text-[#065F46]">
                {scaleMessage}
              </div>
            )}
          </div>
        </section>

        {/* D. Upload Mode Selection */}
        <section className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 flex flex-col justify-between space-y-3 min-w-0">
          <div className="space-y-1">
            <h2 className="text-sm sm:text-base font-bold text-[#15152F]">
              Upload Mode
            </h2>
            <p className="text-xs text-slate-500">
              Import primary customer accounts or enrich with standalone support tickets.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" role="radiogroup" aria-label="Upload mode">
            <button
              type="button"
              onClick={() => setUploadMode('customer')}
              className={`px-3.5 py-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                uploadMode === 'customer'
                  ? 'border-[#7655E8] bg-[#7655E8]/[0.08] text-[#15152F] ring-1 ring-[#7655E8]/30'
                  : 'border-purple-200 bg-[#F5F3FF]/40 text-slate-600 hover:bg-[#F5F3FF]'
              }`}
            >
              <div
                className={`text-xs font-bold whitespace-nowrap ${
                  uploadMode === 'customer' ? 'text-[#7655E8]' : 'text-[#15152F]'
                }`}
              >
                Customer Data Upload
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                .xlsx workbook or .csv
              </div>
            </button>

            <button
              type="button"
              onClick={() => setUploadMode('tickets')}
              className={`px-3.5 py-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                uploadMode === 'tickets'
                  ? 'border-[#397BFF] bg-[#397BFF]/[0.08] text-[#15152F] ring-1 ring-[#397BFF]/30'
                  : 'border-purple-200 bg-[#F5F3FF]/40 text-slate-600 hover:bg-[#F5F3FF]'
              }`}
            >
              <div
                className={`text-xs font-bold whitespace-nowrap ${
                  uploadMode === 'tickets' ? 'text-[#397BFF]' : 'text-[#15152F]'
                }`}
              >
                Ticket History Upload
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Linked via Customer_ID
              </div>
            </button>
          </div>
        </section>
      </div>

      {/* STEP 1 (PRE-UPLOAD): DEFINE CHURN BEFORE UPLOADING */}
      <section className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7655E8]">
                Step 1 · Define Churn Rules
              </span>
              {company.churnDefinition?.confirmedByUser ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-[#0E9F6E]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Confirmed ({company.churnDefinition.triggerType.replace('_', ' ')})
                </span>
              ) : (
                <span className="text-[11px] font-mono font-semibold text-[#D97706]">
                  Awaiting Confirmation
                </span>
              )}
            </div>
            <h2 className="text-sm sm:text-base font-bold text-[#15152F]">
              What does churn mean for {company.name}?
            </h2>
            <p className="text-xs text-slate-600">
              {company.customerRelationshipType || tmpl.label} · Inactivity is never assumed to
              equal churn unless you explicitly configure an inactivity window below.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowPreDefEditor((prev) => !prev)}
            className="px-3.5 py-1.5 rounded-xl border border-purple-200 bg-[#F5F3FF] hover:bg-purple-100 text-xs font-semibold text-[#5B3AD6] cursor-pointer self-start sm:self-auto whitespace-nowrap"
          >
            {showPreDefEditor ? 'Hide Churn Rule Editor' : 'Edit Churn Definition'}
          </button>
        </div>

        {churnDefMessage && (
          <div className="bg-[#16C995]/12 border border-[#16C995]/35 rounded-xl px-3.5 py-2.5 text-xs text-[#065F46]">
            {churnDefMessage}
          </div>
        )}

        {showPreDefEditor && (
          <form onSubmit={handleConfirmPreUploadChurnDef} className="space-y-4 pt-3 border-t border-purple-100">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Churn Trigger Event
                </label>
                <select
                  value={preUploadChurnDef.triggerType}
                  onChange={(e) =>
                    setPreUploadChurnDef((p) => ({
                      ...p,
                      triggerType: e.target.value as ChurnTriggerType,
                      inactivityDays: e.target.value === 'inactivity' ? p.inactivityDays || 90 : null,
                    }))
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  {CHURN_TRIGGER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Calculation Method
                </label>
                <select
                  value={preUploadChurnDef.calculationMethod}
                  onChange={(e) =>
                    setPreUploadChurnDef((p) => ({
                      ...p,
                      calculationMethod: e.target.value as ChurnCalculationMethod,
                    }))
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  {CALCULATION_METHOD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Denominator Population
                </label>
                <select
                  value={preUploadChurnDef.denominatorPopulation}
                  onChange={(e) =>
                    setPreUploadChurnDef((p) => ({
                      ...p,
                      denominatorPopulation: e.target.value as ChurnDenominatorType,
                    }))
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  {DENOMINATOR_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Reporting Period
                </label>
                <select
                  value={preUploadChurnDef.reportingPeriod}
                  onChange={(e) =>
                    setPreUploadChurnDef((p) => ({
                      ...p,
                      reportingPeriod: e.target.value as ReportingPeriod,
                    }))
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  {REPORTING_PERIOD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {preUploadChurnDef.triggerType === 'inactivity' && (
                <div>
                  <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                    Inactivity Threshold (Days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1095}
                    value={preUploadChurnDef.inactivityDays ?? 90}
                    onChange={(e) =>
                      setPreUploadChurnDef((p) => ({
                        ...p,
                        inactivityDays: Number(e.target.value) || 90,
                      }))
                    }
                    className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-mono text-[#15152F]"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Churn Status / Event Column Hint
                </label>
                <input
                  type="text"
                  value={preUploadChurnDef.churnStatusColumnHint || ''}
                  onChange={(e) =>
                    setPreUploadChurnDef((p) => ({
                      ...p,
                      churnStatusColumnHint: e.target.value || null,
                    }))
                  }
                  placeholder="e.g. churn_status, cancelled, lapsed"
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-mono text-[#15152F]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Cancellation / Closure Date Hint
                </label>
                <input
                  type="text"
                  value={preUploadChurnDef.cancellationDateColumnHint || ''}
                  onChange={(e) =>
                    setPreUploadChurnDef((p) => ({
                      ...p,
                      cancellationDateColumnHint: e.target.value || null,
                    }))
                  }
                  placeholder="e.g. churn_date, cancel_date (audit only)"
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-mono text-[#15152F]"
                />
              </div>

              <div
                className={
                  preUploadChurnDef.triggerType === 'inactivity'
                    ? 'sm:col-span-2 lg:col-span-3'
                    : 'sm:col-span-2 lg:col-span-2'
                }
              >
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Business Churn Event Description
                </label>
                <input
                  type="text"
                  value={preUploadChurnDef.churnEventDescription}
                  onChange={(e) =>
                    setPreUploadChurnDef((p) => ({
                      ...p,
                      churnEventDescription: e.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs text-[#15152F]"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-[#F5F3FF] border border-purple-200/80 rounded-xl px-4 py-3 text-xs">
              <div className="font-mono text-[11px] text-[#4C4A6E]">
                {formatChurnCalculationExplanation(preUploadChurnDef, 25, 250)}
              </div>
              {canUploadAndAnalyse && onSaveChurnDefinition && (
                <button
                  type="submit"
                  disabled={isSavingChurnDef}
                  className="px-4 py-2 bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {isSavingChurnDef ? 'Confirming...' : 'Confirm Churn Definition'}
                </button>
              )}
            </div>
          </form>
        )}
      </section>

      {/* STEP 2: DATA UPLOAD PATHWAYS */}
      <section className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 space-y-4 min-w-0">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="space-y-0.5 min-w-0 flex-1">
            <h2 className="text-sm sm:text-base font-bold text-[#15152F]">
              Step 2 · Upload Pathway
            </h2>
            <p className="text-xs text-slate-500">
              Choose the stage matching your spreadsheet before uploading.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-[#4C4A6E]">Industry:</label>
              <select
                value={templateIndustry}
                onChange={(e) => setTemplateIndustry(e.target.value as IndustryKey)}
                className="rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-1.5 text-xs font-semibold text-[#15152F]"
              >
                {INDUSTRY_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setShowTemplateSpec((p) => !p)}
              className="px-3 py-1.5 rounded-xl border border-purple-200 text-xs font-semibold text-[#5B3AD6] hover:bg-[#F5F3FF] cursor-pointer whitespace-nowrap shrink-0"
            >
              {showTemplateSpec ? 'Hide Schema Guide' : 'View Schema Guide'}
            </button>
          </div>
        </div>

        {/* Four Explicit Upload Pathways */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => {
              setSelectedPathway('new_business');
              setUploadMode('customer');
            }}
            className={`text-left rounded-xl border p-4 transition-all cursor-pointer flex flex-col justify-between space-y-2 ${
              selectedPathway === 'new_business'
                ? 'border-[#397BFF] bg-[#397BFF]/[0.06] ring-1 ring-[#397BFF]/30'
                : 'border-purple-100 bg-white hover:border-purple-200'
            }`}
          >
            <div className="space-y-1">
              <div className="text-[11px] font-mono font-bold text-[#397BFF]">NEW BUSINESS</div>
              <div className="text-sm font-bold text-[#11142B]">No Historical Outcomes</div>
              <p className="text-xs text-slate-600">
                Track active/trial accounts and build behaviour baselines.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedPathway('established_historical');
              setUploadMode('customer');
            }}
            className={`text-left rounded-xl border p-4 transition-all cursor-pointer flex flex-col justify-between space-y-2 ${
              selectedPathway === 'established_historical'
                ? 'border-[#7655E8] bg-[#7655E8]/[0.06] ring-1 ring-[#7655E8]/30'
                : 'border-purple-100 bg-white hover:border-purple-200'
            }`}
          >
            <div className="space-y-1">
              <div className="text-[11px] font-mono font-bold text-[#7655E8]">HISTORICAL DATA</div>
              <div className="text-sm font-bold text-[#11142B]">Past Churn Outcomes</div>
              <p className="text-xs text-slate-600">
                Analyse historical churn and train prediction models.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedPathway('current_prediction');
              setUploadMode('customer');
            }}
            className={`text-left rounded-xl border p-4 transition-all cursor-pointer flex flex-col justify-between space-y-2 ${
              selectedPathway === 'current_prediction'
                ? 'border-[#0E9F6E] bg-[#0E9F6E]/[0.06] ring-1 ring-[#0E9F6E]/30'
                : 'border-purple-100 bg-white hover:border-purple-200'
            }`}
          >
            <div className="space-y-1">
              <div className="text-[11px] font-mono font-bold text-[#0E9F6E]">RISK SCORING</div>
              <div className="text-sm font-bold text-[#11142B]">Score Active Customers</div>
              <p className="text-xs text-slate-600">
                Score current accounts against your active ML model.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedPathway('existing_custom');
              setUploadMode('customer');
            }}
            className={`text-left rounded-xl border p-4 transition-all cursor-pointer flex flex-col justify-between space-y-2 ${
              selectedPathway === 'existing_custom'
                ? 'border-[#11142B] bg-[#F5F3FF] ring-1 ring-[#11142B]/20'
                : 'border-purple-100 bg-white hover:border-purple-200'
            }`}
          >
            <div className="space-y-1">
              <div className="text-[11px] font-mono font-bold text-[#11142B]">CUSTOM EXPORT</div>
              <div className="text-sm font-bold text-[#11142B]">Any CRM / Billing File</div>
              <p className="text-xs text-slate-600">
                Auto-map columns and validate row quality before import.
              </p>
            </div>
          </button>
        </div>

        {/* Cold-Start Honest Notice for New Business Pathway */}
        {selectedPathway === 'new_business' && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-center gap-3 text-xs text-amber-950">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span className="font-medium">
              Monitoring mode active: predictive training unlocks once historical churn outcomes are recorded.
            </span>
          </div>
        )}

        {/* Active Pathway Details & Template Download Controls */}
        <div className="border-t border-purple-100 pt-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {selectedPathway === 'new_business' && (
            <div className="space-y-1 min-w-0 flex-1 max-w-3xl">
              <div className="text-xs font-bold text-[#11142B]">
                New Business Monitoring Template — Guided Capabilities
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Monitor customer activity, track subscription and lifecycle status, establish engagement
                baselines, and begin collecting outcomes over time.{' '}
                <strong className="text-[#11142B]">
                  Supervised churn prediction models will not be trained until valid historical churn
                  outcomes are present.
                </strong>
              </p>
            </div>
          )}

          {selectedPathway === 'established_historical' && (
            <div className="space-y-1 min-w-0 flex-1 max-w-3xl">
              <div className="text-xs font-bold text-[#11142B]">
                Established Business Historical Template — Point-In-Time Discipline
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Ensure attributes, revenue, and usage reflect customer behaviour at{' '}
                <span className="font-mono font-semibold text-[#11142B]">observation_date</span> before churn
                occurred. Optional{' '}
                <span className="font-mono font-semibold text-[#11142B]">churn_date</span> is retained
                for audit and automatically excluded from ML model training features.
              </p>
            </div>
          )}

          {selectedPathway === 'current_prediction' && (
            <div className="space-y-1 min-w-0 flex-1 max-w-3xl">
              <div className="text-xs font-bold text-[#11142B]">
                Current Customer Risk Scoring — Active Model Compatibility Check
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {activeModel
                  ? `Scores active customers using ${activeModel.modelName} (${activeModel.version}) while keeping your trained model intact and updating Value Intelligence exposure.`
                  : 'Train or activate a historical churn model first, then upload current customer spreadsheets here to score churn risk in bulk.'}
              </p>
            </div>
          )}

          {selectedPathway === 'existing_custom' && (
            <div className="space-y-1 min-w-0 flex-1 max-w-3xl">
              <div className="text-xs font-bold text-[#11142B]">
                Custom File Auto-Inspection &amp; Mapping Confirmation
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Upload your CRM, billing, or ERP export below. ChurnSight detects identifiers, snapshot
                dates, revenue, usage, satisfaction, support tickets, and optional churn outcomes, then
                lets you inspect validation rows before importing.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {selectedPathway === 'current_prediction' && predictionTemplateMeta?.available ? (
              <button
                type="button"
                onClick={() => handleDownloadPredictionTemplate('xlsx')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-[#35C5E8]" />
                <span>Download Prediction Excel (.xlsx)</span>
              </button>
            ) : selectedPathway === 'existing_custom' ? (
              <div className="inline-flex rounded-xl border border-purple-200 bg-[#F5F3FF]/60 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setReferenceMode('established_historical')}
                  className={`px-3 py-1 rounded-lg font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                    referenceMode === 'established_historical'
                      ? 'bg-white text-[#7655E8] shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Historical Reference
                </button>
                <button
                  type="button"
                  onClick={() => setReferenceMode('new_business')}
                  className={`px-3 py-1 rounded-lg font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                    referenceMode === 'new_business'
                      ? 'bg-white text-[#397BFF] shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  New Business Reference
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleDownloadTemplate('xlsx')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-[#35C5E8]" />
                <span>
                  {selectedPathway === 'new_business'
                    ? 'Download New Business Excel (.xlsx)'
                    : 'Download Historical Excel (.xlsx)'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Grouped Required / Recommended / Optional Schema Breakdown */}
        {showTemplateSpec && (
          <div className="space-y-4 pt-2 border-t border-purple-100">
            {templateGroups.map((group) => {
              const cols = templateColumns.filter((c) => c.tier === group.tier);
              if (cols.length === 0) return null;
              return (
                <div key={group.tier} className="space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
                    <div className="text-xs font-bold text-[#11142B]">
                      {group.label} ({cols.length})
                    </div>
                    <div className="text-[11px] text-slate-500">{group.summary}</div>
                  </div>
                  <div className="overflow-x-auto border border-purple-100 rounded-xl">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-[#F5F3FF] text-[#4C4A6E] border-b border-purple-100">
                        <tr>
                          <th className="py-2 px-3">Column</th>
                          <th className="py-2 px-3">Role</th>
                          <th className="py-2 px-3">Accepted Formats</th>
                          <th className="py-2 px-3">Example</th>
                          <th className="py-2 px-3">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-purple-50">
                        {cols.map((col) => (
                          <tr key={col.name} className="hover:bg-[#F5F3FF]/40">
                            <td className="py-2 px-3 font-mono font-semibold text-[#11142B] whitespace-nowrap">
                              {col.name}
                            </td>
                            <td className="py-2 px-3 font-mono text-[11px] text-[#5B3AD6] whitespace-nowrap">
                              {col.semanticRole}
                            </td>
                            <td className="py-2 px-3 text-slate-600">{col.acceptedFormats}</td>
                            <td className="py-2 px-3 font-mono text-slate-700 whitespace-nowrap">
                              {col.exampleValue || <span className="text-slate-400 italic">blank when retained</span>}
                            </td>
                            <td className="py-2 px-3 text-slate-600">{col.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Upload Dropzone or Permission Notice */}
      <div ref={uploadSectionRef}>
        {canUploadAndAnalyse ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`bg-white border-2 border-dashed rounded-2xl p-6 text-center transition-all shadow-sm shadow-purple-950/[0.03] ${
              dragOver
                ? 'border-[#7655E8] bg-[#7655E8]/5'
                : 'border-purple-200 hover:border-[#7655E8]/60'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = '';
              }}
            />
            <div className="max-w-xl mx-auto space-y-2">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#7655E8] to-[#E84FA8] text-white flex items-center justify-center mx-auto shadow-md shadow-[#7655E8]/25">
                <Upload className="w-5 h-5" />
              </div>
              <div className="text-[11px] font-mono font-semibold text-[#7655E8]">
                {uploadMode === 'tickets'
                  ? 'Mode: Support Ticket History Enrichment'
                  : `${PATHWAY_LABELS[selectedPathway]} · Scale: ${satisfactionScale.toUpperCase()}`}
              </div>
              <div className="text-sm font-semibold text-[#15152F]">
                Drop an Excel (.xlsx / .xls) or CSV file here, or{' '}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[#7655E8] hover:text-[#E84FA8] underline font-bold cursor-pointer transition-colors"
                >
                  browse your computer
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Auto-detects Customer_Data &amp; Ticket_Data sheets, validates fields, and previews before import.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 text-xs text-amber-900">
            <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <strong>Read-Only Access:</strong> Ask your Firm Administrator to enable upload permissions.
            </div>
          </div>
        )}
      </div>

      {/* Template 3: Current Customer Prediction Input Template */}
      {!stagedImport && (
        <section className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 space-y-3 min-w-0">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0E9F6E]">
                Prediction Input Template · Active Model Schema
              </div>
              <h2 className="text-sm sm:text-base font-bold text-[#15152F]">
                Current Customer Prediction Template
                {predictionTemplateMeta?.available && predictionTemplateMeta.modelVersion
                  ? ` (${predictionTemplateMeta.modelName} ${predictionTemplateMeta.modelVersion})`
                  : ''}
              </h2>
              <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">
                {predictionTemplateMeta?.available
                  ? `Generated directly from your validated workspace model. Includes customer ID and exact trained input features while excluding Churn_Status and Churn_Date.`
                  : predictionTemplateMeta?.reason ||
                    'This model-driven scoring template unlocks once your workspace has an active validated churn prediction model.'}
              </p>
            </div>

            {predictionTemplateMeta?.available ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadPredictionTemplate('xlsx')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-[#35C5E8]" />
                  <span>Download Prediction Excel (.xlsx)</span>
                </button>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('predictions')}
                    className="px-3.5 py-2 rounded-xl border border-purple-200 bg-[#F5F3FF] hover:bg-purple-100 text-xs font-semibold text-[#5B3AD6] cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Score in Churn Predictions →
                  </button>
                )}
              </div>
            ) : (
              <div className="text-xs font-mono text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2 self-start lg:self-auto">
                Locked until validated model is active
              </div>
            )}
          </div>

          {predictionTemplateMeta?.available && predictionTemplateMeta.columns.length > 0 && (
            <div className="text-[11px] font-mono text-slate-600 pt-2 border-t border-purple-100/80 break-words">
              Required input columns ({predictionTemplateMeta.columns.length}):{' '}
              <span className="text-[#11142B] font-semibold">
                {predictionTemplateMeta.columns.map((c) => c.name).join(', ')}
              </span>
            </div>
          )}
        </section>
      )}

      {uploadError && (
        <div className="bg-[#FF786B]/10 border border-[#FF786B]/40 rounded-2xl p-4 flex items-start gap-3 text-sm text-[#9A2E25]">
          <AlertCircle className="w-4 h-4 text-[#E04F44] shrink-0 mt-0.5" />
          <div>{uploadError}</div>
        </div>
      )}

      {(isPipelineRunning || isCommitting || automationStatus) && !stagedImport && (
        <PredictionPipelineBanner
          automationStatus={automationStatus}
          isRunning={isPipelineRunning || isCommitting}
          canGeneratePredictions={canGeneratePredictions}
          onAutoBuild={onAutoBuild}
          onNavigate={onNavigate}
        />
      )}

      {/* ===================================================================== */}
      {/* STAGED SPREADSHEET IMPORT REVIEW & CHURN DEFINITION CONFIRMATION      */}
      {/* ===================================================================== */}
      {stagedImport && stagedMapping && stagedChurnDef && (
        <div className="bg-white border-2 border-[#7655E8]/50 rounded-2xl shadow-xl shadow-[#7655E8]/10 p-5 sm:p-6 space-y-6 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-purple-100 pb-4">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#7655E8]">
                Step 2 of 2 · Staging Review &amp; Churn Definition Confirmation
              </div>
              <h2 className="text-lg font-bold text-[#15152F] break-words">
                Review &ldquo;{stagedImport.fileName}&rdquo; ({stagedImport.sourceFormat.toUpperCase()})
              </h2>
              <p className="text-xs text-slate-600 font-mono tabular-nums">
                {stagedImport.rowCount.toLocaleString()} rows · {stagedImport.columnCount} columns ·{' '}
                {stagedImport.duplicateCount} duplicate rows ·{' '}
                {stagedImport.missingCellCount} missing cells ·{' '}
                {stagedImport.invalidDateCount ?? 0} invalid dates ·{' '}
                {stagedImport.inconsistentCategoryCount ?? 0} casing mismatches
              </p>
              {stagedImport.readiness && (
                <div className="text-xs font-mono font-semibold text-[#7655E8] pt-1">
                  Staged Readiness: {stagedImport.readiness.overallLabel} (
                  {stagedImport.readiness.readinessScore}/100)
                  {stagedImport.uploadPathway
                    ? ` · ${PATHWAY_LABELS[stagedImport.uploadPathway]}`
                    : ''}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onCancelStaged}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-purple-200 text-xs font-semibold text-slate-600 hover:bg-[#F5F3FF] cursor-pointer self-start"
            >
              <X className="w-3.5 h-3.5" />
              <span>Discard Upload</span>
            </button>
          </div>

          {/* Row-Level Validation Summary Grid + Rejected CSV Download */}
          {stagedImport.rowValidation && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[#15152F]">
                    Row-Level Validation Summary
                  </h3>
                  <p className="text-xs text-slate-500">
                    Inspected all {stagedImport.rowValidation.totalRows.toLocaleString()} uploaded rows
                    across mapped customer &amp; support fields
                  </p>
                </div>

                {stagedImport.rowValidation.hasRejectedRowsCsv && (
                  <button
                    type="button"
                    onClick={() => {
                      downloadProtectedCsv(
                        '/api/dataset/staged-rejected-csv',
                        `rejected_rows_${stagedImport.stagedId}.csv`
                      ).catch((err: unknown) => {
                        setUploadError(
                          err instanceof Error ? err.message : 'Failed to download rejected rows CSV.'
                        );
                      });
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#FF786B]/50 bg-[#FF786B]/10 hover:bg-[#FF786B]/20 text-xs font-semibold text-[#9A2E25] cursor-pointer whitespace-nowrap self-start sm:self-auto"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Rejected Rows CSV</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
                <div className="rounded-xl border border-purple-100 bg-[#F5F3FF]/40 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Rows</div>
                  <div className="text-lg font-extrabold font-mono tabular-nums text-[#15152F] mt-0.5">
                    {stagedImport.rowValidation.totalRows.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-[#16C995]/30 bg-[#16C995]/10 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#065F46]">Valid Rows</div>
                  <div className="text-lg font-extrabold font-mono tabular-nums text-[#0E9F6E] mt-0.5">
                    {stagedImport.rowValidation.validCount.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">Warnings</div>
                  <div className="text-lg font-extrabold font-mono tabular-nums text-amber-700 mt-0.5">
                    {stagedImport.rowValidation.warningCount.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-[#FF786B]/40 bg-[#FF786B]/10 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9A2E25]">Errors</div>
                  <div className="text-lg font-extrabold font-mono tabular-nums text-[#E04F44] mt-0.5">
                    {stagedImport.rowValidation.errorCount.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-purple-100 bg-white p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Duplicate IDs</div>
                  <div className="text-lg font-extrabold font-mono tabular-nums text-[#15152F] mt-0.5">
                    {(
                      stagedImport.rowValidation.duplicateCustomerIds +
                      stagedImport.rowValidation.duplicateTicketIds
                    ).toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-purple-100 bg-white p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Missing Values</div>
                  <div className="text-lg font-extrabold font-mono tabular-nums text-[#15152F] mt-0.5">
                    {stagedImport.rowValidation.missingValuesCount.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-purple-100 bg-white p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Mapped Cols</div>
                  <div className="text-lg font-extrabold font-mono tabular-nums text-[#7655E8] mt-0.5">
                    {stagedImport.rowValidation.mappedFieldsCount}
                  </div>
                </div>
                <div className="rounded-xl border border-purple-100 bg-white p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Unmapped Cols</div>
                  <div className="text-lg font-extrabold font-mono tabular-nums text-slate-700 mt-0.5">
                    {stagedImport.rowValidation.unmappedColumns.length}
                  </div>
                </div>
              </div>

              {stagedImport.rowValidation.issuesSummary.length > 0 && (
                <div className="rounded-xl border border-purple-100 bg-[#F5F3FF]/40 p-3.5 text-xs space-y-1.5">
                  <div className="font-bold text-[#15152F]">Detected Row Validation Checks</div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    {stagedImport.rowValidation.issuesSummary.map((item, idx) => (
                      <span
                        key={idx}
                        className={`font-mono text-[11px] font-semibold ${
                          item.severity === 'error' ? 'text-[#E04F44]' : 'text-amber-800'
                        }`}
                      >
                        {item.label}: {item.count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Ticket Aggregation & Separate Ticket Validation Summary Card */}
          {stagedImport.ticketAggregation && (
            <div className="bg-[#397BFF]/[0.06] border border-[#397BFF]/30 rounded-xl p-4 space-y-3 text-xs text-[#11142B]">
              <div className="flex items-start gap-3">
                <LifeBuoy className="w-4 h-4 text-[#397BFF] shrink-0 mt-0.5" />
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="font-bold flex flex-wrap items-center gap-2">
                    <span>
                      {stagedImport.ticketAggregation.source === 'standalone_ticket_upload'
                        ? 'Standalone Ticket_Data Validation & Linking'
                        : 'Ticket_Data Worksheet Validated & Linked Separately'}
                    </span>
                    <span className="font-mono text-[11px] text-[#397BFF]">
                      {stagedImport.ticketAggregation.ticketRowsCount} ticket rows ·{' '}
                      {stagedImport.ticketAggregation.matchedCustomersCount} unique customer(s) linked
                      {stagedImport.ticketAggregation.duplicateTicketIds > 0
                        ? ` · ${stagedImport.ticketAggregation.duplicateTicketIds} duplicate Ticket_IDs skipped`
                        : ''}
                    </span>
                  </div>
                  <p className="text-slate-700 leading-relaxed">
                    {stagedImport.ticketAggregation.note}{' '}
                    {stagedImport.ticketAggregation.doubleCountingPrevented
                      ? 'Multiple tickets per Customer_ID are aggregated cleanly into customer metrics without duplicating customer rows or double-counting.'
                      : ''}
                  </p>
                </div>
              </div>

              {(typeof stagedImport.ticketAggregation.validTicketRows === 'number' ||
                (stagedImport.ticketAggregation.unmatchedTicketRowsCount ?? 0) > 0) && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                  <div className="rounded-lg border border-[#397BFF]/20 bg-white/80 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Ticket Rows
                    </div>
                    <div className="font-mono font-bold text-sm text-[#15152F]">
                      {stagedImport.ticketAggregation.ticketRowsCount.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#16C995]/30 bg-[#16C995]/10 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[#065F46]">
                      Clean Tickets
                    </div>
                    <div className="font-mono font-bold text-sm text-[#0E9F6E]">
                      {(stagedImport.ticketAggregation.validTicketRows ?? stagedImport.ticketAggregation.ticketRowsCount).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                      Ticket Warnings
                    </div>
                    <div className="font-mono font-bold text-sm text-amber-700">
                      {(stagedImport.ticketAggregation.warningTicketRows ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#FF786B]/40 bg-[#FF786B]/10 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9A2E25]">
                      Ticket Errors
                    </div>
                    <div className="font-mono font-bold text-sm text-[#E04F44]">
                      {(stagedImport.ticketAggregation.errorTicketRows ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-purple-100 bg-white/80 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Unmatched Customer_ID
                    </div>
                    <div className="font-mono font-bold text-sm text-[#15152F]">
                      {(stagedImport.ticketAggregation.unmatchedTicketRowsCount ?? 0).toLocaleString()}
                    </div>
                  </div>
                </div>
              )}

              {stagedImport.ticketAggregation.ticketIssues &&
                stagedImport.ticketAggregation.ticketIssues.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-1">
                    <div className="font-bold text-[11px] text-amber-900">
                      Ticket_Data Validation Findings (First {Math.min(6, stagedImport.ticketAggregation.ticketIssues.length)})
                    </div>
                    <ul className="space-y-0.5 text-[11px] text-amber-950 font-mono">
                      {stagedImport.ticketAggregation.ticketIssues.slice(0, 6).map((ti, i) => (
                        <li key={i}>
                          Row {ti.rowIndex} ({ti.customerId}) [{ti.status.toUpperCase()}]:{' '}
                          <span className="font-sans">{ti.messages.join(' ')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </div>
          )}

          {/* Model Compatibility Report for Current Customer Scoring */}
          {stagedImport.modelCompatibility && (
            <div
              className={`border rounded-xl p-4 flex items-start gap-3 text-xs ${
                stagedImport.modelCompatibility.compatible
                  ? 'bg-[#16C995]/10 border-[#16C995]/35 text-[#065F46]'
                  : 'bg-amber-50 border-amber-300 text-amber-950'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold">
                  Model Schema Compatibility
                  {stagedImport.modelCompatibility.modelName
                    ? ` · ${stagedImport.modelCompatibility.modelName} (${stagedImport.modelCompatibility.modelVersion})`
                    : ''}
                </div>
                <p className="leading-relaxed">{stagedImport.modelCompatibility.message}</p>
                {stagedImport.modelCompatibility.missingFeatures.length > 0 && (
                  <p className="font-mono text-[11px]">
                    Missing features: {stagedImport.modelCompatibility.missingFeatures.join(', ')}
                  </p>
                )}
              </div>
            </div>
          )}

          {stagedImport.readiness?.datasetProfile.classImbalanceWarning && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-950">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Class Imbalance Detected</div>
                <p className="mt-0.5 leading-relaxed">
                  {stagedImport.readiness.datasetProfile.classImbalanceWarning}
                </p>
              </div>
            </div>
          )}

          {stagedImport.readiness?.datasetProfile.leakageColumnsExcluded &&
            stagedImport.readiness.datasetProfile.leakageColumnsExcluded.length > 0 && (
              <div className="bg-[#F5F3FF] border border-purple-200 rounded-xl p-4 flex items-start gap-3 text-xs text-[#15152F]">
                <Info className="w-4 h-4 text-[#7655E8] shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Target Leakage Protection Active</div>
                  <p className="mt-0.5 leading-relaxed">
                    Post-outcome columns ({stagedImport.readiness.datasetProfile.leakageColumnsExcluded.join(', ')}) are
                    preserved for audit visibility and excluded from supervised ML training features.
                  </p>
                </div>
              </div>
            )}

          {!stagedImport.hasValidChurnLabels &&
            stagedImport.churnReadinessMessage &&
            stagedImport.uploadMode !== 'tickets' &&
            stagedImport.uploadPathway !== 'current_prediction' && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-950">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Churn Label Readiness Notice</div>
                  <p className="mt-0.5 leading-relaxed">{stagedImport.churnReadinessMessage}</p>
                </div>
              </div>
            )}

          {stagedImport.issues.length > 0 && (
            <div className="space-y-2">
              {stagedImport.issues.map((issue, idx) => (
                <div
                  key={idx}
                  className={`border rounded-xl px-3.5 py-2.5 text-xs flex items-start gap-2.5 ${
                    issue.severity === 'error'
                      ? 'bg-[#FF786B]/10 border-[#FF786B]/40 text-[#9A2E25]'
                      : issue.severity === 'warning'
                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                        : 'bg-[#F6F3FF] border-purple-200/70 text-[#15152F]'
                  }`}
                >
                  <Info className="w-4 h-4 shrink-0 mt-0.5 opacity-80" />
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Customer Column Mapping Editor (shown for customer uploads, hidden for standalone tickets) */}
          {stagedImport.uploadMode !== 'tickets' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-[#15152F]">
                1. Verify Suggested Column Mapping ({tmpl.label})
              </h3>
              <p className="text-xs text-slate-500">
                Adjust auto-detected fields so analytics and Customer data preparation reflect your
                spreadsheet accurately.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Target Churn Column
                </label>
                <select
                  value={stagedMapping.targetColumn}
                  onChange={(e) => {
                    const nextTarget = e.target.value;
                    setStagedMapping((prev) =>
                      prev
                        ? {
                            ...prev,
                            targetColumn: nextTarget,
                            featureColumns: prev.featureColumns.filter((c) => c !== nextTarget),
                          }
                        : prev
                    );
                  }}
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  <option value="">None (Descriptive profiling only)</option>
                  {stagedImport.columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} ({c.uniqueCount} unique)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Positive Churn Value
                </label>
                {stagedTargetUniqueValues.length >= 2 && stagedTargetUniqueValues.length <= 20 ? (
                  <select
                    value={stagedMapping.positiveClassValue}
                    onChange={(e) =>
                      setStagedMapping((prev) =>
                        prev ? { ...prev, positiveClassValue: e.target.value } : prev
                      )
                    }
                    className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                  >
                    {stagedTargetUniqueValues.map((val) => (
                      <option key={val} value={val}>
                        {val}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={stagedMapping.positiveClassValue}
                    onChange={(e) =>
                      setStagedMapping((prev) =>
                        prev ? { ...prev, positiveClassValue: e.target.value } : prev
                      )
                    }
                    placeholder="e.g. Yes, 1, Churned"
                    className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  {tmpl.entitySingular} ID Column
                </label>
                <select
                  value={stagedMapping.idColumn || ''}
                  onChange={(e) =>
                    setStagedMapping((prev) =>
                      prev ? { ...prev, idColumn: e.target.value || null } : prev
                    )
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  <option value="">Auto-generate Row ID</option>
                  {stagedImport.columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  {tmpl.segmentLabel} Column
                </label>
                <select
                  value={stagedMapping.contractColumn || ''}
                  onChange={(e) =>
                    setStagedMapping((prev) =>
                      prev ? { ...prev, contractColumn: e.target.value || null } : prev
                    )
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  <option value="">Not mapped</option>
                  {stagedImport.columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  {tmpl.tenureLabel} Column
                </label>
                <select
                  value={stagedMapping.tenureColumn || ''}
                  onChange={(e) =>
                    setStagedMapping((prev) =>
                      prev ? { ...prev, tenureColumn: e.target.value || null } : prev
                    )
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  <option value="">Not mapped</option>
                  {stagedImport.columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  {tmpl.revenueLabel} Column
                </label>
                <select
                  value={stagedMapping.monthlyChargesColumn || ''}
                  onChange={(e) =>
                    setStagedMapping((prev) =>
                      prev ? { ...prev, monthlyChargesColumn: e.target.value || null } : prev
                    )
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  <option value="">Not mapped</option>
                  {stagedImport.columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Date / Timestamp Column
                </label>
                <select
                  value={stagedMapping.dateColumn || ''}
                  onChange={(e) =>
                    setStagedMapping((prev) =>
                      prev ? { ...prev, dateColumn: e.target.value || null } : prev
                    )
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  <option value="">Not mapped (Stratified split only)</option>
                  {stagedImport.columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} ({c.dataType})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  {tmpl.frequencyLabel} Column
                </label>
                <select
                  value={stagedMapping.frequencyColumn || ''}
                  onChange={(e) =>
                    setStagedMapping((prev) =>
                      prev ? { ...prev, frequencyColumn: e.target.value || null } : prev
                    )
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  <option value="">Not mapped</option>
                  {stagedImport.columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Customer Status Column (Operational)
                </label>
                <select
                  value={stagedMapping.statusColumn || ''}
                  onChange={(e) =>
                    setStagedMapping((prev) =>
                      prev ? { ...prev, statusColumn: e.target.value || null } : prev
                    )
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  <option value="">Not mapped</option>
                  {stagedImport.columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Observation Snapshot Date
                </label>
                <select
                  value={stagedMapping.observationDateColumn || ''}
                  onChange={(e) =>
                    setStagedMapping((prev) =>
                      prev ? { ...prev, observationDateColumn: e.target.value || null } : prev
                    )
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  <option value="">Not mapped</option>
                  {stagedImport.columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Registration / Join Date
                </label>
                <select
                  value={stagedMapping.registrationDateColumn || ''}
                  onChange={(e) =>
                    setStagedMapping((prev) =>
                      prev ? { ...prev, registrationDateColumn: e.target.value || null } : prev
                    )
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  <option value="">Not mapped</option>
                  {stagedImport.columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Churn / Cancellation Date (Audit Only)
                </label>
                <select
                  value={stagedMapping.churnDateColumn || ''}
                  onChange={(e) => {
                    const nextChurnDate = e.target.value || null;
                    setStagedMapping((prev) =>
                      prev
                        ? {
                            ...prev,
                            churnDateColumn: nextChurnDate,
                            featureColumns: nextChurnDate
                              ? prev.featureColumns.filter((c) => c !== nextChurnDate)
                              : prev.featureColumns,
                          }
                        : prev
                    );
                  }}
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  <option value="">Not present (safe)</option>
                  {stagedImport.columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#4C4A6E] mb-2">
                Prepared Customer Attributes ({stagedMapping.featureColumns.length} selected for
                Customer data preparation — target &amp; post-outcome dates excluded)
              </label>
              <div className="flex flex-wrap gap-2">
                {stagedImport.columns
                  .filter(
                    (c) =>
                      c.name !== stagedMapping.targetColumn &&
                      c.name !== stagedMapping.idColumn &&
                      c.name !== stagedMapping.churnDateColumn &&
                      c.dataType !== 'identifier' &&
                      c.dataType !== 'date'
                  )
                  .map((col) => {
                    const checked = stagedMapping.featureColumns.includes(col.name);
                    return (
                      <label
                        key={col.name}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs cursor-pointer select-none ${
                          checked
                            ? 'bg-[#7655E8]/10 border-[#7655E8]/40 text-[#5B3AD6] font-semibold'
                            : 'bg-white border-purple-100 text-slate-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleStagedFeatureColumn(col.name)}
                          className="rounded border-purple-300 accent-[#7655E8]"
                        />
                        <span>{col.name}</span>
                      </label>
                    );
                  })}
              </div>
            </div>

            {stagedImport.mappingRationales && stagedImport.mappingRationales.length > 0 && (
              <div className="rounded-xl border border-purple-100 bg-[#F5F3FF]/50 p-3.5 space-y-2">
                <div className="text-xs font-bold text-[#15152F]">
                  Auto-Detection Mapping Confidence &amp; Reasoning
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                  {stagedImport.mappingRationales
                    .filter((m) => m.field !== 'featureColumns')
                    .map((m) => (
                      <div key={String(m.field)} className="flex items-start gap-2 text-slate-700">
                        <span
                          className={`font-mono font-bold uppercase shrink-0 ${
                            m.confidence === 'high'
                              ? 'text-[#0E9F6E]'
                              : m.confidence === 'medium'
                                ? 'text-[#397BFF]'
                                : 'text-slate-400'
                          }`}
                        >
                          [{m.confidence}]
                        </span>
                        <span>{m.reason}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
          )}

          {/* Churn Definition Builder (Required for Historical/Custom, Optional for Tickets/Current/Cold-Start) */}
          {stagedImport.uploadMode !== 'tickets' && (
          <div className="pt-4 border-t border-purple-100 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-[#15152F]">
                  2. {canCommitWithoutChurnDef ? 'Workspace Churn Definition (Optional for this upload)' : 'Confirm Business Churn Definition'}
                </h3>
                <p className="text-xs text-slate-500">
                  Defines how churn rate and attrition formulas are explained across reports and KPIs.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Churn Trigger Type
                </label>
                <select
                  value={stagedChurnDef.triggerType}
                  onChange={(e) =>
                    setStagedChurnDef((prev) =>
                      prev
                        ? {
                            ...prev,
                            triggerType: e.target.value as ChurnTriggerType,
                            inactivityDays:
                              e.target.value === 'inactivity' ? prev.inactivityDays || 90 : null,
                          }
                        : prev
                    )
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  {CHURN_TRIGGER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Calculation Method
                </label>
                <select
                  value={stagedChurnDef.calculationMethod}
                  onChange={(e) =>
                    setStagedChurnDef((prev) =>
                      prev
                        ? { ...prev, calculationMethod: e.target.value as ChurnCalculationMethod }
                        : prev
                    )
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  {CALCULATION_METHOD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Denominator Population
                </label>
                <select
                  value={stagedChurnDef.denominatorPopulation}
                  onChange={(e) =>
                    setStagedChurnDef((prev) =>
                      prev
                        ? {
                            ...prev,
                            denominatorPopulation: e.target.value as ChurnDenominatorType,
                          }
                        : prev
                    )
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  {DENOMINATOR_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Reporting Period
                </label>
                <select
                  value={stagedChurnDef.reportingPeriod}
                  onChange={(e) =>
                    setStagedChurnDef((prev) =>
                      prev ? { ...prev, reportingPeriod: e.target.value as ReportingPeriod } : prev
                    )
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F]"
                >
                  {REPORTING_PERIOD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {stagedChurnDef.triggerType === 'inactivity' && (
                <div>
                  <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                    Inactivity Threshold (Days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1095}
                    value={stagedChurnDef.inactivityDays ?? 90}
                    onChange={(e) =>
                      setStagedChurnDef((prev) =>
                        prev ? { ...prev, inactivityDays: Number(e.target.value) || 90 } : prev
                      )
                    }
                    className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-mono text-[#15152F]"
                  />
                </div>
              )}

              <div
                className={
                  stagedChurnDef.triggerType === 'inactivity' ? 'sm:col-span-3' : 'sm:col-span-4'
                }
              >
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Churn Event Description
                </label>
                <input
                  type="text"
                  value={stagedChurnDef.churnEventDescription}
                  onChange={(e) =>
                    setStagedChurnDef((prev) =>
                      prev ? { ...prev, churnEventDescription: e.target.value } : prev
                    )
                  }
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs text-[#15152F]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Expected Churn Status Column Hint (Optional)
                </label>
                <input
                  type="text"
                  value={stagedChurnDef.churnStatusColumnHint || ''}
                  onChange={(e) =>
                    setStagedChurnDef((prev) =>
                      prev ? { ...prev, churnStatusColumnHint: e.target.value } : prev
                    )
                  }
                  placeholder="e.g. churn_status, exited, discontinued"
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-mono text-[#15152F]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                  Cancellation / Churn Date Column Hint (Optional)
                </label>
                <input
                  type="text"
                  value={stagedChurnDef.cancellationDateColumnHint || ''}
                  onChange={(e) =>
                    setStagedChurnDef((prev) =>
                      prev ? { ...prev, cancellationDateColumnHint: e.target.value } : prev
                    )
                  }
                  placeholder="e.g. churn_date, cancellation_date"
                  className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-mono text-[#15152F]"
                />
              </div>
            </div>

            <div className="bg-[#F5F3FF] border border-purple-200/80 rounded-xl p-3.5 text-xs text-[#15152F] space-y-2">
              <div className="font-semibold text-[#5B3AD6]">Live Churn Formula Preview</div>
              <div className="font-mono text-[11px] text-slate-700">
                {formatChurnCalculationExplanation(stagedChurnDef, 25, stagedImport.rowCount)}
              </div>
            </div>

            {!canCommitWithoutChurnDef && (
              <label className="flex items-start gap-2.5 text-xs text-[#15152F] cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={stagedChurnDef.confirmedByUser}
                  onChange={(e) =>
                    setStagedChurnDef((prev) =>
                      prev ? { ...prev, confirmedByUser: e.target.checked } : prev
                    )
                  }
                  className="mt-0.5 rounded border-purple-300 accent-[#7655E8]"
                />
                <span className="font-semibold">
                  I confirm this churn definition and column mapping accurately represent our
                  organization&apos;s dataset.
                </span>
              </label>
            )}
          </div>
          )}

          {/* Customer-Centric Staged Validation Preview Table */}
          {stagedImport.rowValidation && stagedImport.rowValidation.previewRecords.length > 0 ? (
            <div className="pt-4 border-t border-purple-100 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-bold text-[#15152F]">
                  Customer Validation Preview (First {stagedImport.rowValidation.previewRecords.length} Records)
                </div>
                <span className="text-[11px] font-mono text-slate-500">
                  Scale: {satisfactionScale.toUpperCase()}
                </span>
              </div>
              <div className="overflow-x-auto border border-purple-100 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-[#F5F3FF] text-[#4C4A6E] border-b border-purple-100">
                    <tr>
                      <th className="py-2 px-3 whitespace-nowrap font-semibold">Customer ID</th>
                      <th className="py-2 px-3 whitespace-nowrap font-semibold">Customer Name</th>
                      <th className="py-2 px-3 whitespace-nowrap font-semibold">Status</th>
                      <th className="py-2 px-3 whitespace-nowrap font-semibold text-right">Tenure</th>
                      <th className="py-2 px-3 whitespace-nowrap font-semibold text-right">Satisfaction</th>
                      <th className="py-2 px-3 whitespace-nowrap font-semibold text-right">Complaints</th>
                      <th className="py-2 px-3 whitespace-nowrap font-semibold text-right">Tickets</th>
                      <th className="py-2 px-3 whitespace-nowrap font-semibold text-right">Avg Resolution</th>
                      <th className="py-2 px-3 whitespace-nowrap font-semibold text-right">Revenue</th>
                      <th className="py-2 px-3 whitespace-nowrap font-semibold">Churn Status</th>
                      <th className="py-2 px-3 whitespace-nowrap font-semibold">Validation</th>
                      <th className="py-2 px-3 whitespace-nowrap font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-purple-50 font-mono tabular-nums">
                    {stagedImport.rowValidation.previewRecords.map((rec) => {
                      const statusColor =
                        rec.validationStatus === 'Error'
                          ? 'text-[#E04F44] font-bold'
                          : rec.validationStatus === 'Warning'
                            ? 'text-amber-700 font-bold'
                            : 'text-[#0E9F6E] font-semibold';
                      return (
                        <tr key={`${rec.rowIndex}-${rec.customerId}`} className="hover:bg-[#F5F3FF]/50">
                          <td className="py-2 px-3 whitespace-nowrap font-semibold text-[#15152F]">{rec.customerId}</td>
                          <td className="py-2 px-3 whitespace-nowrap font-sans text-slate-700">{rec.customerName}</td>
                          <td className="py-2 px-3 whitespace-nowrap font-sans text-slate-700">{rec.subscriptionStatus}</td>
                          <td className="py-2 px-3 whitespace-nowrap text-right text-slate-700">{rec.tenure}</td>
                          <td className="py-2 px-3 whitespace-nowrap text-right text-slate-700">{rec.satisfactionScore}</td>
                          <td className="py-2 px-3 whitespace-nowrap text-right text-slate-700">{rec.complaints}</td>
                          <td className="py-2 px-3 whitespace-nowrap text-right text-slate-700">{rec.ticketsRaised}</td>
                          <td className="py-2 px-3 whitespace-nowrap text-right text-slate-700">{rec.avgResolutionTime}</td>
                          <td className="py-2 px-3 whitespace-nowrap text-right text-slate-700">{rec.revenue}</td>
                          <td className="py-2 px-3 whitespace-nowrap font-sans text-slate-700">{rec.churnStatus}</td>
                          <td className={`py-2 px-3 whitespace-nowrap font-sans ${statusColor}`}>
                            {rec.validationStatus}
                          </td>
                          <td className="py-2 px-3 font-sans text-[11px] text-slate-600 min-w-[200px]">
                            {rec.validationNotes.length > 0 ? rec.validationNotes.join('; ') : 'Passed'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : stagedImport.previewRows.length > 0 ? (
            <div className="pt-4 border-t border-purple-100 space-y-2">
              <div className="text-xs font-bold text-[#15152F]">
                Sample Preview (First {Math.min(5, stagedImport.previewRows.length)} Rows)
              </div>
              <div className="overflow-x-auto border border-purple-100 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-[#F5F3FF] text-[#4C4A6E]">
                    <tr>
                      {stagedImport.columns.slice(0, 7).map((c) => (
                        <th key={c.name} className="py-2 px-3 whitespace-nowrap font-semibold">
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-purple-50 font-mono">
                    {stagedImport.previewRows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        {stagedImport.columns.slice(0, 7).map((c) => (
                          <td key={c.name} className="py-1.5 px-3 whitespace-nowrap text-slate-700">
                            {r[c.name] || <span className="text-amber-600 italic">empty</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Duplicate Customer_ID Conflict Handling */}
          {stagedImport.uploadMode !== 'tickets' &&
            stagedImport.duplicateConflict &&
            stagedImport.duplicateConflict.conflictCount > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 sm:p-5 space-y-3 text-xs text-amber-950">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-bold text-sm text-[#15152F]">
                      Duplicate Customer_IDs Detected ({stagedImport.duplicateConflict.conflictCount.toLocaleString()} matching records)
                    </div>
                    <p className="text-slate-700">
                      This upload overlaps with existing records in{' '}
                      <span className="font-semibold">
                        {stagedImport.duplicateConflict.existingDatasetFileName}
                      </span>
                      {stagedImport.duplicateConflict.sampleDuplicateIds.length > 0 && (
                        <>
                          {' '}
                          (e.g.{' '}
                          <span className="font-mono font-semibold">
                            {stagedImport.duplicateConflict.sampleDuplicateIds.slice(0, 5).join(', ')}
                          </span>
                          )
                        </>
                      )}
                      . Choose how to handle matching IDs:
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <label
                    className={`rounded-xl border p-3 cursor-pointer transition-all flex items-start gap-2.5 ${
                      duplicateStrategy === 'skip'
                        ? 'border-[#7655E8] bg-white ring-1 ring-[#7655E8]/30'
                        : 'border-amber-200 bg-white/70 hover:bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name="duplicateStrategy"
                      checked={duplicateStrategy === 'skip'}
                      onChange={() => setDuplicateStrategy('skip')}
                      className="mt-0.5 accent-[#7655E8]"
                    />
                    <div>
                      <div className="font-bold text-[#15152F]">Skip Existing</div>
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        Keep existing customers unchanged and append only new IDs.
                      </div>
                    </div>
                  </label>

                  <label
                    className={`rounded-xl border p-3 cursor-pointer transition-all flex items-start gap-2.5 ${
                      duplicateStrategy === 'update'
                        ? 'border-[#7655E8] bg-white ring-1 ring-[#7655E8]/30'
                        : 'border-amber-200 bg-white/70 hover:bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name="duplicateStrategy"
                      checked={duplicateStrategy === 'update'}
                      onChange={() => setDuplicateStrategy('update')}
                      className="mt-0.5 accent-[#7655E8]"
                    />
                    <div>
                      <div className="font-bold text-[#15152F]">Update Existing</div>
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        Update matching customers with new data and add new rows.
                      </div>
                    </div>
                  </label>

                  <label
                    className={`rounded-xl border p-3 cursor-pointer transition-all flex items-start gap-2.5 ${
                      duplicateStrategy === 'replace'
                        ? 'border-[#7655E8] bg-white ring-1 ring-[#7655E8]/30'
                        : 'border-amber-200 bg-white/70 hover:bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name="duplicateStrategy"
                      checked={duplicateStrategy === 'replace'}
                      onChange={() => setDuplicateStrategy('replace')}
                      className="mt-0.5 accent-[#7655E8]"
                    />
                    <div>
                      <div className="font-bold text-[#15152F]">Replace Active Dataset</div>
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        Switch active workspace table exclusively to this upload.
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            )}

          {/* Import Commit Mode Selector & Confirmation Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-3 border-t border-purple-100">
            {stagedImport.uploadMode !== 'tickets' &&
            stagedImport.rowValidation &&
            stagedImport.rowValidation.errorCount > 0 ? (
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="font-semibold text-[#15152F]">Commit Scope:</span>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'valid_only'}
                    onChange={() => setImportMode('valid_only')}
                    className="accent-[#7655E8]"
                  />
                  <span className="font-semibold text-[#0E9F6E]">
                    Import Valid Rows Only ({stagedImport.rowValidation.validCount + stagedImport.rowValidation.warningCount} clean/warning rows)
                  </span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'all'}
                    onChange={() => setImportMode('all')}
                    className="accent-[#7655E8]"
                  />
                  <span className="text-slate-600">
                    Include Flagged Error Rows ({stagedImport.rowValidation.totalRows} total)
                  </span>
                </label>
              </div>
            ) : (
              <div className="text-xs text-slate-500">
                {stagedImport.uploadMode === 'tickets'
                  ? 'Links deduplicated Ticket_Data metrics onto matching existing customers.'
                  : 'Ready to commit validated records into your workspace.'}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={onCancelStaged}
                className="px-4 py-2 border border-purple-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-[#F5F3FF] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  isCommitting ||
                  (!canCommitWithoutChurnDef && !stagedChurnDef.confirmedByUser) ||
                  (stagedImport.uploadMode === 'tickets' && !dataset)
                }
                onClick={handleCommitStaged}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#7655E8] to-[#E84FA8] hover:opacity-95 text-white text-xs font-bold rounded-xl shadow-md shadow-[#7655E8]/25 disabled:opacity-45 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {isCommitting
                    ? 'Importing Dataset...'
                    : stagedImport.uploadMode === 'tickets'
                      ? 'Confirm & Link Ticket History'
                      : stagedImport.uploadPathway === 'current_prediction'
                        ? 'Confirm & Score Current Customers'
                        : 'Confirm & Import Dataset'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {dataset && (
        <>
          <DataReadinessPanel
            company={company}
            dataset={dataset}
            analytics={analytics}
            canUploadAndAnalyse={canUploadAndAnalyse}
            onRecordOutcome={onRecordOutcome}
            onNavigate={onNavigate}
          />

          {/* Validation & Data Quality Report */}
          <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 sm:p-6 space-y-4 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold text-[#15152F]">
                  Data Validation & Quality Report
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                  {dataset.fileName}
                  {dataset.isSample ? ' (Demonstration Data)' : ''} ·{' '}
                  {dataset.rowCount.toLocaleString()} rows · {dataset.columnCount} columns
                  {typeof dataset.duplicateCount === 'number'
                    ? ` · ${dataset.duplicateCount} duplicates`
                    : ''}
                  {typeof dataset.missingCellCount === 'number'
                    ? ` · ${dataset.missingCellCount} missing`
                    : ''}
                  {typeof dataset.invalidDateCount === 'number' && dataset.invalidDateCount > 0
                    ? ` · ${dataset.invalidDateCount} invalid dates`
                    : ''}
                  {typeof dataset.inconsistentCategoryCount === 'number' &&
                  dataset.inconsistentCategoryCount > 0
                    ? ` · ${dataset.inconsistentCategoryCount} inconsistent categories`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                {onNavigate && automationStatus?.predictionAvailable && (
                  <button
                    type="button"
                    onClick={() => onNavigate('predictions')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                  >
                    <span>View Churn Predictions</span>
                  </button>
                )}
                {canUploadAndAnalyse && (
                  <button
                    type="button"
                    onClick={() => setShowMapper((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#F6F3FF] hover:bg-purple-100 text-[#7655E8] border border-purple-200/80 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>{showMapper ? 'Hide Column Mapping' : 'Configure Column Mapping'}</span>
                  </button>
                )}
              </div>
            </div>

            {dataset.hasValidChurnLabels === false && dataset.churnReadinessMessage && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-start gap-2.5 text-xs text-amber-950">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Churn Outcome Warning: </span>
                  {dataset.churnReadinessMessage}
                </div>
              </div>
            )}

            {dataset.issues.length === 0 ? (
              <div className="flex items-center gap-2.5 text-sm text-[#065F46] bg-[#16C995]/12 border border-[#16C995]/35 rounded-xl px-4 py-3">
                <CheckCircle2 className="w-4 h-4 text-[#16C995] shrink-0" />
                <span>
                  All columns and rows passed validation with zero missing values. Data is ready for
                  Business Analytics and Managed prediction setup.
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                {dataset.issues.map((issue, idx) => {
                  const style =
                    issue.severity === 'error'
                      ? 'bg-[#FF786B]/10 border-[#FF786B]/40 text-[#9A2E25]'
                      : issue.severity === 'warning'
                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                        : 'bg-[#F6F3FF] border-purple-200/70 text-[#15152F]';

                  return (
                    <div
                      key={idx}
                      className={`border rounded-xl px-3.5 py-2.5 text-xs flex items-start gap-2.5 ${style}`}
                    >
                      <Info className="w-4 h-4 shrink-0 mt-0.5 opacity-80" />
                      <span>{issue.message}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Flexible Column Mapping Panel */}
            {showMapper && (
              <div className="pt-4 border-t border-purple-100 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-[#15152F]">Flexible Column Mapping</h3>
                  <p className="text-xs text-slate-500">
                    Map spreadsheet columns to your {tmpl.label} schema below.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                      Target Churn Column
                    </label>
                    <select
                      value={dataset.mapping.targetColumn}
                      onChange={(e) => onUpdateMapping({ targetColumn: e.target.value })}
                      className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-sm text-[#15152F] focus:outline-none focus:border-[#7655E8]"
                    >
                      <option value="">None (Unlabeled)</option>
                      {dataset.columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name} ({c.uniqueCount} unique)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                      Positive Churn Value
                    </label>
                    {dataset.targetUniqueValues &&
                    dataset.targetUniqueValues.length >= 2 &&
                    dataset.targetUniqueValues.length <= 20 ? (
                      <select
                        value={dataset.mapping.positiveClassValue}
                        onChange={(e) => onUpdateMapping({ positiveClassValue: e.target.value })}
                        className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-sm text-[#15152F] focus:outline-none focus:border-[#7655E8]"
                      >
                        {dataset.targetUniqueValues.map((val) => (
                          <option key={val} value={val}>
                            {val}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={dataset.mapping.positiveClassValue}
                        onChange={(e) => onUpdateMapping({ positiveClassValue: e.target.value })}
                        className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-sm text-[#15152F] focus:outline-none focus:border-[#7655E8]"
                        placeholder="e.g. Yes or 1"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                      {tmpl.entitySingular} ID Column (Optional)
                    </label>
                    <select
                      value={dataset.mapping.idColumn || ''}
                      onChange={(e) =>
                        onUpdateMapping({ idColumn: e.target.value ? e.target.value : null })
                      }
                      className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-sm text-[#15152F] focus:outline-none focus:border-[#7655E8]"
                    >
                      <option value="">None (Auto-generate ID)</option>
                      {dataset.columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                      {tmpl.segmentLabel} Column (Optional)
                    </label>
                    <select
                      value={dataset.mapping.contractColumn || ''}
                      onChange={(e) =>
                        onUpdateMapping({
                          contractColumn: e.target.value ? e.target.value : null,
                        })
                      }
                      className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-sm text-[#15152F] focus:outline-none focus:border-[#7655E8]"
                    >
                      <option value="">Not available</option>
                      {dataset.columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                      {tmpl.tenureLabel} Column (Optional)
                    </label>
                    <select
                      value={dataset.mapping.tenureColumn || ''}
                      onChange={(e) =>
                        onUpdateMapping({ tenureColumn: e.target.value ? e.target.value : null })
                      }
                      className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-sm text-[#15152F] focus:outline-none focus:border-[#7655E8]"
                    >
                      <option value="">Not available</option>
                      {dataset.columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                      {tmpl.revenueLabel} Column (Optional)
                    </label>
                    <select
                      value={dataset.mapping.monthlyChargesColumn || ''}
                      onChange={(e) =>
                        onUpdateMapping({
                          monthlyChargesColumn: e.target.value ? e.target.value : null,
                        })
                      }
                      className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-sm text-[#15152F] focus:outline-none focus:border-[#7655E8]"
                    >
                      <option value="">Not available</option>
                      {dataset.columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                      Date / Timestamp Column (Optional)
                    </label>
                    <select
                      value={dataset.mapping.dateColumn || ''}
                      onChange={(e) =>
                        onUpdateMapping({ dateColumn: e.target.value ? e.target.value : null })
                      }
                      className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-sm text-[#15152F] focus:outline-none focus:border-[#7655E8]"
                    >
                      <option value="">Not available</option>
                      {dataset.columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                      {tmpl.frequencyLabel} Column (Optional)
                    </label>
                    <select
                      value={dataset.mapping.frequencyColumn || ''}
                      onChange={(e) =>
                        onUpdateMapping({
                          frequencyColumn: e.target.value ? e.target.value : null,
                        })
                      }
                      className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-sm text-[#15152F] focus:outline-none focus:border-[#7655E8]"
                    >
                      <option value="">Not available</option>
                      {dataset.columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                      Customer Status Column (Operational)
                    </label>
                    <select
                      value={dataset.mapping.statusColumn || ''}
                      onChange={(e) =>
                        onUpdateMapping({
                          statusColumn: e.target.value ? e.target.value : null,
                        })
                      }
                      className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-sm text-[#15152F] focus:outline-none focus:border-[#7655E8]"
                    >
                      <option value="">Not mapped</option>
                      {dataset.columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                      Observation Snapshot Date
                    </label>
                    <select
                      value={dataset.mapping.observationDateColumn || ''}
                      onChange={(e) =>
                        onUpdateMapping({
                          observationDateColumn: e.target.value ? e.target.value : null,
                        })
                      }
                      className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-sm text-[#15152F] focus:outline-none focus:border-[#7655E8]"
                    >
                      <option value="">Not mapped</option>
                      {dataset.columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                      Registration Date
                    </label>
                    <select
                      value={dataset.mapping.registrationDateColumn || ''}
                      onChange={(e) =>
                        onUpdateMapping({
                          registrationDateColumn: e.target.value ? e.target.value : null,
                        })
                      }
                      className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-sm text-[#15152F] focus:outline-none focus:border-[#7655E8]"
                    >
                      <option value="">Not mapped</option>
                      {dataset.columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                      Churn / Cancellation Date (Audit Only)
                    </label>
                    <select
                      value={dataset.mapping.churnDateColumn || ''}
                      onChange={(e) =>
                        onUpdateMapping({
                          churnDateColumn: e.target.value ? e.target.value : null,
                        })
                      }
                      className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-sm text-[#15152F] focus:outline-none focus:border-[#7655E8]"
                    >
                      <option value="">Not present (safe)</option>
                      {dataset.columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#4C4A6E] mb-2">
                    Prepared Customer Attributes ({dataset.mapping.featureColumns.length}{' '}
                    selected for Customer data preparation — target &amp; post-outcome dates excluded)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {dataset.columns
                      .filter(
                        (c) =>
                          c.name !== dataset.mapping.targetColumn &&
                          c.name !== dataset.mapping.idColumn &&
                          c.name !== dataset.mapping.churnDateColumn &&
                          c.dataType !== 'identifier' &&
                          c.dataType !== 'date'
                      )
                      .map((col) => {
                        const checked = dataset.mapping.featureColumns.includes(col.name);
                        return (
                          <label
                            key={col.name}
                            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs cursor-pointer select-none transition-colors ${
                              checked
                                ? 'bg-[#7655E8]/10 border-[#7655E8]/40 text-[#5B3AD6] font-semibold'
                                : 'bg-white border-purple-100 text-slate-600 hover:bg-[#F6F3FF]'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleFeatureColumn(col.name)}
                              className="rounded border-purple-300 text-[#7655E8] accent-[#7655E8]"
                            />
                            <span>{col.name}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Column Schema Summary */}
          <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 sm:p-6 space-y-4 min-w-0">
            <div>
              <h2 className="text-base font-bold text-[#15152F]">
                Detected Column Schema & Missing Values
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Automatic type inference and semantic profiling across all {dataset.columnCount}{' '}
                columns
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-purple-100 text-xs font-semibold text-[#4C4A6E]">
                    <th className="py-2.5 pr-4">Column Name</th>
                    <th className="py-2.5 px-4">Detected Type</th>
                    <th className="py-2.5 px-4">Semantic Role</th>
                    <th className="py-2.5 px-4 text-right">Unique Values</th>
                    <th className="py-2.5 px-4 text-right">Missing Values</th>
                    <th className="py-2.5 px-4">Data Hygiene</th>
                    <th className="py-2.5 pl-4">Sample Values</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-50 text-sm">
                  {dataset.columns.map((col) => {
                    const hygieneFlags: string[] = [];
                    if ((col.invalidDateCount || 0) > 0) {
                      hygieneFlags.push(`${col.invalidDateCount} invalid date(s)`);
                    }
                    if ((col.inconsistentCategoryCount || 0) > 0) {
                      hygieneFlags.push(`${col.inconsistentCategoryCount} case/trim variant(s)`);
                    }
                    if (col.invalidNumericCount > 0 && col.dataType === 'numeric') {
                      hygieneFlags.push(`${col.invalidNumericCount} non-numeric`);
                    }
                    return (
                      <tr key={col.name} className="hover:bg-[#F6F3FF]/60 transition-colors">
                        <td className="py-2.5 pr-4 font-semibold text-[#15152F]">
                          {col.name}
                          {col.name === dataset.mapping.targetColumn && (
                            <span className="ml-2 text-xs font-bold text-[#7655E8]">(Target)</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-xs font-mono text-[#397BFF] font-medium">
                          {col.dataType}
                        </td>
                        <td className="py-2.5 px-4 text-xs font-mono text-slate-600">
                          {col.semanticRole || 'other'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                          {col.uniqueCount}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          <span
                            className={
                              col.missingCount > 0
                                ? 'text-[#D97706] font-semibold'
                                : 'text-[#0E9F6E] font-medium'
                            }
                          >
                            {col.missingCount} ({col.missingPercent}%)
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-xs">
                          {hygieneFlags.length > 0 ? (
                            <span className="text-[#D97706] font-medium">
                              {hygieneFlags.join(' · ')}
                            </span>
                          ) : (
                            <span className="text-[#0E9F6E]">Clean</span>
                          )}
                        </td>
                        <td className="py-2.5 pl-4 text-xs text-slate-500 truncate max-w-[220px]">
                          {col.sampleValues.join(', ') || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Customer Records Table */}
          <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 sm:p-6 space-y-4 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[#15152F]">
                  {tmpl.entitySingular} Records Preview
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Showing {rows.length} of {totalRows} matching records · Click any row to inspect
                  all attributes
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-[#7655E8] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder={`Search ${tmpl.entityPlural.toLowerCase()}...`}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-purple-200 rounded-xl bg-[#F6F3FF]/40 text-[#15152F] focus:outline-none focus:border-[#7655E8] focus:ring-2 focus:ring-[#7655E8]/20"
                />
              </div>
            </div>

            {isFetchingRows || isLoading ? (
              <TableRowsSkeleton rows={8} cols={Math.max(4, visibleHeaders.length + 1)} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-purple-100 text-xs font-semibold text-[#4C4A6E]">
                      {visibleHeaders.map((h) => (
                        <th key={h} className="py-2.5 px-3 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                      <th className="py-2.5 pl-3 text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-purple-50 text-sm">
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={visibleHeaders.length + 1}
                          className="py-10 text-center text-xs text-slate-500"
                        >
                          <div className="space-y-2">
                            <div>No records match &ldquo;{searchQuery}&rdquo;.</div>
                            {searchQuery && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSearchQuery('');
                                  setPage(1);
                                }}
                                className="text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer"
                              >
                                Clear Search
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, idx) => (
                        <tr
                          key={idx}
                          onClick={() => setSelectedRow(row)}
                          className="hover:bg-[#F6F3FF]/80 cursor-pointer transition-colors"
                        >
                          {visibleHeaders.map((h) => (
                            <td
                              key={h}
                              className="py-2.5 px-3 text-slate-700 whitespace-nowrap font-mono text-xs tabular-nums"
                            >
                              {row[h] ? row[h] : <span className="text-[#D97706] italic">missing</span>}
                            </td>
                          ))}
                          <td className="py-2.5 pl-3 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRow(row);
                              }}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Inspect</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            <div className="flex items-center justify-between pt-3 border-t border-purple-100 text-xs text-slate-600">
              <span className="font-mono tabular-nums font-medium">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3.5 py-1.5 border border-purple-200 rounded-xl bg-white hover:bg-[#F6F3FF] text-[#15152F] font-medium disabled:opacity-40 cursor-pointer transition-colors"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3.5 py-1.5 border border-purple-200 rounded-xl bg-white hover:bg-[#F6F3FF] text-[#15152F] font-medium disabled:opacity-40 cursor-pointer transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Sample Dataset Preview Modal */}
      {showSampleModal && (
        <div className="fixed inset-0 z-50 bg-[#15152F]/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-purple-100 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-purple-100 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-[#15152F]">
                  Sample Customer Dataset Preview ({tmpl.label})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Rows marked with [Example] show expected formatting before you replace them with real customer records.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSampleModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[#15152F] hover:bg-[#F6F3FF] cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-auto space-y-4">
              <div className="overflow-x-auto border border-purple-100 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-[#F5F3FF] text-[#4C4A6E] border-b border-purple-100">
                    <tr>
                      <th className="py-2.5 px-3 whitespace-nowrap">customer_id</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">customer_name</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">customer_status</th>
                      <th className="py-2.5 px-3 whitespace-nowrap text-right">tenure_months</th>
                      <th className="py-2.5 px-3 whitespace-nowrap text-right">satisfaction</th>
                      <th className="py-2.5 px-3 whitespace-nowrap text-right">complaints</th>
                      <th className="py-2.5 px-3 whitespace-nowrap text-right">tickets</th>
                      <th className="py-2.5 px-3 whitespace-nowrap text-right">avg_res_days</th>
                      <th className="py-2.5 px-3 whitespace-nowrap text-right">total_revenue</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">churn_status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-purple-50 font-mono tabular-nums">
                    {SAMPLE_PREVIEW_RECORDS.map((row) => (
                      <tr key={row.customer_id}>
                        <td className="py-2 px-3 font-semibold text-[#15152F]">{row.customer_id}</td>
                        <td className="py-2 px-3 font-sans text-slate-700">{row.customer_name}</td>
                        <td className="py-2 px-3 font-sans text-slate-700">{row.customer_status}</td>
                        <td className="py-2 px-3 text-right">{row.tenure_months}</td>
                        <td className="py-2 px-3 text-right">{row.customer_satisfaction_score}</td>
                        <td className="py-2 px-3 text-right">{row.total_complaints}</td>
                        <td className="py-2 px-3 text-right">{row.total_tickets_raised}</td>
                        <td className="py-2 px-3 text-right">{row.average_resolution_days}</td>
                        <td className="py-2 px-3 text-right">${row.total_revenue}</td>
                        <td className="py-2 px-3 font-sans font-semibold">{row.churn_status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => handleDownloadTemplate('xlsx', undefined, 'comprehensive')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#11142B] text-white text-xs font-bold hover:bg-[#1C2147] cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-[#35C5E8]" />
                  <span>Download Excel Template (.xlsx)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Data Requirements & 7-Category Schema Modal */}
      {showRequirementsModal && (
        <div className="fixed inset-0 z-50 bg-[#15152F]/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-purple-100 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-purple-100 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-[#15152F]">
                  ChurnSight Import Centre · 7-Category Data Requirements
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Multi-sheet .xlsx exports include Customer_Data, Ticket_Data, Field_Guide, and Instructions tabs.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRequirementsModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[#15152F] hover:bg-[#F6F3FF] cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-5">
              {IMPORT_FIELD_CATEGORIES.map((group) => (
                <div key={group.category} className="space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
                    <h4 className="text-xs font-bold text-[#15152F]">{group.category}</h4>
                    <span className="text-[11px] text-slate-500">{group.usedFor}</span>
                  </div>
                  <div className="overflow-x-auto border border-purple-100 rounded-xl">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-[#F5F3FF] text-[#4C4A6E] border-b border-purple-100">
                        <tr>
                          <th className="py-2 px-3">Field Name</th>
                          <th className="py-2 px-3">Tier</th>
                          <th className="py-2 px-3">Accepted Format</th>
                          <th className="py-2 px-3">Example</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-purple-50">
                        {group.fields.map((f) => (
                          <tr key={f.name}>
                            <td className="py-2 px-3 font-mono font-semibold text-[#15152F]">{f.name}</td>
                            <td className="py-2 px-3 font-medium text-[#7655E8]">{f.requirement}</td>
                            <td className="py-2 px-3 text-slate-600">{f.format}</td>
                            <td className="py-2 px-3 font-mono text-slate-700">{f.example}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Customer Attribute Detail Modal */}
      {selectedRow && (
        <div className="fixed inset-0 z-50 bg-[#15152F]/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-purple-100 rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-purple-100 flex items-center justify-between">
              <h3 className="text-base font-bold text-[#15152F]">
                {tmpl.entitySingular} Attributes
              </h3>
              <button
                type="button"
                onClick={() => setSelectedRow(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[#15152F] hover:bg-[#F6F3FF] cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto divide-y divide-purple-50 text-sm">
              {Object.entries(selectedRow).map(([key, val]) => (
                <div key={key} className="py-2.5 flex items-center justify-between gap-4">
                  <span className="text-slate-500 font-medium">{key}</span>
                  <span className="font-mono text-xs font-semibold text-[#15152F] text-right">
                    {val ? val : <span className="text-[#D97706] italic">missing</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Delete Dataset Confirmation Dialog */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-[#15152F]/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dataset-title"
        >
          <div className="bg-white border border-purple-100 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#FF786B]/15 text-[#E04F44] flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="delete-dataset-title" className="text-base font-bold text-[#15152F]">
                    Delete Uploaded Dataset
                  </h3>
                  <p className="text-xs text-slate-500 font-mono truncate max-w-[260px]">
                    {deleteTarget.fileName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isDeletingDataset}
                onClick={() => setDeleteTarget(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[#15152F] hover:bg-[#F6F3FF] cursor-pointer"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl bg-[#FF786B]/10 border border-[#FF786B]/35 p-3.5 text-xs text-[#9A2E25] space-y-1.5 leading-relaxed">
              <p>
                You are about to permanently remove{' '}
                <strong className="font-semibold">{deleteTarget.fileName}</strong> (
                {deleteTarget.customerCount.toLocaleString()} customers
                {deleteTarget.ticketCount > 0
                  ? `, ${deleteTarget.ticketCount.toLocaleString()} tickets`
                  : ''}
                ).
              </p>
              <p>
                Associated exclusive records, analytics, and predictions derived from this dataset
                will be removed or invalidated. Models trained exclusively on this file will be
                marked outdated.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                disabled={isDeletingDataset}
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl border border-purple-200 text-xs font-semibold text-slate-700 hover:bg-[#F5F3FF] cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingDataset}
                onClick={handleConfirmDeleteDataset}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#E04F44] hover:bg-[#C93B31] text-white text-xs font-bold shadow-sm cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingDataset ? 'Deleting...' : 'Confirm Delete Dataset'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
