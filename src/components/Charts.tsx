import React, { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CategoryChurnStat,
  CompanyWorkspaceInfo,
  DatasetState,
  FeatureImportance,
  ModelEvaluationResult,
  MonthlyChargesComparison,
  NumericComparisonStat,
} from '../types/churn';
import {
  formatAttributeValue,
  formatCurrencyUSD,
  formatFeatureDisplayName,
  getHumanReadableFieldLabel,
  inferFieldKind,
} from '../utils/formatters';

const COLOR_STAYED = '#059669'; // green for Active / Retained
const COLOR_CHURNED = '#DC2626'; // red for Churned (Left)
const COLOR_ACCENT_PURPLE = '#7655E8'; // vibrant purple
const COLOR_GRID = '#EDE9FE'; // soft lavender grid
const COLOR_AXIS = '#4C4A6E'; // muted navy-slate

interface ChurnSplitBarProps {
  stayedCount: number;
  churnedCount: number;
  totalCustomers: number;
}

export const ChurnSplitBar: React.FC<ChurnSplitBarProps> = ({
  stayedCount,
  churnedCount,
  totalCustomers,
}) => {
  if (totalCustomers === 0) return null;
  const stayedPct = (stayedCount / totalCustomers) * 100;
  const churnedPct = (churnedCount / totalCustomers) * 100;

  return (
    <div className="space-y-4">
      <div className="h-9 w-full bg-[#F6F3FF] rounded-xl overflow-hidden flex border border-purple-100 p-0.5">
        <div
          style={{ width: `${stayedPct}%` }}
          className="bg-emerald-600 h-full rounded-l-lg transition-all duration-300 flex items-center justify-center text-xs font-semibold text-white tabular-nums"
          title={`Stayed: ${stayedCount} (${stayedPct.toFixed(1)}%)`}
        >
          {stayedPct >= 14 ? `${stayedPct.toFixed(1)}%` : ''}
        </div>
        <div
          style={{ width: `${churnedPct}%` }}
          className="bg-red-600 h-full rounded-r-lg transition-all duration-300 flex items-center justify-center text-xs font-semibold text-white tabular-nums"
          title={`Churned: ${churnedCount} (${churnedPct.toFixed(1)}%)`}
        >
          {churnedPct >= 14 ? `${churnedPct.toFixed(1)}%` : ''}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
        <div className="flex items-center justify-between border border-emerald-200 rounded-xl px-4 py-3 bg-emerald-50/50">
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-sm bg-[#059669] shrink-0" />
            <span className="text-sm font-medium text-[#15152F]">Active (Retained)</span>
          </div>
          <div className="text-sm font-bold text-[#059669] font-mono tabular-nums">
            {stayedCount.toLocaleString()} ({stayedPct.toFixed(1)}%)
          </div>
        </div>

        <div className="flex items-center justify-between border border-red-200 rounded-xl px-4 py-3 bg-red-50/50">
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-sm bg-[#DC2626] shrink-0" />
            <span className="text-sm font-medium text-[#15152F]">Churned (Left)</span>
          </div>
          <div className="text-sm font-bold text-[#DC2626] font-mono tabular-nums">
            {churnedCount.toLocaleString()} ({churnedPct.toFixed(1)}%)
          </div>
        </div>
      </div>
    </div>
  );
};

interface GroupedCategoryChartProps {
  data: CategoryChurnStat[];
  emptyMessage?: string;
}

export const GroupedCategoryChart: React.FC<GroupedCategoryChartProps> = ({
  data,
  emptyMessage = 'No data available for this dimension.',
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-purple-200 rounded-xl bg-[#F6F3FF]/50">
        {emptyMessage}
      </div>
    );
  }

  const maxTotal = Math.max(1, ...data.map((d) => d.total));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-slate-500 pb-1">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#059669]" />
            <span>Active / Retained</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#DC2626]" />
            <span>Churned</span>
          </span>
        </div>
        <span>Hover a row to inspect exact counts</span>
      </div>

      <div className="space-y-2.5">
        {data.map((item, idx) => {
          const stayedWidth = (item.stayed / maxTotal) * 100;
          const churnedWidth = (item.churned / maxTotal) * 100;
          const isHovered = hoveredIdx === idx;

          return (
            <div
              key={item.category}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={`p-3 rounded-xl border transition-colors ${
                isHovered
                  ? 'border-[#7655E8]/40 bg-[#F6F3FF]'
                  : 'border-purple-100/80 bg-[#F6F3FF]/40'
              }`}
            >
              <div className="flex items-center justify-between text-sm mb-2 gap-2">
                <span className="font-medium text-[#15152F] truncate" title={item.category}>
                  {item.category}
                </span>
                <div className="flex items-center gap-3 text-xs font-mono tabular-nums shrink-0">
                  <span className="text-slate-600">
                    {item.stayed} active · {item.churned} churned
                  </span>
                  <span
                    className={`font-semibold ${
                      item.churnRate >= 40
                        ? 'text-[#DC2626]'
                        : item.churnRate >= 20
                          ? 'text-[#EA580C]'
                          : 'text-[#059669]'
                    }`}
                  >
                    {item.churnRate.toFixed(1)}% churn
                  </span>
                </div>
              </div>

              <div className="h-3 w-full bg-purple-100/70 rounded-full overflow-hidden flex">
                <div
                  style={{ width: `${stayedWidth}%` }}
                  className="bg-[#059669] h-full transition-all duration-200"
                />
                <div
                  style={{ width: `${churnedWidth}%` }}
                  className="bg-[#DC2626] h-full transition-all duration-200"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Recharts Business Intelligence Visualisations
// ---------------------------------------------------------------------------

interface ChartEmptyStateProps {
  message: string;
}

const ChartEmptyState: React.FC<ChartEmptyStateProps> = ({ message }) => (
  <div className="h-64 flex items-center justify-center text-center px-6 text-xs text-slate-500 border border-dashed border-purple-200 rounded-xl bg-[#F6F3FF]/50">
    {message}
  </div>
);

interface CategoryTooltipPayloadItem {
  payload?: CategoryChurnStat;
}

interface CustomCategoryTooltipProps {
  active?: boolean;
  payload?: CategoryTooltipPayloadItem[];
  label?: string;
}

const CategoryStatsTooltip: React.FC<CustomCategoryTooltipProps> = ({
  active,
  payload,
  label,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const stat = payload[0]?.payload;
  if (!stat) return null;

  return (
    <div className="bg-white border border-purple-100 rounded-xl shadow-lg shadow-purple-950/10 px-3.5 py-2.5 text-xs space-y-1">
      <div className="font-semibold text-[#15152F] border-b border-purple-100 pb-1">
        {label || stat.category}
      </div>
      <div className="flex items-center justify-between gap-4 text-slate-700">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-xs bg-[#059669]" />
          Active (Retained):
        </span>
        <span className="font-mono tabular-nums font-medium">{stat.stayed.toLocaleString()}</span>
      </div>
      <div className="flex items-center justify-between gap-4 text-slate-700">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-xs bg-[#DC2626]" />
          Churned:
        </span>
        <span className="font-mono tabular-nums font-medium">{stat.churned.toLocaleString()}</span>
      </div>
      <div className="flex items-center justify-between gap-4 text-slate-600 pt-1 border-t border-purple-100">
        <span>Total in Category:</span>
        <span className="font-mono tabular-nums font-medium">{stat.total.toLocaleString()}</span>
      </div>
      <div className="flex items-center justify-between gap-4 font-semibold text-[#DC2626]">
        <span>Category Churn Rate:</span>
        <span className="font-mono tabular-nums">{stat.churnRate.toFixed(1)}%</span>
      </div>
    </div>
  );
};

interface ChurnDoughnutChartProps {
  stayedCount: number;
  churnedCount: number;
  totalCustomers: number;
}

export const ChurnDoughnutChart: React.FC<ChurnDoughnutChartProps> = ({
  stayedCount,
  churnedCount,
  totalCustomers,
}) => {
  if (totalCustomers === 0) {
    return <ChartEmptyState message="No customer records match the selected filters." />;
  }

  const stayedPct = Number(((stayedCount / totalCustomers) * 100).toFixed(1));
  const churnedPct = Number(((churnedCount / totalCustomers) * 100).toFixed(1));

  const pieData = [
    { name: 'Stayed (Retained)', value: stayedCount, pct: stayedPct, color: COLOR_STAYED },
    { name: 'Churned (Left)', value: churnedCount, pct: churnedPct, color: COLOR_CHURNED },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-4">
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={56}
              outerRadius={88}
              paddingAngle={pieData.length > 1 ? 2 : 0}
              isAnimationActive={true}
              animationDuration={850}
              animationEasing="ease-out"
            >
              {pieData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => {
                const count = Number(value) || 0;
                const pct = totalCustomers > 0 ? ((count / totalCustomers) * 100).toFixed(1) : '0.0';
                return [`${count.toLocaleString()} customers (${pct}%)`, String(name)];
              }}
              contentStyle={{
                backgroundColor: '#FFFFFF',
                borderColor: '#EDE9FE',
                borderRadius: '12px',
                fontSize: '12px',
                boxShadow: '0 8px 24px rgba(21, 21, 47, 0.08)',
              }}
            />
            <Legend
              verticalAlign="bottom"
              height={28}
              iconType="square"
              wrapperStyle={{ fontSize: '12px', color: '#4C4A6E' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="border border-emerald-200 rounded-xl px-3.5 py-2.5 bg-emerald-50/50">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#059669] shrink-0" />
            <span>Active (Retained)</span>
          </div>
          <div className="mt-1 text-base font-bold text-[#15152F] font-mono tabular-nums">
            {stayedCount.toLocaleString()}{' '}
            <span className="text-xs font-semibold text-[#059669]">({stayedPct.toFixed(1)}%)</span>
          </div>
        </div>

        <div className="border border-red-200 rounded-xl px-3.5 py-2.5 bg-red-50/50">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#DC2626] shrink-0" />
            <span>Churned (Left)</span>
          </div>
          <div className="mt-1 text-base font-bold text-[#15152F] font-mono tabular-nums">
            {churnedCount.toLocaleString()}{' '}
            <span className="text-xs font-semibold text-[#DC2626]">({churnedPct.toFixed(1)}%)</span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface GroupedChurnBarChartProps {
  data: CategoryChurnStat[];
  xAxisLabel?: string;
  height?: number;
}

export const GroupedChurnBarChart: React.FC<GroupedChurnBarChartProps> = ({
  data,
  xAxisLabel,
  height = 270,
}) => {
  if (!data || data.length === 0) {
    return <ChartEmptyState message="No matching records available for this chart." />;
  }

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: xAxisLabel ? 22 : 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} vertical={false} />
          <XAxis
            dataKey="category"
            tick={{ fontSize: 11, fill: COLOR_AXIS }}
            axisLine={{ stroke: COLOR_GRID }}
            tickLine={false}
            interval={0}
            label={
              xAxisLabel
                ? {
                    value: xAxisLabel,
                    position: 'insideBottom',
                    offset: -14,
                    fontSize: 11,
                    fill: COLOR_AXIS,
                  }
                : undefined
            }
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: COLOR_AXIS }}
            axisLine={false}
            tickLine={false}
            label={{
              value: 'Customers',
              angle: -90,
              position: 'insideLeft',
              offset: 10,
              fontSize: 11,
              fill: COLOR_AXIS,
            }}
          />
          <Tooltip content={<CategoryStatsTooltip />} cursor={{ fill: 'rgba(118, 85, 232, 0.08)' }} />
          <Legend
            verticalAlign="top"
            height={30}
            iconType="square"
            wrapperStyle={{ fontSize: '12px', color: '#4C4A6E' }}
          />
          <Bar
            dataKey="stayed"
            name="Stayed (Retained)"
            fill={COLOR_STAYED}
            radius={[5, 5, 0, 0]}
            isAnimationActive={true}
            animationDuration={850}
              animationEasing="ease-out"
          />
          <Bar
            dataKey="churned"
            name="Churned"
            fill={COLOR_CHURNED}
            radius={[5, 5, 0, 0]}
            isAnimationActive={true}
            animationDuration={850}
              animationEasing="ease-out"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

interface AverageChargesBarChartProps {
  comparison: MonthlyChargesComparison | null;
  valuePrefix?: string;
  metricLabel?: string;
  dataset?: DatasetState | null;
  company?: CompanyWorkspaceInfo | null;
}

export const AverageChargesBarChart: React.FC<AverageChargesBarChartProps> = ({
  comparison,
  valuePrefix = '$',
  metricLabel,
  dataset,
  company,
}) => {
  if (!comparison || (comparison.stayedCount === 0 && comparison.churnedCount === 0)) {
    return <ChartEmptyState message="No numeric comparison records match the current filters." />;
  }

  const ctx = { dataset, company };
  const labelText =
    metricLabel || `Avg ${getHumanReadableFieldLabel(comparison.columnName, ctx)}`;
  const isCurrency = valuePrefix === '$';
  const formatVal = (n: number) =>
    isCurrency
      ? formatCurrencyUSD(n)
      : valuePrefix
        ? `${valuePrefix}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : formatAttributeValue(comparison.columnName, n, ctx);

  const chartData = [
    {
      status: 'Stayed (Retained)',
      avgCharges: comparison.stayedAvg,
      count: comparison.stayedCount,
      fill: COLOR_STAYED,
      label: formatVal(comparison.stayedAvg),
    },
    {
      status: 'Churned (Left)',
      avgCharges: comparison.churnedAvg,
      count: comparison.churnedCount,
      fill: COLOR_CHURNED,
      label: formatVal(comparison.churnedAvg),
    },
  ];

  const maxVal = Math.max(4, comparison.stayedAvg, comparison.churnedAvg);

  return (
    <div className="space-y-3">
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 24, right: 20, left: 10, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} vertical={false} />
            <XAxis
              dataKey="status"
              tick={{ fontSize: 12, fill: COLOR_AXIS }}
              axisLine={{ stroke: COLOR_GRID }}
              tickLine={false}
            />
            <YAxis
              domain={[0, Math.ceil(maxVal * 1.2)]}
              tick={{ fontSize: 11, fill: COLOR_AXIS }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) =>
                isCurrency
                  ? `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                  : `${valuePrefix}${Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}`
              }
              label={{
                value: isCurrency ? `${labelText} (USD)` : labelText,
                angle: -90,
                position: 'insideLeft',
                offset: 2,
                fontSize: 11,
                fill: COLOR_AXIS,
              }}
            />
            <Tooltip
              formatter={(value) => [formatVal(Number(value)), labelText]}
              contentStyle={{
                backgroundColor: '#FFFFFF',
                borderColor: '#EDE9FE',
                borderRadius: '12px',
                fontSize: '12px',
                boxShadow: '0 8px 24px rgba(21, 21, 47, 0.08)',
              }}
              cursor={{ fill: 'rgba(118, 85, 232, 0.08)' }}
            />
            <Bar
              dataKey="avgCharges"
              maxBarSize={76}
              radius={[6, 6, 0, 0]}
              isAnimationActive={true}
              animationDuration={850}
              animationEasing="ease-out"
            >
              {chartData.map((entry) => (
                <Cell key={entry.status} fill={entry.fill} />
              ))}
              <LabelList
                dataKey="label"
                position="top"
                style={{ fontSize: '12px', fontWeight: 700, fill: '#15152F' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="border border-purple-100 rounded-xl px-3.5 py-2.5 bg-[#F6F3FF]/60 flex items-center justify-between">
          <span className="text-slate-600">Stayed Avg ({comparison.stayedCount})</span>
          <span className="font-mono tabular-nums font-bold text-[#397BFF]">
            {formatVal(comparison.stayedAvg)}
          </span>
        </div>
        <div className="border border-purple-100 rounded-xl px-3.5 py-2.5 bg-[#F6F3FF]/60 flex items-center justify-between">
          <span className="text-slate-600">Churned Avg ({comparison.churnedCount})</span>
          <span className="font-mono tabular-nums font-bold text-[#D63384]">
            {formatVal(comparison.churnedAvg)}
          </span>
        </div>
      </div>
    </div>
  );
};

interface TenureTrendLineChartProps {
  data: CategoryChurnStat[];
}

export const TenureTrendLineChart: React.FC<TenureTrendLineChartProps> = ({ data }) => {
  if (!data || data.length === 0 || data.every((d) => d.total === 0)) {
    return <ChartEmptyState message="No tenure records match the current filters." />;
  }

  const enrichedData = data.map((d) => ({
    ...d,
    retentionRate: d.total > 0 ? Number((100 - d.churnRate).toFixed(1)) : 0,
  }));

  return (
    <div className="h-68 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={enrichedData} margin={{ top: 14, right: 20, left: 6, bottom: 22 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} />
          <XAxis
            dataKey="category"
            tick={{ fontSize: 11, fill: COLOR_AXIS }}
            axisLine={{ stroke: COLOR_GRID }}
            tickLine={false}
            label={{
              value: 'Customer Tenure Group (Months)',
              position: 'insideBottom',
              offset: -14,
              fontSize: 11,
              fill: COLOR_AXIS,
            }}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 11, fill: COLOR_AXIS }}
            axisLine={false}
            tickLine={false}
            label={{
              value: 'Rate (%)',
              angle: -90,
              position: 'insideLeft',
              offset: 8,
              fontSize: 11,
              fill: COLOR_AXIS,
            }}
          />
          <Tooltip content={<CategoryStatsTooltip />} />
          <Legend
            verticalAlign="top"
            height={30}
            wrapperStyle={{ fontSize: '12px', color: '#4C4A6E' }}
          />
          <Line
            type="monotone"
            dataKey="retentionRate"
            name="Retention Rate (%)"
            stroke="#059669"
            strokeWidth={3}
            dot={{ r: 4.5, fill: '#059669', strokeWidth: 2, stroke: '#FFFFFF' }}
            activeDot={{ r: 6.5, fill: '#059669' }}
            isAnimationActive={true}
            animationDuration={850}
              animationEasing="ease-out"
          />
          <Line
            type="monotone"
            dataKey="churnRate"
            name="Churn Rate (%)"
            stroke={COLOR_CHURNED}
            strokeWidth={3}
            dot={{ r: 4.5, fill: '#DC2626', strokeWidth: 2, stroke: '#FFFFFF' }}
            activeDot={{ r: 6.5, fill: '#DC2626' }}
            isAnimationActive={true}
            animationDuration={850}
              animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

interface CategoryChurnRateBarChartProps {
  data: CategoryChurnStat[];
  barColor?: string;
  height?: number;
}

export const CategoryChurnRateBarChart: React.FC<CategoryChurnRateBarChartProps> = ({
  data,
  barColor = COLOR_CHURNED,
  height = 250,
}) => {
  if (!data || data.length === 0) {
    return <ChartEmptyState message="No matching records available for this chart." />;
  }

  const formatted = data.map((d) => ({
    ...d,
    rateLabel: `${d.churnRate.toFixed(1)}%`,
  }));

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={formatted}
          layout="vertical"
          margin={{ top: 8, right: 44, left: 8, bottom: 16 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 11, fill: COLOR_AXIS }}
            axisLine={{ stroke: COLOR_GRID }}
            tickLine={false}
            label={{
              value: 'Churn Rate (%) = (Churned / Category Total) × 100',
              position: 'insideBottom',
              offset: -10,
              fontSize: 11,
              fill: COLOR_AXIS,
            }}
          />
          <YAxis
            type="category"
            dataKey="category"
            width={155}
            tick={{ fontSize: 11, fill: '#15152F' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CategoryStatsTooltip />} cursor={{ fill: 'rgba(118, 85, 232, 0.08)' }} />
          <Bar
            dataKey="churnRate"
            name="Category Churn Rate (%)"
            fill={barColor}
            maxBarSize={26}
            radius={[0, 6, 6, 0]}
            isAnimationActive={true}
            animationDuration={850}
              animationEasing="ease-out"
          >
            <LabelList
              dataKey="rateLabel"
              position="right"
              style={{ fontSize: '11px', fontWeight: 700, fill: '#15152F' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

interface NumericComparisonChartProps {
  stats: NumericComparisonStat[];
  dataset?: DatasetState | null;
  company?: CompanyWorkspaceInfo | null;
}

export const NumericComparisonChart: React.FC<NumericComparisonChartProps> = ({
  stats,
  dataset,
  company,
}) => {
  if (!stats || stats.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-slate-500">
        No numeric feature columns available for comparison.
      </div>
    );
  }

  const ctx = { dataset, company };

  const formatDiff = (colName: string, diff: number) => {
    const kind = inferFieldKind(colName, ctx);
    if (kind === 'currency_usd') {
      return `${diff >= 0 ? '+' : ''}${formatCurrencyUSD(diff)}`;
    }
    if (kind === 'percentage') {
      return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} pts`;
    }
    return `${diff >= 0 ? '+' : ''}${diff.toLocaleString('en-US', { maximumFractionDigits: 1 })}`;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-purple-100 text-xs font-semibold text-[#4C4A6E]">
            <th className="py-2.5 pr-4">Numeric Attribute</th>
            <th className="py-2.5 px-4 text-right">Overall Mean</th>
            <th className="py-2.5 px-4 text-right">Stayed Mean</th>
            <th className="py-2.5 pl-4 text-right">Churned Mean</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-purple-50 text-sm">
          {stats.map((row) => {
            const diff = row.churnedAvg - row.stayedAvg;
            const readableLabel = getHumanReadableFieldLabel(row.column, ctx);
            return (
              <tr key={row.column} className="hover:bg-[#F6F3FF]/70 transition-colors">
                <td className="py-2.5 pr-4 font-medium text-[#15152F]" title={row.column}>
                  {readableLabel}
                </td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                  {formatAttributeValue(row.column, row.overallAvg, ctx)}
                </td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#059669] font-semibold">
                  {formatAttributeValue(row.column, row.stayedAvg, ctx)}
                </td>
                <td className="py-2.5 pl-4 text-right font-mono tabular-nums text-[#DC2626] font-semibold">
                  {formatAttributeValue(row.column, row.churnedAvg, ctx)}{' '}
                  <span className="text-xs text-slate-400 font-normal">
                    ({formatDiff(row.column, diff)})
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

interface FeatureImportanceChartProps {
  importances: FeatureImportance[];
  dataset?: DatasetState | null;
  company?: CompanyWorkspaceInfo | null;
}

export const FeatureImportanceChart: React.FC<FeatureImportanceChartProps> = ({
  importances,
  dataset,
  company,
}) => {
  if (!importances || importances.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-slate-500">
        No feature importance data available.
      </div>
    );
  }

  const ctx = { dataset, company };
  const maxImportance = Math.max(1, ...importances.map((i) => i.importance));

  return (
    <div className="space-y-3">
      {importances.map((item) => {
        const displayFeature = formatFeatureDisplayName(item.feature, ctx);
        const barColor =
          item.direction === 'increases_churn'
            ? 'bg-gradient-to-r from-[#FF786B] to-[#E84FA8]'
            : item.direction === 'decreases_churn'
              ? 'bg-gradient-to-r from-[#397BFF] to-[#7655E8]'
              : 'bg-gradient-to-r from-[#7655E8] to-[#B84DE0]';

        const directionLabel =
          item.direction === 'increases_churn'
            ? 'Increases Risk'
            : item.direction === 'decreases_churn'
              ? 'Reduces Risk'
              : 'Model Share';

        const coefText =
          item.coefficient !== undefined
            ? `β = ${item.coefficient >= 0 ? '+' : ''}${item.coefficient.toFixed(2)} · `
            : '';

        const barWidth = Math.max(4, (item.importance / maxImportance) * 100);

        return (
          <div key={item.feature} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs gap-2">
              <span
                className="font-semibold text-[#15152F] truncate max-w-[52%]"
                title={displayFeature}
              >
                {displayFeature}
              </span>
              <span className="text-slate-600 font-mono tabular-nums shrink-0">
                {coefText}
                {directionLabel} · Impact share {item.importance.toFixed(1)}%
              </span>
            </div>
            <div className="h-2.5 w-full bg-[#F6F3FF] rounded-full overflow-hidden border border-purple-100/70">
              <div
                style={{ width: `${barWidth}%` }}
                className={`h-full ${barColor} rounded-full transition-all duration-300`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface ModelComparisonBarChartProps {
  runs: ModelEvaluationResult[];
}

export const ModelComparisonBarChart: React.FC<ModelComparisonBarChartProps> = ({ runs }) => {
  if (!runs || runs.length === 0) return null;

  const chartData = runs.map((run, idx) => ({
    label: `${run.modelName.replace(' Classifier', '')} (#${runs.length - idx})`,
    accuracy: Number(run.accuracy.toFixed(1)),
    precision: Number(run.precision.toFixed(1)),
    recall: Number(run.recall.toFixed(1)),
    f1Score: Number(run.f1Score.toFixed(1)),
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: COLOR_AXIS }}
            axisLine={{ stroke: COLOR_GRID }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 11, fill: COLOR_AXIS }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(val, name) => [`${Number(val).toFixed(1)}%`, String(name)]}
            contentStyle={{
              backgroundColor: '#FFFFFF',
              borderColor: '#EDE9FE',
              borderRadius: '12px',
              fontSize: '12px',
              boxShadow: '0 8px 24px rgba(21, 21, 47, 0.08)',
            }}
            cursor={{ fill: 'rgba(118, 85, 232, 0.08)' }}
          />
          <Legend
            verticalAlign="top"
            height={30}
            iconType="square"
            wrapperStyle={{ fontSize: '12px', color: '#4C4A6E' }}
          />
          <Bar
            dataKey="accuracy"
            name="Accuracy"
            fill="#7655E8"
            radius={[5, 5, 0, 0]}
            isAnimationActive={true}
            animationDuration={850}
              animationEasing="ease-out"
          />
          <Bar
            dataKey="precision"
            name="Precision"
            fill="#397BFF"
            radius={[5, 5, 0, 0]}
            isAnimationActive={true}
            animationDuration={850}
              animationEasing="ease-out"
          />
          <Bar
            dataKey="recall"
            name="Recall"
            fill="#E84FA8"
            radius={[5, 5, 0, 0]}
            isAnimationActive={true}
            animationDuration={450}
          />
          <Bar
            dataKey="f1Score"
            name="F1-Score"
            fill="#16C995"
            radius={[5, 5, 0, 0]}
            isAnimationActive={true}
            animationDuration={450}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
