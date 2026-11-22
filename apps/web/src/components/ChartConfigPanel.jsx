import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { Button, Field, Input, Select, Pill } from './ui';
import { api } from '../lib/api';

const CHART_TYPES = [
  { value: 'bar', label: 'Bar', hint: 'Compare values across categories' },
  { value: 'pie', label: 'Pie', hint: 'Show part-to-whole share' },
  { value: 'line', label: 'Line', hint: 'Track a value over time or sequence' },
  { value: 'area', label: 'Area', hint: 'Trend with volume emphasis' },
  { value: 'scatter', label: 'Scatter', hint: 'Compare two numeric fields' },
  { value: 'histogram', label: 'Histogram', hint: 'Distribution of one numeric field' },
];

const AGGREGATIONS = [
  { value: 'sum', label: 'Sum', numericOnly: true },
  { value: 'avg', label: 'Average', numericOnly: true },
  { value: 'count', label: 'Count of rows', numericOnly: false },
  { value: 'count_distinct', label: 'Distinct count', numericOnly: false },
  { value: 'min', label: 'Minimum', numericOnly: false },
  { value: 'max', label: 'Maximum', numericOnly: false },
  { value: 'median', label: 'Median', numericOnly: true },
  { value: 'none', label: 'No aggregation (raw points)', numericOnly: false },
];

const OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: '≤' },
];

/**
 * Chart configuration panel (UI spec §5.5).
 * Validates combinations client-side and explains *why* a chart cannot be
 * generated, mirroring the server's rules.
 */
export default function ChartConfigPanel({ columns = [], valueCounts = {}, config, onChange, onSubmit, onAutoPick, submitting }) {
  const [problem, setProblem] = useState(null);
  const [checking, setChecking] = useState(false);

  const numericColumns = useMemo(() => columns.filter((c) => c.type === 'number'), [columns]);
  const dimensionColumns = useMemo(
    () => columns.filter((c) => ['category', 'text', 'date', 'boolean', 'number'].includes(c.type)),
    [columns],
  );

  const set = (patch) => onChange({ ...config, ...patch });

  useEffect(() => {
    // Client-side compatibility rules, evaluated on every change.
    const yCol = columns.find((c) => c.name === config.yField);
    const agg = AGGREGATIONS.find((a) => a.value === config.aggregation);

    if (!config.xField && config.chartType !== 'histogram') {
      setProblem('Choose an x-axis field to plot.');
      return;
    }
    if (config.chartType === 'histogram' && !config.yField) {
      setProblem('Histograms need one numeric field.');
      return;
    }
    if (config.chartType === 'histogram' && yCol && yCol.type !== 'number') {
      setProblem(`"${yCol.name}" is text — histograms need a numeric field.`);
      return;
    }
    if (agg?.numericOnly && yCol && yCol.type !== 'number') {
      setProblem(`"${yCol.name}" is ${yCol.type}, so "${agg.label}" cannot be applied. Use count, or pick a numeric field.`);
      return;
    }
    if (config.chartType === 'scatter' && config.yField && yCol && yCol.type !== 'number') {
      setProblem('Scatter charts compare numeric values — pick a numeric value field.');
      return;
    }
    setProblem(null);
  }, [config, columns]);

  const addFilter = () => {
    const field = configurationFirstDimension(config, columns);
    set({
      filters: [...(config.filters || []), { field: field || '', operator: 'eq', value: '' }],
    });
  };

  const updateFilter = (index, patch) => {
    const filters = [...(config.filters || [])];
    filters[index] = { ...filters[index], ...patch };
    set({ filters });
  };

  const removeFilter = (index) => set({ filters: (config.filters || []).filter((_, i) => i !== index) });

  const runServerCheck = async () => {
    if (!config.datasetId) return;
    setChecking(true);
    try {
      const result = await api.validateChart({
        datasetId: config.datasetId,
        chartType: config.chartType,
        xField: config.xField,
        yField: config.yField,
        aggregation: config.aggregation,
      });
      setProblem(result.problems?.length ? result.problems.join(' ') : null);
    } catch {
      /* client-side rules already cover this */
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-5">
      <Field label="Chart type" htmlFor="chart-type">
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Chart type">
          {CHART_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => set({ chartType: type.value })}
              aria-pressed={config.chartType === type.value}
              title={type.hint}
              className={`rounded-lg border px-2 py-2 text-[12px] font-medium transition-colors ${
                config.chartType === type.value
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-edge bg-white text-ink-muted hover:border-navy-200 hover:text-ink'
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label={config.chartType === 'histogram' ? 'Numeric field' : 'X-axis (group by)'}
        htmlFor="x-field"
        hint={config.chartType === 'line' || config.chartType === 'area' ? 'Dates are sorted chronologically.' : undefined}
      >
        {config.chartType === 'histogram' ? (
          <Select id="x-field" value={config.yField || ''} onChange={(e) => set({ yField: e.target.value, xField: null })}>
            <option value="">Select a numeric column…</option>
            {numericColumns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </Select>
        ) : (
          <Select id="x-field" value={config.xField || ''} onChange={(e) => set({ xField: e.target.value })}>
            <option value="">Select a column…</option>
            {dimensionColumns.map((c) => (
              <option key={c.name} value={c.name}>{c.name} ({c.type})</option>
            ))}
          </Select>
        )}
      </Field>

      {config.chartType !== 'histogram' && (
        <Field label="Value field (Y-axis)" htmlFor="y-field">
          <Select id="y-field" value={config.yField || ''} onChange={(e) => set({ yField: e.target.value })}>
            <option value="">Select a column…</option>
            {columns.map((c) => (
              <option key={c.name} value={c.name}>{c.name} ({c.type})</option>
            ))}
          </Select>
        </Field>
      )}

      {config.chartType !== 'scatter' && config.chartType !== 'histogram' && (
        <Field label="Aggregation" htmlFor="aggregation">
          <Select id="aggregation" value={config.aggregation} onChange={(e) => set({ aggregation: e.target.value })}>
            {AGGREGATIONS.map((a) => (
              <option key={a.value} value={a.value} disabled={a.numericOnly && !numericColumns.length}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Chart title" htmlFor="chart-title">
        <Input
          id="chart-title"
          value={config.title || ''}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="e.g. Revenue by region"
          maxLength={200}
        />
      </Field>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[13px] font-medium text-ink">Filters</span>
          <button type="button" onClick={addFilter} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
            <Plus size={12} /> Add filter
          </button>
        </div>
        {(config.filters || []).length === 0 ? (
          <p className="rounded-lg border border-dashed border-edge px-3 py-2.5 text-[12px] text-ink-faint">
            No filters. All rows in the dataset are included.
          </p>
        ) : (
          <ul className="space-y-2">
            {config.filters.map((filter, i) => {
              const suggestions = valueCounts[filter.field] || [];
              return (
                <li key={i} className="rounded-lg border border-edge bg-white p-2">
                  <div className="flex items-center gap-1.5">
                    <Select
                      value={filter.field}
                      onChange={(e) => updateFilter(i, { field: e.target.value, value: '' })}
                      aria-label={`Filter ${i + 1} field`}
                      className="flex-1 text-[12px]"
                    >
                      <option value="">Field…</option>
                      {columns.map((c) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </Select>
                    <button type="button" onClick={() => removeFilter(i)} className="rounded p-1.5 text-ink-faint hover:bg-danger/5 hover:text-danger" aria-label={`Remove filter ${i + 1}`}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Select
                      value={filter.operator}
                      onChange={(e) => updateFilter(i, { operator: e.target.value })}
                      aria-label={`Filter ${i + 1} operator`}
                      className="w-[42%] text-[12px]"
                    >
                      {OPERATORS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </Select>
                    {suggestions.length > 0 && filter.operator !== 'gt' && filter.operator !== 'lt' && filter.operator !== 'gte' && filter.operator !== 'lte' ? (
                      <Select
                        value={filter.value ?? ''}
                        onChange={(e) => updateFilter(i, { value: e.target.value })}
                        aria-label={`Filter ${i + 1} value`}
                        className="flex-1 text-[12px]"
                      >
                        <option value="">Value…</option>
                        {suggestions.map((s) => (
                          <option key={s.value} value={s.value}>{s.value}</option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        value={filter.value ?? ''}
                        onChange={(e) => updateFilter(i, { value: e.target.value })}
                        placeholder="Value"
                        aria-label={`Filter ${i + 1} value`}
                        className="flex-1 text-[12px]"
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {problem && (
        <div className="rounded-lg border border-warn/30 bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-warn" role="status">
          {problem}
        </div>
      )}

      <div className="space-y-2 border-t border-edge pt-4">
        <Button className="w-full" onClick={onSubmit} disabled={!!problem} loading={submitting}>
          {submitting ? 'Generating…' : 'Generate chart'}
        </Button>
        <div className="flex gap-2">
          {onAutoPick && (
            <Button variant="secondary" size="sm" className="flex-1" onClick={onAutoPick} type="button">
              <Wand2 size={13} /> Suggest fields
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={runServerCheck} loading={checking} type="button" className="flex-1">
            Check with server
          </Button>
        </div>
        {columns.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            <Pill>{columns.length} columns</Pill>
            <Pill tone="accent">{numericColumns.length} numeric</Pill>
          </div>
        )}
      </div>
    </div>
  );
}

function configurationFirstDimension(config, columns) {
  return columns.find((c) => c.type === 'category')?.name || columns[0]?.name || '';
}

export { CHART_TYPES, AGGREGATIONS };
