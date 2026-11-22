import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Download,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TrendingDown,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CompanyWorkspaceInfo,
  CustomerValueConfig,
  CustomerValueRecord,
  CustomerValueSummary,
  NavTab,
  ValueMatrixQuadrant,
  ValueSegmentTier,
} from '../types/churn';
import { apiFetch, downloadProtectedCsv } from '../utils/apiClient';
import { DashboardLoadingSkeleton } from './PremiumUI';

interface CustomerValueViewProps {
  company: CompanyWorkspaceInfo;
  datasetId: string | null;
  canEditConfig: boolean;
  embedded?: boolean;
  onNavigate: (tab: NavTab) => void;
}

const SEGMENT_COLORS: Record<ValueSegmentTier, string> = {
  'High Value': '#7655E8',
  'Medium Value': '#397BFF',
  'Low Value': '#94A3B8',
};

const QUADRANT_COLORS: Record<ValueMatrixQuadrant, string> = {
  critical_retention_priority: '#E04F44',
  protect_and_maintain: '#0E9F6E',
  monitor_and_assess: '#F59E0B',
  normal_monitoring: '#64748B',
  risk_unavailable: '#94A3B8',
};

function formatCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'Unavailable';
  return `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export const CustomerValueView: React.FC<CustomerValueViewProps> = ({
  company,
  datasetId,
  canEditConfig,
  embedded = false,
  onNavigate,
}) => {
  const [summary, setSummary] = useState<CustomerValueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Config drawer state
  const [showConfig, setShowConfig] = useState(false);
  const [draftConfig, setDraftConfig] = useState<CustomerValueConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configNotice, setConfigNotice] = useState<string | null>(null);

  // Table filter & drawer state
  const [search, setSearch] = useState('');
  const [segmentFilter, setSegmentFilter] = useState<'ALL' | ValueSegmentTier>('ALL');
  const [quadrantFilter, setQuadrantFilter] = useState<'ALL' | ValueMatrixQuadrant>('ALL');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerValueRecord | null>(null);

  const fetchValueIntelligence = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/value-intelligence');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to compute Customer Value Intelligence.');
      }
      setSummary(data.summary);
      setDraftConfig(data.summary?.config || null);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Unable to load Customer Value Intelligence.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchValueIntelligence();
  }, [fetchValueIntelligence, datasetId]);

  const handleSaveConfig = async () => {
    if (!draftConfig) return;
    setSavingConfig(true);
    setConfigNotice(null);
    setError(null);
    try {
      const res = await apiFetch('/api/value-intelligence/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftConfig),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save criteria settings.');
      }
      setSummary(data.summary);
      setDraftConfig(data.summary.config);
      setConfigNotice('Customer value weights and segmentation thresholds updated.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update criteria.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleResetDefaults = () => {
    setDraftConfig({
      weights: {
        revenue: 40,
        frequency: 20,
        tenure: 15,
        paymentHealth: 10,
        profit: 10,
        growth: 5,
      },
      highValuePercentile: 75,
      mediumValuePercentile: 35,
      highRiskCutoff: 0.5,
      annualizationMonths: 12,
    });
  };

  const filteredCustomers = useMemo(() => {
    if (!summary) return [];
    const q = search.trim().toLowerCase();
    return summary.customers.filter((c) => {
      if (segmentFilter !== 'ALL' && c.valueSegment !== segmentFilter) return false;
      if (quadrantFilter !== 'ALL' && c.quadrant !== quadrantFilter) return false;
      if (!q) return true;
      return (
        c.customerId.toLowerCase().includes(q) ||
        c.customerName.toLowerCase().includes(q) ||
        c.segment.toLowerCase().includes(q) ||
        c.quadrantLabel.toLowerCase().includes(q)
      );
    });
  }, [summary, search, segmentFilter, quadrantFilter]);

  const scatterPoints = useMemo(() => {
    if (!summary || !summary.riskPredictionsAvailable) return [];
    return summary.customers
      .filter((c) => c.churnProbability !== null)
      .slice(0, 250)
      .map((c) => ({
        customerId: c.customerId,
        customerName: c.customerName,
        valueScore: c.valueScore,
        churnRiskPct: Number(((c.churnProbability || 0) * 100).toFixed(1)),
        quadrant: c.quadrant,
        quadrantLabel: c.quadrantLabel,
        revenue: c.annualizedRevenue,
      }));
  }, [summary]);

  if (loading && !summary) {
    return <DashboardLoadingSkeleton />;
  }

  if (!summary || !summary.valueAssessmentAvailable) {
    return (
      <div className="space-y-6">
        {!embedded && (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[#11142B] tracking-tight">
                Customer Value Intelligence
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                Quantify customer revenue contribution, identify high-value accounts at risk, and prioritise retention investment.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('data')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#7655E8] to-[#397BFF] text-white text-sm font-semibold shadow-sm hover:opacity-95 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Open Import Centre</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="bg-white border border-purple-100 rounded-2xl p-8 text-center max-w-2xl mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-[#F5F3FF] text-[#7655E8] flex items-center justify-center mx-auto mb-4">
            <TrendingDown className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-[#11142B]">
            Customer Value Analysis Awaiting Dataset Attributes
          </h2>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            {summary?.unavailableReason ||
              'Upload a customer dataset containing financial or behavioural metrics (revenue, spend, purchase frequency, tenure, payment history, or profit margin) to generate Customer Value Intelligence.'}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('data')}
              className="px-4 py-2 rounded-xl bg-[#11142B] text-white text-sm font-semibold hover:bg-[#1b2042] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Upload Customer Data
            </button>
            <button
              type="button"
              onClick={fetchValueIntelligence}
              className="px-4 py-2 rounded-xl border border-purple-200 text-sm font-semibold text-[#11142B] hover:bg-[#F5F3FF] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Refresh Check
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {embedded ? (
            <h2 className="text-lg font-bold text-[#11142B] tracking-tight">
              Customer Value &amp; Revenue Exposure
            </h2>
          ) : (
            <h1 className="text-2xl font-bold text-[#11142B] tracking-tight">
              Customer Value Intelligence
            </h1>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
            <span>{company.name}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {summary.totalCustomers.toLocaleString()} customers evaluated
            </span>
            <span aria-hidden="true">·</span>
            <span>{summary.revenueBasisNote}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {canEditConfig && (
            <button
              type="button"
              onClick={() => setShowConfig((v) => !v)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showConfig
                  ? 'bg-[#11142B] text-white border-[#11142B]'
                  : 'bg-white text-[#11142B] border-purple-200 hover:bg-[#F5F3FF]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Configure Criteria</span>
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              downloadProtectedCsv(
                '/api/value-intelligence/export-csv',
                'churnsight_customer_value_intelligence.csv'
              )
            }
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-purple-200 bg-white text-xs font-semibold text-[#11142B] hover:bg-[#F5F3FF] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#7655E8]" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={fetchValueIntelligence}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-purple-200 bg-white text-xs font-semibold text-slate-600 hover:text-[#11142B] hover:bg-[#F5F3FF] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700 flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Configurable Criteria & Weighting Drawer */}
      {showConfig && draftConfig && (
        <div className="bg-white border border-purple-200 rounded-2xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-purple-100">
            <div>
              <h2 className="text-base font-bold text-[#11142B]">
                Configurable Value Assessment Criteria & Cutoffs
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Only detected dataset fields receive active weight; missing fields are automatically excluded and weights re-normalize cleanly.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetDefaults}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:text-[#11142B] cursor-pointer whitespace-nowrap shrink-0"
              >
                Reset Defaults
              </button>
              <button
                type="button"
                disabled={savingConfig}
                onClick={handleSaveConfig}
                className="px-4 py-1.5 rounded-lg bg-[#7655E8] text-white text-xs font-semibold hover:bg-[#6544d6] disabled:opacity-60 cursor-pointer whitespace-nowrap shrink-0"
              >
                {savingConfig ? 'Saving...' : 'Save & Recalculate'}
              </button>
            </div>
          </div>

          {configNotice && (
            <div className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-2">
              {configNotice}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {summary.criteriaAvailability.map((crit) => {
              const weightVal = draftConfig.weights[crit.key];
              return (
                <div
                  key={crit.key}
                  className={`p-3.5 rounded-xl border ${
                    crit.available
                      ? 'border-purple-100 bg-[#F5F3FF]/40'
                      : 'border-slate-200 bg-slate-50/70 opacity-75'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#11142B]">{crit.label}</span>
                    <span className="font-mono tabular-nums text-slate-600">
                      {crit.available ? `Effective ${crit.effectiveWeight}%` : 'Not in dataset'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      disabled={!crit.available}
                      value={weightVal}
                      onChange={(e) =>
                        setDraftConfig((prev) =>
                          prev
                            ? {
                                ...prev,
                                weights: { ...prev.weights, [crit.key]: Number(e.target.value) },
                              }
                            : prev
                        )
                      }
                      className="flex-1 accent-[#7655E8]"
                    />
                    <span className="w-10 text-right text-xs font-mono tabular-nums font-bold text-[#11142B]">
                      {weightVal}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">{crit.note}</p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-purple-100">
            <label className="block text-xs">
              <span className="font-semibold text-[#11142B]">High-Value Percentile Cutoff</span>
              <input
                type="number"
                min={50}
                max={95}
                value={draftConfig.highValuePercentile}
                onChange={(e) =>
                  setDraftConfig((prev) =>
                    prev ? { ...prev, highValuePercentile: Number(e.target.value) } : prev
                  )
                }
                className="mt-1.5 w-full px-3 py-2 rounded-lg border border-purple-200 text-xs font-mono tabular-nums"
              />
            </label>
            <label className="block text-xs">
              <span className="font-semibold text-[#11142B]">Medium-Value Percentile Cutoff</span>
              <input
                type="number"
                min={10}
                max={75}
                value={draftConfig.mediumValuePercentile}
                onChange={(e) =>
                  setDraftConfig((prev) =>
                    prev ? { ...prev, mediumValuePercentile: Number(e.target.value) } : prev
                  )
                }
                className="mt-1.5 w-full px-3 py-2 rounded-lg border border-purple-200 text-xs font-mono tabular-nums"
              />
            </label>
            <label className="block text-xs">
              <span className="font-semibold text-[#11142B]">High Churn Risk Cutoff (0.20–0.85)</span>
              <input
                type="number"
                min={0.2}
                max={0.85}
                step={0.05}
                value={draftConfig.highRiskCutoff}
                onChange={(e) =>
                  setDraftConfig((prev) =>
                    prev ? { ...prev, highRiskCutoff: Number(e.target.value) } : prev
                  )
                }
                className="mt-1.5 w-full px-3 py-2 rounded-lg border border-purple-200 text-xs font-mono tabular-nums"
              />
            </label>
            <label className="block text-xs">
              <span className="font-semibold text-[#11142B]">Annualization Window (Months)</span>
              <input
                type="number"
                min={1}
                max={36}
                value={draftConfig.annualizationMonths}
                onChange={(e) =>
                  setDraftConfig((prev) =>
                    prev ? { ...prev, annualizationMonths: Number(e.target.value) } : prev
                  )
                }
                className="mt-1.5 w-full px-3 py-2 rounded-lg border border-purple-200 text-xs font-mono tabular-nums"
              />
            </label>
          </div>
        </div>
      )}

      {/* Transparency Notices for Missing Profit or Missing Risk Model */}
      {(!summary.profitAvailable || !summary.riskPredictionsAvailable) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {!summary.profitAvailable && (
            <div className="bg-white border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-slate-700 leading-relaxed">
                <span className="font-bold text-[#11142B]">Profit Calculation Not Assumed: </span>
                {summary.profitUnavailableReason}
              </div>
            </div>
          )}
          {!summary.riskPredictionsAvailable && (
            <div className="bg-white border border-purple-200 rounded-2xl p-4 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-[#7655E8] shrink-0 mt-0.5" />
                <div className="text-xs text-slate-700 leading-relaxed">
                  <span className="font-bold text-[#11142B]">
                    Risk classification unavailable:{' '}
                  </span>
                  {summary.riskUnavailableReason}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('data')}
                className="text-xs font-semibold text-[#7655E8] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Import Historical Data
              </button>
            </div>
          )}
        </div>
      )}

      {/* Max 4 Top KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-purple-100 rounded-2xl p-5">
          <div className="text-xs font-medium text-slate-500">Portfolio Annualized Revenue</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#11142B] mt-2">
            {summary.revenueAvailable ? formatCurrency(summary.totalPortfolioRevenue) : 'Unavailable'}
          </div>
          <div className="text-xs text-slate-500 mt-1.5">
            {summary.profitAvailable
              ? `Measured profit: ${formatCurrency(summary.totalPortfolioProfit)}`
              : 'Profit unavailable (no cost/margin column)'}
          </div>
        </div>

        <div className="bg-white border border-purple-100 rounded-2xl p-5">
          <div className="text-xs font-medium text-slate-500">High-Value Customers</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#7655E8] mt-2">
            {summary.highValueCount.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 mt-1.5 font-mono tabular-nums">
            Top {100 - summary.config.highValuePercentile}% composite threshold ·{' '}
            {summary.totalCustomers > 0
              ? `${((summary.highValueCount / summary.totalCustomers) * 100).toFixed(1)}%`
              : '0%'}{' '}
            of base
          </div>
        </div>

        <div className="bg-white border border-purple-100 rounded-2xl p-5">
          <div className="text-xs font-medium text-slate-500">High-Value At Risk</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#E04F44] mt-2">
            {summary.riskPredictionsAvailable && summary.highValueAtRiskCount !== null
              ? summary.highValueAtRiskCount.toLocaleString()
              : 'Unavailable'}
          </div>
          <div className="text-xs text-slate-500 mt-1.5 font-mono tabular-nums">
            {summary.riskPredictionsAvailable
              ? `${formatCurrency(summary.highValueAtRiskRevenue)} full account revenue at risk`
              : 'Requires validated churn probabilities'}
          </div>
        </div>

        <div className="bg-white border border-purple-100 rounded-2xl p-5">
          <div className="text-xs font-medium text-slate-500">
            Expected Revenue Exposure (P × Rev)
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#11142B] mt-2">
            {summary.riskPredictionsAvailable && summary.revenueAvailable
              ? formatCurrency(summary.estimatedExpectedRevenueExposure)
              : 'Unavailable'}
          </div>
          <div className="text-xs text-slate-500 mt-1.5">
            {summary.riskPredictionsAvailable
              ? `Probability-weighted estimate · ${formatCurrency(summary.atRiskCustomersRevenue)} total at-risk`
              : 'Probability-weighted exposure awaits model'}
          </div>
        </div>
      </div>

      {/* 2-Column Visualization Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Value Segment Distribution */}
        <div className="bg-white border border-purple-100 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <h2 className="text-base font-bold text-[#11142B]">
                Customer Value Segment Distribution
              </h2>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                Cutoffs: P{summary.config.mediumValuePercentile} / P{summary.config.highValuePercentile}
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Data-driven segmentation from active portfolio criteria rather than arbitrary fixed labels.
            </p>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.segmentDistribution} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="segment" tick={{ fontSize: 12, fill: '#4755E9' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748B' }} allowDecimals={false} />
                <Tooltip
                  formatter={(value: unknown, name?: string | number) => [
                    name === 'count' ? `${value} customers` : String(value ?? ''),
                    name === 'count' ? 'Customers' : String(name ?? ''),
                  ]}
                />
                <Bar dataKey="count" radius={[8, 8, 0, 0]} maxBarSize={64}>
                  {summary.segmentDistribution.map((entry) => (
                    <Cell key={entry.segment} fill={SEGMENT_COLORS[entry.segment]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 pt-4 border-t border-purple-100 grid grid-cols-3 gap-3 text-xs">
            {summary.segmentDistribution.map((seg) => (
              <div key={seg.segment}>
                <div className="font-semibold text-[#11142B]">{seg.segment}</div>
                <div className="font-mono tabular-nums text-slate-600 mt-0.5">
                  {seg.count} ({seg.sharePercent}%)
                </div>
                <div className="font-mono tabular-nums text-[11px] text-slate-500">
                  {seg.totalRevenue !== null ? formatCurrency(seg.totalRevenue) : 'No revenue col'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Value vs Churn Risk 4-Quadrant Matrix */}
        <div className="bg-white border border-purple-100 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <h2 className="text-base font-bold text-[#11142B]">
                Customer Value × Churn Risk Matrix
              </h2>
              {summary.riskPredictionsAvailable && (
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  Risk Cutoff {(summary.config.highRiskCutoff * 100).toFixed(0)}%
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Combines composite customer value score (0–100) with estimated churn probability from the active model.
            </p>
          </div>

          {summary.riskPredictionsAvailable ? (
            <>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis
                      type="number"
                      dataKey="churnRiskPct"
                      name="Churn Risk"
                      domain={[0, 100]}
                      unit="%"
                      tick={{ fontSize: 11, fill: '#64748B' }}
                    />
                    <YAxis
                      type="number"
                      dataKey="valueScore"
                      name="Value Score"
                      domain={[0, 100]}
                      tick={{ fontSize: 11, fill: '#64748B' }}
                    />
                    <ReferenceLine
                      x={summary.config.highRiskCutoff * 100}
                      stroke="#E04F44"
                      strokeDasharray="4 4"
                    />
                    <ReferenceLine
                      y={summary.config.highValuePercentile}
                      stroke="#7655E8"
                      strokeDasharray="4 4"
                    />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const pt = payload[0].payload as (typeof scatterPoints)[number];
                        return (
                          <div className="bg-white border border-purple-200 rounded-xl p-3 text-xs shadow-md">
                            <div className="font-bold text-[#11142B]">{pt.customerId}</div>
                            <div className="text-slate-600 mt-0.5">{pt.quadrantLabel}</div>
                            <div className="font-mono tabular-nums mt-1 text-[#11142B]">
                              Value: {pt.valueScore} · Risk: {pt.churnRiskPct}%
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={scatterPoints}>
                      {scatterPoints.map((pt, idx) => (
                        <Cell key={`${pt.customerId}-${idx}`} fill={QUADRANT_COLORS[pt.quadrant]} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-4 pt-4 border-t border-purple-100 grid grid-cols-2 gap-3 text-xs">
                {summary.fourGroupMatrix.map((q) => (
                  <button
                    key={q.quadrant}
                    type="button"
                    onClick={() =>
                      setQuadrantFilter((prev) => (prev === q.quadrant ? 'ALL' : q.quadrant))
                    }
                    className={`text-left p-2.5 rounded-xl border transition-colors cursor-pointer ${
                      quadrantFilter === q.quadrant
                        ? 'border-[#7655E8] bg-[#F5F3FF]'
                        : 'border-slate-200 hover:border-purple-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#11142B] truncate">{q.label}</span>
                      <span className="font-mono tabular-nums font-bold text-[#11142B]">
                        {q.count}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                      {q.expectedExposure !== null
                        ? `Exposure ${formatCurrency(q.expectedExposure)}`
                        : q.totalRevenue !== null
                          ? `Revenue ${formatCurrency(q.totalRevenue)}`
                          : q.description}
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-10 px-4 border border-dashed border-purple-200 rounded-xl bg-[#F5F3FF]/30">
              <div className="text-sm font-bold text-[#11142B]">
                Risk classification unavailable
              </div>
              <p className="text-xs text-slate-600 mt-1.5 max-w-md leading-relaxed">
                {summary.riskUnavailableReason}
              </p>
              <button
                type="button"
                onClick={() => onNavigate('predictions')}
                className="mt-4 px-4 py-2 rounded-xl bg-[#11142B] text-white text-xs font-semibold hover:bg-[#1c2146] cursor-pointer whitespace-nowrap shrink-0"
              >
                Review Churn Predictions
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Prioritised Retention Recommendations */}
      {summary.recommendations.length > 0 && (
        <div className="bg-white border border-purple-100 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-[#11142B]">
                Evidence-Based Retention Priorities
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Estimates reflect revenue associated with elevated churn risk rather than guaranteed prevented losses.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {summary.recommendations.map((rec) => (
              <div
                key={rec.id}
                className="p-4 rounded-xl border border-purple-100 bg-[#F5F3FF]/35 flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span
                      className={`font-bold ${
                        rec.priority === 'Critical'
                          ? 'text-[#E04F44]'
                          : rec.priority === 'High'
                            ? 'text-amber-700'
                            : 'text-[#7655E8]'
                      }`}
                    >
                      {rec.priority} Priority
                    </span>
                    <span className="font-mono tabular-nums">
                      {rec.affectedCustomers} accounts
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-[#11142B] mt-1.5">{rec.title}</h3>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{rec.evidence}</p>
                </div>
                <div className="pt-3 border-t border-purple-100 text-xs text-[#11142B] leading-relaxed">
                  <span className="font-semibold">Suggested Action: </span>
                  {rec.recommendedAction}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Searchable, Traceable Customer Value Table */}
      <div className="bg-white border border-purple-100 rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-purple-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#11142B]">
              Customer Value & Exposure Ledger
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select any customer row to inspect exact weighted score contributions and risk evidence.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ID, name, segment..."
                className="pl-8 pr-3 py-1.5 rounded-lg border border-purple-200 text-xs w-52 focus:outline-none focus:ring-2 focus:ring-[#7655E8]"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['ALL', 'High Value', 'Medium Value', 'Low Value'] as const).map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setSegmentFilter(tier)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    segmentFilter === tier
                      ? 'bg-white text-[#11142B] shadow-xs'
                      : 'text-slate-600 hover:text-[#11142B]'
                  }`}
                >
                  {tier === 'ALL' ? 'All Tiers' : tier}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-purple-100 bg-[#F5F3FF]/50 text-slate-600">
                <th className="py-3 px-4 font-semibold">Customer</th>
                <th className="py-3 px-4 font-semibold">Segment</th>
                <th className="py-3 px-4 font-semibold text-right">Value Score</th>
                <th className="py-3 px-4 font-semibold">Value Tier</th>
                <th className="py-3 px-4 font-semibold text-right">Annualized Rev</th>
                <th className="py-3 px-4 font-semibold text-right">Churn Prob</th>
                <th className="py-3 px-4 font-semibold text-right">Expected Exposure</th>
                <th className="py-3 px-4 font-semibold">Priority Matrix</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-purple-50">
              {filteredCustomers.slice(0, 60).map((c) => (
                <tr
                  key={`${c.rowIndex}-${c.customerId}`}
                  onClick={() => setSelectedCustomer(c)}
                  className="hover:bg-[#F5F3FF]/60 transition-colors cursor-pointer"
                >
                  <td className="py-3 px-4">
                    <div className="font-mono font-semibold text-[#11142B]">{c.customerId}</div>
                    {c.customerName !== '—' && (
                      <div className="text-[11px] text-slate-500 truncate max-w-[160px]">
                        {c.customerName}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-700">{c.segment}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-[#11142B]">
                    {c.valueScore.toFixed(1)}
                  </td>
                  <td className="py-3 px-4 font-medium text-[#11142B]">{c.valueSegment}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                    {formatCurrency(c.annualizedRevenue)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                    {c.churnProbability !== null
                      ? `${(c.churnProbability * 100).toFixed(1)}%`
                      : 'Unavailable'}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-[#11142B]">
                    {formatCurrency(c.expectedRevenueExposure)}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`font-semibold ${
                        c.quadrant === 'critical_retention_priority'
                          ? 'text-[#E04F44]'
                          : c.quadrant === 'protect_and_maintain'
                            ? 'text-emerald-700'
                            : c.quadrant === 'monitor_and_assess'
                              ? 'text-amber-700'
                              : 'text-slate-600'
                      }`}
                    >
                      {c.quadrantLabel}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No customers match the active search or segment filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Traceability Drawer */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-[#11142B]/40 flex justify-end">
          <div className="w-full max-w-md bg-white h-full overflow-y-auto p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-purple-100">
              <div>
                <div className="text-xs text-slate-500">Customer Value Traceability</div>
                <h3 className="text-lg font-bold font-mono text-[#11142B] mt-0.5">
                  {selectedCustomer.customerId}
                </h3>
                <div className="text-xs text-slate-600 mt-0.5">
                  {selectedCustomer.customerName !== '—' ? `${selectedCustomer.customerName} · ` : ''}
                  {selectedCustomer.segment} · {selectedCustomer.valueSegment}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-[#11142B] hover:bg-slate-100 cursor-pointer"
                aria-label="Close traceability drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[#F5F3FF]/60 border border-purple-100">
                <div className="text-slate-500">Composite Score</div>
                <div className="text-lg font-bold font-mono tabular-nums text-[#7655E8] mt-1">
                  {selectedCustomer.valueScore.toFixed(1)} / 100
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#F5F3FF]/60 border border-purple-100">
                <div className="text-slate-500">Expected Exposure</div>
                <div className="text-lg font-bold font-mono tabular-nums text-[#11142B] mt-1">
                  {formatCurrency(selectedCustomer.expectedRevenueExposure)}
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              <h4 className="text-xs font-bold text-[#11142B] uppercase tracking-wider">
                Value Contribution Breakdown
              </h4>
              {selectedCustomer.valueFactors.map((f) => (
                <div
                  key={f.label}
                  className="p-3 rounded-xl border border-purple-100 flex items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-semibold text-[#11142B]">{f.label}</div>
                    <div className="text-slate-500 font-mono tabular-nums mt-0.5">
                      Observed: {f.rawDisplay} · Weight {f.weightPct}%
                    </div>
                  </div>
                  <div className="font-mono tabular-nums font-bold text-[#7655E8]">
                    P{f.percentileScore.toFixed(0)}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-[#11142B] uppercase tracking-wider">
                Churn Risk & Service Signals
              </h4>
              <div className="p-3.5 rounded-xl border border-slate-200 text-xs space-y-1.5">
                <div className="font-semibold text-[#11142B]">
                  {selectedCustomer.quadrantLabel}
                  {selectedCustomer.churnProbability !== null
                    ? ` (${(selectedCustomer.churnProbability * 100).toFixed(1)}% probability)`
                    : ''}
                </div>
                <ul className="list-disc pl-4 text-slate-600 space-y-1">
                  {selectedCustomer.riskFactors.map((rf, idx) => (
                    <li key={idx}>{rf}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
