import { useMemo } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart, Scatter, ScatterChart, ZAxis,
} from 'recharts';
import { formatFullNumber, formatNumber } from '../lib/format';
import { EmptyState, ErrorState, ChartSkeleton } from './ui';
import { BarChart3 } from 'lucide-react';

/**
 * Series colours are fixed and distinguishable, and every chart also carries
 * axis labels, a legend where relevant and a text summary — colour is never the
 * only signal (UI spec §3, §8).
 */
export const SERIES_COLORS = ['#2563eb', '#0d9488', '#f59e0b', '#7c3aed', '#dc2626', '#0891b2', '#65a30d', '#db2777'];

function compactAxisTick(value) {
  if (typeof value !== 'number') return value;
  return formatNumber(value);
}

function ChartTooltip({ active, payload, label, valueLabel }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-edge bg-white px-3 py-2 shadow-pop">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="mt-0.5 text-[13px] font-semibold text-ink">
          {valueLabel || entry.name}: {formatFullNumber(entry.value)}
        </p>
      ))}
    </div>
  );
}

/**
 * Renders chart data returned by /api/charts/query.
 * Handles loading, empty and error states explicitly (PRD FR-03).
 */
export default function ChartView({
  chartType = 'bar',
  data = [],
  loading = false,
  error = null,
  onRetry,
  xLabel = '',
  yLabel = 'Value',
  title,
  height = 300,
  showLegend = true,
  compact = false,
}) {
  const safeData = useMemo(() => (Array.isArray(data) ? data.filter((d) => d && d.label !== undefined) : []), [data]);

  const summary = useMemo(() => {
    if (!safeData.length) return null;
    const values = safeData.map((d) => Number(d.value) || 0);
    const total = values.reduce((a, b) => a + b, 0);
    const maxIdx = values.indexOf(Math.max(...values));
    return {
      total,
      top: safeData[maxIdx]?.label,
      topValue: values[maxIdx],
      points: safeData.length,
    };
  }, [safeData]);

  if (loading) return <ChartSkeleton className="h-full" />;
  if (error) return <ErrorState message={error} onRetry={onRetry} className="h-full" />;
  if (!safeData.length) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No data to display"
        description="The selected filters or aggregation may exclude every row. Try widening the filters or a different field."
        className="h-full"
      />
    );
  }

  const margin = { top: 8, right: 16, bottom: compact ? 4 : 8, left: 4 };
  const axisProps = {
    tick: { fontSize: 11, fill: '#5b6472' },
    tickLine: false,
    axisLine: { stroke: '#e3e6ea' },
  };
  const rotateLabels = safeData.length > 8;

  const renderChart = () => {
    switch (chartType) {
      case 'pie': {
        return (
          <PieChart>
            <Tooltip content={<ChartTooltip valueLabel={yLabel} />} />
            <Pie
              data={safeData}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius="78%"
              innerRadius="38%"
              paddingAngle={1.5}
              isAnimationActive={false}
              label={({ percent, index }) => (percent > 0.06 ? `${Math.round(percent * 100)}%` : '')}
              labelLine={false}
            >
              {safeData.map((_, i) => (
                <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} stroke="#fff" strokeWidth={1.5} />
              ))}
            </Pie>
            {showLegend && (
              <Legend
                verticalAlign="bottom"
                height={compact ? 24 : 40}
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11, color: '#5b6472' }}
              />
            )}
          </PieChart>
        );
      }
      case 'line':
        return (
          <LineChart data={safeData} margin={margin}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
            <XAxis
              dataKey="label"
              {...axisProps}
              interval="preserveStartEnd"
              minTickGap={42}
              angle={rotateLabels ? -30 : 0}
              textAnchor={rotateLabels ? 'end' : 'middle'}
              height={rotateLabels ? 52 : 30}
            />
            <YAxis {...axisProps} tickFormatter={compactAxisTick} width={48} />
            <Tooltip content={<ChartTooltip valueLabel={yLabel} />} />
            <Line
              type="monotone"
              dataKey="value"
              name={yLabel}
              stroke={SERIES_COLORS[0]}
              strokeWidth={2}
              dot={safeData.length <= 20 ? { r: 2.5, strokeWidth: 0, fill: SERIES_COLORS[0] } : false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        );
      case 'area':
        return (
          <AreaChart data={safeData} margin={margin}>
            <defs>
              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES_COLORS[0]} stopOpacity={0.28} />
                <stop offset="100%" stopColor={SERIES_COLORS[0]} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={42} height={30} />
            <YAxis {...axisProps} tickFormatter={compactAxisTick} width={48} />
            <Tooltip content={<ChartTooltip valueLabel={yLabel} />} />
            <Area type="monotone" dataKey="value" name={yLabel} stroke={SERIES_COLORS[0]} strokeWidth={2} fill="url(#areaFill)" isAnimationActive={false} />
          </AreaChart>
        );
      case 'scatter':
        return (
          <ScatterChart margin={{ ...margin, bottom: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" />
            <XAxis dataKey="label" {...axisProps} name={xLabel} height={44} angle={-25} textAnchor="end" interval="preserveStartEnd" minTickGap={36} />
            <YAxis dataKey="value" {...axisProps} tickFormatter={compactAxisTick} width={48} />
            <ZAxis range={[45, 45]} />
            <Tooltip content={<ChartTooltip valueLabel={yLabel} />} />
            <Scatter data={safeData} fill={SERIES_COLORS[0]} fillOpacity={0.7} isAnimationActive={false} />
          </ScatterChart>
        );
      case 'histogram':
      case 'bar':
      default:
        return (
          <BarChart data={safeData} margin={margin} barCategoryGap="22%">
            <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
            <XAxis
              dataKey="label"
              {...axisProps}
              interval={0}
              minTickGap={24}
              angle={rotateLabels ? -30 : 0}
              textAnchor={rotateLabels ? 'end' : 'middle'}
              height={rotateLabels ? 56 : 30}
              tickFormatter={(v) => (String(v).length > 14 ? `${String(v).slice(0, 13)}…` : v)}
            />
            <YAxis {...axisProps} tickFormatter={compactAxisTick} width={52} />
            <Tooltip content={<ChartTooltip valueLabel={yLabel} />} cursor={{ fill: '#f2f5fa' }} />
            <Bar dataKey="value" name={yLabel} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={56}>
              {safeData.map((_, i) => (
                <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        );
    }
  };

  return (
    <div className="flex h-full flex-col">
      {title && (
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {xLabel && <span className="text-[11px] text-ink-faint">by {xLabel}</span>}
        </div>
      )}
      {/* Explicit pixel height: ResponsiveContainer needs a measurable box.
          Do not add flex-1 here — flex-basis:0 collapses the height in a
          column flex parent and Recharts then renders nothing. */}
      <div style={height ? { height } : { flex: '1 1 260px', minHeight: 220 }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
      {/* Text alternative for screen readers and quick scanning. */}
      <p className="sr-only">
        {chartType} chart with {summary?.points} categories. Total {formatFullNumber(summary?.total)}.
        Largest category is {summary?.top} with {formatFullNumber(summary?.topValue)}.
      </p>
    </div>
  );
}
