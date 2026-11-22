import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, Info, Play, TrendingUp, History, ShieldQuestion, Database,
} from 'lucide-react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import { api } from '../lib/api';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import {
  Button, Field, Select, Input, Skeleton, EmptyState, Banner, Pill, SectionHeader, StatusBadge,
} from '../components/ui';
import { formatFullNumber, formatNumber, timeAgo, formatDateTime } from '../lib/format';

/**
 * Predictive analytics (UI spec §5.7, PRD FR-06).
 *
 * Suitability is checked before a run is created, the comparison table always
 * includes the naive baseline, and the disclaimer is not dismissible.
 */
export default function Predictive() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const { subscribe } = useRealtime();

  const [datasets, setDatasets] = useState([]);
  const [datasetId, setDatasetId] = useState('');
  const [dataset, setDataset] = useState(null);
  const [form, setForm] = useState({ targetColumn: '', timeField: '', horizon: 12, modelType: 'auto' });
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [runs, setRuns] = useState([]);
  const [activeRun, setActiveRun] = useState(null);
  const [runLoading, setRunLoading] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const ds = await api.datasets({ pageSize: 100, status: 'ready' });
        setDatasets(ds.data);
        const initial = searchParams.get('datasetId') || ds.data[0]?.id;
        if (initial) setDatasetId(initial);
      } catch (err) {
        toast.error('Could not load datasets', err.message);
      }
    })();
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRuns = async () => {
    try {
      const res = await api.forecasts();
      setRuns(res.data);
    } catch {
      setRuns([]);
    }
  };

  useEffect(() => {
    if (!datasetId) return;
    (async () => {
      try {
        const data = await api.dataset(datasetId);
        setDataset(data);
        const numeric = (data.columns || []).find((c) => c.type === 'number');
        const dateish = (data.columns || []).find((c) => c.type === 'date');
        setForm((f) => ({
          ...f,
          targetColumn: numeric?.name || '',
          timeField: dateish?.name || '',
        }));
        setCheck(null);
      } catch (err) {
        toast.error('Could not load dataset', err.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId]);

  const runIdFromUrl = searchParams.get('run');

  useEffect(() => {
    if (runIdFromUrl) openRun(runIdFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIdFromUrl]);

  useEffect(() => {
    const off = subscribe('forecast:ready', (payload) => {
      loadRuns();
      if (payload?.runId) openRun(payload.runId);
    });
    const off2 = subscribe('forecast:failed', () => loadRuns());
    return () => { off(); off2(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe]);

  const openRun = async (id) => {
    setRunLoading(true);
    try {
      const run = await api.forecast(id);
      setActiveRun(run);
    } catch (err) {
      toast.error('Could not load forecast', err.message);
    } finally {
      setRunLoading(false);
    }
  };

  const runCheck = async () => {
    if (!datasetId || !form.targetColumn) return;
    setChecking(true);
    try {
      const result = await api.forecastCheck({
        datasetId,
        targetColumn: form.targetColumn,
        timeField: form.timeField || null,
      });
      setCheck(result);
    } catch (err) {
      setCheck({ suitable: false, problems: [err.message], notes: [] });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (datasetId && form.targetColumn) runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, form.targetColumn, form.timeField]);

  const start = async () => {
    setStarting(true);
    setErrors({});
    try {
      const res = await api.startForecast({
        datasetId,
        targetColumn: form.targetColumn,
        timeField: form.timeField || null,
        horizon: Number(form.horizon),
        modelType: form.modelType,
      });
      toast.info('Forecast started', 'Training and evaluation run in the background.');
      setActiveRun({ id: res.id, status: 'processing' });

      // Poll as a fallback in case the socket event is missed.
      let attempts = 0;
      const timer = setInterval(async () => {
        attempts += 1;
        try {
          const run = await api.forecast(res.id);
          if (run.status !== 'processing') {
            clearInterval(timer);
            setActiveRun(run);
            loadRuns();
          }
        } catch {
          /* keep trying briefly */
        }
        if (attempts > 40) clearInterval(timer);
      }, 2500);
    } catch (err) {
      if (Object.keys(err.fields || {}).length) setErrors(err.fields);
      else toast.error('Could not start forecast', err.message);
    } finally {
      setStarting(false);
    }
  };

  const columns = dataset?.columns || [];
  const numericColumns = columns.filter((c) => c.type === 'number');
  const timeColumns = columns.filter((c) => c.type === 'date' || c.type === 'number' || c.type === 'category');
  const results = activeRun?.results || null;

  const chartRows = useMemo(() => {
    if (!results) return [];
    const history = (results.history || []).map((h) => ({
      period: h.period,
      actual: h.actual,
      predicted: null,
      band: null,
    }));
    const forecast = (results.forecast || []).map((f) => ({
      period: f.period,
      actual: null,
      predicted: f.predicted,
      band: [f.lower, f.upper],
    }));
    // Bridge the last actual point into the forecast so the line is continuous.
    if (history.length && forecast.length) {
      history[history.length - 1] = {
        ...history[history.length - 1],
        predicted: history[history.length - 1].actual,
      };
    }
    return [...history, ...forecast];
  }, [results]);

  const lastActualPeriod = results?.history?.length ? results.history[results.history.length - 1].period : null;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Predictive analytics</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Forecast a numeric measure and compare it against a naive baseline. Requires a numeric target and,
          ideally, a date field for a proper time series.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Configuration */}
        <aside className="card h-fit card-pad space-y-4">
          <Field label="Dataset" htmlFor="pa-dataset">
            <Select
              id="pa-dataset"
              value={datasetId}
              onChange={(e) => { setDatasetId(e.target.value); setActiveRun(null); }}
            >
              <option value="">Select a dataset…</option>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>

          <Field label="Target column (must be numeric)" htmlFor="pa-target">
            <Select
              id="pa-target"
              value={form.targetColumn}
              onChange={(e) => setForm({ ...form, targetColumn: e.target.value })}
            >
              <option value="">Select a numeric column…</option>
              {numericColumns.map((c) => (
                <option key={c.name} value={c.name}>{c.name} ({formatNumber(c.min)}–{formatNumber(c.max)})</option>
              ))}
            </Select>
            {numericColumns.length === 0 && dataset && (
              <p className="hint text-warn">This dataset has no numeric columns, so it cannot be forecast.</p>
            )}
          </Field>

          <Field
            label="Time field (optional)"
            htmlFor="pa-time"
            hint="Without a date field, rows are treated as evenly spaced periods in stored order."
          >
            <Select
              id="pa-time"
              value={form.timeField}
              onChange={(e) => setForm({ ...form, timeField: e.target.value })}
            >
              <option value="">No time field</option>
              {timeColumns.map((c) => (
                <option key={c.name} value={c.name}>{c.name} ({c.type})</option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Horizon" htmlFor="pa-horizon" hint="1–90 periods">
              <Input
                id="pa-horizon"
                type="number"
                min={1}
                max={90}
                value={form.horizon}
                onChange={(e) => setForm({ ...form, horizon: e.target.value })}
              />
            </Field>
            <Field label="Model" htmlFor="pa-model">
              <Select
                id="pa-model"
                value={form.modelType}
                onChange={(e) => setForm({ ...form, modelType: e.target.value })}
              >
                <option value="auto">Auto (best validated)</option>
                <option value="linear">Linear trend</option>
                <option value="seasonal_naive">Seasonal naive</option>
                <option value="baseline">Naive baseline</option>
              </Select>
            </Field>
          </div>

          {/* Suitability pre-flight */}
          {checking ? (
            <Skeleton className="h-20 w-full" />
          ) : check ? (
            <div className="space-y-2">
              {check.suitable ? (
                <Banner tone="ok" title="Data suitable for forecasting" icon={CheckCircle2}>
                  {formatNumber(check.observations)} observations available for the selected target.
                </Banner>
              ) : (
                <Banner tone="danger" title="This data cannot be forecast as configured" icon={AlertTriangle}>
                  <ul className="list-inside list-disc space-y-0.5">
                    {check.problems.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </Banner>
              )}
              {check.notes?.length > 0 && (
                <Banner tone="warn" title="Notes" icon={Info}>
                  <ul className="list-inside list-disc space-y-0.5">
                    {check.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </Banner>
              )}
            </div>
          ) : null}

          <Button
            className="w-full"
            onClick={start}
            loading={starting}
            disabled={!check?.suitable || !form.targetColumn}
            icon={Play}
          >
            Run forecast
          </Button>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            Training holds out the most recent periods for validation — time series are never split randomly.
          </p>
        </aside>

        {/* Results */}
        <div className="space-y-4">
          {!activeRun ? (
            <div className="card">
              <EmptyState
                icon={TrendingUp}
                title="No forecast selected"
                description="Configure a target and horizon, then run a forecast. Results show history alongside predictions, with the model's validation metrics."
              />
            </div>
          ) : activeRun.status === 'processing' || runLoading ? (
            <div className="card card-pad space-y-4">
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <Skeleton className="h-4 w-4 rounded-full" />
                Training and evaluating models…
              </div>
              <Skeleton className="h-72 w-full" />
            </div>
          ) : activeRun.status === 'failed' ? (
            <Banner tone="danger" title="Forecast failed" icon={AlertTriangle}>
              {activeRun.error_message || 'The model could not be trained on this data.'}
            </Banner>
          ) : results ? (
            <>
              <section className="card" aria-labelledby="fc-heading">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-edge px-5 py-3.5">
                  <div>
                    <h2 id="fc-heading" className="text-sm font-semibold text-ink">
                      {results.targetColumn} — actual vs predicted
                    </h2>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {results.observations} observations · {results.horizon}-period horizon · {results.validationPeriods} periods held out
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Pill tone="accent">{results.modelLabel}</Pill>
                    <Pill tone={results.beatsBaseline ? 'ok' : 'warn'}>
                      {results.beatsBaseline ? 'Beats baseline' : 'Baseline preferred'}
                    </Pill>
                  </div>
                </div>
                <div className="p-4">
                  <div style={{ height: 330 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartRows} margin={{ top: 10, right: 16, left: 4, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
                        <XAxis
                          dataKey="period"
                          tick={{ fontSize: 10, fill: '#5b6472' }}
                          tickLine={false}
                          axisLine={{ stroke: '#e3e6ea' }}
                          interval="preserveStartEnd"
                          minTickGap={24}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: '#5b6472' }}
                          tickLine={false}
                          axisLine={{ stroke: '#e3e6ea' }}
                          width={52}
                          tickFormatter={(v) => formatNumber(v)}
                        />
                        <Tooltip
                          formatter={(value, name) => [formatFullNumber(value), name]}
                          labelStyle={{ fontSize: 11, color: '#5b6472' }}
                          contentStyle={{ borderRadius: 8, border: '1px solid #e3e6ea', fontSize: 12 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} iconType="line" />
                        {lastActualPeriod && (
                          <ReferenceLine
                            x={lastActualPeriod}
                            stroke="#8a929f"
                            strokeDasharray="4 4"
                            label={{ value: 'forecast →', position: 'insideTopRight', fontSize: 9, fill: '#8a929f' }}
                          />
                        )}
                        <Area
                          dataKey="band"
                          name="95% interval"
                          stroke="none"
                          fill="#2563eb"
                          fillOpacity={0.12}
                          isAnimationActive={false}
                          connectNulls={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="actual"
                          name="Actual"
                          stroke="#16273f"
                          strokeWidth={2}
                          dot={false}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="predicted"
                          name="Predicted"
                          stroke="#2563eb"
                          strokeWidth={2}
                          strokeDasharray="5 3"
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="card card-pad">
                  <SectionHeader title="Validation metrics" description={`Measured on the held-out ${results.validationPeriods} periods`} />
                  <dl className="mt-3 grid grid-cols-2 gap-3">
                    {[
                      { label: 'MAE', value: formatFullNumber(results.metrics?.mae), hint: 'Mean absolute error' },
                      { label: 'RMSE', value: formatFullNumber(results.metrics?.rmse), hint: 'Root mean squared error' },
                      { label: 'MAPE', value: `${results.metrics?.mape ?? '—'}%`, hint: 'Mean absolute % error' },
                      { label: 'R²', value: results.metrics?.r2 ?? '—', hint: 'Proportion of variance explained' },
                    ].map((m) => (
                      <div key={m.label} className="rounded-lg border border-edge px-3 py-2.5">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{m.label}</dt>
                        <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">{m.value}</dd>
                        <p className="text-[10px] text-ink-faint">{m.hint}</p>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-3 text-[11px] text-ink-muted">
                    Lower MAE/RMSE/MAPE is better. R² below 0 means the model is worse than predicting the average.
                  </p>
                </section>

                <section className="card card-pad">
                  <SectionHeader title="Model comparison" description="Every candidate is scored on the same hold-out window" />
                  <div className="mt-3 overflow-hidden rounded-lg border border-edge">
                    <table className="w-full">
                      <thead className="bg-navy-50/70">
                        <tr>
                          <th className="th !py-2">Model</th>
                          <th className="th !py-2 text-right">RMSE</th>
                          <th className="th !py-2 text-right">MAE</th>
                          <th className="th !py-2 text-right">Selected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(results.modelComparison || []).map((m) => (
                          <tr key={m.modelType} className={`border-t border-edge/70 ${m.selected ? 'bg-accent-soft/60' : ''}`}>
                            <td className="td !py-2 text-[12px]">{m.label}</td>
                            <td className="td !py-2 text-right text-[12px] tabular-nums">{formatFullNumber(m.metrics?.rmse)}</td>
                            <td className="td !py-2 text-right text-[12px] tabular-nums">{formatFullNumber(m.metrics?.mae)}</td>
                            <td className="td !py-2 text-right">
                              {m.selected ? <CheckCircle2 size={14} className="ml-auto text-ok" /> : <span className="text-ink-faint">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              {results.warnings?.length > 0 && (
                <Banner tone="warn" title="Interpretation notes" icon={AlertTriangle}>
                  <ul className="list-inside list-disc space-y-1">
                    {results.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </Banner>
              )}

              <Banner tone="info" title="These are estimates, not guarantees" icon={ShieldQuestion}>
                {results.disclaimer} The shaded band shows a 95% interval that widens with the forecast horizon.
                Revisit the model when new data arrives.
              </Banner>
            </>
          ) : (
            <Banner tone="warn" title="No results stored">This run has no stored results.</Banner>
          )}
        </div>
      </div>

      {/* History */}
      <section className="card overflow-hidden" aria-labelledby="history-heading">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
          <div className="flex items-center gap-2">
            <History size={15} className="text-ink-faint" />
            <h2 id="history-heading" className="text-sm font-semibold text-ink">Forecast history</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={loadRuns}>Refresh</Button>
        </div>
        {runs.length === 0 ? (
          <EmptyState icon={TrendingUp} title="No forecast runs yet" description="Runs you start are stored with their configuration and metrics for later review." />
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[720px]">
              <thead className="bg-navy-50/70">
                <tr>
                  <th className="th">Dataset</th>
                  <th className="th">Target</th>
                  <th className="th">Model</th>
                  <th className="th">Horizon</th>
                  <th className="th">RMSE</th>
                  <th className="th">Status</th>
                  <th className="th">Created</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className={`table-row ${activeRun?.id === run.id ? 'bg-accent-soft/40' : ''}`}>
                    <td className="td max-w-[200px] truncate">{run.dataset_name}</td>
                    <td className="td">{run.target_column}</td>
                    <td className="td text-[12px]">{run.model_type || '—'}</td>
                    <td className="td tabular-nums">{run.horizon}</td>
                    <td className="td tabular-nums">{run.metrics?.rmse ? formatFullNumber(run.metrics.rmse) : '—'}</td>
                    <td className="td"><StatusBadge status={run.status} /></td>
                    <td className="td whitespace-nowrap text-[12px] text-ink-muted">{timeAgo(run.created_at)}</td>
                    <td className="td text-right">
                      <Button variant="ghost" size="sm" onClick={() => { openRun(run.id); setSearchParams({ run: run.id }); }}>
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
