import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import { NavTab, PredictionPipelineStatus } from '../types/churn';

interface PredictionPipelineBannerProps {
  automationStatus: PredictionPipelineStatus | null;
  isRunning?: boolean;
  canGeneratePredictions?: boolean;
  onAutoBuild?: () => void;
  onNavigate?: (tab: NavTab) => void;
  compact?: boolean;
}

const LIVE_PROGRESS_STEPS = [
  'Dataset uploaded.',
  'Data validation complete.',
  'Preparing customer data.',
  'Building prediction model.',
  'Checking prediction quality.',
];

export const PredictionPipelineBanner: React.FC<PredictionPipelineBannerProps> = ({
  automationStatus,
  isRunning = false,
  canGeneratePredictions = true,
  onAutoBuild,
  onNavigate,
  compact = false,
}) => {
  const [liveIdx, setLiveIdx] = useState(0);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    if (!isRunning) {
      setLiveIdx(0);
      return;
    }
    const timer = window.setInterval(() => {
      setLiveIdx((prev) => (prev < LIVE_PROGRESS_STEPS.length - 1 ? prev + 1 : prev));
    }, 320);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  if (isRunning) {
    return (
      <section
        aria-live="polite"
        className="rounded-2xl bg-[#11142B] text-white border border-[#7655E8]/40 p-5 sm:p-6 space-y-4 shadow-lg"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-[#35C5E8]">
              Prediction Setup
            </div>
            <h3 className="font-display text-base sm:text-lg font-bold text-white mt-0.5">
              {LIVE_PROGRESS_STEPS[liveIdx]}
            </h3>
          </div>
          <span className="font-mono text-xs text-indigo-200 tabular-nums">
            Step {liveIdx + 1} of {LIVE_PROGRESS_STEPS.length}
          </span>
        </div>

        <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
          <div
            style={{
              width: `${Math.min(100, ((liveIdx + 1) / LIVE_PROGRESS_STEPS.length) * 100)}%`,
            }}
            className="h-full bg-gradient-to-r from-[#35C5E8] via-[#397BFF] to-[#7655E8] transition-all duration-300"
          />
        </div>
      </section>
    );
  }

  if (!automationStatus) {
    return null;
  }

  const isReady =
    automationStatus.stage === 'predictions_ready' && automationStatus.predictionAvailable;
  const needsMoreData = automationStatus.stage === 'more_historical_data_required';
  const isFailed = automationStatus.stage === 'setup_failed';
  const isAutomaticLeakageRefresh = Boolean(
    automationStatus.refreshNotice &&
      /post-churn|post-outcome|target leakage/i.test(automationStatus.refreshNotice)
  );
  const showInlineRefreshNotice = Boolean(
    isReady &&
      automationStatus.needsRefresh &&
      automationStatus.refreshNotice &&
      !isAutomaticLeakageRefresh
  );

  return (
    <section
      className={`rounded-2xl border p-4 sm:p-5 space-y-3 shadow-sm ${
        isReady
          ? 'bg-white border-purple-100/90'
          : isFailed
            ? 'bg-rose-50/80 border-rose-200'
            : 'bg-amber-50/90 border-amber-200'
      }`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              isReady
                ? 'bg-[#16C995]/15 text-[#0E9F6E]'
                : isFailed
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-amber-100 text-amber-800'
            }`}
          >
            {isReady ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : isFailed ? (
              <XCircle className="w-5 h-5" />
            ) : (
              <AlertTriangle className="w-5 h-5" />
            )}
          </div>

          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <h3 className="font-display text-sm sm:text-base font-bold text-[#11142B]">
                {automationStatus.headline}
              </h3>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                  isReady
                    ? 'bg-[#16C995]/12 text-[#0E9F6E]'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {isReady ? 'Active' : 'Paused'}
              </span>
            </div>

            <p className="text-xs text-slate-600 max-w-3xl">
              {automationStatus.failureReason && !isReady
                ? automationStatus.failureReason
                : automationStatus.summary}
            </p>

            {automationStatus.recommendedAction && !isReady && (
              <p className="text-xs font-medium text-[#11142B] pt-0.5">
                Next: {automationStatus.recommendedAction}
              </p>
            )}

            {showInlineRefreshNotice && (
              <div className="mt-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-950">
                <strong>Update advised:</strong> {automationStatus.refreshNotice}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!isReady && onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('data')}
              className="px-3.5 py-2 rounded-xl border border-amber-300 bg-white hover:bg-amber-100/60 text-xs font-semibold text-[#11142B] transition-colors cursor-pointer whitespace-nowrap"
            >
              Review Data
            </button>
          )}

          {canGeneratePredictions && onAutoBuild && (needsMoreData || isFailed || (automationStatus.needsRefresh && !isAutomaticLeakageRefresh)) && (
            <button
              type="button"
              onClick={onAutoBuild}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#35C5E8]" />
              <span>
                {isReady ? 'Refresh Model' : 'Build Prediction Model'}
              </span>
            </button>
          )}

          {isReady && (!automationStatus.needsRefresh || isAutomaticLeakageRefresh) && canGeneratePredictions && onAutoBuild && !compact && (
            <button
              type="button"
              onClick={onAutoBuild}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-purple-200 bg-[#F5F3FF]/60 hover:bg-[#F5F3FF] text-xs font-semibold text-[#11142B] transition-colors cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#7655E8]" />
              <span>Refresh Model</span>
            </button>
          )}

          {onNavigate && !compact && (
            <button
              type="button"
              onClick={() => onNavigate('technical')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors cursor-pointer whitespace-nowrap"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#7655E8]" />
              <span>ML Studio</span>
            </button>
          )}

          {!compact && (automationStatus.steps.length > 0 || isAutomaticLeakageRefresh) && (
            <button
              type="button"
              onClick={() => setShowSteps((prev) => !prev)}
              className="text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] px-2 py-1 cursor-pointer whitespace-nowrap"
            >
              {showSteps ? 'Hide Details' : 'View Details'}
            </button>
          )}
        </div>
      </div>

      {!compact && showSteps && (automationStatus.steps.length > 0 || isAutomaticLeakageRefresh) && (
        <div className="space-y-2.5 pt-2.5 border-t border-slate-200/70">
          {isAutomaticLeakageRefresh && automationStatus.refreshNotice && (
            <div className="rounded-lg border border-purple-200/80 bg-[#F5F3FF]/60 px-3 py-2 text-xs text-slate-700">
              <strong className="text-[#11142B]">Target Leakage Protection: </strong>
              {automationStatus.refreshNotice}
            </div>
          )}
          {automationStatus.steps.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {automationStatus.steps.map((step) => {
                const done = step.status === 'completed';
                const warn = step.status === 'warning';
                const failed = step.status === 'failed';
                return (
                  <div
                    key={step.key}
                    title={step.detail}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-[#F5F3FF]/35 px-2.5 py-1.5 text-xs font-medium text-[#11142B]"
                  >
                    {done ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#0E9F6E] shrink-0" />
                    ) : failed ? (
                      <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    ) : warn ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                    <span>{step.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
