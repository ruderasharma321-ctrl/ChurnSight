import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Database,
  Download,
  FileText,
  Gem,
  ShieldAlert,
  TrendingUp,
  Upload,
  Users,
} from 'lucide-react';
import {
  AnalyticsSummary,
  CompanyWorkspaceInfo,
  CustomerValueSummary,
  DatasetState,
  ModelEvaluationResult,
  NavTab,
  PredictionPipelineStatus,
} from '../types/churn';
import { apiFetch } from '../utils/apiClient';
import { deriveCustomerIntelligence } from '../utils/churnIntelligence';
import { formatCurrencyUSD, getHumanReadableFieldLabel } from '../utils/formatters';
import { getIndustryTemplate } from '../utils/industryConfig';
import { exportChurnSummaryCsv, exportChurnSummaryPdf } from '../utils/reportExporter';
import { getSubscriptionPlanSpec } from '../utils/subscriptionPlans';
import {
  AverageChargesBarChart,
  ChurnDoughnutChart,
  GroupedChurnBarChart,
  TenureTrendLineChart,
} from './Charts';
import { CustomerDirectorySection } from './CustomerDirectorySection';
import { PredictionPipelineBanner } from './PredictionPipelineBanner';
import { HeroArtwork, TiltKpiCard } from './PremiumUI';

export type { NavTab };

interface DashboardViewProps {
  company: CompanyWorkspaceInfo;
  dataset: DatasetState | null;
  analytics: AnalyticsSummary | null;
  activeModel: ModelEvaluationResult | null;
  automationStatus: PredictionPipelineStatus | null;
  isLoading: boolean;
  isPipelineRunning?: boolean;
  canUploadAndAnalyse?: boolean;
  canGeneratePredictions?: boolean;
  onLoadSample: () => void;
  onAutoBuild?: () => void;
  onWorkspaceMutated?: (payload: Record<string, any>) => void;
  onNavigate: (tab: NavTab) => void;
}

const revealProps = {
  initial: { opacity: 0, y: 14 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.08 },
  transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const },
};

function formatCurrencyCompact(value: number | null | undefined): string {
  return formatCurrencyUSD(value, { fallback: 'Unavailable' });
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  company,
  dataset,
  analytics,
  activeModel,
  automationStatus,
  isLoading,
  isPipelineRunning = false,
  canUploadAndAnalyse = true,
  canGeneratePredictions = true,
  onLoadSample,
  onAutoBuild,
  onWorkspaceMutated = () => {},
  onNavigate,
}) => {
  const [heroTilt, setHeroTilt] = useState({ x: 0, y: 0 });
  const [valueSummary, setValueSummary] = useState<CustomerValueSummary | null>(null);
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);
  const plan = getSubscriptionPlanSpec(company.subscriptionPlan);

  useEffect(() => {
    let active = true;
    if (!dataset) {
      setValueSummary(null);
      return;
    }
    apiFetch('/api/value-intelligence')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.summary) {
          setValueSummary(data.summary);
        }
      })
      .catch(() => {
        if (active) setValueSummary(null);
      });
    return () => {
      active = false;
    };
  }, [dataset?.datasetId, dataset?.rowCount, activeModel?.modelId]);

  const handleHeroPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    setHeroTilt({ x: nx, y: ny });
  };

  const handleHeroPointerLeave = () => {
    setHeroTilt({ x: 0, y: 0 });
  };

  const intelligenceInsights = useMemo(() => {
    if (!dataset || !analytics) return [];
    return deriveCustomerIntelligence(
      dataset,
      analytics,
      activeModel,
      company.industry,
      company.customIndustryName
    );
  }, [dataset, analytics, activeModel, company.industry, company.customIndustryName]);

  const riskOverview = useMemo(() => {
    if (!activeModel || activeModel.predictions.length === 0) return null;
    const preds = activeModel.predictions.filter(
      (p) =>
        p.riskApplicable !== false &&
        p.actualStatus !== 'Churned' &&
        p.actualStatus !== 'Inconsistent' &&
        p.actualChurn !== 'Churned'
    );
    const total = preds.length;
    const highCount = preds.filter(
      (p) => p.riskCategory === 'Higher Estimated Churn Risk'
    ).length;
    const medCount = preds.filter(
      (p) => p.riskCategory === 'Moderate Estimated Churn Risk'
    ).length;
    const atRiskCount = highCount + medCount;
    const avgProb =
      total > 0 ? (preds.reduce((acc, p) => acc + p.churnProbability, 0) / total) * 100 : 0;
    return {
      total,
      highCount,
      medCount,
      atRiskCount,
      avgProb,
    };
  }, [activeModel]);

  const recommendedActions = useMemo(() => {
    if (!dataset || !analytics) return [];
    const actions: {
      id: string;
      title: string;
      detail: string;
      cta: string;
      target: NavTab;
      priority: 'Critical' | 'High' | 'Normal';
    }[] = [];

    if (valueSummary?.recommendations?.length) {
      for (const rec of valueSummary.recommendations.slice(0, 2)) {
        actions.push({
          id: rec.id,
          title: rec.title,
          detail: rec.recommendedAction,
          cta: rec.priority === 'Critical' ? 'Review Value & Risk' : 'Inspect Customers',
          target: 'value',
          priority: rec.priority === 'Critical' ? 'Critical' : 'High',
        });
      }
    }

    if (analytics.isUnlabeledColdStart) {
      actions.push({
        id: 'cold-start-outcomes',
        title: 'Record Customer Outcomes as They Occur',
        detail:
          'Your dataset monitors active customer behaviour. Confirm observed churned or retained outcomes in Data Management to unlock churn risk scoring.',
        cta: 'Open Data Management',
        target: 'data',
        priority: 'Normal',
      });
    } else if (activeModel && riskOverview && riskOverview.highCount > 0) {
      actions.push({
        id: 'review-high-risk',
        title: `Contact ${riskOverview.highCount.toLocaleString()} High-Risk ${tmpl.entityPlural}`,
        detail:
          'Inspect individual risk factors and retention drivers in Churn Analysis to launch targeted outreach before renewal.',
        cta: 'Inspect Predictions',
        target: 'predictions',
        priority: 'Critical',
      });
    } else if (!activeModel) {
      actions.push({
        id: 'enable-predictions',
        title: 'Confirm Historical Outcomes to Activate Predictions',
        detail:
          'Map a historical churn outcome column in Data Management to calculate individual churn probabilities and revenue exposure.',
        cta: 'Review Data Setup',
        target: 'data',
        priority: 'Normal',
      });
    }

    if (actions.length < 3) {
      actions.push({
        id: 'explore-patterns',
        title: 'Compare Retention Drivers Across Segments',
        detail: `Review how ${tmpl.segmentLabel.toLowerCase()} and ${tmpl.tenureLabel.toLowerCase()} affect retention and export a summary report.`,
        cta: 'View Churn Patterns',
        target: 'analytics',
        priority: 'Normal',
      });
    }

    return actions.slice(0, 3);
  }, [dataset, analytics, valueSummary, activeModel, riskOverview, tmpl]);

  // Empty Workspace State
  if (!dataset || !analytics) {
    return (
      <div className="relative space-y-8 overflow-x-hidden">
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
          <div className="animate-mesh-drift absolute -top-24 right-1/4 w-[460px] h-[460px] rounded-full bg-[#7655E8]/[0.07] blur-3xl" />
          <div className="animate-mesh-drift-slow absolute bottom-0 left-1/3 w-[420px] h-[420px] rounded-full bg-[#35C5E8]/[0.07] blur-3xl" />
        </div>

        {/* 3D Hero Section */}
        <section
          onPointerMove={handleHeroPointerMove}
          onPointerLeave={handleHeroPointerLeave}
          className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0B0E23] via-[#13173C] to-[#24184E] text-white shadow-[0_28px_70px_rgba(11,14,35,0.32)] border border-white/12 p-7 sm:p-10 lg:p-12"
        >
          <div
            className="absolute inset-0 opacity-15 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.22) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
            }}
          />
          <div className="animate-mesh-drift absolute -left-24 -top-24 w-96 h-96 rounded-full bg-[#38BDF8]/18 blur-3xl pointer-events-none" />
          <div className="animate-mesh-drift-slow absolute right-0 -bottom-16 w-[420px] h-[420px] rounded-full bg-[#7655E8]/26 blur-3xl pointer-events-none" />

          <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
            <div className="lg:col-span-6 space-y-5">
              <div className="text-xs tracking-[0.14em] uppercase font-medium text-[#38BDF8]/90 flex flex-wrap items-center gap-2">
                <span>ChurnSight</span>
                <span aria-hidden="true" className="text-white/30">·</span>
                <span className="text-slate-300">{tmpl.shortLabel} Workspace</span>
              </div>

              <h1 className="font-display text-3xl sm:text-4xl lg:text-[46px] font-extrabold tracking-[-0.025em] leading-[1.06] text-white text-balance">
                UNDERSTAND YOUR{' '}
                <span className="bg-gradient-to-r from-[#38BDF8] via-[#60A5FA] to-[#A855F7] bg-clip-text text-transparent">
                  CUSTOMERS.
                </span>
                <br />
                ANTICIPATE THEIR{' '}
                <span className="bg-gradient-to-r from-[#38BDF8] via-[#60A5FA] to-[#A855F7] bg-clip-text text-transparent">
                  NEXT MOVE.
                </span>
              </h1>

              <p className="text-sm sm:text-base text-slate-300/90 leading-relaxed max-w-lg">
                Identify customer risk. Understand churn patterns. Make smarter retention decisions.
              </p>

              {canUploadAndAnalyse ? (
                <div className="pt-2 flex flex-wrap items-center gap-3.5">
                  <button
                    type="button"
                    onClick={onLoadSample}
                    disabled={isLoading}
                    className="inline-flex items-center gap-2 px-5 py-3 bg-white text-[#0B0E23] hover:bg-[#F5F3FF] text-sm font-bold rounded-xl shadow-lg shadow-[#0B0E23]/30 transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Database className="w-4 h-4 text-[#7655E8]" />
                    <span>{isLoading ? 'Preparing Workspace...' : tmpl.demoDatasetLabel}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('data')}
                    className="inline-flex items-center gap-2 px-5 py-3 bg-white/10 hover:bg-white/18 text-white border border-white/20 text-sm font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Upload className="w-4 h-4 text-[#38BDF8]" />
                    <span>Upload Customer Data</span>
                  </button>
                </div>
              ) : (
                <div className="pt-1 text-xs font-medium text-white/90 bg-white/10 border border-white/15 rounded-xl px-4 py-3 max-w-lg">
                  No dataset is loaded in this company workspace yet. Dataset upload permissions are
                  currently restricted to your Firm Administrator.
                </div>
              )}
            </div>

            <div className="lg:col-span-6">
              <HeroArtwork tilt={heroTilt} />
            </div>
          </div>
        </section>

        {/* Scrollable Customer Directory */}
        <CustomerDirectorySection
          company={company}
          dataset={dataset}
          activeModel={activeModel}
          canUploadAndAnalyse={canUploadAndAnalyse}
          onWorkspaceMutated={onWorkspaceMutated}
          onNavigateData={() => onNavigate('data')}
        />

        {/* Quick 3-Step Onboarding Guide */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-white/95 border border-purple-100 rounded-2xl shadow-xs p-5 space-y-1.5">
            <div className="text-xs font-semibold text-[#7655E8]">Step 01</div>
            <h2 className="font-display text-base font-bold text-[#11142B]">
              Import Customer Data
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Upload your Excel workbook or CSV records in Data Management.
            </p>
          </div>

          <div className="bg-white/95 border border-purple-100 rounded-2xl shadow-xs p-5 space-y-1.5">
            <div className="text-xs font-semibold text-[#397BFF]">Step 02</div>
            <h2 className="font-display text-base font-bold text-[#11142B]">
              Analyse Value &amp; Risk
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Segment High, Medium, and Low value tiers and identify at-risk active accounts.
            </p>
          </div>

          <div className="bg-white/95 border border-purple-100 rounded-2xl shadow-xs p-5 space-y-1.5">
            <div className="text-xs font-semibold text-[#E84FA8]">Step 03</div>
            <h2 className="font-display text-base font-bold text-[#11142B]">
              Retain &amp; Export
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Prioritise high-value outreach and export executive PDF and CSV reports.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const highValueSharePct =
    valueSummary &&
    valueSummary.totalPortfolioRevenue &&
    valueSummary.segmentDistribution.length > 0
      ? (() => {
          const hv = valueSummary.segmentDistribution.find((s) => s.segment === 'High Value');
          if (!hv || hv.totalRevenue === null || valueSummary.totalPortfolioRevenue <= 0) {
            return null;
          }
          return Math.round((hv.totalRevenue / valueSummary.totalPortfolioRevenue) * 100);
        })()
      : null;

  return (
    <div className="relative space-y-8 overflow-x-hidden pb-6">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="animate-mesh-drift absolute -top-20 right-[12%] w-[520px] h-[520px] rounded-full bg-[#7655E8]/[0.07] blur-3xl" />
        <div className="animate-mesh-drift-slow absolute top-[38%] -left-24 w-[460px] h-[460px] rounded-full bg-[#35C5E8]/[0.07] blur-3xl" />
      </div>

      {/* 1. 3D HERO SECTION */}
      <section
        onPointerMove={handleHeroPointerMove}
        onPointerLeave={handleHeroPointerLeave}
        className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0B0E23] via-[#13173C] to-[#24184E] text-white shadow-[0_28px_70px_rgba(11,14,35,0.32)] border border-white/12 p-6 sm:p-9 lg:p-11"
      >
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.22) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="animate-mesh-drift absolute -left-24 -top-24 w-96 h-96 rounded-full bg-[#38BDF8]/18 blur-3xl pointer-events-none" />
        <div className="animate-mesh-drift-slow absolute right-4 -bottom-20 w-[420px] h-[420px] rounded-full bg-[#7655E8]/26 blur-3xl pointer-events-none" />

        <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          <div className="lg:col-span-6 space-y-5">
            <div className="text-xs tracking-[0.12em] uppercase font-medium text-[#38BDF8]/90 flex flex-wrap items-center gap-2">
              <span>{tmpl.shortLabel}</span>
              <span aria-hidden="true" className="text-white/30">·</span>
              <span className="text-slate-300 normal-case tracking-normal truncate max-w-[220px]">
                {dataset.fileName}
              </span>
              <span aria-hidden="true" className="text-white/30">·</span>
              <span className="font-mono tabular-nums text-white/90 normal-case tracking-normal">
                {dataset.rowCount.toLocaleString()} records
              </span>
            </div>

            <h1 className="font-display text-3xl sm:text-4xl lg:text-[46px] font-extrabold tracking-[-0.025em] leading-[1.06] text-white text-balance">
              UNDERSTAND YOUR{' '}
              <span className="bg-gradient-to-r from-[#38BDF8] via-[#60A5FA] to-[#A855F7] bg-clip-text text-transparent">
                CUSTOMERS.
              </span>
              <br />
              ANTICIPATE THEIR{' '}
              <span className="bg-gradient-to-r from-[#38BDF8] via-[#60A5FA] to-[#A855F7] bg-clip-text text-transparent">
                NEXT MOVE.
              </span>
            </h1>

            <p className="text-sm sm:text-base text-slate-300/90 leading-relaxed max-w-lg">
              Identify customer risk. Understand churn patterns. Make smarter retention decisions.
            </p>

            <div className="pt-1 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate(activeModel ? 'churn_analysis' : 'customers')}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-[#0B0E23] hover:bg-[#F5F3FF] text-sm font-bold rounded-xl shadow-lg shadow-[#0B0E23]/25 transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>{activeModel ? 'Open Churn Analysis' : 'Inspect Customers'}</span>
                <ArrowRight className="w-4 h-4 text-[#7655E8]" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('data')}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/18 text-white border border-white/20 text-sm font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                <Database className="w-4 h-4 text-[#38BDF8]" />
                <span>Manage Data</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-6">
            <HeroArtwork analytics={analytics} activeModel={activeModel} tilt={heroTilt} />
          </div>
        </div>
      </section>

      {/* Concise Status Notice Only When Action Is Required */}
      {automationStatus && !automationStatus.predictionAvailable && (
        <PredictionPipelineBanner
          automationStatus={automationStatus}
          isRunning={isPipelineRunning}
          canGeneratePredictions={canGeneratePredictions}
          onAutoBuild={onAutoBuild}
          onNavigate={onNavigate}
          compact
        />
      )}

      {/* 2. FIVE-QUESTION EXECUTIVE SUMMARY (Questions 1–4) */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold text-[#11142B] tracking-tight">
              Executive Portfolio Summary
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Portfolio health, active risk, value concentration, and revenue exposure
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportChurnSummaryCsv(company, dataset, analytics)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-200 bg-white hover:bg-[#F5F3FF] text-xs font-semibold text-[#11142B] cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-[#397BFF]" />
              <span>Summary CSV</span>
            </button>
            <button
              type="button"
              disabled={!plan.allowPdfReports}
              onClick={() => exportChurnSummaryPdf(company, dataset, analytics, activeModel)}
              title={
                plan.allowPdfReports
                  ? 'Download executive churn PDF report'
                  : 'Executive PDF reports require Starter plan or higher'
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-200 bg-white hover:bg-[#F5F3FF] text-xs font-semibold text-[#11142B] disabled:opacity-45 cursor-pointer whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5 text-[#E84FA8]" />
              <span>{plan.allowPdfReports ? 'Executive PDF' : 'PDF (Starter+)'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          {/* Q1: How is my customer portfolio performing? */}
          {(() => {
            const hp = analytics.historicalPerformance;
            const rateReliable =
              !analytics.isUnlabeledColdStart && (hp ? hp.historicalRateReliable : true);
            const rateVal = hp?.historicalChurnRate ?? analytics.churnRate;
            const churnedTotal = hp?.actualChurnedCount ?? analytics.churnedCount;
            return (
              <TiltKpiCard
                index={0}
                title="Portfolio Performance"
                value={
                  analytics.isUnlabeledColdStart
                    ? analytics.totalCustomers
                    : rateReliable
                      ? 100 - rateVal
                      : 0
                }
                displayText={
                  !analytics.isUnlabeledColdStart && !rateReliable ? 'Unavailable' : undefined
                }
                decimals={analytics.isUnlabeledColdStart ? 0 : 1}
                suffix={analytics.isUnlabeledColdStart ? '' : '%'}
                subtitle={
                  analytics.isUnlabeledColdStart
                    ? `Monitoring ${analytics.totalCustomers.toLocaleString()} ${tmpl.entityPlural.toLowerCase()} (awaiting outcomes)`
                    : rateReliable
                      ? `${churnedTotal.toLocaleString()} already churned · ${rateVal.toFixed(1)}% historical churn`
                      : `${churnedTotal.toLocaleString()} already churned · historical rate unavailable`
                }
                gradientClass="bg-gradient-to-br from-[#059669] via-[#10B981] to-[#047857]"
                shadowClass="shadow-xl shadow-[#059669]/25"
                icon={<Users className="w-5 h-5 text-white" />}
              />
            );
          })()}

          {/* Q2: How many active customers might leave? */}
          <TiltKpiCard
            index={1}
            title="Active Customers at Risk"
            value={
              riskOverview
                ? riskOverview.atRiskCount
                : analytics.isUnlabeledColdStart
                  ? analytics.behaviourMonitoring?.inactivityWatchlistCount ?? 0
                  : 0
            }
            displayText={
              !riskOverview && !analytics.isUnlabeledColdStart ? 'Unavailable' : undefined
            }
            subtitle={
              riskOverview
                ? `${riskOverview.highCount.toLocaleString()} active high risk · ${riskOverview.medCount.toLocaleString()} active moderate risk`
                : analytics.isUnlabeledColdStart
                  ? 'Inactivity watchlist (not confirmed churn)'
                  : 'Activate churn predictions in Churn Analysis'
            }
            gradientClass="bg-gradient-to-br from-[#EA580C] via-[#F97316] to-[#C2410C]"
            shadowClass="shadow-xl shadow-[#EA580C]/25"
            icon={<ShieldAlert className="w-5 h-5 text-white" />}
          />

          {/* Q3: Which customers are most valuable? */}
          <TiltKpiCard
            index={2}
            title="High-Value Customers"
            value={valueSummary?.valueAssessmentAvailable ? valueSummary.highValueCount : 0}
            displayText={valueSummary?.valueAssessmentAvailable ? undefined : 'Unavailable'}
            subtitle={
              valueSummary?.valueAssessmentAvailable
                ? highValueSharePct !== null
                  ? `Top tier driving ~${highValueSharePct}% of portfolio revenue`
                  : `Of ${valueSummary.totalCustomers.toLocaleString()} evaluated accounts`
                : 'Add spend or tenure data to score value'
            }
            gradientClass="bg-gradient-to-br from-[#397BFF] via-[#2798F2] to-[#35C5E8]"
            shadowClass="shadow-xl shadow-[#397BFF]/25"
            icon={<Gem className="w-5 h-5 text-white" />}
          />

          {/* Q4: How much revenue is potentially exposed? */}
          <TiltKpiCard
            index={3}
            title="Revenue Exposure"
            value={
              valueSummary?.riskPredictionsAvailable &&
              valueSummary.estimatedExpectedRevenueExposure !== null
                ? valueSummary.estimatedExpectedRevenueExposure
                : 0
            }
            decimals={2}
            prefix="$"
            displayText={
              valueSummary?.riskPredictionsAvailable &&
              valueSummary.estimatedExpectedRevenueExposure !== null
                ? undefined
                : 'Unavailable'
            }
            subtitle={
              valueSummary?.riskPredictionsAvailable &&
              valueSummary.estimatedExpectedRevenueExposure !== null
                ? valueSummary.highValueAtRiskCount !== null
                  ? `${valueSummary.highValueAtRiskCount.toLocaleString()} high-value accounts above risk cutoff`
                  : 'Expected annual exposure from model risk'
                : 'Exposure unavailable until churn predictions activate'
            }
            gradientClass="bg-gradient-to-br from-[#B84DE0] via-[#9650E4] to-[#7655E8]"
            shadowClass="shadow-xl shadow-[#B84DE0]/25"
            icon={<Activity className="w-5 h-5 text-white" />}
          />
        </div>
      </section>

      {/* 3. QUESTION 5: WHAT SHOULD I DO NEXT? + IMPORTANT INSIGHTS */}
      <motion.section {...revealProps} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Important Business Insights */}
        <div className="lg:col-span-7 bg-white/95 border border-purple-100/90 rounded-2xl shadow-xs p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-[#11142B]">
                Important Business Insights
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Key attrition signals across your {tmpl.shortLabel.toLowerCase()} portfolio
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('analytics')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer whitespace-nowrap"
            >
              <span>All Insights</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-purple-100/80">
            {intelligenceInsights.slice(0, 3).map((item) => (
              <div key={item.id} className="py-3.5 first:pt-1 last:pb-1 space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="font-semibold text-sm text-[#11142B] flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-[#7655E8] shrink-0" />
                    <span>{item.title}</span>
                  </div>
                  <span className="font-mono tabular-nums text-sm font-bold text-[#7655E8] shrink-0">
                    {item.statValue}
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{item.explanation}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Recommended Next Actions (Q5) */}
        <div className="lg:col-span-5 bg-white/95 border border-purple-100/90 rounded-2xl shadow-xs p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div>
              <h2 className="font-display text-lg font-bold text-[#11142B]">
                Recommended Actions
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Priority retention steps from live portfolio data
              </p>
            </div>

            <div className="space-y-3">
              {recommendedActions.map((act) => (
                <div
                  key={act.id}
                  className="rounded-xl border border-purple-100 bg-[#F5F3FF]/50 p-3.5 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-bold text-[#11142B] flex items-center gap-1.5">
                      {act.priority === 'Critical' ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-[#E04F44] shrink-0" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#7655E8] shrink-0" />
                      )}
                      <span>{act.title}</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{act.detail}</p>
                  <button
                    type="button"
                    onClick={() => onNavigate(act.target)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer"
                  >
                    <span>{act.cta}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </motion.section>

      {/* 4. IMPORTANT CHARTS & GRAPHS (Focused 2-Chart Summary) */}
      <motion.section {...revealProps} className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-bold text-[#11142B] tracking-tight">
              Key Portfolio Trends
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Retention split and primary attrition pattern ·{' '}
              {valueSummary?.profitAvailable && valueSummary.totalPortfolioProfit !== null
                ? `Tracked portfolio profit: ${formatCurrencyCompact(valueSummary.totalPortfolioProfit)}`
                : valueSummary?.revenueBasisNote || tmpl.shortLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('analytics')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer whitespace-nowrap self-start sm:self-auto"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Open Full Churn Patterns</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 bg-white/95 border border-purple-100/90 rounded-2xl shadow-xs p-6 space-y-4">
            <div>
              <h3 className="font-display text-base font-bold text-[#11142B]">
                {analytics.isUnlabeledColdStart
                  ? `${tmpl.entitySingular} Portfolio Status`
                  : `${tmpl.entitySingular} Churn Distribution`}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {analytics.isUnlabeledColdStart
                  ? `Active monitoring across ${analytics.totalCustomers.toLocaleString()} ${tmpl.entityPlural.toLowerCase()}`
                  : `Retained vs. churned across ${analytics.totalCustomers.toLocaleString()} ${tmpl.entityPlural.toLowerCase()}`}
              </p>
            </div>
            <ChurnDoughnutChart
              stayedCount={analytics.stayedCount}
              churnedCount={analytics.churnedCount}
              totalCustomers={analytics.totalCustomers}
            />
          </div>

          {analytics.contractStats ? (
            <div className="lg:col-span-6 bg-white/95 border border-purple-100/90 rounded-2xl shadow-xs p-6 space-y-4">
              <div>
                <h3 className="font-display text-base font-bold text-[#11142B]">
                  Retention by {tmpl.segmentLabel}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Comparison across {dataset.mapping.contractColumn || tmpl.segmentLabel}
                </p>
              </div>
              <GroupedChurnBarChart data={analytics.contractStats} xAxisLabel={tmpl.segmentLabel} />
            </div>
          ) : analytics.tenureStats ? (
            <div className="lg:col-span-6 bg-white/95 border border-purple-100/90 rounded-2xl shadow-xs p-6 space-y-4">
              <div>
                <h3 className="font-display text-base font-bold text-[#11142B]">
                  {tmpl.entitySingular} Retention Trends
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Retention and churn rates across {tmpl.tenureLabel.toLowerCase()} cohorts
                </p>
              </div>
              <TenureTrendLineChart data={analytics.tenureStats} />
            </div>
          ) : analytics.monthlyChargesComparison ? (
            <div className="lg:col-span-6 bg-white/95 border border-purple-100/90 rounded-2xl shadow-xs p-6 space-y-4">
              <div>
                <h3 className="font-display text-base font-bold text-[#11142B]">
                  {tmpl.revenueLabel} Comparison
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Average {getHumanReadableFieldLabel(analytics.monthlyChargesComparison.columnName, { dataset, company })} by status
                </p>
              </div>
              <AverageChargesBarChart
                comparison={analytics.monthlyChargesComparison}
                metricLabel={tmpl.revenueLabel}
                dataset={dataset}
                company={company}
              />
            </div>
          ) : (
            <div className="lg:col-span-6 bg-white/95 border border-purple-100/90 rounded-2xl shadow-xs p-6 flex flex-col justify-center items-start space-y-3">
              <div className="w-10 h-10 rounded-xl bg-[#F5F3FF] text-[#7655E8] flex items-center justify-center">
                <BrainCircuit className="w-5 h-5" />
              </div>
              <h3 className="font-display text-base font-bold text-[#11142B]">
                Segment Breakdown Not Mapped Yet
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Map a segment, plan, or tenure column in Data Management to compare retention rates across customer groups.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('data')}
                className="px-4 py-2 rounded-xl bg-[#11142B] text-white text-xs font-semibold cursor-pointer"
              >
                Configure Column Mapping
              </button>
            </div>
          )}
        </div>
      </motion.section>

      {/* 5. SCROLLABLE CUSTOMER DIRECTORY (Card & List + Add / Edit / Inspect) */}
      <CustomerDirectorySection
        company={company}
        dataset={dataset}
        activeModel={activeModel}
        canUploadAndAnalyse={canUploadAndAnalyse}
        onWorkspaceMutated={onWorkspaceMutated}
        onNavigateData={() => onNavigate('data')}
      />
    </div>
  );
};
