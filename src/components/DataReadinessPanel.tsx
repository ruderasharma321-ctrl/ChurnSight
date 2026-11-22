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
    <section className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-6">
      {/* Header & Overall Readiness Score */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-purple-100 pb-5">
        <div className="space-y-1.5 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-[#7655E8]">Data Readiness Centre</span>
            <span
              className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-lg border ${tierTone}`}
            >
              {readiness.overallLabel}
            </span>
          </div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-[#15152F]">
            Readiness Assessment &amp; Prediction Eligibility
          </h2>
          <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">
            {readiness.explanation}
          </p>
        </div>

        <div className="flex items-center gap-4 bg-[#F5F3FF] border border-purple-200/80 rounded-2xl px-5 py-3.5 shrink-0 self-start lg:self-auto">
          <div>
            <div className="text-[11px] font-semibold text-[#4C4A6E]">Data Readiness Score</div>
            <div className="text-2xl font-extrabold font-mono tabular-nums text-[#11142B]">
              {readiness.readinessScore}
              <span className="text-sm font-semibold text-slate-400"> / 100</span>
            </div>
          </div>
          <div className="w-24 space-y-1.5">
            <div className="h-2.5 w-full rounded-full bg-purple-100 overflow-hidden">
              <div
                style={{ width: `${readiness.readinessScore}%` }}
                className={`h-full rounded-full bg-gradient-to-r ${scoreBarColor} transition-all duration-500`}
              />
            </div>
            <div className="text-[10px] font-mono text-slate-500 text-right tabular-nums">
              {readiness.datasetProfile.labeledRows} labeled / {readiness.datasetProfile.totalRows} rows
            </div>
          </div>
        </div>
      </div>

      {/* Class Imbalance & Target Leakage Safeguard Alerts */}
      {readiness.datasetProfile.classImbalanceWarning && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-950">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">Class Imbalance Warning</div>
            <p className="mt-0.5 leading-relaxed">
              {readiness.datasetProfile.classImbalanceWarning}
            </p>
          </div>
        </div>
      )}

      {readiness.datasetProfile.leakageColumnsExcluded &&
        readiness.datasetProfile.leakageColumnsExcluded.length > 0 && (
          <div className="bg-[#F5F3FF] border border-purple-200 rounded-xl p-4 flex items-start gap-3 text-xs text-[#15152F]">
            <Info className="w-4 h-4 text-[#7655E8] shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Target Leakage Protection Active</div>
              <p className="mt-0.5 leading-relaxed">
                Post-outcome date or leakage columns (
                <span className="font-mono font-semibold text-[#5B3AD6]">
                  {readiness.datasetProfile.leakageColumnsExcluded.join(', ')}
                </span>
                ) are retained for reporting and automatically excluded from predictive ML features.
              </p>
            </div>
          </div>
        )}

      {/* 4 Readiness Outcomes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* 1. Analytics Ready */}
        <div className="rounded-xl border border-purple-100 bg-[#F5F3FF]/35 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#7655E8]" />
              <span className="text-xs font-bold text-[#11142B]">Analytics Ready</span>
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
          <p className="text-xs text-slate-600 leading-relaxed">
            {readiness.analyticsReady.summary}
          </p>
          {readiness.analyticsReady.availableVisuals.length > 0 && (
            <div className="text-[11px] font-mono text-slate-500 pt-1 border-t border-purple-100/80">
              Visuals: {readiness.analyticsReady.availableVisuals.join(', ')}
            </div>
          )}
        </div>

        {/* 2. Behaviour Monitoring Ready */}
        <div className="rounded-xl border border-purple-100 bg-[#F5F3FF]/35 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#397BFF]" />
              <span className="text-xs font-bold text-[#11142B]">Behaviour Monitoring</span>
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
          <p className="text-xs text-slate-600 leading-relaxed">
            {readiness.behaviourMonitoringReady.summary}
          </p>
          {readiness.behaviourMonitoringReady.trackedSignals.length > 0 && (
            <div className="text-[11px] font-mono text-slate-500 pt-1 border-t border-purple-100/80">
              Signals: {readiness.behaviourMonitoringReady.trackedSignals.join(', ')}
            </div>
          )}
        </div>

        {/* 3. Prediction Ready */}
        <div className="rounded-xl border border-purple-100 bg-[#F5F3FF]/35 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-4 h-4 text-[#E84FA8]" />
              <span className="text-xs font-bold text-[#11142B]">Prediction Ready</span>
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
              ? `Eligible (${readiness.predictionReady.recommendedValidationStrategy} split)`
              : 'Paused — Labels / Hygiene Needed'}
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            {readiness.predictionReady.summary}
          </p>
          <div className="text-[11px] font-mono text-slate-500 pt-1 border-t border-purple-100/80">
            Validation: {readiness.predictionReady.recommendedValidationStrategy}
          </div>
        </div>

        {/* 4. More Data Required */}
        <div
          className={`rounded-xl border p-4 space-y-2.5 ${
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
              <span className="text-xs font-bold text-[#11142B]">More Data Required</span>
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
            <p className="text-xs text-[#065F46] leading-relaxed">
              Minimum sample size, two-class churn balance, and schema hygiene satisfy supervised ML
              modelling thresholds.
            </p>
          )}
        </div>
      </div>

      {/* Weighted Score Breakdown & Statistical Validation Rationale */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 border border-purple-100 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-[#11142B]">Weighted Readiness Factors</h3>
            <span className="text-[11px] font-mono text-slate-500 tabular-nums">
              {readiness.datasetProfile.churnedCount} churned · {readiness.datasetProfile.retainedCount} retained · {readiness.datasetProfile.usableFeatureCount} features
            </span>
          </div>

          <div className="space-y-2.5">
            {readiness.scoreBreakdown.map((factor) => {
              const pct = factor.maxScore > 0 ? Math.round((factor.score / factor.maxScore) * 100) : 0;
              return (
                <div key={factor.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#11142B]">{factor.label}</span>
                    <span className="font-mono tabular-nums font-bold text-[#7655E8]">
                      {factor.score} / {factor.maxScore}
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
                Cross-Company Baseline: {privacy.optInCrossCompanyBaseline ? 'Opted-In (Awaiting Validated Industry Weights)' : 'Private Workspace Only (Opt-Out Default)'}
              </div>
              <p className="leading-snug">
                Cross-company pre-trained weights are{' '}
                <span className="font-mono">{privacy.crossCompanyValidationStatus}</span>; no
                external weights are substituted when company labels are insufficient.
              </p>
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('settings')}
                  className="font-semibold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer"
                >
                  Review Privacy Governance →
                </button>
              )}
            </div>
          </div>
        </div>
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
                Record Observed {tmpl.entitySingular} Outcome (Cold-Start Outcome Tracking)
              </h3>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Record confirmed Churned or Retained outcomes over time. ChurnSight updates readiness
                live and automatically builds your prediction model once both classes reach statistical
                validity.
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
