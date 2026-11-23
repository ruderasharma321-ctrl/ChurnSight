import React, { useMemo } from 'react';
import {
  ArrowRight,
  Cpu,
  Database,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import {
  AnalyticsSummary,
  CompanyWorkspaceInfo,
  DatasetState,
  ModelEvaluationResult,
  NavTab,
  PredictionPipelineStatus,
} from '../types/churn';
import { deriveCustomerIntelligence, InsightTone } from '../utils/churnIntelligence';
import {
  formatAttributeValue,
  formatDuration,
  formatReadableDate,
  getHumanReadableFieldLabel,
} from '../utils/formatters';
import { getIndustryTemplate } from '../utils/industryConfig';
import { PredictionPipelineBanner } from './PredictionPipelineBanner';

interface CustomerIntelligenceViewProps {
  company: CompanyWorkspaceInfo;
  dataset: DatasetState | null;
  analytics: AnalyticsSummary | null;
  activeModel: ModelEvaluationResult | null;
  automationStatus: PredictionPipelineStatus | null;
  isPipelineRunning?: boolean;
  canGeneratePredictions?: boolean;
  embedded?: boolean;
  onAutoBuild?: () => void;
  onNavigate: (tab: NavTab) => void;
}

const INSIGHT_TONE_STYLES: Record<
  InsightTone,
  { iconBg: string; statColor: string; barGradient: string; ringBorder: string }
> = {
  danger: {
    iconBg: 'bg-gradient-to-br from-[#FF786B] to-[#E84FA8]',
    statColor: 'text-[#D63384]',
    barGradient: 'from-[#FF786B] to-[#E84FA8]',
    ringBorder: 'hover:border-[#E84FA8]/40',
  },
  purple: {
    iconBg: 'bg-gradient-to-br from-[#7655E8] to-[#B84DE0]',
    statColor: 'text-[#7655E8]',
    barGradient: 'from-[#7655E8] to-[#B84DE0]',
    ringBorder: 'hover:border-[#7655E8]/40',
  },
  blue: {
    iconBg: 'bg-gradient-to-br from-[#397BFF] to-[#7655E8]',
    statColor: 'text-[#397BFF]',
    barGradient: 'from-[#397BFF] to-[#7655E8]',
    ringBorder: 'hover:border-[#397BFF]/40',
  },
  cyan: {
    iconBg: 'bg-gradient-to-br from-[#35C5E8] to-[#397BFF]',
    statColor: 'text-[#0284C7]',
    barGradient: 'from-[#35C5E8] to-[#397BFF]',
    ringBorder: 'hover:border-[#35C5E8]/45',
  },
  emerald: {
    iconBg: 'bg-gradient-to-br from-[#16C995] to-[#397BFF]',
    statColor: 'text-[#0E9F6E]',
    barGradient: 'from-[#16C995] to-[#397BFF]',
    ringBorder: 'hover:border-[#16C995]/45',
  },
};

export const CustomerIntelligenceView: React.FC<CustomerIntelligenceViewProps> = ({
  company,
  dataset,
  analytics,
  activeModel,
  automationStatus,
  isPipelineRunning = false,
  canGeneratePredictions = true,
  embedded = false,
  onAutoBuild,
  onNavigate,
}) => {
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);

  const fmtCtx = useMemo(() => ({ dataset, company }), [dataset, company]);

  const insights = useMemo(() => {
    if (!dataset || !analytics) return [];
    return deriveCustomerIntelligence(
      dataset,
      analytics,
      activeModel,
      company.industry,
      company.customIndustryName,
      company
    );
  }, [dataset, analytics, activeModel, company]);

  const highRiskAccounts = useMemo(() => {
    if (!activeModel) return [];
    return [...activeModel.predictions]
      .filter(
        (p) =>
          p.riskApplicable !== false &&
          p.actualStatus !== 'Churned' &&
          p.actualStatus !== 'Inconsistent' &&
          p.actualChurn !== 'Churned' &&
          p.riskCategory === 'Higher Estimated Churn Risk'
      )
      .sort((a, b) => b.churnProbability - a.churnProbability)
      .slice(0, 8);
  }, [activeModel]);

  if (!dataset || !analytics) {
    return (
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm p-10 text-center max-w-xl mx-auto space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#7655E8] to-[#397BFF] text-white flex items-center justify-center mx-auto shadow-md shadow-[#7655E8]/25">
          <Database className="w-6 h-6" />
        </div>
        <h2 className="font-display text-lg font-bold text-[#11142B]">
          Churn Pattern Discovery Awaits Data
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Upload your {tmpl.label.toLowerCase()} customer file or load a demonstration dataset in Data
          Management to uncover retention drivers and prioritized action insights.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('data')}
          className="px-5 py-2.5 bg-gradient-to-r from-[#7655E8] to-[#E84FA8] text-white text-sm font-semibold rounded-xl shadow-sm cursor-pointer"
        >
          Open Data Management
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-[#7655E8]">
              {tmpl.label} · Retention Insights
            </div>
            <h2 className="font-display text-2xl font-bold text-[#11142B] tracking-tight mt-0.5">
              Churn Patterns &amp; Retention Insights
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Attrition signals and retention priorities for {company.name}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('predictions')}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              <span>Open Churn Predictions</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#35C5E8]" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-[#F5F3FF] text-[#11142B] border border-purple-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              <span>Export Reports</span>
            </button>
          </div>
        </div>
      )}

      <PredictionPipelineBanner
        automationStatus={automationStatus}
        isRunning={isPipelineRunning}
        canGeneratePredictions={canGeneratePredictions}
        onAutoBuild={onAutoBuild}
        onNavigate={onNavigate}
        compact
      />

      {/* Verified Retention Intelligence Signals */}
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-[#11142B] via-[#211C59] to-[#4F257F] px-6 py-5 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-white/12 border border-white/25 flex items-center justify-center shrink-0">
              <Cpu className="w-5 h-5 text-[#35C5E8]" />
            </div>
            <div>
              <div className="text-xs font-semibold text-[#35C5E8]">
                Automated Pattern Discovery
              </div>
              <div className="font-display text-base font-bold">
                {tmpl.shortLabel} Retention Signals &amp; Playbooks
              </div>
            </div>
          </div>
          <div className="text-xs font-mono text-indigo-100/90">
            {insights.length} Verified Findings
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {insights.map((item) => {
            const tone = INSIGHT_TONE_STYLES[item.tone];
            return (
              <div
                key={item.id}
                className={`rounded-2xl border border-purple-100/90 bg-[#F5F3FF]/50 p-5 flex flex-col justify-between space-y-4 transition-all duration-200 hover:bg-white hover:shadow-md ${tone.ringBorder}`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-slate-500">
                        {item.category}
                      </div>
                      <h3 className="font-display text-sm font-bold text-[#11142B] mt-1 leading-snug">
                        {item.title}
                      </h3>
                    </div>
                    <div
                      className={`w-8 h-8 rounded-xl ${tone.iconBg} text-white flex items-center justify-center shrink-0`}
                    >
                      <TrendingUp className="w-4 h-4" />
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between gap-2 pt-1">
                    <span className="text-xs text-slate-500">{item.statLabel}</span>
                    <span className={`text-xl font-extrabold font-mono tabular-nums ${tone.statColor}`}>
                      {item.statValue}
                    </span>
                  </div>

                  <div className="h-2 w-full rounded-full bg-purple-100/80 overflow-hidden">
                    <div
                      style={{ width: `${item.meterPercent}%` }}
                      className={`h-full rounded-full bg-gradient-to-r ${tone.barGradient}`}
                    />
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">{item.explanation}</p>
                </div>

                <div className="pt-3 border-t border-purple-100/80 text-xs text-[#11142B] leading-relaxed">
                  <span className="font-bold text-[#7655E8]">Recommended Action: </span>
                  {item.recommendation}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Priority Retention Watchlist (when predictions are available) */}
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-[#11142B]">
              Priority Retention Watchlist
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeModel
                ? `Active high-risk ${tmpl.entityPlural.toLowerCase()} (already-churned accounts excluded)`
                : 'Populates automatically once predictions are ready'}
            </p>
          </div>
          {activeModel && (
            <button
              type="button"
              onClick={() => onNavigate('predictions')}
              className="text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer"
            >
              Inspect All {activeModel.predictions.length.toLocaleString()} Predictions →
            </button>
          )}
        </div>

        {activeModel && highRiskAccounts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-purple-100 text-slate-500 font-semibold">
                  <th className="py-2.5 pr-4">{tmpl.entitySingular} ID</th>
                  <th className="py-2.5 px-3">Actual Status</th>
                  <th className="py-2.5 px-3">Predicted Risk</th>
                  <th className="py-2.5 px-3">Key Attributes</th>
                  <th className="py-2.5 pl-3 text-right">Predicted Probability</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-purple-50">
                {highRiskAccounts.map((acct) => {
                  const previewAttrs = Object.entries(acct.attributes)
                    .slice(0, 3)
                    .map(
                      ([k, v]) =>
                        `${getHumanReadableFieldLabel(k, fmtCtx)}: ${formatAttributeValue(k, v, fmtCtx)}`
                    )
                    .join(' · ');
                  return (
                    <tr key={`${acct.rowIndex}-${acct.customerId}`} className="hover:bg-[#F5F3FF]/50">
                      <td className="py-2.5 pr-4 font-mono font-bold text-[#11142B]">
                        <div>{acct.customerId}</div>
                        {acct.customerName && (
                          <div className="text-[11px] font-sans font-normal text-slate-500">
                            {acct.customerName}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#059669]/10 text-[#059669] border border-[#059669]/25">
                          {acct.actualStatus || 'Active'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#EA580C]">
                        High Risk ({acct.predictedChurn})
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 truncate max-w-md">
                        {previewAttrs || '—'}
                      </td>
                      <td className="py-2.5 pl-3 text-right font-mono font-bold tabular-nums text-[#EA580C]">
                        {(acct.churnProbability * 100).toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : !activeModel &&
          analytics.behaviourMonitoring &&
          analytics.behaviourMonitoring.watchlistSample.length > 0 ? (
          <div className="space-y-3">
            <div className="text-xs text-slate-600">
              Showing cold-start behavioural watchlist signals (inactive / low-engagement accounts).{' '}
              <button
                type="button"
                onClick={() => onNavigate('data')}
                className="font-semibold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer"
              >
                Record observed outcomes in Data Management →
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-purple-100 text-slate-500 font-semibold">
                    <th className="py-2 pr-4">{tmpl.entitySingular} ID</th>
                    <th className="py-2 px-3">Last Activity</th>
                    <th className="py-2 px-3 text-right">Days Quiet</th>
                    <th className="py-2 px-3 text-right">Engagement</th>
                    <th className="py-2 pl-3">Signal Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-50">
                  {analytics.behaviourMonitoring.watchlistSample.map((item) => (
                    <tr key={`${item.rowIndex}-${item.customerId}`} className="hover:bg-[#F5F3FF]/50">
                      <td className="py-2 pr-4 font-mono font-bold text-[#11142B]">
                        {item.customerId}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-600">
                        {formatReadableDate(item.lastDate)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-[#D97706] font-semibold">
                        {item.daysSinceActivity !== null
                          ? formatDuration(item.daysSinceActivity, 'day')
                          : '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                        {formatAttributeValue(
                          dataset.mapping.frequencyColumn || 'engagement_score',
                          item.engagementValue,
                          fmtCtx
                        )}
                      </td>
                      <td className="py-2 pl-3 text-slate-600">{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-purple-200 bg-[#F5F3FF]/45 p-6 flex items-center gap-3 text-xs text-slate-600">
            <ShieldAlert className="w-5 h-5 text-[#7655E8] shrink-0" />
            <span>
              {activeModel
                ? `No ${tmpl.entityPlural.toLowerCase()} exceeded the 65% high-risk threshold in the latest evaluation.`
                : 'Prediction availability is currently paused. Confirm historical churn labels in Data Management to build your prediction model.'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
