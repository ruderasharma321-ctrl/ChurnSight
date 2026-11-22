import React from 'react';
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Flame,
  History,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AnalyticsSummary,
  HistoricalChurnPerformance,
  ActiveCustomerRiskSummary,
} from '../types/churn';

interface ChurnSeparationOverviewProps {
  analytics: AnalyticsSummary | null;
  entityPlural?: string;
  selectedPeriod?: string;
  isFilteringPeriod?: boolean;
  onPeriodChange?: (period: string) => void;
  compact?: boolean;
}

const BUCKET_COLORS: Record<string, string> = {
  '0–20%': '#059669',
  '20–40%': '#10B981',
  '40–60%': '#7655E8',
  '60–80%': '#EA580C',
  '80–100%': '#C2410C',
};

export const ChurnSeparationOverview: React.FC<ChurnSeparationOverviewProps> = ({
  analytics,
  entityPlural = 'Customers',
  selectedPeriod = 'ALL',
  isFilteringPeriod = false,
  onPeriodChange,
  compact = false,
}) => {
  if (!analytics) return null;

  const hp: HistoricalChurnPerformance = analytics.historicalPerformance || {
    reportingPeriodGranularity: 'monthly',
    selectedPeriod: 'ALL',
    availablePeriods: analytics.filterOptions?.reportingPeriods || [],
    customersAtStartOfPeriod: analytics.totalCustomers,
    actualChurnedCount: analytics.churnedCount,
    retainedCount: analytics.stayedCount,
    historicalChurnRate: analytics.isUnlabeledColdStart ? null : analytics.churnRate,
    historicalRateReliable: !analytics.isUnlabeledColdStart && analytics.totalCustomers > 0,
    historicalRateNotice: analytics.isUnlabeledColdStart
      ? 'Historical churn rate cannot be reliably calculated until confirmed Churned and Retained outcomes exist in the dataset.'
      : null,
    inconsistentRecordsCount: 0,
    inconsistentRecordsSample: [],
    unknownStatusCount: 0,
    hasDateColumns: false,
    historicalTrends: [],
    formulaDescription:
      'Historical Churn Rate = (Actual Customers Lost During Period / Customers at Start of Period) × 100',
  };

  const activeRisk: ActiveCustomerRiskSummary | null = analytics.activeRiskSummary || null;
  const activePeriod = hp.selectedPeriod || selectedPeriod || 'ALL';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* SECTION A: HISTORICAL CHURN PERFORMANCE */}
        <section className="bg-white border border-red-200/90 rounded-2xl shadow-xs overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-red-50/90 via-white to-white border-b border-red-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#DC2626]">
                <History className="w-3.5 h-3.5" />
                <span>Historical Fact · Already Left</span>
              </div>
              <h2 className="font-display text-lg font-bold text-[#11142B]">
                Historical Churn Performance
              </h2>
              <p className="text-xs text-slate-600">
                <strong className="text-[#DC2626]">Already Churned</strong> · From confirmed historical records only.
              </p>
            </div>

            {onPeriodChange && hp.availablePeriods.length > 0 && (
              <div className="shrink-0">
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Reporting Period ({hp.reportingPeriodGranularity})
                </label>
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5">
                  <CalendarRange className="w-3.5 h-3.5 text-[#DC2626] shrink-0" />
                  <select
                    aria-label="Reporting Period"
                    value={activePeriod}
                    disabled={isFilteringPeriod}
                    onChange={(e) => onPeriodChange(e.target.value)}
                    className="text-xs font-semibold text-[#11142B] bg-transparent focus:outline-none cursor-pointer"
                  >
                    <option value="ALL">All Observed Periods</option>
                    {hp.availablePeriods.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="p-6 space-y-4">
            {!hp.historicalRateReliable && hp.historicalRateNotice && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-2.5 text-xs text-amber-950">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Historical Rate Reliability Notice: </span>
                  {hp.historicalRateNotice}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div className="text-[11px] font-semibold text-slate-500 leading-tight">
                  Customers at Start of Period
                </div>
                <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-[#11142B]">
                  {hp.customersAtStartOfPeriod.toLocaleString()}
                </div>
              </div>

              <div className="rounded-xl border border-red-200 bg-red-50/70 p-3.5">
                <div className="text-[11px] font-semibold text-[#991B1B] leading-tight">
                  Customers Already Churned
                </div>
                <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-[#DC2626]">
                  {hp.actualChurnedCount.toLocaleString()}
                </div>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5">
                <div className="text-[11px] font-semibold text-[#065F46] leading-tight">
                  Retained (Active)
                </div>
                <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-[#059669]">
                  {hp.retainedCount.toLocaleString()}
                </div>
              </div>

              <div className="rounded-xl border border-red-200 bg-red-50/40 p-3.5">
                <div className="text-[11px] font-semibold text-[#991B1B] leading-tight">
                  Historical Churn Rate
                </div>
                <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-[#DC2626]">
                  {hp.historicalRateReliable && hp.historicalChurnRate !== null
                    ? `${hp.historicalChurnRate.toFixed(1)}%`
                    : 'Unavailable'}
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200/80 px-3.5 py-2 text-[11px] font-mono text-slate-600">
              {hp.formulaDescription}
            </div>

            {hp.inconsistentRecordsCount > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-3.5 space-y-2 text-xs text-amber-950">
                <div className="flex items-center justify-between gap-2 font-bold">
                  <span className="inline-flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-700" />
                    <span>
                      {hp.inconsistentRecordsCount} Conflicting Status Record
                      {hp.inconsistentRecordsCount === 1 ? '' : 's'} Flagged
                    </span>
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                    Excluded from clean rate
                  </span>
                </div>
                <p className="text-[11px] text-amber-900">
                  Records with conflicting labels or dates are marked <strong className="font-mono">Inconsistent</strong> and excluded from rates.
                </p>
                {!compact && hp.inconsistentRecordsSample.length > 0 && (
                  <div className="max-h-28 overflow-y-auto divide-y divide-amber-200/70 border-t border-amber-200/70 pt-1.5">
                    {hp.inconsistentRecordsSample.slice(0, 6).map((rec) => (
                      <div key={`${rec.rowIndex}-${rec.customerId}`} className="py-1 flex items-start gap-2 text-[11px]">
                        <span className="font-mono font-bold text-amber-950 shrink-0">
                          {rec.customerId}
                        </span>
                        <span className="text-amber-900">{rec.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!compact && hp.historicalTrends.length > 0 && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#11142B]">
                    Historical Churn Rate Trend ({hp.reportingPeriodGranularity})
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Based strictly on recorded churn dates
                  </span>
                </div>
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={hp.historicalTrends} margin={{ top: 8, right: 16, left: -12, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#FEE2E2" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#475569' }} />
                      <YAxis
                        tickFormatter={(v) => `${v}%`}
                        tick={{ fontSize: 11, fill: '#475569' }}
                        domain={[0, 'auto']}
                      />
                      <Tooltip
                        formatter={(value: unknown) => [`${Number(value).toFixed(1)}%`, 'Historical Churn Rate']}
                        contentStyle={{
                          borderRadius: '10px',
                          borderColor: '#FECACA',
                          fontSize: '12px',
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="churnRate"
                        name="Historical Churn Rate (%)"
                        stroke="#DC2626"
                        strokeWidth={2.5}
                        dot={{ r: 3.5, fill: '#DC2626', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* SECTION B: ACTIVE CUSTOMER RISK (FORWARD-LOOKING PREDICTIONS) */}
        <section className="bg-white border border-orange-200/90 rounded-2xl shadow-xs overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-orange-50/80 via-purple-50/40 to-white border-b border-orange-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#EA580C]">
                <Flame className="w-3.5 h-3.5" />
                <span>Forward Prediction · Currently Active Only</span>
              </div>
              <h2 className="font-display text-lg font-bold text-[#11142B]">
                Active Customer Risk
              </h2>
              <p className="text-xs text-slate-600">
                <strong className="text-[#EA580C]">At Risk of Churning</strong> · Forward risk for <strong className="text-[#059669]">Active</strong> {entityPlural.toLowerCase()} only.
              </p>
            </div>

            {activeRisk && (
              <div className="shrink-0 rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700">
                <span className="text-[#DC2626] font-mono font-bold">
                  {activeRisk.excludedChurnedCount.toLocaleString()}
                </span>{' '}
                already-churned excluded
              </div>
            )}
          </div>

          <div className="p-6 space-y-4">
            {!activeRisk ? (
              <div className="rounded-xl border border-dashed border-purple-200 bg-[#F5F3FF]/50 p-6 text-center space-y-2">
                <ShieldAlert className="w-6 h-6 text-[#7655E8] mx-auto" />
                <div className="text-sm font-bold text-[#11142B]">
                  Active Customer Risk Predictions Not Generated Yet
                </div>
                <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
                  Once your dataset passes historical outcome validation and a prediction model is built, active {entityPlural.toLowerCase()} are segmented here into High Risk, Medium Risk, and Low Risk without modifying their Active status.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5">
                    <div className="text-[11px] font-semibold text-[#065F46] leading-tight inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-[#059669] shrink-0" />
                      <span>Total Active</span>
                    </div>
                    <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-[#059669]">
                      {activeRisk.totalActiveCustomers.toLocaleString()}
                    </div>
                  </div>

                  <div className="rounded-xl border border-orange-200 bg-orange-50/80 p-3.5">
                    <div className="text-[11px] font-semibold text-[#9A3412] leading-tight">
                      High Risk (Active)
                    </div>
                    <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-[#EA580C]">
                      {activeRisk.activeHighRiskCount.toLocaleString()}
                    </div>
                  </div>

                  <div className="rounded-xl border border-purple-200 bg-[#F5F3FF] p-3.5">
                    <div className="text-[11px] font-semibold text-[#5B21B6] leading-tight">
                      Medium Risk (Active)
                    </div>
                    <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-[#7655E8]">
                      {activeRisk.activeMediumRiskCount.toLocaleString()}
                    </div>
                  </div>

                  <div className="rounded-xl border border-emerald-200/80 bg-white p-3.5">
                    <div className="text-[11px] font-semibold text-slate-600 leading-tight">
                      Low Risk (Active)
                    </div>
                    <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-[#059669]">
                      {activeRisk.activeLowRiskCount.toLocaleString()}
                    </div>
                  </div>
                </div>

                {activeRisk.highValueActiveAtRiskCount !== null &&
                  activeRisk.highValueActiveAtRiskCount !== undefined && (
                    <div className="rounded-xl border border-orange-200/90 bg-gradient-to-r from-orange-50/70 to-purple-50/40 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="inline-flex items-center gap-2 font-semibold text-[#11142B]">
                        <TrendingUp className="w-4 h-4 text-[#EA580C]" />
                        <span>
                          High-Value Active {entityPlural} at Risk:{' '}
                          <strong className="font-mono text-[#EA580C]">
                            {activeRisk.highValueActiveAtRiskCount.toLocaleString()}
                          </strong>
                        </span>
                      </div>
                      {activeRisk.highValueActiveAtRiskRevenue !== null &&
                        activeRisk.highValueActiveAtRiskRevenue !== undefined && (
                          <span className="font-mono font-bold text-[#7655E8]">
                            ${activeRisk.highValueActiveAtRiskRevenue.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })}{' '}
                            annualized exposure
                          </span>
                        )}
                    </div>
                  )}

                {!compact && activeRisk.activeProbabilityDistribution.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#11142B]">
                        Predicted Churn Probability Distribution (Active {entityPlural} Only)
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {activeRisk.scoredActiveCustomers.toLocaleString()} active scored
                      </span>
                    </div>
                    <div className="h-48 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={activeRisk.activeProbabilityDistribution}
                          margin={{ top: 18, right: 12, left: -16, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#EDE9FE" vertical={false} />
                          <XAxis dataKey="rangeLabel" tick={{ fontSize: 11, fill: '#475569' }} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                          <Tooltip
                            formatter={(value: unknown) => [
                              `${Number(value).toLocaleString()} active ${entityPlural.toLowerCase()}`,
                              'Count',
                            ]}
                            contentStyle={{
                              borderRadius: '10px',
                              borderColor: '#FED7AA',
                              fontSize: '12px',
                            }}
                          />
                          <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={56}>
                            {activeRisk.activeProbabilityDistribution.map((entry) => (
                              <Cell
                                key={entry.bucket}
                                fill={BUCKET_COLORS[entry.bucket] || '#7655E8'}
                              />
                            ))}
                            <LabelList
                              dataKey="count"
                              position="top"
                              style={{ fontSize: '11px', fontWeight: 700, fill: '#11142B' }}
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
