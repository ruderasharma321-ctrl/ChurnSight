import React, { Suspense, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileText,
  Info,
  Play,
  Scale,
  SlidersHorizontal,
  Sparkles,
  Target,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CompanyWorkspaceInfo,
  DatasetState,
  MLModelType,
  ModelEvaluationResult,
  NavTab,
  PredictionPipelineStatus,
  SplitStrategy,
  TrainModelRequest,
} from '../types/churn';
import { getIndustryTemplate } from '../utils/industryConfig';
import { exportModelEvaluationPdf } from '../utils/reportExporter';
import { getSubscriptionPlanSpec } from '../utils/subscriptionPlans';
import { FeatureImportanceChart, ModelComparisonBarChart } from './Charts';
import { AnimatedNumber } from './PremiumUI';

const LazyPredictiveScene3D = React.lazy(() => import('./PredictiveScene3D'));

interface TechnicalWorkbenchViewProps {
  company: CompanyWorkspaceInfo;
  dataset: DatasetState | null;
  activeModel: ModelEvaluationResult | null;
  modelHistory: ModelEvaluationResult[];
  automationStatus: PredictionPipelineStatus | null;
  isTraining: boolean;
  canGeneratePredictions?: boolean;
  onTrainModel: (req: TrainModelRequest) => Promise<void>;
  onNavigate: (tab: NavTab) => void;
}

const TRAINING_STAGES = [
  'Imputing missing numeric & categorical values',
  'Encoding features & standardizing distributions',
  'Partitioning train & hold-out validation sets',
  'Fitting classifier & calibrating churn probabilities',
  'Computing evaluation metrics & portfolio risk scores',
];

export const TechnicalWorkbenchView: React.FC<TechnicalWorkbenchViewProps> = ({
  company,
  dataset,
  activeModel,
  modelHistory,
  automationStatus,
  isTraining,
  canGeneratePredictions = true,
  onTrainModel,
  onNavigate,
}) => {
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);
  const plan = getSubscriptionPlanSpec(company.subscriptionPlan);

  const [modelType, setModelType] = useState<MLModelType>(
    activeModel?.modelType || 'logistic_regression'
  );
  const [testSplitRatio, setTestSplitRatio] = useState<number>(activeModel?.testSplitRatio || 0.2);
  const [maxDepth, setMaxDepth] = useState<number>(4);
  const [splitStrategy, setSplitStrategy] = useState<SplitStrategy>(
    activeModel?.splitStrategy || 'stratified'
  );
  const [trainError, setTrainError] = useState<string | null>(null);
  const [showMethodology, setShowMethodology] = useState<boolean>(false);
  const [trainingStageIdx, setTrainingStageIdx] = useState<number>(0);
  const [headerTilt, setHeaderTilt] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    if (!dataset?.mapping.dateColumn && splitStrategy === 'chronological') {
      setSplitStrategy('stratified');
    }
  }, [dataset?.mapping.dateColumn, splitStrategy]);

  useEffect(() => {
    if (!isTraining) {
      setTrainingStageIdx(0);
      return;
    }
    const interval = window.setInterval(() => {
      setTrainingStageIdx((prev) => (prev < TRAINING_STAGES.length - 1 ? prev + 1 : prev));
    }, 360);
    return () => window.clearInterval(interval);
  }, [isTraining]);

  if (!dataset) {
    return (
      <div className="font-enterprise bg-[#11142B] text-white rounded-xl border border-white/10 p-8 sm:p-10 max-w-2xl mx-auto shadow-xl space-y-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#35C5E8]">
          ADVANCED TECHNICAL STUDIO
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white">
          Technical ML Studio
        </h1>
        <p className="text-sm text-slate-300 leading-relaxed">
          Import a dataset in Data Management before inspecting algorithms, hyperparameter
          controls, confusion matrices, or versioned training runs.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('data')}
          className="px-5 py-2.5 bg-[#7655E8] hover:bg-[#6645D9] text-white text-xs font-semibold uppercase tracking-[0.12em] rounded-lg transition-colors cursor-pointer"
        >
          Open Data Management
        </button>
      </div>
    );
  }

  const hasValidLabels = dataset.hasValidChurnLabels !== false;
  const canTrain = !isTraining && dataset.isValid && hasValidLabels && canGeneratePredictions;
  const canChronological = Boolean(dataset.mapping.dateColumn) && plan.allowChronologicalSplit;

  const handleTrain = async () => {
    setTrainError(null);
    try {
      await onTrainModel({
        modelType,
        testSplitRatio,
        maxDepth: modelType === 'decision_tree' || modelType === 'random_forest' ? maxDepth : undefined,
        nEstimators: modelType === 'random_forest' ? 25 : undefined,
        splitStrategy: canChronological ? splitStrategy : 'stratified',
      });
    } catch (err: unknown) {
      setTrainError(err instanceof Error ? err.message : 'Failed to build custom model version.');
    }
  };

  const formattedTrainedAt = activeModel?.trainedAt
    ? new Date(activeModel.trainedAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="font-enterprise space-y-6">
      {/* Header */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
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
              isTraining={isTraining}
              riskProbability={activeModel ? activeModel.f1Score / 100 : null}
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
              ADVANCED TECHNICAL AREA / {tmpl.label.toUpperCase()}
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-white leading-[1.12]">
              Technical ML Studio
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed max-w-xl">
              Inspect underlying algorithms, configure hold-out split validation and tree depth,
              audit target leakage checks, and compare versioned runs side by side.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onNavigate('predictions')}
                className="text-xs font-semibold text-[#35C5E8] hover:text-white transition-colors cursor-pointer"
              >
                Open Churn Predictions →
              </button>
              <button
                type="button"
                onClick={() => onNavigate('performance')}
                className="text-xs font-semibold text-indigo-200 hover:text-white transition-colors cursor-pointer"
              >
                Customer Model Performance →
              </button>
            </div>
          </div>

          <div className="lg:min-w-[340px] rounded-lg border border-white/15 bg-[#11142B]/85 px-5 py-4 space-y-3 shadow-lg">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                ACTIVE ARTIFACT
              </span>
              {isTraining ? (
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#35C5E8]">
                  <span className="w-2 h-2 rounded-full bg-[#35C5E8] animate-ping" />
                  <span>Building Version</span>
                </span>
              ) : activeModel ? (
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#35C5E8]">
                  <span className="w-2 h-2 rounded-full bg-[#35C5E8]" />
                  <span>
                    {activeModel.version} · {activeModel.splitStrategy || 'stratified'}
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  <span>No Active Model</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                  LAST BUILT
                </div>
                <div className="font-mono text-white font-medium mt-0.5 truncate">
                  {formattedTrainedAt ?? '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                  PIPELINE STATUS
                </div>
                <div className="font-mono text-white font-medium mt-0.5 truncate">
                  {automationStatus?.headline || (activeModel ? 'Predictions ready.' : 'Pending')}
                </div>
              </div>
              <div className="col-span-2 pt-1 border-t border-white/10 flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                  DATASET
                </span>
                <span className="font-mono text-[11px] text-slate-200 truncate">
                  {dataset.fileName} ({dataset.rowCount.toLocaleString()} rows)
                </span>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {!hasValidLabels && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs text-amber-950">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-sm">More Historical Data Required</div>
              <p className="leading-relaxed">
                {dataset.churnReadinessMessage ||
                  'A binary target churn column with both churned and retained historical outcomes is required before building supervised classification models.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('data')}
            className="px-4 py-2 bg-amber-900 text-white font-semibold rounded-lg shrink-0 cursor-pointer whitespace-nowrap"
          >
            Configure Mapping in Data Management
          </button>
        </div>
      )}

      {/* Algorithm & Parameter Overrides */}
      <section className="bg-white border border-slate-200/90 rounded-xl shadow-xs overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#7655E8]">
              MANUAL MODEL CONFIGURATION
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-1">
              <h2 className="font-display text-lg font-semibold text-[#11142B] tracking-tight">
                Algorithm, Split Strategy &amp; Hyperparameters
              </h2>
              <span className="text-xs text-slate-500">
                Override Managed prediction setup defaults to benchmark specific model configurations.
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowMethodology((prev) => !prev)}
            aria-expanded={showMethodology}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 hover:text-[#11142B] transition-colors cursor-pointer shrink-0"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#7655E8]" />
            <span>Technical Methodology</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                showMethodology ? 'rotate-180' : ''
              }`}
            />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200/80">
          <div className="md:col-span-3 p-5 space-y-2">
            <label
              htmlFor="tech-algorithm"
              className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500"
            >
              CLASSIFICATION ALGORITHM
            </label>
            <select
              id="tech-algorithm"
              value={modelType}
              onChange={(e) => setModelType(e.target.value as MLModelType)}
              className="w-full rounded-lg border border-slate-200 bg-[#F5F3FF]/45 px-3 py-2 text-xs font-medium text-[#11142B] focus:outline-none focus:border-[#7655E8]"
            >
              <option value="logistic_regression">Logistic Regression (L2)</option>
              <option value="decision_tree">CART Decision Tree (Gini)</option>
              <option
                value="random_forest"
                disabled={!plan.allowedModels.includes('random_forest')}
              >
                {plan.allowedModels.includes('random_forest')
                  ? 'Random Forest Ensemble (25 Trees)'
                  : 'Random Forest (Starter+ Required)'}
              </option>
            </select>
          </div>

          <div className="md:col-span-3 p-5 space-y-2">
            <label
              htmlFor="tech-split"
              className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500"
            >
              HOLD-OUT SPLIT RATIO
            </label>
            <select
              id="tech-split"
              value={testSplitRatio}
              onChange={(e) => setTestSplitRatio(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-200 bg-[#F5F3FF]/45 px-3 py-2 text-xs font-medium text-[#11142B] focus:outline-none focus:border-[#7655E8]"
            >
              <option value={0.2}>80% Training / 20% Testing</option>
              <option value={0.25}>75% Training / 25% Testing</option>
              <option value={0.3}>70% Training / 30% Testing</option>
            </select>
          </div>

          <div className="md:col-span-3 p-5 space-y-2">
            <label
              htmlFor="tech-split-strategy"
              className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500"
            >
              SPLIT VALIDATION STRATEGY
            </label>
            <select
              id="tech-split-strategy"
              value={canChronological ? splitStrategy : 'stratified'}
              onChange={(e) => setSplitStrategy(e.target.value as SplitStrategy)}
              className="w-full rounded-lg border border-slate-200 bg-[#F5F3FF]/45 px-3 py-2 text-xs font-medium text-[#11142B] focus:outline-none focus:border-[#7655E8]"
            >
              <option value="stratified">Stratified Random Split</option>
              <option value="chronological" disabled={!canChronological}>
                {dataset.mapping.dateColumn
                  ? plan.allowChronologicalSplit
                    ? `Chronological (${dataset.mapping.dateColumn})`
                    : 'Chronological (Starter+ Plan)'
                  : 'Chronological (Map Date Col First)'}
              </option>
            </select>
          </div>

          <div className="md:col-span-3 p-5 flex flex-col justify-between gap-3 bg-[#F5F3FF]/35">
            {modelType === 'decision_tree' || modelType === 'random_forest' ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  MAX DEPTH
                </span>
                <select
                  aria-label="Maximum Tree Depth"
                  value={maxDepth}
                  onChange={(e) => setMaxDepth(Number(e.target.value))}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-mono text-[#11142B]"
                >
                  <option value={3}>Depth 3</option>
                  <option value={4}>Depth 4</option>
                  <option value={5}>Depth 5</option>
                  <option value={6}>Depth 6</option>
                </select>
              </div>
            ) : (
              <div className="text-[11px] font-mono text-slate-500">
                {dataset.mapping.featureColumns.length} features · Target:{' '}
                {dataset.mapping.targetColumn || '—'}
              </div>
            )}

            <button
              type="button"
              onClick={handleTrain}
              disabled={!canTrain}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold uppercase tracking-[0.12em] rounded-lg border border-[#7655E8]/40 transition-all disabled:opacity-45 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 text-[#35C5E8]" />
              <span>{isTraining ? 'BUILDING...' : 'Build Custom Version'}</span>
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {showMethodology && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden border-t border-slate-200/80 bg-[#F5F3FF]/60"
            >
              <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-600 leading-relaxed">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#11142B] mb-1">
                    ALGORITHM SPECIFICATION
                  </div>
                  {modelType === 'logistic_regression' ? (
                    <p>
                      <strong className="text-[#11142B]">Logistic Regression (L2):</strong> Fits
                      regularized log-odds weights across standardized numeric attributes and
                      one-hot encoded categories, outputting calibrated churn probabilities.
                    </p>
                  ) : modelType === 'random_forest' ? (
                    <p>
                      <strong className="text-[#11142B]">Random Forest Ensemble (25 Trees):</strong>{' '}
                      Trains 25 bootstrap-aggregated decision trees with random feature subsampling
                      at each split and averages predicted probabilities across trees.
                    </p>
                  ) : (
                    <p>
                      <strong className="text-[#11142B]">CART Decision Tree (Gini):</strong>{' '}
                      Partitions customer records recursively by minimizing Gini impurity up to
                      depth {maxDepth}.
                    </p>
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#11142B] mb-1">
                    LEAKAGE GUARDRAILS &amp; SPLIT VALIDATION
                  </div>
                  <p>
                    Applies training-fold median/mode imputation, one-hot encoding, Z-score scaling,
                    and automatic target leakage detection (flagging post-churn columns or
                    &gt;0.96 target correlation).
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {(!canGeneratePredictions || trainError) && (
          <div className="px-6 py-3.5 border-t border-slate-200/80 space-y-2">
            {!canGeneratePredictions && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3.5 py-2.5 text-xs text-amber-900">
                <strong>Access Notice:</strong> Your Analyst role does not currently permit model
                execution.
              </div>
            )}
            {trainError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
                {trainError}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Live Training Progress */}
      {isTraining && (
        <section className="rounded-xl bg-[#11142B] text-white border border-[#7655E8]/35 p-6 space-y-4 shadow-lg">
          <div className="flex items-center justify-between gap-4">
            <div className="font-display text-base font-semibold">
              Building custom model version on {dataset.rowCount.toLocaleString()} records
            </div>
            <span className="font-mono text-xs text-[#35C5E8] tabular-nums">
              Stage {trainingStageIdx + 1} / {TRAINING_STAGES.length}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              style={{
                width: `${Math.min(100, ((trainingStageIdx + 1) / TRAINING_STAGES.length) * 100)}%`,
              }}
              className="h-full bg-gradient-to-r from-[#35C5E8] via-[#397BFF] to-[#7655E8] transition-all duration-300"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
            {TRAINING_STAGES.map((stage, idx) => (
              <div
                key={stage}
                className={`rounded-lg border px-3 py-2 text-[11px] ${
                  idx === trainingStageIdx
                    ? 'border-[#35C5E8]/60 bg-[#35C5E8]/10 text-white'
                    : idx < trainingStageIdx
                      ? 'border-[#7655E8]/40 bg-white/[0.04] text-slate-300'
                      : 'border-white/10 text-slate-500'
                }`}
              >
                {stage}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Technical Evaluation Detail when Active Model Exists */}
      {activeModel && !isTraining && (
        <>
          {activeModel.leakageWarnings && activeModel.leakageWarnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start gap-3 text-xs text-amber-950">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold">Target Leakage Audit Warnings ({activeModel.version})</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {activeModel.leakageWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[#15152F]">
                Technical Evaluation ({activeModel.modelName} · {activeModel.version})
              </h2>
              <p className="text-xs text-slate-500">
                Held-out test set ({activeModel.testCount} records,{' '}
                {Math.round(activeModel.testSplitRatio * 100)}%) ·{' '}
                {activeModel.splitStrategy === 'chronological'
                  ? `Chronological (${activeModel.dateColumnUsed})`
                  : 'Stratified Split'}
              </p>
            </div>
            {plan.allowPdfReports && (
              <button
                type="button"
                onClick={() => exportModelEvaluationPdf(company, activeModel)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#F6F3FF] text-[#15152F] border border-purple-200 text-xs font-semibold rounded-xl shadow-xs cursor-pointer self-start"
              >
                <FileText className="w-3.5 h-3.5 text-[#7655E8]" />
                <span>Technical Evaluation PDF</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-white border border-purple-100/90 rounded-2xl p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-[#7655E8]">
                <span>Test Accuracy</span>
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div className="text-3xl font-bold text-[#15152F] font-mono tabular-nums">
                <AnimatedNumber value={activeModel.accuracy} decimals={1} suffix="%" />
              </div>
              <p className="text-xs text-slate-500">Correct predictions on held-out test records.</p>
            </div>

            <div className="bg-white border border-purple-100/90 rounded-2xl p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-[#397BFF]">
                <span>Precision (Churn)</span>
                <Target className="w-4 h-4" />
              </div>
              <div className="text-3xl font-bold text-[#397BFF] font-mono tabular-nums">
                <AnimatedNumber value={activeModel.precision} decimals={1} suffix="%" />
              </div>
              <p className="text-xs text-slate-500">TP / (TP + FP) on flagged churn predictions.</p>
            </div>

            <div className="bg-white border border-purple-100/90 rounded-2xl p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-[#D63384]">
                <span>Recall (Sensitivity)</span>
                <Activity className="w-4 h-4" />
              </div>
              <div className="text-3xl font-bold text-[#D63384] font-mono tabular-nums">
                <AnimatedNumber value={activeModel.recall} decimals={1} suffix="%" />
              </div>
              <p className="text-xs text-slate-500">TP / (TP + FN) out of actual test churners.</p>
            </div>

            <div className="bg-white border border-purple-100/90 rounded-2xl p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-[#0E9F6E]">
                <span>F1-Score</span>
                <Scale className="w-4 h-4" />
              </div>
              <div className="text-3xl font-bold text-[#0E9F6E] font-mono tabular-nums">
                <AnimatedNumber value={activeModel.f1Score} decimals={1} suffix="%" />
              </div>
              <p className="text-xs text-slate-500">Harmonic mean of Precision and Recall.</p>
            </div>
          </div>

          {/* Class Imbalance Technical Note */}
          <div className="bg-[#397BFF]/8 border border-[#397BFF]/25 rounded-2xl p-4 flex items-start gap-3 text-xs text-[#15152F] leading-relaxed">
            <Info className="w-4 h-4 text-[#397BFF] shrink-0 mt-0.5" />
            <div>
              <strong>Class Imbalance &amp; Majority Baseline:</strong> Test split churn rate is{' '}
              <strong>{activeModel.testChurnRate.toFixed(1)}%</strong>. A naive majority-class
              classifier scores{' '}
              <strong className="font-mono">{activeModel.majorityBaselineAccuracy.toFixed(1)}%</strong>{' '}
              accuracy with <strong>0% Recall</strong>.
            </div>
          </div>

          {/* Confusion Matrix & Technical Feature Importances */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 bg-white border border-purple-100/90 rounded-2xl p-6 space-y-4">
              <div>
                <h3 className="text-base font-bold text-[#15152F]">Test Set Confusion Matrix</h3>
                <p className="text-xs text-slate-500">
                  TP / TN / FP / FN counts across {activeModel.testCount} held-out records
                </p>
              </div>
              <div className="space-y-2.5">
                <div className="grid grid-cols-12 gap-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 items-center">
                  <div className="col-span-2" />
                  <div className="col-span-5 text-center">Predicted: Stay</div>
                  <div className="col-span-5 text-center">Predicted: Churn</div>
                </div>
                <div className="grid grid-cols-12 gap-3 items-stretch">
                  <div className="col-span-2 flex items-center justify-end pr-1 text-right text-[11px] font-bold uppercase text-slate-500">
                    Actual: Stayed
                  </div>
                  <div className="col-span-5 border border-[#16C995]/40 bg-[#16C995]/10 rounded-xl p-4">
                    <div className="text-xs font-bold text-[#065F46]">True Negative (TN)</div>
                    <div className="mt-1 text-2xl font-bold text-[#15152F] font-mono tabular-nums">
                      {activeModel.confusionMatrix.tn}
                    </div>
                  </div>
                  <div className="col-span-5 border border-amber-200 bg-amber-50/75 rounded-xl p-4">
                    <div className="text-xs font-bold text-amber-800">False Positive (FP)</div>
                    <div className="mt-1 text-2xl font-bold text-[#15152F] font-mono tabular-nums">
                      {activeModel.confusionMatrix.fp}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-12 gap-3 items-stretch">
                  <div className="col-span-2 flex items-center justify-end pr-1 text-right text-[11px] font-bold uppercase text-slate-500">
                    Actual: Churned
                  </div>
                  <div className="col-span-5 border border-[#FF786B]/45 bg-[#FF786B]/10 rounded-xl p-4">
                    <div className="text-xs font-bold text-[#9A2E25]">False Negative (FN)</div>
                    <div className="mt-1 text-2xl font-bold text-[#15152F] font-mono tabular-nums">
                      {activeModel.confusionMatrix.fn}
                    </div>
                  </div>
                  <div className="col-span-5 border border-[#7655E8]/35 bg-[#7655E8]/10 rounded-xl p-4">
                    <div className="text-xs font-bold text-[#5B3AD6]">True Positive (TP)</div>
                    <div className="mt-1 text-2xl font-bold text-[#15152F] font-mono tabular-nums">
                      {activeModel.confusionMatrix.tp}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 bg-white border border-purple-100/90 rounded-2xl p-6 space-y-4">
              <div>
                <h3 className="text-base font-bold text-[#15152F]">
                  Encoded Feature Weights &amp; Importances
                </h3>
                <p className="text-xs text-slate-500">
                  {activeModel.modelType === 'logistic_regression'
                    ? 'Signed log-odds coefficients (β) and relative share (%) of total |β|'
                    : 'Relative share (%) of total Gini impurity reduction across splits'}
                </p>
              </div>
              <FeatureImportanceChart importances={activeModel.featureImportances} />
            </div>
          </div>

          {/* Majority-Class Baseline Comparison */}
          {activeModel.baselineMetrics && (
            <div className="bg-white border border-purple-100/90 rounded-2xl p-6 space-y-4">
              <h3 className="text-base font-bold text-[#15152F]">
                Baseline Model Comparison (Test Set)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-purple-100 text-xs font-semibold text-[#4C4A6E]">
                      <th className="py-2.5 pr-4">Model</th>
                      <th className="py-2.5 px-3 text-right">Accuracy</th>
                      <th className="py-2.5 px-3 text-right">Precision</th>
                      <th className="py-2.5 px-3 text-right">Recall</th>
                      <th className="py-2.5 pl-3 text-right">F1-Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-purple-50 text-sm">
                    <tr className="text-slate-600">
                      <td className="py-2.5 pr-4">
                        Majority-Class Baseline (Always &ldquo;
                        {activeModel.baselineMetrics.majorityClassLabel}&rdquo;)
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {activeModel.baselineMetrics.accuracy.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {activeModel.baselineMetrics.precision.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {activeModel.baselineMetrics.recall.toFixed(1)}%
                      </td>
                      <td className="py-2.5 pl-3 text-right font-mono tabular-nums">
                        {activeModel.baselineMetrics.f1Score.toFixed(1)}%
                      </td>
                    </tr>
                    <tr className="bg-[#F6F3FF]/80 font-semibold text-[#15152F]">
                      <td className="py-2.5 pr-4">
                        {activeModel.modelName} ({activeModel.version})
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {activeModel.accuracy.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#397BFF]">
                        {activeModel.precision.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#D63384]">
                        {activeModel.recall.toFixed(1)}%
                      </td>
                      <td className="py-2.5 pl-3 text-right font-mono tabular-nums font-bold text-[#7655E8]">
                        {activeModel.f1Score.toFixed(1)}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Versioned Model Comparison History */}
          {modelHistory.length > 0 && (
            <div className="bg-white border border-purple-100/90 rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-[#15152F]">
                    Versioned Model History ({modelHistory.length})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Side-by-side held-out test metrics across automated and custom builds
                  </p>
                </div>
                <Sparkles className="w-4 h-4 text-[#7655E8] shrink-0" />
              </div>

              {modelHistory.length > 1 && <ModelComparisonBarChart runs={modelHistory} />}

              <div className="overflow-x-auto pt-2 border-t border-purple-100">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-purple-100 text-xs font-semibold text-[#4C4A6E]">
                      <th className="py-2.5 pr-4">Version</th>
                      <th className="py-2.5 px-3">Algorithm</th>
                      <th className="py-2.5 px-3">Split Strategy</th>
                      <th className="py-2.5 px-3 text-right">Train / Test</th>
                      <th className="py-2.5 px-3 text-right">Accuracy</th>
                      <th className="py-2.5 px-3 text-right">Precision</th>
                      <th className="py-2.5 px-3 text-right">Recall</th>
                      <th className="py-2.5 pl-3 text-right">F1-Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-purple-50 text-sm">
                    {modelHistory.map((run) => (
                      <tr
                        key={run.modelId}
                        className={
                          run.modelId === activeModel.modelId ? 'bg-[#F6F3FF]/80 font-semibold' : ''
                        }
                      >
                        <td className="py-2.5 pr-4 font-mono text-xs font-bold text-[#7655E8]">
                          {run.version}
                          {run.modelId === activeModel.modelId ? ' · Active' : ''}
                        </td>
                        <td className="py-2.5 px-3 text-[#15152F]">{run.modelName}</td>
                        <td className="py-2.5 px-3 text-xs text-slate-600">
                          {run.splitStrategy || 'stratified'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-slate-600">
                          {run.trainCount} / {run.testCount}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {run.accuracy.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#397BFF]">
                          {run.precision.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#D63384]">
                          {run.recall.toFixed(1)}%
                        </td>
                        <td className="py-2.5 pl-3 text-right font-mono tabular-nums font-bold text-[#7655E8]">
                          {run.f1Score.toFixed(1)}%
                        </td>
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
  );
};
