import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Info,
  Lock,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  AnalyticsSummary,
  CompanyWorkspaceInfo,
  DatasetState,
  NavTab,
} from '../types/churn';
import { buildDefaultPrivacySettings, getIndustryTemplate } from '../utils/industryConfig';

interface DataReadinessPanelProps {
  company: CompanyWorkspaceInfo;
  dataset: DatasetState;
  analytics: AnalyticsSummary | null;
  canUploadAndAnalyse?: boolean;
  onRecordOutcome?: (
    updates: { customerId: string; outcome: 'Churned' | 'Retained' }[]
  ) => Promise<void>;
  onNavigate?: (tab: NavTab) => void;
}

export const DataReadinessPanel: React.FC<DataReadinessPanelProps> = ({
  company,
  dataset,
  analytics,
  canUploadAndAnalyse = true,
  onRecordOutcome,
  onNavigate,
}) => {
  const readiness = dataset.readiness;
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);
  const privacy = company.privacySettings || buildDefaultPrivacySettings();

  const watchlistCandidates = useMemo(() => {
    const fromWatchlist = (analytics?.behaviourMonitoring?.watchlistSample || []).map(
      (item) => item.customerId
    );
    if (fromWatchlist.length > 0) return Array.from(new Set(fromWatchlist));
    const idCol = dataset.mapping.idColumn;
    if (!idCol) return [];
    return Array.from(
      new Set(
        dataset.previewRows
          .map((r) => (r[idCol] || '').trim())
          .filter(Boolean)
      )
    );
  }, [analytics, dataset]);

  const [customerIdInput, setCustomerIdInput] = useState(watchlistCandidates[0] || '');
  const [outcomeChoice, setOutcomeChoice] = useState<'Churned' | 'Retained'>('Churned');
  const [isRecording, setIsRecording] = useState(false);
  const [recordFeedback, setRecordFeedback] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);

  if (!readiness) {
    return null;
  }

  const handleRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onRecordOutcome) return;
    const trimmed = customerIdInput.trim();
    if (!trimmed) {
      setRecordError(`Enter a ${tmpl.entitySingular} ID to record an observed outcome.`);
      return;
    }
    setRecordError(null);
    setRecordFeedback(null);
    setIsRecording(true);
    try {
      await onRecordOutcome([{ customerId: trimmed, outcome: outcomeChoice }]);
      setRecordFeedback(
        `Recorded "${outcomeChoice}" for ${tmpl.entitySingular} "${trimmed}" and refreshed readiness & model eligibility.`
      );
      setCustomerIdInput('');
    } catch (err: unknown) {
      setRecordError(err instanceof Error ? err.message : 'Unable to record outcome.');
    } finally {
      setIsRecording(false);
    }
  };

  const tierTone =
    readiness.overallStatus === 'prediction_ready'
      ? 'border-[#16C995]/40 bg-[#16C995]/10 text-[#065F46]'
      : readiness.overallStatus === 'behaviour_monitoring_ready'
        ? 'border-[#397BFF]/35 bg-[#397BFF]/10 text-[#1E40AF]'
        : readiness.overallStatus === 'analytics_ready'
          ? 'border-[#7655E8]/35 bg-[#7655E8]/10 text-[#5B3AD6]'
          : 'border-amber-300 bg-amber-50 text-amber-900';

  const scoreBarColor =
    readiness.readinessScore >= 75
      ? 'from-[#16C995] to-[#397BFF]'
      : readiness.readinessScore >= 50
        ? 'from-[#397BFF] to-[#7655E8]'
        : 'from-[#D97706] to-[#E84FA8]';

  return (
    <section className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 sm:p-6 space-y-5">
      {/* Header & Overall Readiness Score */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-purple-100 pb-4">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-base sm:text-lg font-bold text-[#15152F]">
              Data Readiness
            </h2>
            <span
              className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-lg border ${tierTone}`}
            >
              {readiness.overallLabel}
            </span>
          </div>
          <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
            {readiness.explanation}
          </p>
        </div>

        <div className="flex items-center gap-4 bg-[#F5F3FF] border border-purple-200/80 rounded-2xl px-4 py-3 shrink-0 self-start lg:self-auto">
          <div>
            <div className="text-[11px] font-semibold text-[#4C4A6E]">Readiness Score</div>
            <div className="text-2xl font-extrabold font-mono tabular-nums text-[#11142B]">
              {readiness.readinessScore}
              <span className="text-sm font-semibold text-slate-400">/100</span>
            </div>
          </div>
          <div className="w-24 space-y-1">
            <div className="h-2 w-full rounded-full bg-purple-100 overflow-hidden">
              <div
                style={{ width: `${readiness.readinessScore}%` }}
                className={`h-full rounded-full bg-gradient-to-r ${scoreBarColor} transition-all duration-500`}
              />
            </div>
            <div className="text-[10px] font-mono text-slate-500 text-right tabular-nums">
              {readiness.datasetProfile.labeledRows}/{readiness.datasetProfile.totalRows} labeled
            </div>
          </div>
        </div>
      </div>

      {/* Key Warnings Only (if any) */}
      {readiness.datasetProfile.classImbalanceWarning && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-start gap-2.5 text-xs text-amber-950">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Class Imbalance: </span>
            {readiness.datasetProfile.classImbalanceWarning}
          </div>
        </div>
      )}

      {/* Summary & Details Toggle */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 font-mono">
            <span>{readiness.datasetProfile.churnedCount} churned</span>
            <span>{readiness.datasetProfile.retainedCount} retained</span>
            <span>{readiness.datasetProfile.usableFeatureCount} features</span>
          </div>
          <button
            type="button"
            onClick={() => setShowScoreBreakdown((prev) => !prev)}
            className="text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer"
          >
            {showScoreBreakdown ? 'Hide Details' : 'View Details'}
          </button>
        </div>

        {showScoreBreakdown && (
          <div className="space-y-4 pt-2 border-t border-purple-100">
            {readiness.datasetProfile.leakageColumnsExcluded &&
              readiness.datasetProfile.leakageColumnsExcluded.length > 0 && (
                <div className="bg-[#F5F3FF] border border-purple-200 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-[#15152F]">
                  <Info className="w-4 h-4 text-[#7655E8] shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Target Leakage Protection: </span>
                    Post-outcome columns (
                    <span className="font-mono font-semibold text-[#5B3AD6]">
                      {readiness.datasetProfile.leakageColumnsExcluded.join(', ')}
                    </span>
                    ) are excluded from model training features.
                  </div>
                </div>
              )}

            {/* 4 Readiness Outcomes Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5">
              <div className="rounded-xl border border-purple-100 bg-[#F5F3FF]/35 p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-[#7655E8]" />
                    <span className="text-xs font-bold text-[#11142B]">Analytics</span>
                  </div>
                  {readiness.analyticsReady.ready ? (
                    <CheckCircle2 className="w-4 h-4 text-[#16C995] shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0" />
                  )}
                </div>
                <div className="text-[11px] font-mono font-semibold text-[#5B3AD6]">
                  {readiness.analyticsReady.ready ? 'Ready' : 'Needs Structure'} ({readiness.analyticsReady.score}/100)
                </div>
                <p className="text-xs text-slate-600 leading-snug">
                  {readiness.analyticsReady.summary}
                </p>
              </div>

              <div className="rounded-xl border border-purple-100 bg-[#F5F3FF]/35 p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[#397BFF]" />
                    <span className="text-xs font-bold text-[#11142B]">Behaviour</span>
                  </div>
                  {readiness.behaviourMonitoringReady.ready ? (
                    <CheckCircle2 className="w-4 h-4 text-[#16C995] shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                </div>
                <div className="text-[11px] font-mono font-semibold text-[#397BFF]">
                  {readiness.behaviourMonitoringReady.ready
                    ? `Active · ${readiness.behaviourMonitoringReady.inactivityWatchlistCount} watchlist`
                    : 'Add Date / Usage Fields'}
                </div>
                <p className="text-xs text-slate-600 leading-snug">
                  {readiness.behaviourMonitoringReady.summary}
                </p>
              </div>

              <div className="rounded-xl border border-purple-100 bg-[#F5F3FF]/35 p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BrainCircuit className="w-4 h-4 text-[#E84FA8]" />
                    <span className="text-xs font-bold text-[#11142B]">Predictions</span>
                  </div>
                  {readiness.predictionReady.ready ? (
                    <CheckCircle2 className="w-4 h-4 text-[#16C995] shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0" />
                  )}
                </div>
                <div
                  className={`text-[11px] font-mono font-semibold ${
                    readiness.predictionReady.ready ? 'text-[#0E9F6E]' : 'text-[#D97706]'
                  }`}
                >
                  {readiness.predictionReady.ready
                    ? `Ready (${readiness.predictionReady.recommendedValidationStrategy})`
                    : 'Labels Needed'}
                </div>
                <p className="text-xs text-slate-600 leading-snug">
                  {readiness.predictionReady.summary}
                </p>
              </div>

              <div
                className={`rounded-xl border p-3.5 space-y-2 ${
                  readiness.moreDataRequired.needed
                    ? 'border-amber-200 bg-amber-50/70'
                    : 'border-[#16C995]/30 bg-[#16C995]/5'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck
                      className={`w-4 h-4 ${
                        readiness.moreDataRequired.needed ? 'text-[#D97706]' : 'text-[#16C995]'
                      }`}
                    />
                    <span className="text-xs font-bold text-[#11142B]">Requirements</span>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-[#11142B]">
                    {readiness.moreDataRequired.needed
                      ? `${readiness.moreDataRequired.missingItems.length} item(s)`
                      : 'Complete'}
                  </span>
                </div>
                {readiness.moreDataRequired.needed ? (
                  <ul className="text-xs text-amber-950 space-y-1 list-disc pl-4 leading-snug">
                    {readiness.moreDataRequired.missingItems.slice(0, 3).map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[#065F46] leading-snug">
                    Sample size, class balance, and schema hygiene pass requirements.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-7 border border-purple-100 rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-bold text-[#11142B]">Readiness Score Factors</h3>
                <div className="space-y-2.5">
                  {readiness.scoreBreakdown.map((factor) => {
                    const pct = factor.maxScore > 0 ? Math.round((factor.score / factor.maxScore) * 100) : 0;
                    return (
                      <div key={factor.label} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#11142B]">{factor.label}</span>
                          <span className="font-mono tabular-nums font-bold text-[#7655E8]">
                            {factor.score}/{factor.maxScore}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-purple-100 overflow-hidden">
                          <div
                            style={{ width: `${pct}%` }}
                            className="h-full rounded-full bg-gradient-to-r from-[#7655E8] to-[#397BFF]"
                          />
                        </div>
                        <div className="text-[11px] text-slate-500">{factor.note}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="lg:col-span-5 border border-purple-100 rounded-xl p-4 flex flex-col justify-between space-y-4">
                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold text-[#11142B]">
                    Validation Strategy &amp; Next Actions
                  </h3>
                  <div className="bg-[#F5F3FF] border border-purple-200/70 rounded-lg p-3 text-xs text-[#15152F] space-y-1">
                    <div className="font-semibold text-[#5B3AD6]">
                      Recommended Split: {readiness.predictionReady.recommendedValidationStrategy}
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {readiness.predictionReady.validationStrategyReason}
                    </p>
                  </div>

                  {readiness.nextActions.length > 0 && (
                    <ul className="space-y-1.5 text-xs text-slate-700">
                      {readiness.nextActions.map((act, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <Sparkles className="w-3.5 h-3.5 text-[#7655E8] shrink-0 mt-0.5" />
                          <span>{act}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="pt-3 border-t border-purple-100 flex items-start gap-2.5 text-[11px] text-slate-600">
                  {privacy.optInCrossCompanyBaseline ? (
                    <ShieldCheck className="w-4 h-4 text-[#16C995] shrink-0 mt-0.5" />
                  ) : (
                    <Lock className="w-4 h-4 text-[#7655E8] shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1">
                    <div className="font-semibold text-[#11142B]">
                      Cross-Company Baseline:{' '}
                      {privacy.optInCrossCompanyBaseline
                        ? 'Opted-In'
                        : 'Private Workspace Only'}
                    </div>
                    {onNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate('settings')}
                        className="font-semibold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer"
                      >
                        Review Privacy Settings →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Longitudinal Cold-Start Outcome Recorder */}
      {canUploadAndAnalyse && onRecordOutcome && (
        <form
          onSubmit={handleRecordSubmit}
          className="rounded-xl border border-purple-200/80 bg-[#F5F3FF]/50 p-4 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-[#11142B]">
                Record Observed {tmpl.entitySingular} Outcome
              </h3>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Log confirmed Churned or Retained outcomes to update readiness automatically.
              </p>
            </div>
            <span className="text-[11px] font-mono text-[#7655E8] font-semibold shrink-0">
              {readiness.datasetProfile.churnedCount} Churned / {readiness.datasetProfile.retainedCount} Retained
            </span>
          </div>

          {recordError && (
            <div className="text-xs text-[#9A2E25] bg-[#FF786B]/12 border border-[#FF786B]/40 rounded-lg px-3 py-2">
              {recordError}
            </div>
          )}
          {recordFeedback && (
            <div className="text-xs text-[#065F46] bg-[#16C995]/12 border border-[#16C995]/35 rounded-lg px-3 py-2">
              {recordFeedback}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-5">
              <label className="block text-[11px] font-semibold text-[#4C4A6E] mb-1">
                {tmpl.entitySingular} ID
              </label>
              <input
                type="text"
                list="readiness-customer-ids"
                value={customerIdInput}
                onChange={(e) => setCustomerIdInput(e.target.value)}
                placeholder={watchlistCandidates[0] || `Enter ${tmpl.entitySingular} ID`}
                className="w-full rounded-xl border border-purple-200 bg-white px-3 py-2 text-xs font-mono text-[#11142B] focus:outline-none focus:border-[#7655E8]"
              />
              {watchlistCandidates.length > 0 && (
                <datalist id="readiness-customer-ids">
                  {watchlistCandidates.slice(0, 25).map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
              )}
            </div>

            <div className="sm:col-span-4">
              <label className="block text-[11px] font-semibold text-[#4C4A6E] mb-1">
                Observed Outcome
              </label>
              <select
                value={outcomeChoice}
                onChange={(e) => setOutcomeChoice(e.target.value as 'Churned' | 'Retained')}
                className="w-full rounded-xl border border-purple-200 bg-white px-3 py-2 text-xs font-semibold text-[#11142B]"
              >
                <option value="Churned">Churned (Confirmed Exit / Non-Renewal)</option>
                <option value="Retained">Retained (Confirmed Active / Renewed)</option>
              </select>
            </div>

            <div className="sm:col-span-3">
              <button
                type="submit"
                disabled={isRecording}
                className="w-full px-4 py-2 bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {isRecording ? 'Recording...' : 'Record Outcome'}
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
};
