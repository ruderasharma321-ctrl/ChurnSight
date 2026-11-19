import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Upload,
  UserCheck,
  UserMinus,
  Users,
} from 'lucide-react';
import {
  AnalyticsSummary,
  CompanyWorkspaceInfo,
  DatasetState,
  ModelEvaluationResult,
  NavTab,
  PredictionPipelineStatus,
} from '../types/churn';
import {
  deriveCustomerIntelligence,
  InsightTone,
} from '../utils/churnIntelligence';
import { getIndustryTemplate } from '../utils/industryConfig';
import { exportChurnSummaryCsv, exportChurnSummaryPdf } from '../utils/reportExporter';
import { getSubscriptionPlanSpec } from '../utils/subscriptionPlans';
import {
  AverageChargesBarChart,
  CategoryChurnRateBarChart,
  ChurnDoughnutChart,
  GroupedChurnBarChart,
  TenureTrendLineChart,
} from './Charts';
import { PredictionPipelineBanner } from './PredictionPipelineBanner';
import {
  CircularRiskRing,
  HeroArtwork,
  TiltKpiCard,
} from './PremiumUI';

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

const revealProps = {
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.08 },
  transition: { duration: 0.42, ease: [0.16, 1, 0.3, 1] as const },
};

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
  onNavigate,
}) => {
  const [heroTilt, setHeroTilt] = useState({ x: 0, y: 0 });
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);
  const plan = getSubscriptionPlanSpec(company.subscriptionPlan);

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
    const preds = activeModel.predictions;
    const total = preds.length;
    const highRisk = preds.filter((p) => p.riskCategory === 'Higher Estimated Churn Risk');
    const medRisk = preds.filter((p) => p.riskCategory === 'Moderate Estimated Churn Risk');
    const lowRisk = preds.filter((p) => p.riskCategory === 'Low Estimated Churn Risk');
    const avgProb =
      (preds.reduce((acc, p) => acc + p.churnProbability, 0) / total) * 100;
    const topAtRisk = [...preds]
      .sort((a, b) => b.churnProbability - a.churnProbability)
      .slice(0, 5);

    return {
      total,
      highCount: highRisk.length,
      medCount: medRisk.length,
      lowCount: lowRisk.length,
      avgProb,
      topAtRisk,
    };
  }, [activeModel]);

  if (!dataset || !analytics) {
    return (
      <div className="relative space-y-8 overflow-x-hidden">
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
          <div className="animate-mesh-drift absolute -top-24 right-1/4 w-[460px] h-[460px] rounded-full bg-[#7655E8]/[0.07] blur-3xl" />
          <div className="animate-mesh-drift-slow absolute bottom-0 left-1/3 w-[420px] h-[420px] rounded-full bg-[#35C5E8]/[0.07] blur-3xl" />
        </div>

        {/* Cinematic 3D Hero Section (Empty Workspace State) */}
        <section
          onPointerMove={handleHeroPointerMove}
          onPointerLeave={handleHeroPointerLeave}
          className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#11142B] via-[#1C184A] to-[#4A227A] text-white shadow-[0_28px_70px_rgba(17,20,43,0.28)] border border-white/15 p-7 sm:p-10 lg:p-12"
        >
          <div
            className="absolute inset-0 opacity-20 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.24) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
            }}
          />
          <div className="animate-mesh-drift absolute -left-24 -top-24 w-96 h-96 rounded-full bg-[#397BFF]/25 blur-3xl pointer-events-none" />
          <div className="animate-mesh-drift-slow absolute right-0 -bottom-16 w-[420px] h-[420px] rounded-full bg-[#E84FA8]/25 blur-3xl pointer-events-none" />

          <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-6 space-y-5">
              <div className="text-[11px] uppercase tracking-[0.22em] font-semibold text-[#35C5E8] flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span>ChurnSight · {tmpl.label} Intelligence</span>
              </div>

              <h1 className="font-display text-3xl sm:text-4xl lg:text-[46px] font-extrabold tracking-tight leading-[1.08] text-white">
                UNDERSTAND{' '}
                <span className="bg-gradient-to-r from-[#35C5E8] via-[#397BFF] to-[#E84FA8] bg-clip-text text-transparent">
                  {tmpl.entityPlural.toUpperCase()}.
                </span>
                <br />
                PREDICT CHURN EARLY.
              </h1>

              <p className="text-base text-indigo-100/85 leading-relaxed max-w-xl">
                {tmpl.description} Upload CSV or Excel data to uncover churn drivers and activate
                automated retention predictions for {company.name}.
              </p>

              {canUploadAndAnalyse ? (
                <div className="pt-2 flex flex-wrap items-center gap-3.5">
                  <button
                    type="button"
                    onClick={onLoadSample}
                    disabled={isLoading}
                    className="inline-flex items-center gap-2 px-5 py-3 bg-white text-[#11142B] hover:bg-[#F5F3FF] text-sm font-bold rounded-xl shadow-lg shadow-[#11142B]/30 transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Database className="w-4 h-4 text-[#7655E8]" />
                    <span>{isLoading ? 'Preparing Workspace...' : tmpl.demoDatasetLabel}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('data')}
                    className="inline-flex items-center gap-2 px-5 py-3 bg-white/10 hover:bg-white/20 text-white border border-white/25 text-sm font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Upload className="w-4 h-4 text-[#35C5E8]" />
                    <span>Upload Customer Data</span>
                  </button>
                </div>
              ) : (
                <div className="pt-1 text-xs font-medium text-white/90 bg-white/10 border border-white/20 rounded-xl px-4 py-3 max-w-lg">
                  No dataset is loaded in this company workspace yet. Dataset upload permissions are
                  currently restricted to your Firm Administrator or authorised analysts.
                </div>
              )}
            </div>

            <div className="lg:col-span-6">
              <HeroArtwork tilt={heroTilt} />
            </div>
          </div>
        </section>

        {/* Three-Stage Automated SaaS Workflow */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-white/90 border border-purple-100 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-3 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-[#7655E8]/10">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7655E8] to-[#B84DE0] text-white flex items-center justify-center shadow-sm shadow-[#7655E8]/25">
              <Database className="w-5 h-5" />
            </div>
            <div className="text-xs font-semibold text-slate-400">
              Step 01
            </div>
            <h2 className="font-display text-base font-bold text-[#11142B]">
              Upload &amp; Confirm Churn Rules
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Import CSV or Excel sheets, review data quality, confirm {tmpl.segmentLabel},{' '}
              {tmpl.tenureLabel}, and {tmpl.revenueLabel}, and lock in your company churn rule.
            </p>
          </div>

          <div className="bg-white/90 border border-purple-100 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-3 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-[#397BFF]/10">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#397BFF] to-[#35C5E8] text-white flex items-center justify-center shadow-sm shadow-[#397BFF]/25">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div className="text-xs font-semibold text-slate-400">
              Step 02
            </div>
            <h2 className="font-display text-base font-bold text-[#11142B]">
              Explore Business Analytics
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Inspect retention charts tailored to your business with transparent churn
              calculations and interactive segment filtering.
            </p>
          </div>

          <div className="bg-white/90 border border-purple-100 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-3 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-[#E84FA8]/10">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#E84FA8] to-[#B84DE0] text-white flex items-center justify-center shadow-sm shadow-[#E84FA8]/25">
              <BrainCircuit className="w-5 h-5" />
            </div>
            <div className="text-xs font-semibold text-slate-400">
              Step 03
            </div>
            <h2 className="font-display text-base font-bold text-[#11142B]">
              Managed Prediction Setup
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              ChurnSight automatically prepares customer data, selects the best model, checks
              prediction quality, and activates risk scoring and executive reports.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const missingTotal = dataset.columns.reduce((sum, c) => sum + c.missingCount, 0);
  const missingOptionalCharts = [
    !analytics.contractStats ? tmpl.segmentLabel : null,
    !analytics.tenureStats ? tmpl.tenureLabel : null,
    !analytics.monthlyChargesComparison ? tmpl.revenueLabel : null,
    !analytics.paymentMethodStats ? 'Billing / Category Method' : null,
  ].filter(Boolean);

  return (
    <div className="relative space-y-10 overflow-x-hidden pb-6">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="animate-mesh-drift absolute -top-20 right-[12%] w-[520px] h-[520px] rounded-full bg-[#7655E8]/[0.07] blur-3xl" />
        <div className="animate-mesh-drift-slow absolute top-[38%] -left-24 w-[460px] h-[460px] rounded-full bg-[#35C5E8]/[0.07] blur-3xl" />
        <div className="animate-mesh-drift absolute bottom-0 right-[22%] w-[440px] h-[440px] rounded-full bg-[#E84FA8]/[0.06] blur-3xl" />
      </div>

      {/* 1. CINEMATIC 3D HERO EXPERIENCE */}
      <section
        onPointerMove={handleHeroPointerMove}
        onPointerLeave={handleHeroPointerLeave}
        className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#11142B] via-[#211B58] to-[#562583] text-white shadow-[0_28px_70px_rgba(17,20,43,0.28)] border border-white/15 p-6 sm:p-8 lg:p-11"
      >
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.24) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="animate-mesh-drift absolute -left-24 -top-24 w-96 h-96 rounded-full bg-[#397BFF]/25 blur-3xl pointer-events-none" />
        <div className="animate-mesh-drift-slow absolute right-4 -bottom-20 w-[420px] h-[420px] rounded-full bg-[#E84FA8]/30 blur-3xl pointer-events-none" />

        <span className="animate-particle absolute top-8 left-1/3 w-1.5 h-1.5 rounded-full bg-[#35C5E8] pointer-events-none" />
        <span
          className="animate-particle absolute bottom-10 left-1/4 w-1 h-1 rounded-full bg-[#E84FA8] pointer-events-none"
          style={{ animationDelay: '1.6s' }}
        />

        <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-6 space-y-5">
            <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-[#35C5E8] flex flex-wrap items-center gap-2">
              <span>{tmpl.shortLabel} Workspace</span>
              <span aria-hidden="true">·</span>
              <span>{dataset.fileName}</span>
              {dataset.isSample && (
                <span className="text-indigo-200/90">(Demonstration Data)</span>
              )}
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-white/95">
                {dataset.rowCount.toLocaleString()} records
              </span>
            </div>

            <h1 className="font-display text-3xl sm:text-4xl lg:text-[44px] font-extrabold tracking-tight leading-[1.08] text-white">
              KNOW YOUR{' '}
              <span className="bg-gradient-to-r from-[#35C5E8] via-[#397BFF] to-[#E84FA8] bg-clip-text text-transparent">
                {tmpl.entityPlural.toUpperCase()}.
              </span>
              <br />
              BEFORE THEY LEAVE.
            </h1>

            <p className="text-sm sm:text-base text-indigo-100/85 leading-relaxed max-w-xl">
              {tmpl.description} Turn {company.name} retention metrics into actionable predictions.
            </p>

            <div className="pt-1 flex flex-wrap items-center gap-3">
              {activeModel ? (
                <button
                  type="button"
                  onClick={() => onNavigate('predictions')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-[#11142B] hover:bg-[#F5F3FF] text-sm font-bold rounded-xl shadow-lg shadow-[#11142B]/25 transition-all cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>View Churn Predictions</span>
                  <ArrowRight className="w-4 h-4 text-[#7655E8]" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate('intelligence')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-[#11142B] hover:bg-[#F5F3FF] text-sm font-bold rounded-xl shadow-lg shadow-[#11142B]/25 transition-all cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>Explore Customer Intelligence</span>
                  <ArrowRight className="w-4 h-4 text-[#7655E8]" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onNavigate('analytics')}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white border border-white/25 text-sm font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                <BarChart3 className="w-4 h-4 text-[#35C5E8]" />
                <span>Business Analytics</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('data')}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 text-sm font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Data Management</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-6">
            <HeroArtwork
              analytics={analytics}
              activeModel={activeModel}
              tilt={heroTilt}
            />
          </div>
        </div>
      </section>

      {/* Managed Prediction Setup Status */}
      <PredictionPipelineBanner
        automationStatus={automationStatus}
        isRunning={isPipelineRunning}
        canGeneratePredictions={canGeneratePredictions}
        onAutoBuild={onAutoBuild}
        onNavigate={onNavigate}
      />

      {dataset.hasValidChurnLabels === false && dataset.churnReadinessMessage && !automationStatus && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-amber-950">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">More Historical Data Required for Predictions</div>
              <p className="mt-0.5">{dataset.churnReadinessMessage}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('data')}
            className="px-3.5 py-2 bg-amber-900 text-white font-semibold rounded-xl shrink-0 cursor-pointer whitespace-nowrap"
          >
            Review Data Management
          </button>
        </div>
      )}

      {/* 2. PREMIUM FLOATING GLASS KPI PANELS */}
      {analytics.isUnlabeledColdStart ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          <TiltKpiCard
            index={0}
            title={`Monitored ${tmpl.entityPlural}`}
            value={analytics.totalCustomers}
            subtitle="Active records (Cold-start mode)"
            gradientClass="bg-gradient-to-br from-[#7655E8] via-[#6846DE] to-[#4E30BF]"
            shadowClass="shadow-xl shadow-[#7655E8]/25"
            icon={<Users className="w-5 h-5 text-white" />}
          />

          <TiltKpiCard
            index={1}
            title="Inactivity Watchlist"
            value={analytics.behaviourMonitoring?.inactivityWatchlistCount ?? 0}
            subtitle={
              analytics.behaviourMonitoring?.inactivityThresholdDays
                ? `Inactive > ${analytics.behaviourMonitoring.inactivityThresholdDays} days`
                : 'Quiet activity signal (not assumed churn)'
            }
            gradientClass="bg-gradient-to-br from-[#FF786B] via-[#F2638A] to-[#E84FA8]"
            shadowClass="shadow-xl shadow-[#E84FA8]/25"
            icon={<UserMinus className="w-5 h-5 text-white" />}
          />

          <TiltKpiCard
            index={2}
            title="Data Readiness Score"
            value={dataset.readiness?.readinessScore ?? 55}
            suffix="/100"
            subtitle={dataset.readiness?.overallLabel || 'Behaviour Monitoring Ready'}
            gradientClass="bg-gradient-to-br from-[#397BFF] via-[#2798F2] to-[#35C5E8]"
            shadowClass="shadow-xl shadow-[#397BFF]/25"
            icon={<CheckCircle2 className="w-5 h-5 text-white" />}
          />

          <TiltKpiCard
            index={3}
            title="Low-Engagement Accounts"
            value={analytics.behaviourMonitoring?.lowEngagementCount ?? 0}
            subtitle="Awaiting observed churn outcomes"
            gradientClass="bg-gradient-to-br from-[#B84DE0] via-[#9650E4] to-[#7655E8]"
            shadowClass="shadow-xl shadow-[#B84DE0]/25"
            icon={<Activity className="w-5 h-5 text-white" />}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          <TiltKpiCard
            index={0}
            title={`Total ${tmpl.entityPlural}`}
            value={analytics.totalCustomers}
            subtitle="Valid labeled records in dataset"
            gradientClass="bg-gradient-to-br from-[#7655E8] via-[#6846DE] to-[#4E30BF]"
            shadowClass="shadow-xl shadow-[#7655E8]/25"
            icon={<Users className="w-5 h-5 text-white" />}
          />

          <TiltKpiCard
            index={1}
            title={tmpl.churnLabel}
            value={analytics.churnedCount}
            subtitle={
              dataset.mapping.targetColumn
                ? `Target = ${dataset.mapping.positiveClassValue}`
                : 'Target unmapped'
            }
            gradientClass="bg-gradient-to-br from-[#FF786B] via-[#F2638A] to-[#E84FA8]"
            shadowClass="shadow-xl shadow-[#E84FA8]/25"
            icon={<UserMinus className="w-5 h-5 text-white" />}
          />

          <TiltKpiCard
            index={2}
            title={`Retained ${tmpl.entityPlural}`}
            value={analytics.stayedCount}
            subtitle="Active retained accounts"
            gradientClass="bg-gradient-to-br from-[#397BFF] via-[#2798F2] to-[#35C5E8]"
            shadowClass="shadow-xl shadow-[#397BFF]/25"
            icon={<UserCheck className="w-5 h-5 text-white" />}
          />

          <TiltKpiCard
            index={3}
            title="Overall Churn Rate"
            value={analytics.churnRate}
            decimals={1}
            suffix="%"
            subtitle={`${analytics.churnedCount.toLocaleString()} of ${analytics.totalCustomers.toLocaleString()} ${tmpl.entityPlural.toLowerCase()}`}
            gradientClass="bg-gradient-to-br from-[#B84DE0] via-[#9650E4] to-[#7655E8]"
            shadowClass="shadow-xl shadow-[#B84DE0]/25"
            icon={<Activity className="w-5 h-5 text-white" />}
          />
        </div>
      )}

      {/* Cold-Start Behaviour Monitoring & Watchlist */}
      {analytics.isUnlabeledColdStart && analytics.behaviourMonitoring && (
        <section className="bg-white/95 border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-[#397BFF]">
                Cold-Start Behaviour Monitoring Active
              </div>
              <h2 className="font-display text-lg font-bold text-[#11142B]">
                Engagement &amp; Inactivity Watchlist
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Tracking {analytics.behaviourMonitoring.signalsDetected.join(', ') || 'portfolio metrics'} across{' '}
                {analytics.behaviourMonitoring.activeAccountsCount.toLocaleString()}{' '}
                {tmpl.entityPlural.toLowerCase()}. Record observed outcomes in Data Management as they happen.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('data')}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#11142B] hover:bg-[#1C2147] text-white text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap self-start sm:self-auto"
            >
              <span>Open Readiness &amp; Record Outcomes</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#35C5E8]" />
            </button>
          </div>

          {analytics.behaviourMonitoring.watchlistSample.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-purple-100 text-[#4C4A6E] font-semibold">
                    <th className="py-2 pr-3">{tmpl.entitySingular} ID</th>
                    <th className="py-2 px-3">Last Activity</th>
                    <th className="py-2 px-3 text-right">Days Quiet</th>
                    <th className="py-2 px-3 text-right">Engagement</th>
                    <th className="py-2 pl-3">Signal Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-50">
                  {analytics.behaviourMonitoring.watchlistSample.slice(0, 6).map((item) => (
                    <tr key={`${item.rowIndex}-${item.customerId}`}>
                      <td className="py-2 pr-3 font-mono font-bold text-[#11142B]">
                        {item.customerId}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-600">
                        {item.lastDate || '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-[#D97706] font-semibold">
                        {item.daysSinceActivity !== null ? `${item.daysSinceActivity}d` : '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                        {item.engagementValue ?? '—'}
                      </td>
                      <td className="py-2 pl-3 text-slate-600">{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-slate-600 bg-[#F5F3FF]/60 border border-purple-100 rounded-xl p-4">
              No inactive or low-engagement outliers breached threshold yet. Continue updating activity dates and recording observed churn outcomes to build your supervised baseline.
            </div>
          )}
        </section>
      )}

      {/* 3. SECTION 01: THE CUSTOMER LANDSCAPE */}
      <motion.section {...revealProps} className="space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#7655E8]">
              01 · Portfolio Overview ({tmpl.shortLabel})
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#11142B]">
              THE {tmpl.entitySingular.toUpperCase()}{' '}
              <span className="bg-gradient-to-r from-[#7655E8] via-[#B84DE0] to-[#E84FA8] bg-clip-text text-transparent">
                LANDSCAPE
              </span>
            </h2>
            {analytics.calculationExplanation && (
              <p className="text-xs font-mono text-slate-600">
                {analytics.calculationExplanation}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => exportChurnSummaryCsv(company, dataset, analytics)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-purple-200 bg-white hover:bg-[#F5F3FF] text-xs font-semibold text-[#11142B] cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-[#397BFF]" />
              <span>Export Summary CSV</span>
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
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-purple-200 bg-white hover:bg-[#F5F3FF] text-xs font-semibold text-[#11142B] disabled:opacity-45 cursor-pointer whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5 text-[#E84FA8]" />
              <span>{plan.allowPdfReports ? 'Executive PDF' : 'PDF (Starter+)'}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('analytics')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] transition-colors cursor-pointer whitespace-nowrap pl-1"
            >
              <span>Open Business Analytics</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* A. Customer Churn Distribution */}
          <div className="lg:col-span-6 bg-white/95 border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4 transition-all duration-200 hover:shadow-lg hover:shadow-[#7655E8]/[0.07] hover:border-purple-200">
            <div>
              <h3 className="font-display text-base font-bold text-[#11142B]">
                {tmpl.entitySingular} Churn Distribution
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Churned vs. retained split across{' '}
                <span className="font-mono tabular-nums">
                  {analytics.totalCustomers.toLocaleString()}
                </span>{' '}
                {tmpl.entityPlural.toLowerCase()}
              </p>
            </div>
            <ChurnDoughnutChart
              stayedCount={analytics.stayedCount}
              churnedCount={analytics.churnedCount}
              totalCustomers={analytics.totalCustomers}
            />
          </div>

          {/* D. Revenue / Value Analysis */}
          {analytics.monthlyChargesComparison && (
            <div className="lg:col-span-6 bg-white/95 border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4 transition-all duration-200 hover:shadow-lg hover:shadow-[#397BFF]/[0.07] hover:border-purple-200">
              <div>
                <h3 className="font-display text-base font-bold text-[#11142B]">
                  {tmpl.revenueLabel} Comparison
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Average {analytics.monthlyChargesComparison.columnName} comparing retained vs.
                  churned {tmpl.entityPlural.toLowerCase()}
                </p>
              </div>
              <AverageChargesBarChart
                comparison={analytics.monthlyChargesComparison}
                metricLabel={tmpl.revenueLabel}
              />
            </div>
          )}

          {/* Engagement / Frequency Comparison if mapped and revenue is not taking both slots */}
          {analytics.frequencyComparison && (
            <div className="lg:col-span-6 bg-white/95 border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4 transition-all duration-200 hover:shadow-lg hover:shadow-[#35C5E8]/[0.08] hover:border-purple-200">
              <div>
                <h3 className="font-display text-base font-bold text-[#11142B]">
                  {tmpl.frequencyLabel} Comparison
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Average {analytics.frequencyComparison.columnName} comparing retained vs. churned
                </p>
              </div>
              <AverageChargesBarChart
                comparison={analytics.frequencyComparison}
                valuePrefix=""
                metricLabel={tmpl.frequencyLabel}
              />
            </div>
          )}
        </div>
      </motion.section>

      {/* 4. SECTION 02: WHERE CUSTOMERS DISAPPEAR */}
      {(analytics.contractStats || analytics.tenureStats || analytics.paymentMethodStats) && (
        <motion.section {...revealProps} className="space-y-5">
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#E84FA8]">
              02 · Attrition Drivers
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#11142B]">
              WHERE {tmpl.entityPlural.toUpperCase()}{' '}
              <span className="bg-gradient-to-r from-[#FF786B] via-[#E84FA8] to-[#7655E8] bg-clip-text text-transparent">
                DISAPPEAR
              </span>
            </h2>
            <p className="text-sm text-slate-600">
              Cohort attrition across {tmpl.segmentLabel.toLowerCase()},{' '}
              {tmpl.tenureLabel.toLowerCase()}, and mapped categorical dimensions
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {analytics.contractStats && (
              <div className="lg:col-span-6 bg-white/95 border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4 transition-all duration-200 hover:shadow-lg hover:shadow-[#7655E8]/[0.07] hover:border-purple-200">
                <div>
                  <h3 className="font-display text-base font-bold text-[#11142B]">
                    Churn by {tmpl.segmentLabel}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Grouped comparison across &ldquo;{dataset.mapping.contractColumn}&rdquo;
                  </p>
                </div>
                <GroupedChurnBarChart
                  data={analytics.contractStats}
                  xAxisLabel={tmpl.segmentLabel}
                />
              </div>
            )}

            {analytics.tenureStats && (
              <div className="lg:col-span-6 bg-white/95 border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4 transition-all duration-200 hover:shadow-lg hover:shadow-[#397BFF]/[0.07] hover:border-purple-200">
                <div>
                  <h3 className="font-display text-base font-bold text-[#11142B]">
                    {tmpl.tenureLabel} Analysis
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Retained vs. churned counts across tenure cohorts
                  </p>
                </div>
                <GroupedChurnBarChart
                  data={analytics.tenureStats}
                  xAxisLabel={tmpl.tenureLabel}
                />
              </div>
            )}

            {analytics.paymentMethodStats && (
              <div className="lg:col-span-6 bg-white/95 border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4 transition-all duration-200 hover:shadow-lg hover:shadow-[#E84FA8]/[0.07] hover:border-purple-200">
                <div>
                  <h3 className="font-display text-base font-bold text-[#11142B]">
                    {analytics.paymentMethodColumn} Breakdown
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Churn percentage across &ldquo;{analytics.paymentMethodColumn}&rdquo; categories
                  </p>
                </div>
                <CategoryChurnRateBarChart
                  data={analytics.paymentMethodStats}
                  barColor="#E84FA8"
                  height={265}
                />
              </div>
            )}

            {analytics.tenureStats && (
              <div className="lg:col-span-6 bg-white/95 border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4 transition-all duration-200 hover:shadow-lg hover:shadow-[#35C5E8]/[0.08] hover:border-purple-200">
                <div>
                  <h3 className="font-display text-base font-bold text-[#11142B]">
                    {tmpl.entitySingular} Retention Trends
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Retention rate (%) and churn rate (%) trajectory across tenure cohorts
                  </p>
                </div>
                <TenureTrendLineChart data={analytics.tenureStats} />
              </div>
            )}
          </div>

          {missingOptionalCharts.length > 0 && (
            <p className="text-xs text-slate-500">
              Note: Visualisations for {missingOptionalCharts.join(', ')} are hidden because
              matching columns are not present or mapped in this dataset.
            </p>
          )}
        </motion.section>
      )}

      {/* 5. SECTION 03: INTELLIGENCE BEYOND THE NUMBERS */}
      {intelligenceInsights.length > 0 && (
        <motion.section {...revealProps} className="space-y-5">
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#397BFF]">
              03 · Retention Intelligence
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#11142B]">
              <span className="bg-gradient-to-r from-[#397BFF] via-[#7655E8] to-[#E84FA8] bg-clip-text text-transparent">
                INTELLIGENCE
              </span>{' '}
              BEYOND THE NUMBERS
            </h2>
            <p className="text-sm text-slate-600">
              Verified statistical findings and retention opportunities calculated from your{' '}
              {tmpl.label} dataset{activeModel ? ' and trained ML feature weights' : ''}
            </p>
          </div>

          <div className="bg-white/95 border border-purple-100/90 rounded-[24px] shadow-sm shadow-purple-950/[0.05] overflow-hidden">
            <div className="bg-gradient-to-r from-[#11142B] via-[#211C59] to-[#4F257F] px-6 py-5 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-white/12 border border-white/25 flex items-center justify-center shrink-0">
                  <Cpu className="w-5 h-5 text-[#35C5E8]" />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#35C5E8] font-semibold">
                    Automated Pattern Extraction
                  </div>
                  <div className="font-display text-sm sm:text-base font-bold tracking-tight">
                    {tmpl.shortLabel} Customer Intelligence Engine
                  </div>
                </div>
              </div>

              <div className="text-xs font-mono text-indigo-100/90 shrink-0">
                {intelligenceInsights.length} Verified Signals
              </div>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {intelligenceInsights.map((item) => {
                const tone = INSIGHT_TONE_STYLES[item.tone];
                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border border-purple-100/90 bg-[#F5F3FF]/50 p-5 flex flex-col justify-between space-y-4 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-md ${tone.ringBorder}`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500">
                            {item.category}
                          </div>
                          <h3 className="font-display text-sm font-bold text-[#11142B] mt-1 leading-snug">
                            {item.title}
                          </h3>
                        </div>
                        <div
                          className={`w-8 h-8 rounded-xl ${tone.iconBg} text-white flex items-center justify-center shrink-0 shadow-xs`}
                        >
                          <TrendingUp className="w-4 h-4" />
                        </div>
                      </div>

                      <div className="flex items-baseline justify-between gap-2 pt-1">
                        <span className="text-xs text-slate-500">{item.statLabel}</span>
                        <span
                          className={`text-xl font-extrabold font-mono tabular-nums ${tone.statColor}`}
                        >
                          {item.statValue}
                        </span>
                      </div>

                      <div className="h-2 w-full rounded-full bg-purple-100/80 overflow-hidden">
                        <div
                          style={{ width: `${item.meterPercent}%` }}
                          className={`h-full rounded-full bg-gradient-to-r ${tone.barGradient} transition-all duration-700`}
                        />
                      </div>

                      <p className="text-xs text-slate-600 leading-relaxed">{item.explanation}</p>
                    </div>

                    <div className="pt-3 border-t border-purple-100/80 text-xs text-[#11142B] leading-relaxed">
                      <span className="font-bold text-[#7655E8]">Recommendation: </span>
                      {item.recommendation}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.section>
      )}

      {/* 6. SECTION 04: UNDERSTANDING THE RISK & PIPELINE DIAGNOSTICS */}
      <motion.section {...revealProps} className="space-y-5">
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#B84DE0]">
            04 · Predictive Scoring &amp; Pipeline
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#11142B]">
            UNDERSTANDING THE{' '}
            <span className="bg-gradient-to-r from-[#7655E8] via-[#397BFF] to-[#35C5E8] bg-clip-text text-transparent">
              RISK
            </span>
          </h2>
          <p className="text-sm text-slate-600">
            Account-level churn risk estimates generated automatically for {company.name}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-white/95 border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-bold text-[#11142B]">
                  {tmpl.entitySingular} Risk Overview
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {riskOverview && activeModel
                    ? `Prediction availability: Active · ${riskOverview.total.toLocaleString()} scored records`
                    : 'Predictions activate automatically once valid historical churn labels are confirmed'}
                </p>
              </div>

              {riskOverview && (
                <button
                  type="button"
                  onClick={() => onNavigate('predictions')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto"
                >
                  <span>Inspect All Predictions</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {riskOverview && activeModel ? (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <CircularRiskRing
                    label={`High-Risk ${tmpl.entityPlural}`}
                    count={riskOverview.highCount}
                    total={riskOverview.total}
                    strokeStart="#FF786B"
                    strokeEnd="#E84FA8"
                    badgeTextClass="text-[#D63384]"
                    description="Probability ≥ 65%"
                  />
                  <CircularRiskRing
                    label={`Medium-Risk ${tmpl.entityPlural}`}
                    count={riskOverview.medCount}
                    total={riskOverview.total}
                    strokeStart="#B84DE0"
                    strokeEnd="#7655E8"
                    badgeTextClass="text-[#7655E8]"
                    description="Probability 35% – 64.9%"
                  />
                  <CircularRiskRing
                    label={`Low-Risk ${tmpl.entityPlural}`}
                    count={riskOverview.lowCount}
                    total={riskOverview.total}
                    strokeStart="#16C995"
                    strokeEnd="#397BFF"
                    badgeTextClass="text-[#0E9F6E]"
                    description="Probability < 35%"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#11142B]">
                      Scored Risk Distribution
                    </span>
                    <span className="font-mono tabular-nums text-slate-600">
                      Mean Churn Probability:{' '}
                      <strong className="text-[#7655E8]">
                        {riskOverview.avgProb.toFixed(1)}%
                      </strong>
                    </span>
                  </div>
                  <div className="h-3.5 w-full rounded-full bg-[#F5F3FF] border border-purple-100 overflow-hidden flex">
                    <div
                      style={{
                        width: `${(riskOverview.highCount / riskOverview.total) * 100}%`,
                      }}
                      className="h-full bg-gradient-to-r from-[#FF786B] to-[#E84FA8]"
                      title={`High Risk: ${riskOverview.highCount}`}
                    />
                    <div
                      style={{
                        width: `${(riskOverview.medCount / riskOverview.total) * 100}%`,
                      }}
                      className="h-full bg-gradient-to-r from-[#B84DE0] to-[#7655E8]"
                      title={`Medium Risk: ${riskOverview.medCount}`}
                    />
                    <div
                      style={{
                        width: `${(riskOverview.lowCount / riskOverview.total) * 100}%`,
                      }}
                      className="h-full bg-gradient-to-r from-[#16C995] to-[#397BFF]"
                      title={`Low Risk: ${riskOverview.lowCount}`}
                    />
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="text-[11px] uppercase tracking-[0.14em] font-bold text-[#4C4A6E]">
                    Highest Churn Probability Accounts (Model Estimate)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-purple-100 text-[#4C4A6E] font-semibold">
                          <th className="py-2 pr-3">{tmpl.entitySingular} ID</th>
                          <th className="py-2 px-3">Split</th>
                          <th className="py-2 px-3">Predicted Status</th>
                          <th className="py-2 pl-3 text-right">Churn Probability</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-purple-50">
                        {riskOverview.topAtRisk.map((pred) => {
                          const pct = pred.churnProbability * 100;
                          return (
                            <tr key={`${pred.rowIndex}-${pred.customerId}`}>
                              <td className="py-2.5 pr-3 font-mono font-semibold text-[#11142B]">
                                {pred.customerId}
                              </td>
                              <td className="py-2.5 px-3 text-slate-500">{pred.split}</td>
                              <td className="py-2.5 px-3 font-medium text-[#D63384]">
                                {pred.predictedChurn}
                              </td>
                              <td className="py-2.5 pl-3 text-right">
                                <div className="inline-flex items-center gap-2.5">
                                  <div className="w-20 h-1.5 rounded-full bg-purple-100 overflow-hidden">
                                    <div
                                      style={{ width: `${pct}%` }}
                                      className="h-full rounded-full bg-gradient-to-r from-[#FF786B] to-[#E84FA8]"
                                    />
                                  </div>
                                  <span className="font-mono tabular-nums font-bold text-[#11142B] w-11 text-right">
                                    {pct.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-purple-200 bg-[#F5F3FF]/60 p-8 text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#7655E8] to-[#E84FA8] text-white flex items-center justify-center mx-auto shadow-md shadow-[#7655E8]/25">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div className="space-y-1 max-w-md mx-auto">
                  <h4 className="font-display text-sm font-bold text-[#11142B]">
                    {dataset.hasValidChurnLabels === false
                      ? 'More historical data required.'
                      : 'Predictions Are Not Active Yet'}
                  </h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {dataset.hasValidChurnLabels === false
                      ? 'Historical churn outcomes are missing or incomplete. Confirm your churn column in Data Management to activate predictions.'
                      : `Run Managed prediction setup to score High, Moderate, and Low churn risk across your ${tmpl.label} accounts.`}
                  </p>
                </div>
                {canGeneratePredictions && dataset.hasValidChurnLabels !== false && onAutoBuild && (
                  <button
                    type="button"
                    onClick={onAutoBuild}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#7655E8] to-[#E84FA8] hover:opacity-95 text-white text-xs font-bold rounded-xl shadow-md shadow-[#7655E8]/25 transition-all cursor-pointer whitespace-nowrap"
                  >
                    <BrainCircuit className="w-4 h-4" />
                    <span>Build prediction model</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="lg:col-span-5 bg-white/95 border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              <div>
                <h3 className="font-display text-base font-bold text-[#11142B]">
                  Summary of Latest Analysis
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {tmpl.label} workspace data readiness &amp; prediction availability
                </p>
              </div>

              <dl className="divide-y divide-purple-50 text-sm">
                <div className="py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Source File</dt>
                  <dd className="font-semibold text-[#11142B] truncate max-w-[200px]">
                    {dataset.fileName}
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Churn Outcome Field</dt>
                  <dd className="font-mono text-xs font-semibold text-[#7655E8]">
                    {dataset.mapping.targetColumn
                      ? `${dataset.mapping.targetColumn} (${dataset.mapping.positiveClassValue})`
                      : 'Unmapped'}
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Customer Data Preparation</dt>
                  <dd className="font-mono tabular-nums font-semibold text-[#11142B]">
                    {dataset.mapping.featureColumns.length} prepared signals
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Missing Values Checked</dt>
                  <dd className="font-mono tabular-nums font-semibold text-[#11142B]">
                    {missingTotal} cell(s)
                  </dd>
                </div>
                {dataset.readiness && (
                  <div className="py-2.5 flex items-center justify-between gap-4">
                    <dt className="text-slate-500">Data Readiness Score</dt>
                    <dd className="font-mono tabular-nums font-bold text-[#7655E8]">
                      {dataset.readiness.readinessScore}/100 ({dataset.readiness.overallLabel})
                    </dd>
                  </div>
                )}
                <div className="py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Prediction Availability</dt>
                  <dd className="font-semibold text-[#11142B] text-right flex items-center gap-1.5 justify-end">
                    {activeModel && <CheckCircle2 className="w-3.5 h-3.5 text-[#16C995] shrink-0" />}
                    <span>
                      {activeModel ? 'Active (Predictions ready)' : 'More historical data required'}
                    </span>
                  </dd>
                </div>
                {activeModel && (
                  <>
                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <dt className="text-slate-500">Validation Reliability</dt>
                      <dd className="font-mono tabular-nums font-bold text-[#397BFF]">
                        {activeModel.accuracy.toFixed(1)}%
                      </dd>
                    </div>
                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <dt className="text-slate-500">Churn Detection Balance</dt>
                      <dd className="font-mono tabular-nums font-bold text-[#7655E8]">
                        {activeModel.f1Score.toFixed(1)}%
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </div>

            <div className="pt-3 border-t border-purple-100 flex items-center justify-between gap-3">
              {activeModel ? (
                <>
                  <button
                    type="button"
                    onClick={() => onNavigate('performance')}
                    className="flex-1 px-3 py-2.5 text-xs font-semibold text-[#11142B] bg-[#F5F3FF] hover:bg-purple-100 border border-purple-200/70 rounded-xl transition-colors cursor-pointer text-center whitespace-nowrap"
                  >
                    Model Performance
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('predictions')}
                    className="flex-1 px-3 py-2.5 text-xs font-semibold text-white bg-gradient-to-r from-[#7655E8] to-[#E84FA8] hover:opacity-95 rounded-xl shadow-sm shadow-[#7655E8]/25 transition-all cursor-pointer text-center whitespace-nowrap"
                  >
                    Churn Predictions
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate('predictions')}
                  className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-[#7655E8] to-[#E84FA8] hover:opacity-95 rounded-xl shadow-md shadow-[#7655E8]/25 transition-all cursor-pointer"
                >
                  Open Churn Predictions
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.section>
    </div>
  );
};
