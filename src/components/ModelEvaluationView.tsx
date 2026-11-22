import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Info,
  RefreshCw,
  Scale,
  SlidersHorizontal,
  Target,
} from 'lucide-react';
import {
  CompanyWorkspaceInfo,
  ModelEvaluationResult,
  NavTab,
  PredictionPipelineStatus,
} from '../types/churn';
import { getIndustryTemplate } from '../utils/industryConfig';
import { exportCustomerRiskPdf, exportModelEvaluationPdf } from '../utils/reportExporter';
import { getSubscriptionPlanSpec } from '../utils/subscriptionPlans';
import { FeatureImportanceChart } from './Charts';
import { PredictionPipelineBanner } from './PredictionPipelineBanner';
import { AnimatedNumber } from './PremiumUI';

interface ModelEvaluationViewProps {
  company: CompanyWorkspaceInfo;
  activeModel: ModelEvaluationResult | null;
  automationStatus: PredictionPipelineStatus | null;
  isBuilding?: boolean;
  canGeneratePredictions?: boolean;
  onAutoBuild?: () => Promise<void>;
  onNavigate: (tab: NavTab) => void;
}

export const ModelEvaluationView: React.FC<ModelEvaluationViewProps> = ({
  company,
  activeModel,
  automationStatus,
  isBuilding = false,
  canGeneratePredictions = true,
  onAutoBuild,
  onNavigate,
}) => {
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);
  const plan = getSubscriptionPlanSpec(company.subscriptionPlan);

  const predictionsReady =
    Boolean(activeModel) && (automationStatus ? automationStatus.predictionAvailable : true);

  if (!predictionsReady || !activeModel) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#15152F] tracking-tight">Model Performance</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Prediction reliability, validation accuracy, and active model status
          </p>
        </div>

        {(automationStatus || isBuilding) && (
          <PredictionPipelineBanner
            automationStatus={automationStatus}
            isRunning={isBuilding}
            canGeneratePredictions={canGeneratePredictions}
            onAutoBuild={onAutoBuild}
            onNavigate={onNavigate}
          />
        )}

        <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-10 text-center max-w-xl mx-auto space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#7655E8] to-[#397BFF] text-white flex items-center justify-center mx-auto shadow-md shadow-[#7655E8]/25">
            <Target className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-[#15152F]">
            {automationStatus?.headline || 'Prediction Model Not Active Yet'}
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            {automationStatus?.failureReason ||
              'Import a customer dataset with historical churn outcomes in Data Management so Managed prediction setup can validate prediction quality and publish performance metrics.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => onNavigate('data')}
              className="px-5 py-2.5 bg-gradient-to-r from-[#7655E8] to-[#E84FA8] hover:opacity-95 text-white text-sm font-semibold rounded-xl shadow-sm shadow-[#7655E8]/25 cursor-pointer whitespace-nowrap"
            >
              Open Data Management
            </button>
            {canGeneratePredictions && onAutoBuild && (
              <button
                type="button"
                onClick={() => onAutoBuild()}
                className="px-5 py-2.5 bg-[#11142B] hover:bg-[#1C2147] text-white text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap"
              >
                Build prediction model
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { confusionMatrix: cm } = activeModel;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#15152F] tracking-tight">Model Performance</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Prediction availability: <strong className="text-[#0E9F6E]">Active</strong> (
            {activeModel.version}) · Checked on{' '}
            <span className="font-mono tabular-nums font-semibold text-[#7655E8]">
              {activeModel.testCount}
            </span>{' '}
            held-out {tmpl.entityPlural.toLowerCase()}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            disabled={!plan.allowPdfReports}
            onClick={() => exportModelEvaluationPdf(company, activeModel)}
            title={
              plan.allowPdfReports
                ? 'Export model performance PDF'
                : 'PDF exports require Starter plan or higher'
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#F6F3FF] text-[#15152F] border border-purple-200 text-xs font-semibold rounded-xl shadow-xs transition-colors disabled:opacity-45 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-[#7655E8]" />
            <span>{plan.allowPdfReports ? 'Performance PDF' : 'PDF (Starter+)'}</span>
          </button>
          <button
            type="button"
            disabled={!plan.allowPdfReports}
            onClick={() => exportCustomerRiskPdf(company, activeModel)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#F6F3FF] text-[#15152F] border border-purple-200 text-xs font-semibold rounded-xl shadow-xs transition-colors disabled:opacity-45 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-[#E84FA8]" />
            <span>Customer Risk PDF</span>
          </button>
          {canGeneratePredictions && onAutoBuild && (
            <button
              type="button"
              disabled={isBuilding}
              onClick={() => onAutoBuild()}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#35C5E8] ${isBuilding ? 'animate-spin' : ''}`} />
              <span>{isBuilding ? 'Refreshing...' : 'Refresh prediction model'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Outdated Model Notice */}
      {activeModel.isOutdated && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start justify-between gap-3 text-xs text-amber-950">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-bold">Outdated · Source dataset deleted</div>
              <p>
                {activeModel.outdatedReason ||
                  'The dataset used to train this model was deleted. Upload a dataset and refresh to update predictions.'}
              </p>
            </div>
          </div>
          {canGeneratePredictions && onAutoBuild && (
            <button
              type="button"
              disabled={isBuilding}
              onClick={() => onAutoBuild()}
              className="px-3 py-1.5 rounded-lg bg-amber-900 text-white font-semibold shrink-0 cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              Refresh Model
            </button>
          )}
        </div>
      )}

      {/* Refresh Advisory or Data Preparation Note */}
      {automationStatus?.needsRefresh && automationStatus.refreshNotice && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start gap-3 text-xs text-amber-950">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold">Model Refresh Advised</div>
            <p>{automationStatus.refreshNotice}</p>
          </div>
        </div>
      )}

      {activeModel.leakageWarnings && activeModel.leakageWarnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start gap-3 text-xs text-amber-950">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold">Data Quality &amp; Outcome Leakage Notice</div>
            <ul className="list-disc pl-4 space-y-0.5">
              {activeModel.leakageWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 4 Plain-Language Performance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 space-y-3 hover:-translate-y-0.5 transition-transform">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-[#7655E8]">Overall Reliability</div>
            <div className="w-8 h-8 rounded-xl bg-[#7655E8]/10 text-[#7655E8] flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-bold text-[#15152F] font-mono tabular-nums">
            <AnimatedNumber value={activeModel.accuracy} decimals={1} suffix="%" />
          </div>
          <div className="h-2 w-full bg-[#F6F3FF] rounded-full overflow-hidden">
            <div
              style={{ width: `${Math.min(100, Math.max(0, activeModel.accuracy))}%` }}
              className="h-full rounded-full bg-gradient-to-r from-[#7655E8] to-[#B84DE0] transition-all duration-500"
            />
          </div>
          <p className="text-xs text-slate-600">Unseen validation accuracy</p>
        </div>

        <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 space-y-3 hover:-translate-y-0.5 transition-transform">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-[#397BFF]">Flagged Account Accuracy</div>
            <div className="w-8 h-8 rounded-xl bg-[#397BFF]/10 text-[#397BFF] flex items-center justify-center">
              <Target className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-bold text-[#397BFF] font-mono tabular-nums">
            <AnimatedNumber value={activeModel.precision} decimals={1} suffix="%" />
          </div>
          <div className="h-2 w-full bg-[#F6F3FF] rounded-full overflow-hidden">
            <div
              style={{ width: `${Math.min(100, Math.max(0, activeModel.precision))}%` }}
              className="h-full rounded-full bg-gradient-to-r from-[#397BFF] to-[#7655E8] transition-all duration-500"
            />
          </div>
          <p className="text-xs text-slate-600">
            Precision on flagged at-risk {tmpl.entityPlural.toLowerCase()}
          </p>
        </div>

        <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 space-y-3 hover:-translate-y-0.5 transition-transform">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-[#D63384]">Churners Detected</div>
            <div className="w-8 h-8 rounded-xl bg-[#E84FA8]/12 text-[#D63384] flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-bold text-[#D63384] font-mono tabular-nums">
            <AnimatedNumber value={activeModel.recall} decimals={1} suffix="%" />
          </div>
          <div className="h-2 w-full bg-[#F6F3FF] rounded-full overflow-hidden">
            <div
              style={{ width: `${Math.min(100, Math.max(0, activeModel.recall))}%` }}
              className="h-full rounded-full bg-gradient-to-r from-[#E84FA8] to-[#FF786B] transition-all duration-500"
            />
          </div>
          <p className="text-xs text-slate-600">
            Share of actual churned {tmpl.entityPlural.toLowerCase()} detected
          </p>
        </div>

        <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 space-y-3 hover:-translate-y-0.5 transition-transform">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-[#0E9F6E]">Detection Balance</div>
            <div className="w-8 h-8 rounded-xl bg-[#16C995]/12 text-[#0E9F6E] flex items-center justify-center">
              <Scale className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-bold text-[#0E9F6E] font-mono tabular-nums">
            <AnimatedNumber value={activeModel.f1Score} decimals={1} suffix="%" />
          </div>
          <div className="h-2 w-full bg-[#F6F3FF] rounded-full overflow-hidden">
            <div
              style={{ width: `${Math.min(100, Math.max(0, activeModel.f1Score))}%` }}
              className="h-full rounded-full bg-gradient-to-r from-[#16C995] to-[#397BFF] transition-all duration-500"
            />
          </div>
          <p className="text-xs text-slate-600">F1 balance of precision and recall</p>
        </div>
      </div>

      {/* Baseline Comparison */}
      <div className="bg-[#397BFF]/8 border border-[#397BFF]/25 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs text-[#15152F]">
        <div className="flex items-center gap-3">
          <Info className="w-4 h-4 text-[#397BFF] shrink-0" />
          <div>
            <strong>Validation Check:</strong> Sample churn rate{' '}
            <span className="font-mono tabular-nums font-bold">
              {activeModel.testChurnRate.toFixed(1)}%
            </span>{' '}
            · Naive baseline{' '}
            <span className="font-mono tabular-nums font-bold">
              {activeModel.majorityBaselineAccuracy.toFixed(1)}%
            </span>{' '}
            (0% recall) vs. active model{' '}
            <span className="font-mono tabular-nums font-bold text-[#7655E8]">
              {activeModel.recall.toFixed(1)}% recall
            </span>
            .
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('technical')}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-purple-200 hover:bg-[#F5F3FF] text-xs font-semibold text-[#11142B] shrink-0 cursor-pointer whitespace-nowrap"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-[#7655E8]" />
          <span>Inspect in Technical Studio</span>
        </button>
      </div>

      {/* Customer Outcomes Breakdown & Top Retention Drivers */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
          <div>
            <h2 className="text-base font-bold text-[#15152F]">Validation Outcome Breakdown</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Predictions vs. real outcomes ({activeModel.testCount} held-out{' '}
              {tmpl.entityPlural.toLowerCase()})
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="border border-[#7655E8]/35 bg-[#7655E8]/8 rounded-xl p-4 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#5B3AD6]">Churners Caught Early</span>
                <span className="text-[11px] font-mono tabular-nums text-[#5B3AD6]/80">
                  {activeModel.testCount > 0
                    ? ((cm.tp / activeModel.testCount) * 100).toFixed(1)
                    : '0.0'}
                  %
                </span>
              </div>
              <div className="text-2xl font-bold text-[#15152F] font-mono tabular-nums">{cm.tp}</div>
              <p className="text-xs text-slate-600">Correctly flagged as high risk before leaving.</p>
            </div>

            <div className="border border-[#16C995]/40 bg-[#16C995]/10 rounded-xl p-4 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#065F46]">Retained Identified</span>
                <span className="text-[11px] font-mono tabular-nums text-[#065F46]/80">
                  {activeModel.testCount > 0
                    ? ((cm.tn / activeModel.testCount) * 100).toFixed(1)
                    : '0.0'}
                  %
                </span>
              </div>
              <div className="text-2xl font-bold text-[#15152F] font-mono tabular-nums">{cm.tn}</div>
              <p className="text-xs text-slate-600">Correctly identified as loyal / retained.</p>
            </div>

            <div className="border border-amber-200 bg-amber-50/75 rounded-xl p-4 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-800">Preventive Alerts</span>
                <span className="text-[11px] font-mono tabular-nums text-amber-800/80">
                  {activeModel.testCount > 0
                    ? ((cm.fp / activeModel.testCount) * 100).toFixed(1)
                    : '0.0'}
                  %
                </span>
              </div>
              <div className="text-2xl font-bold text-[#15152F] font-mono tabular-nums">{cm.fp}</div>
              <p className="text-xs text-slate-600">Flagged as at-risk, though they stayed.</p>
            </div>

            <div className="border border-[#FF786B]/45 bg-[#FF786B]/10 rounded-xl p-4 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#9A2E25]">Missed Departures</span>
                <span className="text-[11px] font-mono tabular-nums text-[#9A2E25]/80">
                  {activeModel.testCount > 0
                    ? ((cm.fn / activeModel.testCount) * 100).toFixed(1)
                    : '0.0'}
                  %
                </span>
              </div>
              <div className="text-2xl font-bold text-[#15152F] font-mono tabular-nums">{cm.fn}</div>
              <p className="text-xs text-slate-600">Churned without a prior risk alert.</p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
          <div>
            <h2 className="text-base font-bold text-[#15152F]">Strongest Churn Signals</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Customer attributes showing the strongest statistical link with retention or churn
            </p>
          </div>
          <FeatureImportanceChart importances={activeModel.featureImportances} />
        </div>
      </div>
    </div>
  );
};
