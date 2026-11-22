import React, { useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, Filter, RotateCcw } from 'lucide-react';
import {
  AnalyticsFilters,
  AnalyticsSummary,
  CompanyWorkspaceInfo,
  DatasetState,
  NavTab,
} from '../types/churn';
import { apiFetch } from '../utils/apiClient';
import { getIndustryTemplate } from '../utils/industryConfig';
import {
  AverageChargesBarChart,
  CategoryChurnRateBarChart,
  ChurnDoughnutChart,
  GroupedCategoryChart,
  GroupedChurnBarChart,
  NumericComparisonChart,
  TenureTrendLineChart,
} from './Charts';

interface DataAnalysisViewProps {
  company: CompanyWorkspaceInfo;
  dataset: DatasetState | null;
  analytics: AnalyticsSummary | null;
  onNavigate: (tab: NavTab) => void;
}

const DEFAULT_FILTERS: AnalyticsFilters = {
  contract: 'ALL',
  churnStatus: 'ALL',
  tenureGroup: 'ALL',
  paymentMethod: 'ALL',
  reportingPeriod: 'ALL',
};

export const DataAnalysisView: React.FC<DataAnalysisViewProps> = ({
  company,
  dataset,
  analytics,
  onNavigate,
}) => {
  const tmpl = getIndustryTemplate(company.industry, company.customIndustryName);
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);
  const [filteredAnalytics, setFilteredAnalytics] = useState<AnalyticsSummary | null>(analytics);
  const [isFiltering, setIsFiltering] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [selectedCategoryCol, setSelectedCategoryCol] = useState<string>('');

  useEffect(() => {
    setFilters(DEFAULT_FILTERS);
    setFilteredAnalytics(analytics);
    setFilterError(null);
  }, [dataset?.datasetId, analytics]);

  const activeData = filteredAnalytics || analytics;
  const categoricalKeys = activeData ? Object.keys(activeData.categoricalBreakdowns) : [];

  useEffect(() => {
    if (categoricalKeys.length > 0 && !categoricalKeys.includes(selectedCategoryCol)) {
      const preferred =
        categoricalKeys.find((k) => k.toLowerCase().includes('segment')) ||
        categoricalKeys.find((k) => k.toLowerCase().includes('plan')) ||
        categoricalKeys.find((k) => k.toLowerCase().includes('payment')) ||
        categoricalKeys[0];
      setSelectedCategoryCol(preferred);
    }
  }, [categoricalKeys, selectedCategoryCol]);

  const applyFilters = async (nextFilters: AnalyticsFilters) => {
    setFilters(nextFilters);
    const isDefault =
      (!nextFilters.contract || nextFilters.contract === 'ALL') &&
      (!nextFilters.churnStatus || nextFilters.churnStatus === 'ALL') &&
      (!nextFilters.tenureGroup || nextFilters.tenureGroup === 'ALL') &&
      (!nextFilters.paymentMethod || nextFilters.paymentMethod === 'ALL') &&
      (!nextFilters.reportingPeriod || nextFilters.reportingPeriod === 'ALL');

    if (isDefault) {
      setFilteredAnalytics(analytics);
      setFilterError(null);
      return;
    }

    setIsFiltering(true);
    setFilterError(null);
    try {
      const res = await apiFetch('/api/analytics/filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextFilters),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to apply chart filters.');
      }
      setFilteredAnalytics(data.analytics);
    } catch (err: unknown) {
      setFilterError(err instanceof Error ? err.message : 'Failed to apply chart filters.');
    } finally {
      setIsFiltering(false);
    }
  };

  if (!dataset || !activeData) {
    return (
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-10 text-center max-w-xl mx-auto space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#397BFF] to-[#7655E8] text-white flex items-center justify-center mx-auto shadow-md shadow-[#397BFF]/25">
          <BarChart3 className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-[#15152F]">No Dataset Loaded</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Load a {tmpl.label} sample dataset or upload your own CSV/Excel spreadsheet in Data
          Management to explore Business Analytics.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('data')}
          className="px-5 py-2.5 bg-gradient-to-r from-[#7655E8] to-[#E84FA8] hover:opacity-95 text-white text-sm font-semibold rounded-xl shadow-sm shadow-[#7655E8]/25 cursor-pointer whitespace-nowrap"
        >
          Open Data Management
        </button>
      </div>
    );
  }

  const hasActiveFilter =
    (filters.contract && filters.contract !== 'ALL') ||
    (filters.churnStatus && filters.churnStatus !== 'ALL') ||
    (filters.tenureGroup && filters.tenureGroup !== 'ALL') ||
    (filters.paymentMethod && filters.paymentMethod !== 'ALL') ||
    (filters.reportingPeriod && filters.reportingPeriod !== 'ALL');

  const baseTotal = analytics?.totalCustomers ?? activeData.totalCustomers;
  const hp = activeData.historicalPerformance;
  const historicalRateReliable = hp ? hp.historicalRateReliable : !activeData.isUnlabeledColdStart;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#15152F] tracking-tight">Business Analytics</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            <span className="font-semibold text-[#15152F]">{dataset.fileName}</span>
            {dataset.isSample ? ' (Demo)' : ''} ·{' '}
            <span className="font-mono tabular-nums font-bold text-[#7655E8]">
              {activeData.totalCustomers.toLocaleString()}
            </span>
            {hasActiveFilter ? ` of ${baseTotal.toLocaleString()} filtered` : ''} records
          </p>
        </div>

        <div className="text-xs font-medium text-slate-600 font-mono tabular-nums bg-white border border-purple-100 rounded-xl px-3.5 py-2 shadow-xs">
          {activeData.isUnlabeledColdStart || !historicalRateReliable ? (
            <>
              Historical Churn Rate:{' '}
              <span className="font-bold text-amber-700">
                {activeData.isUnlabeledColdStart ? 'Unavailable (Cold-Start)' : 'Unavailable'}
              </span>
            </>
          ) : (
            <>
              Historical Churn Rate:{' '}
              <span className="font-bold text-[#DC2626]">
                {(hp?.historicalChurnRate ?? activeData.churnRate).toFixed(1)}%
              </span>
            </>
          )}
        </div>
      </div>

      {hp && !hp.historicalRateReliable && hp.historicalRateNotice && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start gap-2.5 text-xs text-amber-950">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <strong>Historical Rate Reliability Notice:</strong> {hp.historicalRateNotice}
          </div>
        </div>
      )}

      {hp && hp.inconsistentRecordsCount > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start gap-2.5 text-xs text-amber-950">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <strong>Inconsistent Status Records ({hp.inconsistentRecordsCount}):</strong>{' '}
            Conflicting churn labels or cancellation/registration dates were detected and excluded from clean historical rates so figures remain trustworthy.
          </div>
        </div>
      )}

      {dataset.hasValidChurnLabels === false && dataset.churnReadinessMessage && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start gap-2.5 text-xs text-amber-950">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <strong>Churn Target Notice:</strong> {dataset.churnReadinessMessage}
          </div>
        </div>
      )}

      {activeData.calculationExplanation && (
        <div className="bg-[#F5F3FF] border border-purple-200/80 rounded-xl px-4 py-2.5 text-xs font-mono text-[#4C4A6E]">
          {activeData.calculationExplanation}
        </div>
      )}

      {/* Interactive BI Filter Bar */}
      <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-5 space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-[#15152F]">
            <Filter className="w-3.5 h-3.5 text-[#7655E8]" />
            <span>Filter Visualisations</span>
            {isFiltering && <span className="text-[#7655E8] font-normal">Updating...</span>}
          </div>

          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => applyFilters(DEFAULT_FILTERS)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {!activeData.isUnlabeledColdStart && (
            <div>
              <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">Churn Status</label>
              <select
                value={filters.churnStatus || 'ALL'}
                onChange={(e) =>
                  applyFilters({
                    ...filters,
                    churnStatus: e.target.value as 'ALL' | 'Churned' | 'Stayed',
                  })
                }
                className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F] focus:outline-none focus:border-[#7655E8]"
              >
                <option value="ALL">All {tmpl.entityPlural}</option>
                <option value="Churned">Churned Only</option>
                <option value="Stayed">Stayed (Retained) Only</option>
              </select>
            </div>
          )}

          {activeData.filterOptions.contracts.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                {tmpl.segmentLabel}
              </label>
              <select
                value={filters.contract || 'ALL'}
                onChange={(e) => applyFilters({ ...filters, contract: e.target.value })}
                className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F] focus:outline-none focus:border-[#7655E8]"
              >
                <option value="ALL">All {tmpl.segmentLabel}s</option>
                {activeData.filterOptions.contracts.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          {activeData.filterOptions.tenureGroups.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                {tmpl.tenureLabel}
              </label>
              <select
                value={filters.tenureGroup || 'ALL'}
                onChange={(e) => applyFilters({ ...filters, tenureGroup: e.target.value })}
                className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F] focus:outline-none focus:border-[#7655E8]"
              >
                <option value="ALL">All Tenure Groups</option>
                {activeData.filterOptions.tenureGroups.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}

          {activeData.filterOptions.paymentMethods.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                {activeData.paymentMethodColumn || 'Category Breakdown'}
              </label>
              <select
                value={filters.paymentMethod || 'ALL'}
                onChange={(e) => applyFilters({ ...filters, paymentMethod: e.target.value })}
                className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F] focus:outline-none focus:border-[#7655E8]"
              >
                <option value="ALL">All Values</option>
                {activeData.filterOptions.paymentMethods.map((pm) => (
                  <option key={pm} value={pm}>
                    {pm}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(activeData.filterOptions.reportingPeriods?.length || 0) > 0 && (
            <div>
              <label className="block text-xs font-semibold text-[#4C4A6E] mb-1">
                Reporting Period
              </label>
              <select
                value={filters.reportingPeriod || 'ALL'}
                onChange={(e) => applyFilters({ ...filters, reportingPeriod: e.target.value })}
                className="w-full rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-2 text-xs font-medium text-[#15152F] focus:outline-none focus:border-[#7655E8]"
              >
                <option value="ALL">All Periods</option>
                {activeData.filterOptions.reportingPeriods!.map((period) => (
                  <option key={period} value={period}>
                    {period}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {filterError && (
          <div className="text-xs text-[#9A2E25] bg-[#FF786B]/10 border border-[#FF786B]/40 rounded-xl px-3 py-2">
            {filterError}
          </div>
        )}
      </div>

      {/* Core Visualisations */}
      <div
        className={`grid grid-cols-1 lg:grid-cols-12 gap-6 transition-opacity duration-200 ${
          isFiltering ? 'opacity-60 pointer-events-none' : 'opacity-100'
        }`}
      >
        {/* Churn Distribution */}
        <div className="lg:col-span-6 bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
          <div>
            <h2 className="text-base font-bold text-[#15152F]">
              {tmpl.entitySingular} Churn Distribution
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Share of stayed vs. churned ({activeData.totalCustomers.toLocaleString()}{' '}
              {tmpl.entityPlural.toLowerCase()})
            </p>
          </div>
          <ChurnDoughnutChart
            stayedCount={activeData.stayedCount}
            churnedCount={activeData.churnedCount}
            totalCustomers={activeData.totalCustomers}
          />
        </div>

        {/* Average Revenue Comparison */}
        {activeData.monthlyChargesComparison && (
          <div className="lg:col-span-6 bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-[#15152F]">
                Average {tmpl.revenueLabel} by Churn Status
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Mean {activeData.monthlyChargesComparison.columnName} for retained vs. churned{' '}
                {tmpl.entityPlural.toLowerCase()}
              </p>
            </div>
            <AverageChargesBarChart
              comparison={activeData.monthlyChargesComparison}
              metricLabel={tmpl.revenueLabel}
            />
          </div>
        )}

        {/* Frequency / Usage Comparison */}
        {activeData.frequencyComparison && (
          <div className="lg:col-span-6 bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-[#15152F]">
                Average {tmpl.frequencyLabel} by Churn Status
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Mean {activeData.frequencyComparison.columnName} comparing retained vs. churned
              </p>
            </div>
            <AverageChargesBarChart
              comparison={activeData.frequencyComparison}
              valuePrefix=""
              metricLabel={tmpl.frequencyLabel}
            />
          </div>
        )}

        {/* Segment Breakdown */}
        {activeData.contractStats && (
          <div className="lg:col-span-6 bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-[#15152F]">
                Churn by {tmpl.segmentLabel}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Retained vs. churned counts across &ldquo;{dataset.mapping.contractColumn}&rdquo;
              </p>
            </div>
            <GroupedChurnBarChart data={activeData.contractStats} xAxisLabel={tmpl.segmentLabel} />
          </div>
        )}

        {/* Tenure Cohorts */}
        {activeData.tenureStats && (
          <div className="lg:col-span-6 bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-[#15152F]">
                Churn by {tmpl.tenureLabel}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Retained vs. churned counts across tenure cohorts
              </p>
            </div>
            <GroupedChurnBarChart
              data={activeData.tenureStats}
              xAxisLabel={tmpl.tenureLabel}
            />
          </div>
        )}

        {/* Tenure Trends Line */}
        {activeData.tenureStats && (
          <div className="lg:col-span-6 bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-[#15152F]">
                {tmpl.tenureLabel} &amp; Retention Trends
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Churn rate (%) vs. retention trajectory across ordered cohorts
              </p>
            </div>
            <TenureTrendLineChart data={activeData.tenureStats} />
          </div>
        )}

        {/* Secondary Category Churn Rate */}
        {activeData.paymentMethodStats && (
          <div className="lg:col-span-6 bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-[#15152F]">
                Churn Rate by {activeData.paymentMethodColumn}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Category churn percentage across &ldquo;{activeData.paymentMethodColumn}&rdquo;
              </p>
            </div>
            <CategoryChurnRateBarChart
              data={activeData.paymentMethodStats}
              barColor="#E84FA8"
              height={265}
            />
          </div>
        )}
      </div>

      {/* Additional Domain Visualisations */}
      {activeData.additionalCharts.length > 0 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-[#15152F]">
              Additional Attribute Analysis
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Generated dynamically for categorical columns detected in {dataset.fileName}
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {activeData.additionalCharts.map((chart) => {
              const useRateBar =
                chart.key === 'onlineSecurity' ||
                chart.key === 'techSupport' ||
                chart.key === 'seniorCitizen';

              return (
                <div
                  key={chart.key}
                  className="lg:col-span-6 bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4"
                >
                  <div>
                    <h3 className="text-base font-bold text-[#15152F]">{chart.title}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Column: &ldquo;{chart.columnName}&rdquo; ·{' '}
                      {useRateBar
                        ? 'Churn rate (%) within each category'
                        : 'Retained vs. churned counts and category churn rate'}
                    </p>
                  </div>

                  {useRateBar ? (
                    <CategoryChurnRateBarChart
                      data={chart.stats}
                      barColor={chart.key === 'seniorCitizen' ? '#7655E8' : '#E84FA8'}
                      height={220}
                    />
                  ) : (
                    <GroupedChurnBarChart data={chart.stats} height={240} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Numeric Summary Table & Custom Categorical Explorer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
          <div>
            <h2 className="text-base font-bold text-[#15152F]">Numeric Attributes Comparison</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Mean values for all numeric columns grouped by churn outcome
            </p>
          </div>
          <NumericComparisonChart stats={activeData.numericComparisons} />
        </div>

        {categoricalKeys.length > 0 && (
          <div className="lg:col-span-6 bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-[#15152F]">
                  Categorical Attribute Explorer
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Inspect counts and churn rate across any categorical column
                </p>
              </div>

              <select
                value={selectedCategoryCol}
                onChange={(e) => setSelectedCategoryCol(e.target.value)}
                className="rounded-xl border border-purple-200 bg-[#F6F3FF]/40 px-3 py-1.5 text-xs font-semibold text-[#15152F] focus:outline-none focus:border-[#7655E8]"
              >
                {categoricalKeys.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </div>

            {selectedCategoryCol && activeData.categoricalBreakdowns[selectedCategoryCol] && (
              <GroupedCategoryChart data={activeData.categoricalBreakdowns[selectedCategoryCol]} />
            )}
          </div>
        )}
      </div>

      {activeData.behaviourMonitoring &&
        activeData.behaviourMonitoring.watchlistSample.length > 0 && (
          <div className="bg-white border border-purple-100/90 rounded-2xl shadow-sm shadow-purple-950/[0.04] p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-[#15152F]">
                  Behaviour Monitoring Watchlist
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Early inactivity and low-engagement signals ({activeData.behaviourMonitoring.inactivityWatchlistCount} inactivity alerts · {activeData.behaviourMonitoring.lowEngagementCount} low engagement) — never classified as churn without confirmed outcomes
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('data')}
                className="text-xs font-semibold text-[#7655E8] hover:text-[#E84FA8] cursor-pointer whitespace-nowrap"
              >
                Record Observed Outcomes →
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-purple-100 text-[#4C4A6E] font-semibold">
                    <th className="py-2 pr-3">{tmpl.entitySingular} ID</th>
                    <th className="py-2 px-3">Last Date</th>
                    <th className="py-2 px-3 text-right">Days Quiet</th>
                    <th className="py-2 px-3 text-right">Engagement</th>
                    <th className="py-2 px-3 text-right">Value</th>
                    <th className="py-2 pl-3">Signal Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-50">
                  {activeData.behaviourMonitoring.watchlistSample.map((item) => (
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
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                        {item.revenueValue ?? '—'}
                      </td>
                      <td className="py-2 pl-3 text-slate-600">{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {(!activeData.contractStats ||
        !activeData.tenureStats ||
        !activeData.monthlyChargesComparison ||
        !activeData.paymentMethodStats) && (
        <p className="text-xs text-slate-400">
          Hidden unmapped charts:{' '}
          {[
            !activeData.contractStats ? tmpl.segmentLabel : null,
            !activeData.tenureStats ? tmpl.tenureLabel : null,
            !activeData.monthlyChargesComparison ? tmpl.revenueLabel : null,
            !activeData.paymentMethodStats ? 'Secondary Category' : null,
          ]
            .filter(Boolean)
            .join(', ')}
        </p>
      )}
    </div>
  );
};
