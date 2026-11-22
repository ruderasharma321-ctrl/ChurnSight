import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  BatchScoreResult,
  CompanyWorkspaceInfo,
  CustomerPrediction,
  DatasetState,
  FeatureImportance,
  ModelEvaluationResult,
  NavTab,
  PredictionPipelineStatus,
  RiskCategory,
} from '../types/churn';
import { apiFetch, downloadProtectedCsv } from '../utils/apiClient';
import { getIndustryTemplate } from '../utils/industryConfig';
import { exportCustomerRiskPdf } from '../utils/reportExporter';
import { getSubscriptionPlanSpec } from '../utils/subscriptionPlans';
import { EnterpriseRiskDial } from './EnterpriseRiskDial';
import { PredictionPipelineBanner } from './PredictionPipelineBanner';

const LazyPredictiveScene3D = React.lazy(() => import('./PredictiveScene3D'));

interface ChurnPredictionViewProps {
  company: CompanyWorkspaceInfo;
  dataset: DatasetState | null;
  activeModel: ModelEvaluationResult | null;
  automationStatus: PredictionPipelineStatus | null;
  batchScores?: BatchScoreResult[];
  isBuilding: boolean;
  canGeneratePredictions?: boolean;
  onAutoBuild: () => Promise<void>;
  onBatchScore?: (
    fileName: string,
    payload: { csvText?: string; fileBase64?: string }
  ) => Promise<void>;
  onNavigate: (tab: NavTab) => void;
}

function readExcelBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read Excel file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read Excel file.'));
    reader.readAsDataURL(file);
  });
}

const CUSTOMER_NAME_MISSING_TOKENS = new Set([
  '',
  'null',
  'na',
  'n/a',
  'nan',
  'none',
  'undefined',
  '?',
  '-',
  '—',
]);

const CUSTOMER_NAME_PRIORITY = [
  'customername',
  'fullname',
  'membername',
  'clientname',
  'accountname',
  'subscribername',
  'studentname',
  'patientname',
  'contactname',
  'companyname',
  'username',
  'name',
];

const CUSTOMER_NAME_NORM_KEYS = new Set(CUSTOMER_NAME_PRIORITY);

function isValidCustomerNameValue(val: string | undefined): val is string {
  if (!val) return false;
  const trimmed = val.trim();
  return !CUSTOMER_NAME_MISSING_TOKENS.has(trimmed.toLowerCase());
}

function getCustomerNameCandidates(attributes: Record<string, string> | undefined): string[] {
  if (!attributes) return [];
  const candidates: string[] = [];
  let firstName = '';
  let lastName = '';

  for (const [key, rawVal] of Object.entries(attributes)) {
    const val = (rawVal || '').trim();
    if (!isValidCustomerNameValue(val)) continue;
    const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (CUSTOMER_NAME_NORM_KEYS.has(norm)) {
      candidates.push(val);
    } else if (norm === 'firstname') {
      firstName = val;
    } else if (norm === 'lastname') {
      lastName = val;
    } else if (
      norm.endsWith('name') &&
      !/(plan|tier|product|package|service|campaign|segment|region|branch|store|file|sheet|model)/.test(
        norm
      )
    ) {
      candidates.push(val);
    }
  }

  const combinedName = `${firstName} ${lastName}`.trim();
  if (combinedName) {
    candidates.push(combinedName);
  } else if (firstName) {
    candidates.push(firstName);
  } else if (lastName) {
    candidates.push(lastName);
  }

  return candidates;
}

function resolveCustomerName(p: CustomerPrediction): string {
  if (isValidCustomerNameValue(p.customerName)) {
    return p.customerName.trim();
  }
  const attrs = p.attributes;
  if (!attrs) return '';

  const normalized = Object.entries(attrs).map(([k, v]) => ({
    norm: k.toLowerCase().replace(/[^a-z0-9]/g, ''),
    val: (v || '').trim(),
  }));

  for (const key of CUSTOMER_NAME_PRIORITY) {
    const found = normalized.find((e) => e.norm === key && isValidCustomerNameValue(e.val));
    if (found) return found.val;
  }

  const first =
    normalized.find((e) => e.norm === 'firstname' && isValidCustomerNameValue(e.val))?.val || '';
  const last =
    normalized.find((e) => e.norm === 'lastname' && isValidCustomerNameValue(e.val))?.val || '';
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;

  const fallback = getCustomerNameCandidates(attrs)[0];
  return fallback || '';
}

export const ChurnPredictionView: React.FC<ChurnPredictionViewProps> = ({
  company,
  dataset,
  activeModel,
  automationStatus,
  batchScores = [],
  isBuilding,
  canGeneratePredictions = true,
  onAutoBuild,
  onBatchScore,
  onNavigate,
}) => {
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);
  const plan = getSubscriptionPlanSpec(company.subscriptionPlan);

  const [actionError, setActionError] = useState<string | null>(null);
  const [headerTilt, setHeaderTilt] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Prediction Results & Individual Inspection
  const [selectedCustomerIdx, setSelectedCustomerIdx] = useState<number>(0);
  const [riskFilter, setRiskFilter] = useState<'ALL' | RiskCategory>('ALL');
  const [splitFilter, setSplitFilter] = useState<'ALL' | 'Unseen Test' | 'Training'>('ALL');
  const [searchId, setSearchId] = useState('');

  // Mode Switcher: Individual Record / Scenario Simulator / Batch Scoring
  const [inspectorMode, setInspectorMode] = useState<'record' | 'whatif' | 'batch'>('record');
  const [whatIfAttrs, setWhatIfAttrs] = useState<Record<string, string>>({});
  const [whatIfResult, setWhatIfResult] = useState<{
    churnProbability: number;
    predictedChurn: 'Likely to Churn' | 'Likely to Stay';
    riskCategory: RiskCategory;
  } | null>(null);
  const [isPredictingSingle, setIsPredictingSingle] = useState(false);
  const [whatIfError, setWhatIfError] = useState<string | null>(null);

  // Batch scoring states
  const batchFileRef = useRef<HTMLInputElement | null>(null);
  const [isBatchScoring, setIsBatchScoring] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  useEffect(() => {
    if (activeModel && activeModel.predictions.length > 0) {
      setSelectedCustomerIdx(0);
      setWhatIfAttrs({ ...activeModel.predictions[0].attributes });
      setWhatIfResult(null);
      setWhatIfError(null);
      setRiskFilter('ALL');
      setSplitFilter('ALL');
      setSearchId('');
    }
  }, [activeModel]);

  const filteredPredictions = useMemo(() => {
    if (!activeModel) return [];
    const rawQuery = searchId.trim().toLowerCase();
    const normalizedQuery = rawQuery.replace(/\s+/g, ' ');
    return activeModel.predictions.filter((p) => {
      if (riskFilter !== 'ALL' && p.riskCategory !== riskFilter) return false;
      if (splitFilter !== 'ALL' && p.split !== splitFilter) return false;
      if (normalizedQuery) {
        const matchesId = p.customerId.toLowerCase().includes(rawQuery);
        const resolvedName = resolveCustomerName(p);
        const matchesResolvedName =
          resolvedName && resolvedName.toLowerCase().replace(/\s+/g, ' ').includes(normalizedQuery);
        const matchesCandidateName = getCustomerNameCandidates(p.attributes).some((name) =>
          name.toLowerCase().replace(/\s+/g, ' ').includes(normalizedQuery)
        );
        if (!matchesId && !matchesResolvedName && !matchesCandidateName) {
          return false;
        }
      }
      return true;
    });
  }, [activeModel, riskFilter, splitFilter, searchId]);

  if (!dataset) {
    return (
      <div className="font-enterprise bg-[#11142B] text-white rounded-xl border border-white/10 p-8 sm:p-10 max-w-2xl mx-auto shadow-xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#35C5E8]">
          {tmpl.label.toUpperCase()} / CHURN PREDICTIONS
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white mt-2">
          Churn Predictions
        </h1>
        <p className="text-sm text-slate-300 mt-3 leading-relaxed max-w-lg">
          Upload your customer spreadsheet or load a {tmpl.label} demonstration dataset in Data
          Management. Managed prediction setup will prepare your data and activate predictions
          automatically.
        </p>
        <div className="mt-6">
          <button
            type="button"
            onClick={() => onNavigate('data')}
            className="px-5 py-2.5 bg-[#7655E8] hover:bg-[#6645D9] text-white text-xs font-semibold uppercase tracking-[0.12em] rounded-lg transition-colors cursor-pointer"
          >
            Open Data Management
          </button>
        </div>
      </div>
    );
  }

  const hasValidLabels = dataset.hasValidChurnLabels !== false;
  const predictionsReady =
    Boolean(activeModel) && (automationStatus ? automationStatus.predictionAvailable : true);

  const handleAutoBuild = async () => {
    setActionError(null);
    try {
      await onAutoBuild();
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Unable to complete Managed prediction setup.'
      );
    }
  };

  const handleWhatIfPredict = async () => {
    setIsPredictingSingle(true);
    setWhatIfError(null);
    try {
      const res = await apiFetch('/api/model/predict-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(whatIfAttrs),
      });
      const data = await res.json();
      if (!res.ok) {
        setWhatIfError(data.error || 'Failed to estimate churn risk.');
      } else {
        setWhatIfResult(data);
      }
    } catch {
      setWhatIfError('Network error while estimating churn risk.');
    } finally {
      setIsPredictingSingle(false);
    }
  };

  const handleBatchFile = async (file: File) => {
    if (!onBatchScore) return;
    setBatchError(null);
    const lower = file.name.toLowerCase();
    const isCsv = lower.endsWith('.csv') || file.type === 'text/csv';
    const isExcel =
      lower.endsWith('.xlsx') ||
      lower.endsWith('.xls') ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel';

    if (!isCsv && !isExcel) {
      setBatchError('Please select a valid .csv, .xlsx, or .xls file for batch scoring.');
      return;
    }

    setIsBatchScoring(true);
    try {
      if (isExcel) {
        const fileBase64 = await readExcelBase64(file);
        await onBatchScore(file.name, { fileBase64 });
      } else {
        const csvText = await file.text();
        await onBatchScore(file.name, { csvText });
      }
    } catch (err: unknown) {
      setBatchError(err instanceof Error ? err.message : 'Failed to score batch file.');
    } finally {
      setIsBatchScoring(false);
    }
  };

  const selectedPrediction: CustomerPrediction | null =
    activeModel && activeModel.predictions[selectedCustomerIdx]
      ? activeModel.predictions[selectedCustomerIdx]
      : null;

  const activeProbability =
    inspectorMode === 'whatif'
      ? whatIfResult?.churnProbability ?? null
      : selectedPrediction?.churnProbability ?? null;

  const formattedBuiltAt = activeModel?.trainedAt
    ? new Date(activeModel.trainedAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const latestBatch = batchScores[0] || null;

  const renderRiskDotLabel = (risk: RiskCategory) => {
    if (risk === 'Higher Estimated Churn Risk') {
      return (
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#9D2EC5]">
          <span className="w-2 h-2 rounded-full bg-[#B84DE0] shrink-0" />
          <span>High Risk</span>
        </span>
      );
    }
    if (risk === 'Moderate Estimated Churn Risk') {
      return (
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#5B3BD4]">
          <span className="w-2 h-2 rounded-full bg-[#7655E8] shrink-0" />
          <span>Moderate Risk</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#0C7D99]">
        <span className="w-2 h-2 rounded-full bg-[#35C5E8] shrink-0" />
        <span>Low Risk</span>
      </span>
    );
  };

  const resolveCustomerAttrForFeature = (
    featureName: string,
    attrs: Record<string, string>
  ): { baseCol: string; attrValue: string; matchesCategory: boolean } => {
    const eqIndex = featureName.indexOf(' = ');
    if (eqIndex > 0) {
      const baseCol = featureName.slice(0, eqIndex);
      const targetCat = featureName.slice(eqIndex + 3);
      const actualVal = attrs[baseCol] || '—';
      return {
        baseCol,
        attrValue: actualVal,
        matchesCategory: actualVal === targetCat,
      };
    }
    return {
      baseCol: featureName,
      attrValue: attrs[featureName] || '—',
      matchesCategory: true,
    };
  };

  const renderKeyRiskDrivers = (
    importances: FeatureImportance[],
    attrs: Record<string, string>
  ) => {
    const topFeatures = importances.slice(0, 6);
    if (topFeatures.length === 0) return null;
    const maxImportance = Math.max(1, ...topFeatures.map((f) => f.importance));

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7655E8]">
              KEY CHURN DRIVERS
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Top signals shaping this retention estimate
            </div>
          </div>
          <span className="text-[11px] font-mono text-slate-400">TOP {topFeatures.length}</span>
        </div>

        <div className="space-y-3">
          {topFeatures.map((item, idx) => {
            const { attrValue, matchesCategory } = resolveCustomerAttrForFeature(
              item.feature,
              attrs
            );
            const isIncrease = item.direction === 'increases_churn';
            const isDecrease = item.direction === 'decreases_churn';
            const directionLabel = isIncrease
              ? 'Increases Risk'
              : isDecrease
                ? 'Reduces Risk'
                : 'Key Influence';
            const directionTextClass = isIncrease
              ? 'text-[#B84DE0]'
              : isDecrease
                ? 'text-[#0C7D99]'
                : 'text-[#7655E8]';
            const barClass = isIncrease
              ? 'bg-[#B84DE0]'
              : isDecrease
                ? 'bg-[#35C5E8]'
                : 'bg-[#7655E8]';
            const barWidth = Math.max(8, (item.importance / maxImportance) * 100);

            return (
              <div
                key={item.feature}
                className="group border border-slate-200/80 hover:border-[#7655E8]/40 rounded-lg bg-[#F5F3FF]/35 hover:bg-white p-3 transition-all duration-150"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div
                      className="text-xs font-semibold text-[#11142B] truncate"
                      title={item.feature}
                    >
                      {item.feature}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                      <span className={`font-semibold ${directionTextClass}`}>
                        {directionLabel}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-slate-500">
                        Value:{' '}
                        <span className="font-mono font-semibold text-[#11142B]">
                          {attrValue}
                        </span>
                        {item.feature.includes(' = ') && (
                          <span className="ml-1 text-slate-400">
                            ({matchesCategory ? 'active' : 'inactive'})
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="font-mono text-xs font-bold tabular-nums text-[#11142B]">
                      {item.importance.toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-slate-400">Impact share</div>
                  </div>
                </div>

                <div className="mt-2.5 h-1.5 w-full rounded-full bg-slate-200/80 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${barWidth}%` }}
                    transition={{ duration: 0.55, delay: idx * 0.04, ease: [0.16, 1, 0.3, 1] }}
                    className={`h-full rounded-full ${barClass}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="font-enterprise space-y-6">
      {/* Enterprise Header */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
          const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
          setHeaderTilt({ x, y });
        }}
        onPointerLeave={() => setHeaderTilt({ x: 0, y: 0 })}
        className="relative overflow-hidden rounded-xl bg-[#11142B] text-white border border-white/10 shadow-xl shadow-[#11142B]/15"
      >
        <div className="absolute inset-0 pointer-events-none opacity-80">
          <Suspense fallback={null}>
            <LazyPredictiveScene3D
              isTraining={isBuilding}
              riskProbability={activeProbability}
              pointerTilt={headerTilt}
              variant="header"
            />
          </Suspense>
        </div>

        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(90deg, rgba(17,20,43,0.96) 0%, rgba(17,20,43,0.88) 54%, rgba(17,20,43,0.52) 100%)',
          }}
        />

        <div className="relative z-10 px-6 py-7 sm:px-8 sm:py-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="max-w-2xl space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#35C5E8]">
              {tmpl.label.toUpperCase()} / CHURN PREDICTIONS
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-white leading-[1.12]">
              Churn Predictions
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed max-w-xl">
              Review individual {tmpl.entitySingular.toLowerCase()} risk scores, test retention
              scenarios, and score new cohorts without manual technical configuration.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-1">
              {predictionsReady && (
                <button
                  type="button"
                  onClick={() => onNavigate('performance')}
                  className="text-xs font-semibold text-[#35C5E8] hover:text-white transition-colors cursor-pointer"
                >
                  View Model Performance ({activeModel?.accuracy.toFixed(1)}%) →
                </button>
              )}
              <button
                type="button"
                onClick={() => onNavigate('technical')}
                className="text-xs font-semibold text-indigo-200 hover:text-white transition-colors cursor-pointer"
              >
                Open Technical ML Studio →
              </button>
            </div>
          </div>

          <div className="lg:min-w-[340px] rounded-lg border border-white/15 bg-[#11142B]/85 px-5 py-4 space-y-3 shadow-lg">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                PREDICTION AVAILABILITY
              </span>
              {isBuilding ? (
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#35C5E8]">
                  <span className="w-2 h-2 rounded-full bg-[#35C5E8] animate-ping" />
                  <span>Building prediction model.</span>
                </span>
              ) : predictionsReady && activeModel ? (
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#35C5E8]">
                  <span className="w-2 h-2 rounded-full bg-[#35C5E8]" />
                  <span>Predictions ready ({activeModel.version})</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-amber-300">
                  <span className="w-2 h-2 rounded-full bg-amber-300" />
                  <span>
                    {hasValidLabels ? 'Setup required' : 'More historical data required.'}
                  </span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                  LAST UPDATED
                </div>
                <div className="font-mono text-white font-medium mt-0.5 truncate">
                  {formattedBuiltAt ?? '—'}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                  DATASET RECORDS
                </div>
                <div className="font-mono text-white font-medium mt-0.5">
                  {dataset.rowCount.toLocaleString()} rows
                </div>
              </div>

              <div className="col-span-2 pt-1 border-t border-white/10 flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                  SOURCE
                </span>
                <span className="font-mono text-[11px] text-slate-200 truncate">
                  {dataset.fileName}
                  {dataset.isSample ? ' (Demonstration Data)' : ''}
                </span>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* Managed Prediction Setup Status */}
      <PredictionPipelineBanner
        automationStatus={automationStatus}
        isRunning={isBuilding}
        canGeneratePredictions={canGeneratePredictions}
        onAutoBuild={handleAutoBuild}
        onNavigate={onNavigate}
      />

      {actionError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
          {actionError}
        </div>
      )}

      {/* Truthful Empty / Paused State when no valid predictions exist */}
      {!predictionsReady && !isBuilding && (
        <div className="bg-white border border-purple-100 rounded-2xl p-8 text-center max-w-2xl mx-auto space-y-4">
          <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-bold text-[#11142B]">
            {hasValidLabels ? 'Prediction Model Not Built Yet' : 'More historical data required.'}
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            {automationStatus?.failureReason ||
              dataset.churnReadinessMessage ||
              'ChurnSight only activates predictions after validating historical churn outcomes and passing hold-out quality checks.'}
          </p>
          {automationStatus?.recommendedAction && (
            <p className="text-xs text-slate-700 font-medium">
              {automationStatus.recommendedAction}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => onNavigate('data')}
              className="px-4 py-2 rounded-xl border border-purple-200 bg-[#F5F3FF] hover:bg-purple-100 text-xs font-semibold text-[#11142B] cursor-pointer"
            >
              Open Data Management
            </button>
            {hasValidLabels && canGeneratePredictions && (
              <button
                type="button"
                onClick={handleAutoBuild}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#35C5E8]" />
                <span>Build prediction model</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* CUSTOMER RISK INTELLIGENCE (3-Column Workspace + Portfolio Ledger) */}
      {predictionsReady && activeModel && !isBuilding && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
          className="space-y-6"
        >
          <section className="bg-white border border-slate-200/90 rounded-xl shadow-xs overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-200/80 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#7655E8]">
                  CUSTOMER RISK INTELLIGENCE · {activeModel.version}
                </div>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      ACTIVE MODEL
                    </span>
                    <span className="font-semibold text-[#11142B]">{activeModel.modelName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      MODEL RELIABILITY
                    </span>
                    <span className="font-mono font-semibold text-[#397BFF] tabular-nums">
                      {activeModel.accuracy.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      ACCOUNTS SCORED
                    </span>
                    <span className="font-mono font-semibold text-[#11142B] tabular-nums">
                      {activeModel.predictions.length.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Workspace Mode Switcher */}
              <div className="inline-flex flex-wrap items-center rounded-lg border border-slate-200 bg-[#F5F3FF]/70 p-1 self-start">
                <button
                  type="button"
                  onClick={() => setInspectorMode('record')}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                    inspectorMode === 'record'
                      ? 'bg-[#11142B] text-white shadow-xs'
                      : 'text-slate-600 hover:text-[#11142B]'
                  }`}
                >
                  {tmpl.entitySingular} Record
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorMode('whatif')}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                    inspectorMode === 'whatif'
                      ? 'bg-[#11142B] text-white shadow-xs'
                      : 'text-slate-600 hover:text-[#11142B]'
                  }`}
                >
                  Scenario Simulator
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorMode('batch')}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                    inspectorMode === 'batch'
                      ? 'bg-[#11142B] text-white shadow-xs'
                      : 'text-slate-600 hover:text-[#11142B]'
                  }`}
                >
                  Batch Scoring
                </button>
              </div>
            </div>

            {/* RECORD MODE */}
            {inspectorMode === 'record' && selectedPrediction && (
              <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200/80">
                <div className="lg:col-span-4 p-6 space-y-5">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="cs-customer-select"
                        className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7655E8]"
                      >
                        SELECT {tmpl.entitySingular.toUpperCase()}
                      </label>
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedCustomerIdx((prev) =>
                              prev > 0 ? prev - 1 : activeModel.predictions.length - 1
                            )
                          }
                          aria-label="Previous customer"
                          className="p-1 rounded border border-slate-200 hover:border-[#7655E8] text-slate-600 hover:text-[#11142B] cursor-pointer"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedCustomerIdx((prev) =>
                              prev < activeModel.predictions.length - 1 ? prev + 1 : 0
                            )
                          }
                          aria-label="Next customer"
                          className="p-1 rounded border border-slate-200 hover:border-[#7655E8] text-slate-600 hover:text-[#11142B] cursor-pointer"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <select
                      id="cs-customer-select"
                      value={selectedCustomerIdx}
                      onChange={(e) => setSelectedCustomerIdx(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-200 bg-[#F5F3FF]/45 px-3 py-2 text-xs text-[#11142B] font-mono focus:outline-none focus:border-[#7655E8]"
                    >
                      {activeModel.predictions.map((p, idx) => (
                        <option key={p.rowIndex} value={idx}>
                          #{p.rowIndex} · {p.customerId} ({(p.churnProbability * 100).toFixed(1)}%)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-lg border border-slate-200/80 bg-[#F5F3FF]/35 divide-y divide-slate-200/70 text-xs">
                    <div className="px-3.5 py-2.5 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        IDENTIFIER
                      </span>
                      <span className="font-mono font-bold text-[#11142B]">
                        {selectedPrediction.customerId}
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        VALIDATION SAMPLE
                      </span>
                      <span
                        className={`font-semibold ${
                          selectedPrediction.split === 'Unseen Test'
                            ? 'text-[#397BFF]'
                            : 'text-slate-600'
                        }`}
                      >
                        {selectedPrediction.split === 'Unseen Test'
                          ? 'Held-out Quality Check'
                          : 'Historical Reference'}
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        HISTORICAL OUTCOME
                      </span>
                      <span className="font-semibold text-[#11142B]">
                        {selectedPrediction.actualChurn}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      ATTRIBUTES
                    </div>
                    <div className="max-h-[260px] overflow-y-auto pr-1 divide-y divide-slate-100 text-xs border-t border-slate-200/80">
                      {Object.entries(selectedPrediction.attributes).map(([k, v]) => (
                        <div key={k} className="py-2 flex items-center justify-between gap-3">
                          <span className="text-slate-500 truncate">{k}</span>
                          <span className="font-mono font-semibold text-[#11142B] text-right">
                            {v || '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-4 p-6 flex flex-col justify-between bg-gradient-to-b from-[#F5F3FF]/30 via-white to-[#F5F3FF]/30">
                  <div className="flex items-center justify-between text-[11px] border-b border-slate-200/80 pb-2.5">
                    <span className="font-semibold uppercase tracking-[0.18em] text-slate-500">
                      PROBABILITY ASSESSMENT
                    </span>
                    {renderRiskDotLabel(selectedPrediction.riskCategory)}
                  </div>

                  <div className="my-auto py-4">
                    <EnterpriseRiskDial
                      probability={selectedPrediction.churnProbability}
                      riskCategory={selectedPrediction.riskCategory}
                      predictedLabel={selectedPrediction.predictedChurn}
                      customerId={selectedPrediction.customerId}
                    />
                  </div>

                  <div className="rounded-lg border border-slate-200/80 bg-white/90 px-3.5 py-2.5 flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
                    <Info className="w-3.5 h-3.5 text-[#397BFF] shrink-0 mt-0.5" />
                    <span>
                      Estimated by your company&apos;s{' '}
                      <strong className="text-[#11142B]">
                        {activeModel.modelName} ({activeModel.version})
                      </strong>
                      . Scores represent risk signals to prioritize proactive retention outreach.
                    </span>
                  </div>
                </div>

                <div className="lg:col-span-4 p-6">
                  {renderKeyRiskDrivers(
                    activeModel.featureImportances,
                    selectedPrediction.attributes
                  )}
                </div>
              </div>
            )}

            {/* SCENARIO SIMULATOR (WHAT-IF) MODE */}
            {inspectorMode === 'whatif' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200/80">
                <div className="lg:col-span-5 p-6 space-y-4">
                  <div className="border-b border-slate-200/80 pb-2.5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7655E8]">
                      SCENARIO PARAMETERS
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Adjust attributes to test how retention changes affect churn risk
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[340px] overflow-y-auto pr-1">
                    {dataset.mapping.featureColumns.map((colName) => {
                      const colProfile = dataset.columns.find((c) => c.name === colName);
                      const hasSelectOptions =
                        colProfile?.dataType === 'categorical' &&
                        colProfile.categories &&
                        colProfile.categories.length > 0;

                      return (
                        <div key={colName}>
                          <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 mb-1 truncate">
                            {colName}
                          </label>
                          {hasSelectOptions ? (
                            <select
                              value={whatIfAttrs[colName] ?? ''}
                              onChange={(e) =>
                                setWhatIfAttrs((prev) => ({ ...prev, [colName]: e.target.value }))
                              }
                              className="w-full rounded-lg border border-slate-200 bg-[#F5F3FF]/45 px-2.5 py-1.5 text-xs font-medium text-[#11142B] focus:outline-none focus:border-[#7655E8]"
                            >
                              {colProfile.categories!.map((cat) => (
                                <option key={cat} value={cat}>
                                  {cat}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={colProfile?.dataType === 'numeric' ? 'number' : 'text'}
                              step="any"
                              value={whatIfAttrs[colName] ?? ''}
                              onChange={(e) =>
                                setWhatIfAttrs((prev) => ({ ...prev, [colName]: e.target.value }))
                              }
                              className="w-full rounded-lg border border-slate-200 bg-[#F5F3FF]/45 px-2.5 py-1.5 text-xs font-mono text-[#11142B] focus:outline-none focus:border-[#7655E8]"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-2 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={handleWhatIfPredict}
                      disabled={isPredictingSingle || !canGeneratePredictions}
                      className="px-5 py-2.5 bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold uppercase tracking-[0.14em] rounded-lg border border-[#7655E8]/40 transition-colors disabled:opacity-45 cursor-pointer"
                    >
                      {isPredictingSingle ? 'CALCULATING...' : 'ESTIMATE CHURN RISK'}
                    </button>
                  </div>

                  {whatIfError && (
                    <div className="rounded-lg border border-[#B84DE0]/35 bg-[#B84DE0]/8 px-3 py-2 text-xs text-[#7E1D9E]">
                      {whatIfError}
                    </div>
                  )}
                </div>

                <div className="lg:col-span-3 p-6 flex flex-col justify-center bg-gradient-to-b from-[#F5F3FF]/30 via-white to-[#F5F3FF]/30">
                  {whatIfResult ? (
                    <EnterpriseRiskDial
                      probability={whatIfResult.churnProbability}
                      riskCategory={whatIfResult.riskCategory}
                      predictedLabel={whatIfResult.predictedChurn}
                      customerId="Simulated Profile"
                    />
                  ) : (
                    <div className="text-center space-y-2 py-12">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                        SIMULATION READY
                      </div>
                      <div className="font-display text-lg font-semibold text-[#11142B]">
                        Awaiting Scenario Run
                      </div>
                      <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                        Modify parameters and click{' '}
                        <strong className="text-[#11142B]">Estimate Churn Risk</strong> to inspect
                        updated churn likelihood.
                      </p>
                    </div>
                  )}
                </div>

                <div className="lg:col-span-4 p-6">
                  {renderKeyRiskDrivers(activeModel.featureImportances, whatIfAttrs)}
                </div>
              </div>
            )}

            {/* BATCH SCORING MODE */}
            {inspectorMode === 'batch' && (
              <div className="p-6 space-y-5">
                {!plan.allowBatchScoring ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-xs text-amber-900 space-y-2">
                    <div className="font-bold text-sm">
                      Batch Scoring Unavailable on {plan.name}
                    </div>
                    <p>
                      Upgrade your workspace subscription to Starter, Professional, or Enterprise to
                      upload unlabeled CSV or Excel customer batches and score them with your active
                      model ({activeModel.version}).
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border border-purple-200/80 bg-white p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                      <div className="space-y-1">
                        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#7655E8]">
                          Step 1 · Download Model-Matched Input Template
                        </div>
                        <div className="text-xs font-bold text-[#11142B]">
                          Current Customer Prediction Template ({activeModel.modelName}{' '}
                          {activeModel.version})
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
                          Contains{' '}
                          <span className="font-mono font-semibold text-[#11142B]">
                            {[
                              dataset.mapping.idColumn || 'customer_id',
                              ...dataset.mapping.featureColumns,
                            ].join(', ')}
                          </span>{' '}
                          and intentionally excludes outcome/leakage columns (
                          <span className="font-mono">
                            {dataset.mapping.targetColumn || 'churn_status'}
                            {dataset.mapping.churnDateColumn
                              ? `, ${dataset.mapping.churnDateColumn}`
                              : ''}
                          </span>
                          ).
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setBatchError(null);
                            downloadProtectedCsv(
                              '/api/dataset/prediction-template?format=csv',
                              `churnsight_prediction_input_${activeModel.version}.csv`
                            ).catch((err: unknown) => {
                              setBatchError(
                                err instanceof Error
                                  ? err.message
                                  : 'Failed to download prediction CSV template.'
                              );
                            });
                          }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-[#F5F3FF] text-xs font-semibold text-[#11142B] cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Download className="w-3.5 h-3.5 text-[#7655E8]" />
                          <span>Prediction CSV</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setBatchError(null);
                            downloadProtectedCsv(
                              '/api/dataset/prediction-template?format=xlsx',
                              `churnsight_prediction_input_${activeModel.version}.xlsx`
                            ).catch((err: unknown) => {
                              setBatchError(
                                err instanceof Error
                                  ? err.message
                                  : 'Failed to download prediction Excel template.'
                              );
                            });
                          }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 text-[#35C5E8]" />
                          <span>Prediction Excel (.xlsx)</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border border-dashed border-purple-300 bg-[#F5F3FF]/50 rounded-xl p-5">
                      <div className="space-y-1">
                        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#397BFF]">
                          Step 2 · Score Active {tmpl.entityPlural}
                        </div>
                        <div className="text-xs font-bold text-[#11142B]">
                          Upload Unlabeled {tmpl.entitySingular} File ({activeModel.version})
                        </div>
                        <p className="text-xs text-slate-600">
                          Upload a CSV or Excel (.xlsx/.xls) file of active{' '}
                          {tmpl.entityPlural.toLowerCase()} to estimate forward-looking churn
                          probabilities for retention prioritization.
                        </p>
                      </div>

                      <div className="shrink-0">
                        <input
                          ref={batchFileRef}
                          type="file"
                          accept=".csv,.xlsx,.xls"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleBatchFile(f);
                            e.target.value = '';
                          }}
                        />
                        <button
                          type="button"
                          disabled={isBatchScoring || !canGeneratePredictions}
                          onClick={() => batchFileRef.current?.click()}
                          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold uppercase tracking-[0.12em] rounded-lg cursor-pointer disabled:opacity-45 whitespace-nowrap shrink-0"
                        >
                          <Upload className="w-3.5 h-3.5 text-[#35C5E8]" />
                          <span>{isBatchScoring ? 'Scoring Batch...' : 'Upload Batch File'}</span>
                        </button>
                      </div>
                    </div>

                    {batchError && (
                      <div className="rounded-lg border border-[#B84DE0]/35 bg-[#B84DE0]/8 px-3.5 py-2.5 text-xs text-[#7E1D9E]">
                        {batchError}
                      </div>
                    )}

                    {latestBatch && (
                      <div className="space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div>
                            <div className="text-sm font-bold text-[#11142B]">
                              Latest Batch: {latestBatch.fileName}
                            </div>
                            <div className="text-xs text-slate-500 font-mono tabular-nums">
                              Scored {latestBatch.totalRows.toLocaleString()} records ·{' '}
                              {latestBatch.modelVersion} · Mean Probability{' '}
                              {(latestBatch.averageProbability * 100).toFixed(1)}%
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                downloadProtectedCsv(
                                  `/api/model/export-batch/${encodeURIComponent(latestBatch.batchId)}`,
                                  `batch_predictions_${latestBatch.batchId}.csv`
                                ).catch((err: unknown) =>
                                  setBatchError(
                                    err instanceof Error ? err.message : 'Batch CSV export failed.'
                                  )
                                );
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#11142B] text-white text-xs font-semibold rounded-lg cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5 text-[#35C5E8]" />
                              <span>Export Batch CSV</span>
                            </button>
                            {plan.allowPdfReports && (
                              <button
                                type="button"
                                onClick={() =>
                                  exportCustomerRiskPdf(company, activeModel, latestBatch)
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-purple-200 bg-white hover:bg-[#F5F3FF] text-[#11142B] text-xs font-semibold rounded-lg cursor-pointer"
                              >
                                <FileText className="w-3.5 h-3.5 text-[#E84FA8]" />
                                <span>Batch Risk PDF</span>
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          <div className="border border-slate-200 rounded-lg p-3.5 bg-[#F5F3FF]/40">
                            <div className="text-slate-500 font-semibold">High Risk (≥ 65%)</div>
                            <div className="font-mono text-xl font-bold text-[#9D2EC5] tabular-nums mt-1">
                              {latestBatch.highRiskCount.toLocaleString()}
                            </div>
                          </div>
                          <div className="border border-slate-200 rounded-lg p-3.5 bg-[#F5F3FF]/40">
                            <div className="text-slate-500 font-semibold">
                              Moderate Risk (35–64.9%)
                            </div>
                            <div className="font-mono text-xl font-bold text-[#7655E8] tabular-nums mt-1">
                              {latestBatch.moderateRiskCount.toLocaleString()}
                            </div>
                          </div>
                          <div className="border border-slate-200 rounded-lg p-3.5 bg-[#F5F3FF]/40">
                            <div className="text-slate-500 font-semibold">Low Risk (&lt; 35%)</div>
                            <div className="font-mono text-xl font-bold text-[#0C7D99] tabular-nums mt-1">
                              {latestBatch.lowRiskCount.toLocaleString()}
                            </div>
                          </div>
                        </div>

                        <div className="overflow-x-auto max-h-[300px] border border-slate-200 rounded-lg">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead className="sticky top-0 bg-[#F5F3FF] text-[10px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                              <tr>
                                <th className="py-2.5 px-3">Row</th>
                                <th className="py-2.5 px-3">{tmpl.entitySingular} ID</th>
                                <th className="py-2.5 px-3">Estimated Signal</th>
                                <th className="py-2.5 px-3 text-right">Probability</th>
                                <th className="py-2.5 px-3">Risk Classification</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {latestBatch.records.slice(0, 50).map((r) => (
                                <tr key={r.rowIndex}>
                                  <td className="py-2 px-3 font-mono text-slate-400">
                                    {r.rowIndex}
                                  </td>
                                  <td className="py-2 px-3 font-mono font-semibold text-[#11142B]">
                                    {r.customerId}
                                  </td>
                                  <td className="py-2 px-3 font-medium text-[#11142B]">
                                    {r.predictedChurn}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono font-bold tabular-nums">
                                    {(r.churnProbability * 100).toFixed(1)}%
                                  </td>
                                  <td className="py-2 px-3">{renderRiskDotLabel(r.riskCategory)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </section>

          {/* CUSTOMER PORTFOLIO LEDGER & EXPORT */}
          <section className="bg-white border border-slate-200/90 rounded-xl shadow-xs overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-200/80 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#7655E8]">
                  {tmpl.entitySingular.toUpperCase()} PORTFOLIO
                </div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-1">
                  <h2 className="font-display text-lg font-semibold text-[#11142B] tracking-tight">
                    Portfolio Risk Ledger
                  </h2>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">
                    {filteredPredictions.length.toLocaleString()} of{' '}
                    {activeModel.predictions.length.toLocaleString()} accounts · Click any row to
                    inspect
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchId}
                    onChange={(e) => setSearchId(e.target.value)}
                    placeholder="Search by Customer ID or Name..."
                    aria-label="Search by Customer ID or Name"
                    className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-[#F5F3FF]/45 text-[#11142B] w-36 focus:outline-none focus:border-[#7655E8]"
                  />
                </div>

                <select
                  value={splitFilter}
                  onChange={(e) =>
                    setSplitFilter(e.target.value as 'ALL' | 'Unseen Test' | 'Training')
                  }
                  className="rounded-lg border border-slate-200 bg-[#F5F3FF]/45 px-2.5 py-1.5 text-xs text-[#11142B] focus:outline-none focus:border-[#7655E8]"
                >
                  <option value="ALL">All Records ({activeModel.predictions.length})</option>
                  <option value="Unseen Test">Validation Sample ({activeModel.testCount})</option>
                  <option value="Training">Reference Sample ({activeModel.trainCount})</option>
                </select>

                <select
                  value={riskFilter}
                  onChange={(e) => setRiskFilter(e.target.value as 'ALL' | RiskCategory)}
                  className="rounded-lg border border-slate-200 bg-[#F5F3FF]/45 px-2.5 py-1.5 text-xs text-[#11142B] focus:outline-none focus:border-[#7655E8]"
                >
                  <option value="ALL">All Risk Tiers</option>
                  <option value="Higher Estimated Churn Risk">High Risk Only</option>
                  <option value="Moderate Estimated Churn Risk">Moderate Risk Only</option>
                  <option value="Low Estimated Churn Risk">Low Risk Only</option>
                </select>

                <button
                  type="button"
                  onClick={() => {
                    downloadProtectedCsv(
                      '/api/model/export-predictions',
                      'churn_predictions.csv'
                    ).catch((err: unknown) => {
                      setActionError(
                        err instanceof Error ? err.message : 'Failed to export predictions CSV.'
                      );
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#35C5E8]" />
                  <span>Export CSV</span>
                </button>

                {plan.allowPdfReports && (
                  <button
                    type="button"
                    onClick={() => exportCustomerRiskPdf(company, activeModel)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 border border-slate-200 bg-white hover:bg-[#F5F3FF] text-[#11142B] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#E84FA8]" />
                    <span>Risk PDF</span>
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto max-h-[460px]">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[#F5F3FF]/95 backdrop-blur-xs border-b border-slate-200 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="py-3 pl-6 pr-3">Row</th>
                    <th className="py-3 px-3 min-w-[200px] whitespace-nowrap">
                      {tmpl.entitySingular} ID / Customer Name
                    </th>
                    <th className="py-3 px-3">Sample Group</th>
                    <th className="py-3 px-3">Historical Status</th>
                    <th className="py-3 px-3">Predicted Signal</th>
                    <th className="py-3 px-3 text-right">Churn Probability</th>
                    <th className="py-3 pl-3 pr-6">Risk Classification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredPredictions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-500">
                        <div className="space-y-2">
                          <div>No customers found</div>
                          <button
                            type="button"
                            onClick={() => {
                              setSearchId('');
                              setRiskFilter('ALL');
                              setSplitFilter('ALL');
                            }}
                            className="text-xs font-semibold text-[#7655E8] hover:text-[#397BFF] cursor-pointer"
                          >
                            Reset Filters
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredPredictions.map((p) => {
                      const originalIdx = activeModel.predictions.findIndex(
                        (item) => item.rowIndex === p.rowIndex
                      );
                      const isSelected = originalIdx === selectedCustomerIdx;
                      const customerName = resolveCustomerName(p);
                      return (
                        <tr
                          key={p.rowIndex}
                          onClick={() => {
                            if (originalIdx >= 0) {
                              setSelectedCustomerIdx(originalIdx);
                              setInspectorMode('record');
                            }
                          }}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[#7655E8]/[0.07] border-l-2 border-l-[#7655E8]'
                              : 'hover:bg-[#F5F3FF]/60'
                          }`}
                        >
                          <td className="py-2.5 pl-6 pr-3 font-mono tabular-nums text-slate-400">
                            {p.rowIndex}
                          </td>
                          <td className="py-2.5 px-3 min-w-[200px]">
                            <div className="font-mono font-bold text-[#11142B] leading-tight">
                              {p.customerId}
                            </div>
                            <div
                              className={`font-sans text-[11px] leading-snug mt-0.5 truncate max-w-[240px] ${
                                customerName
                                  ? 'text-slate-500 font-normal'
                                  : 'text-slate-400 font-normal'
                              }`}
                              title={customerName || 'Name unavailable'}
                            >
                              {customerName || 'Name unavailable'}
                            </div>
                          </td>
                          <td
                            className={`py-2.5 px-3 font-medium ${
                              p.split === 'Unseen Test' ? 'text-[#397BFF]' : 'text-slate-500'
                            }`}
                          >
                            {p.split === 'Unseen Test' ? 'Validation Sample' : 'Reference Sample'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{p.actualChurn}</td>
                          <td
                            className={`py-2.5 px-3 font-semibold ${
                              p.predictedChurn === 'Likely to Churn'
                                ? 'text-[#9D2EC5]'
                                : 'text-[#0C7D99]'
                            }`}
                          >
                            {p.predictedChurn}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#11142B]">
                            {(p.churnProbability * 100).toFixed(1)}%
                          </td>
                          <td className="py-2.5 pl-3 pr-6">{renderRiskDotLabel(p.riskCategory)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </motion.div>
      )}
    </div>
  );
};
