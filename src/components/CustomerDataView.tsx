import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  Info,
  Search,
  SlidersHorizontal,
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
  IndustryKey,
  NavTab,
  PredictionPipelineStatus,
  ReportingPeriod,
  StagedDatasetImport,
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
  analytics?: AnalyticsSummary | null;
  stagedImport: StagedDatasetImport | null;
  automationStatus?: PredictionPipelineStatus | null;
  isPipelineRunning?: boolean;
  isLoading: boolean;
  canUploadAndAnalyse?: boolean;
  canGeneratePredictions?: boolean;
  onLoadSample: () => void;
  onStageUpload: (
    fileName: string,
    payload: { csvText?: string; fileBase64?: string }
  ) => Promise<void>;
  onCommitStaged: (req: {
    stagedId: string;
    mapping: ColumnMapping;
    churnDefinition: ChurnDefinition;
  }) => Promise<void>;
  onCancelStaged: () => void;
  onUpdateMapping: (mapping: Partial<ColumnMapping>) => Promise<void>;
  onSaveChurnDefinition?: (def: ChurnDefinition) => Promise<void>;
  onRecordOutcome?: (
    updates: { customerId: string; outcome: 'Churned' | 'Retained' }[]
  ) => Promise<void>;
  onAutoBuild?: () => void;
  onNavigate?: (tab: NavTab) => void;
}

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
  analytics = null,
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
  onUpdateMapping,
  onSaveChurnDefinition,
  onRecordOutcome,
  onAutoBuild,
  onNavigate,
}) => {
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);

  // Pre-upload Churn Definition & Industry Template Centre states
  const [preUploadChurnDef, setPreUploadChurnDef] = useState<ChurnDefinition>(
    company.churnDefinition || buildDefaultChurnDefinition(company.industry)
  );
  const [isSavingChurnDef, setIsSavingChurnDef] = useState(false);
  const [churnDefMessage, setChurnDefMessage] = useState<string | null>(null);
  const [showPreDefEditor, setShowPreDefEditor] = useState(
    !company.churnDefinition?.confirmedByUser || !dataset
  );
  const [templateIndustry, setTemplateIndustry] = useState<IndustryKey>(company.industry);
  const [templateMode, setTemplateMode] = useState<'labeled' | 'cold_start'>('labeled');
  const [showTemplateSpec, setShowTemplateSpec] = useState(!dataset);

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
  }, [company.churnDefinition, company.industry]);

  useEffect(() => {
    if (stagedImport) {
      setStagedMapping({ ...stagedImport.suggestedMapping });
      setStagedChurnDef({
        ...stagedImport.suggestedChurnDefinition,
        confirmedByUser: Boolean(company.churnDefinition?.confirmedByUser),
      });
      setUploadError(null);
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
      if (isExcel) {
        const fileBase64 = await readFileAsBase64(file);
        await onStageUpload(file.name, { fileBase64 });
      } else {
        const csvText = await file.text();
        await onStageUpload(file.name, { csvText });
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

  const handleCommitStaged = async () => {
    if (!stagedImport || !stagedMapping || !stagedChurnDef) return;
    if (!stagedChurnDef.confirmedByUser) {
      setUploadError(
        'Please confirm that the configured churn definition accurately represents your dataset before importing.'
      );
      return;
    }
    setUploadError(null);
    setIsCommitting(true);
    try {
      await onCommitStaged({
        stagedId: stagedImport.stagedId,
        mapping: stagedMapping,
        churnDefinition: {
          ...stagedChurnDef,
          confirmedByUser: true,
          confirmedAt: new Date().toISOString(),
        },
      });
      setPage(1);
      setSearchQuery('');
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Failed to commit dataset.');
    } finally {
      setIsCommitting(false);
    }
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

  const handleDownloadTemplate = (format: 'csv' | 'xlsx') => {
    setUploadError(null);
    const ext = format === 'xlsx' ? 'xlsx' : 'csv';
    const url = `/api/dataset/template?industry=${encodeURIComponent(
      templateIndustry
    )}&format=${format}&mode=${templateMode}`;
    downloadProtectedCsv(
      url,
      `churnsight_${templateIndustry}_${templateMode}_template.${ext}`
    ).catch((err: unknown) => {
      setUploadError(err instanceof Error ? err.message : 'Failed to download template.');
    });
  };

  const templateColumns = getIndustryDataTemplateColumns(templateIndustry);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#15152F] tracking-tight">Data Management</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Import CSV or Excel files for{' '}
            <span className="font-semibold text-[#15152F]">{tmpl.label}</span>, verify data quality,
            and confirm your churn definition to trigger Managed prediction setup
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {dataset && (
            <button
              type="button"
              onClick={() => exportDatasetSummaryCsv(company, dataset)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#F6F3FF] text-[#15152F] border border-purple-200 text-xs font-semibold rounded-xl shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#397BFF]" />
              <span>Export Schema CSV</span>
            </button>
          )}
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
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#F6F3FF] text-[#15152F] border border-purple-200 text-xs font-semibold rounded-xl shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#7655E8]" />
            <span>Download Sample CSV</span>
          </button>
          {canUploadAndAnalyse && (
            <button
              type="button"
              onClick={onLoadSample}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-[#7655E8] to-[#E84FA8] hover:opacity-95 text-white text-xs font-semibold rounded-xl shadow-sm shadow-[#7655E8]/25 transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Database className="w-3.5 h-3.5" />
              <span>{isLoading ? 'Loading...' : tmpl.demoDatasetLabel}</span>
            </button>
          )}
        </div>
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

              <div
                className={
                  preUploadChurnDef.triggerType === 'inactivity'
                    ? 'sm:col-span-3'
                    : 'sm:col-span-4'
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

      {/* STEP 2: INDUSTRY-SPECIFIC DATA TEMPLATES (CSV & EXCEL) */}
      <section className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#397BFF]">
              Step 2 · Industry Data Templates (CSV &amp; Excel)
            </div>
            <h2 className="text-sm sm:text-base font-bold text-[#15152F]">
              Prepare Your Spreadsheet Without Rigid Header Lock-In
            </h2>
            <p className="text-xs text-slate-600">
              Download pre-formatted CSV or Excel templates with sample rows and accepted date/number
              formats, or upload your own schema—our mapper adapts automatically.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleDownloadTemplate('csv')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-purple-200 bg-white hover:bg-[#F5F3FF] text-xs font-semibold text-[#11142B] cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-[#7655E8]" />
              <span>CSV Template</span>
            </button>
            <button
              type="button"
              onClick={() => handleDownloadTemplate('xlsx')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#35C5E8]" />
              <span>Excel (.xlsx) Template</span>
            </button>
            <button
              type="button"
              onClick={() => setShowTemplateSpec((p) => !p)}
              className="px-3 py-2 rounded-xl border border-purple-100 text-xs font-semibold text-slate-600 hover:bg-[#F5F3FF] cursor-pointer whitespace-nowrap"
            >
              {showTemplateSpec ? 'Hide Schema Guide' : 'View Schema Guide'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-[#4C4A6E]">Industry Template:</label>
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

          <div className="inline-flex rounded-xl border border-purple-200 bg-[#F5F3FF]/60 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setTemplateMode('labeled')}
              className={`px-3 py-1 rounded-lg font-semibold cursor-pointer transition-colors ${
                templateMode === 'labeled'
                  ? 'bg-white text-[#7655E8] shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              Full Historical (With Labels)
            </button>
            <button
              type="button"
              onClick={() => setTemplateMode('cold_start')}
              className={`px-3 py-1 rounded-lg font-semibold cursor-pointer transition-colors ${
                templateMode === 'cold_start'
                  ? 'bg-white text-[#397BFF] shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              Cold-Start (No Labels)
            </button>
          </div>
        </div>

        {showTemplateSpec && (
          <div className="overflow-x-auto border border-purple-100 rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#F5F3FF] text-[#4C4A6E] border-b border-purple-100">
                <tr>
                  <th className="py-2 px-3">Column</th>
                  <th className="py-2 px-3">Importance</th>
                  <th className="py-2 px-3">Accepted Formats</th>
                  <th className="py-2 px-3">Example</th>
                  <th className="py-2 px-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-purple-50">
                {templateColumns.map((col) => {
                  const tierColor =
                    col.tier === 'required'
                      ? 'text-[#7655E8] font-bold'
                      : col.tier === 'recommended'
                        ? 'text-[#397BFF] font-semibold'
                        : 'text-slate-500 font-medium';
                  return (
                    <tr key={col.name} className="hover:bg-[#F5F3FF]/40">
                      <td className="py-2 px-3 font-mono font-semibold text-[#11142B] whitespace-nowrap">
                        {col.name}
                      </td>
                      <td className={`py-2 px-3 uppercase text-[10px] tracking-wider ${tierColor}`}>
                        {col.tier}
                      </td>
                      <td className="py-2 px-3 text-slate-600">{col.acceptedFormats}</td>
                      <td className="py-2 px-3 font-mono text-slate-700 whitespace-nowrap">
                        {col.exampleValue}
                      </td>
                      <td className="py-2 px-3 text-slate-600">
                        {col.description}
                        {templateMode === 'cold_start' && col.coldStartNote && (
                          <span className="block text-[11px] text-[#397BFF] mt-0.5">
                            Cold-Start: {col.coldStartNote}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Upload Dropzone or Permission Notice */}
      {canUploadAndAnalyse ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`bg-white border-2 border-dashed rounded-2xl p-7 text-center transition-all shadow-sm shadow-purple-950/[0.03] ${
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
          <div className="max-w-lg mx-auto space-y-2.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#7655E8] to-[#E84FA8] text-white flex items-center justify-center mx-auto shadow-md shadow-[#7655E8]/25">
              <Upload className="w-5 h-5" />
            </div>
            <div className="text-sm font-semibold text-[#15152F]">
              Drag and drop a CSV or Excel (.xlsx / .xls) file here, or{' '}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-[#7655E8] hover:text-[#E84FA8] underline font-bold cursor-pointer transition-colors"
              >
                browse your computer
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Both labeled historical files and active/cold-start datasets without churn outcomes are
              accepted. Uploads stage into a schema preview first for automatic mapping &amp; quality
              checks.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 text-xs text-amber-900">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <strong>Read-Only Dataset Access:</strong> Your Analyst account does not currently have
            permission to upload files or modify column mappings. You may inspect existing company
            records below or ask your Firm Administrator to enable upload permissions.
          </div>
        </div>
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
        <div className="bg-white border-2 border-[#7655E8]/50 rounded-2xl shadow-xl shadow-[#7655E8]/10 p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-purple-100 pb-4">
            <div className="space-y-1">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#7655E8]">
                Step 2 of 2 · Staging Review &amp; Churn Definition Confirmation
              </div>
              <h2 className="text-lg font-bold text-[#15152F]">
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

          {!stagedImport.hasValidChurnLabels && stagedImport.churnReadinessMessage && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-950">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Churn Label Readiness Warning</div>
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

          {/* Staged Column Mapping Editor */}
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
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#4C4A6E] mb-2">
                Prepared Customer Attributes ({stagedMapping.featureColumns.length} selected for
                Customer data preparation)
              </label>
              <div className="flex flex-wrap gap-2">
                {stagedImport.columns
                  .filter(
                    (c) =>
                      c.name !== stagedMapping.targetColumn &&
                      c.name !== stagedMapping.idColumn &&
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

          {/* Churn Definition Builder */}
          <div className="pt-4 border-t border-purple-100 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-[#15152F]">
                2. Confirm Business Churn Definition
              </h3>
              <p className="text-xs text-slate-500">
                Defines how churn rate and attrition formulas are explained across reports and KPIs.
              </p>
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
            </div>

            <div className="bg-[#F5F3FF] border border-purple-200/80 rounded-xl p-3.5 text-xs text-[#15152F] space-y-2">
              <div className="font-semibold text-[#5B3AD6]">Live Churn Formula Preview</div>
              <div className="font-mono text-[11px] text-slate-700">
                {formatChurnCalculationExplanation(stagedChurnDef, 25, stagedImport.rowCount)}
              </div>
            </div>

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
          </div>

          {/* Staged Sample Rows Preview */}
          {stagedImport.previewRows.length > 0 && (
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
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onCancelStaged}
              className="px-4 py-2 border border-purple-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-[#F5F3FF] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isCommitting || !stagedChurnDef.confirmedByUser}
              onClick={handleCommitStaged}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#7655E8] to-[#E84FA8] hover:opacity-95 text-white text-xs font-bold rounded-xl shadow-md shadow-[#7655E8]/25 disabled:opacity-45 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isCommitting ? 'Importing Dataset...' : 'Confirm & Import Dataset'}</span>
            </button>
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
          <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
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
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#4C4A6E] mb-2">
                    Prepared Customer Attributes ({dataset.mapping.featureColumns.length}{' '}
                    selected for Customer data preparation)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {dataset.columns
                      .filter(
                        (c) =>
                          c.name !== dataset.mapping.targetColumn &&
                          c.name !== dataset.mapping.idColumn &&
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
          <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
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
          <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
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
    </div>
  );
};
