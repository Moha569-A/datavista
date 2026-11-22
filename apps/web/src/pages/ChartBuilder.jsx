import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BarChart3, Plus, Save, LayoutGrid, Trash2, Database } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import ChartView from '../components/ChartView';
import ChartConfigPanel from '../components/ChartConfigPanel';
import {
  Button, Select, Field, Input, EmptyState, ErrorState, Skeleton, Modal, Banner, Pill,
} from '../components/ui';

const DEFAULT_CONFIG = {
  chartType: 'bar',
  xField: '',
  yField: '',
  aggregation: 'sum',
  filters: [],
  title: '',
  limit: 12,
};

/**
 * Chart builder (UI spec §5.5).
 * Three-pane layout: dataset + fields (left), live canvas (centre), save/add
 * actions (right). Chart data is always computed server-side from the imported
 * rows, so values match the dataset exactly.
 */
export default function ChartBuilder() {
  const navigate = useNavigate();
  const { id: chartId } = useParams();
  const [searchParams] = useSearchParams();

  const toast = useToast();
  const [datasets, setDatasets] = useState([]);
  const [dataset, setDataset] = useState(null);
  const [datasetState, setDatasetState] = useState({ loading: true, error: null });
  const [config, setConfig] = useState({ ...DEFAULT_CONFIG, datasetId: searchParams.get('datasetId') || '' });
  const [result, setResult] = useState(null);
  const [queryState, setQueryState] = useState({ loading: false, error: null });
  const [savedCharts, setSavedCharts] = useState([]);
  const [dashboards, setDashboards] = useState([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [saveTarget, setSaveTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const [ds, dash] = await Promise.all([api.datasets({ pageSize: 100, status: 'ready' }), api.dashboards()]);
        setDatasets(ds.data);
        setDashboards(dash.owned.filter((d) => d.canEdit));
        if (!config.datasetId && ds.data[0]) {
          setConfig((c) => ({ ...c, datasetId: ds.data[0].id }));
        }
      } catch (err) {
        setDatasetState({ loading: false, error: err.message });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load dataset schema
  useEffect(() => {
    if (!config.datasetId) {
      setDatasetState({ loading: false, error: null });
      setDataset(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setDatasetState({ loading: true, error: null });
      try {
        const data = await api.dataset(config.datasetId);
        if (cancelled) return;
        setDataset(data);
        setDatasetState({ loading: false, error: null });
      } catch (err) {
        if (!cancelled) setDatasetState({ loading: false, error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [config.datasetId]);

  // Load an existing chart when routed with an id
  useEffect(() => {
    if (!chartId) return;
    (async () => {
      try {
        const { data } = await api.charts();
        const chart = data.find((c) => c.id === chartId);
        if (chart) {
          setConfig({
            ...DEFAULT_CONFIG,
            ...chart.configuration,
            datasetId: chart.datasetId,
            chartType: chart.chartType,
            title: chart.title,
          });
          setSaveTarget({ id: chart.id, title: chart.title });
        }
      } catch {
        /* non-fatal */
      }
    })();
  }, [chartId]);

  useEffect(() => {
    if (config.datasetId) {
      api.charts(config.datasetId).then((r) => setSavedCharts(r.data)).catch(() => setSavedCharts([]));
    }
  }, [config.datasetId, result]);

  const canBuild = Boolean(config.datasetId && (config.chartType === 'histogram' ? config.yField : config.xField));

  const runQuery = async () => {
    if (!canBuild) return;
    setQueryState({ loading: true, error: null });
    try {
      const res = await api.queryChart({
        datasetId: config.datasetId,
        chartType: config.chartType,
        xField: config.xField || null,
        yField: config.yField || null,
        aggregation: config.aggregation,
        filters: (config.filters || []).filter((f) => f.field && f.value !== '' && f.value !== undefined),
        limit: config.limit,
      });
      setResult(res);
      setQueryState({ loading: false, error: null });
    } catch (err) {
      setResult(null);
      setQueryState({ loading: false, error: err.message });
    }
  };

  useEffect(() => {
    if (canBuild) {
      const timer = setTimeout(runQuery, 420);
      return () => clearTimeout(timer);
    }
    setResult(null);
    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.datasetId, config.chartType, config.xField, config.yField, config.aggregation, JSON.stringify(config.filters), config.limit]);

  const autoPick = () => {
    const cols = dataset?.columns || [];
    const numeric = cols.find((c) => c.type === 'number');
    const category = cols.find((c) => c.type === 'category') || cols.find((c) => c.type === 'date') || cols[0];
    if (!category || !numeric) return;
    const type = category.type === 'date' ? 'line' : 'bar';
    setConfig((c) => ({
      ...c,
      chartType: type,
      xField: category.name,
      yField: numeric.name,
      aggregation: 'sum',
      title: c.title || `${numeric.name} by ${category.name}`,
    }));
  };

  const saveChart = async () => {
    setBusy(true);
    setFormErrors({});
    const payload = {
      title: config.title.trim() || `${config.aggregation} of ${config.yField} by ${config.xField}`,
      chartType: config.chartType,
      configuration: {
        chartType: config.chartType,
        xField: config.xField,
        yField: config.yField,
        aggregation: config.aggregation,
        filters: config.filters,
        limit: config.limit,
        title: config.title,
      },
      datasetId: config.datasetId,
    };
    try {
      if (saveTarget?.id) {
        await api.updateChart(saveTarget.id, { title: payload.title, configuration: payload.configuration });
        toast.success('Chart updated', 'Your saved chart now uses the current configuration.');
      } else {
        const chart = await api.saveChart(payload);
        setSaveTarget({ id: chart.id, title: chart.title });
        toast.success('Chart saved', 'You can add it to a dashboard now.');
      }
      setSaveOpen(false);
    } catch (err) {
      if (Object.keys(err.fields || {}).length) setFormErrors(err.fields);
      else toast.error('Could not save chart', err.message);
    } finally {
      setBusy(false);
    }
  };

  const addToDashboard = async () => {
    setBusy(true);
    try {
      if (!saveTarget?.id) {
        toast.warning('Save the chart first', 'Charts must be saved before they can be added to a dashboard.');
        setBusy(false);
        setAddOpen(false);
        setSaveOpen(true);
        return;
      }
      const target = dashboards.find((d) => d.id === addOpen);
      const detail = await api.dashboard(target.id);
      const widgets = [
        ...detail.widgets.map((w) => ({ chartId: w.chartId, position: w.position })),
        { chartId: saveTarget.id, position: { x: 0, y: detail.widgets.length * 4, w: 6, h: 4 } },
      ];
      await api.setWidgets(target.id, widgets);
      toast.success('Added to dashboard', `“${target.name}” now includes this chart.`);
      setAddOpen(false);
    } catch (err) {
      toast.error('Could not add to dashboard', err.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteChart = async (id) => {
    try {
      await api.deleteChart(id);
      setSavedCharts((prev) => prev.filter((c) => c.id !== id));
      if (saveTarget?.id === id) setSaveTarget(null);
      toast.success('Chart deleted');
    } catch (err) {
      toast.error('Could not delete chart', err.message);
    }
  };

  const valueCounts = dataset?.valueCounts || {};
  const columns = dataset?.columns || [];

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Chart builder</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Pick a dataset and fields, preview instantly, then save the configuration or add it to a dashboard.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setSaveOpen(true)} disabled={!canBuild} icon={Save}>
            {saveTarget?.id ? 'Save changes' : 'Save chart'}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)} disabled={!saveTarget?.id} icon={LayoutGrid}>
            Add to dashboard
          </Button>
        </div>
      </div>

      {datasets.length === 0 && !datasetState.loading ? (
        <EmptyState
          icon={Database}
          title="No ready datasets"
          description="Upload a dataset and wait for the import to finish, then return here to build charts."
          action={<Button onClick={() => navigate('/datasets')}>Upload a dataset</Button>}
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_300px]">
          {/* Left panel */}
          <aside className="card h-fit card-pad" aria-label="Chart configuration">
            <Field label="Dataset" htmlFor="dataset-select">
              <Select
                id="dataset-select"
                value={config.datasetId}
                onChange={(e) => setConfig({ ...DEFAULT_CONFIG, datasetId: e.target.value })}
              >
                <option value="">Select a dataset…</option>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>

            {datasetState.loading ? (
              <div className="mt-4 space-y-3">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
              </div>
            ) : dataset?.status !== 'ready' ? (
              <Banner tone="warn" title="Dataset not ready" className="mt-4">
                This dataset is still {dataset?.status || 'pending'}. Charts become available once processing completes.
              </Banner>
            ) : (
              <div className="mt-4">
                <ChartConfigPanel
                  columns={columns}
                  valueCounts={valueCounts}
                  config={config}
                  onChange={setConfig}
                  onSubmit={runQuery}
                  onAutoPick={autoPick}
                  submitting={queryState.loading}
                />
              </div>
            )}
          </aside>

          {/* Canvas */}
          <section className="card flex min-h-[520px] flex-col" aria-label="Chart preview">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-5 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-ink">
                  {config.title || 'Untitled chart'}
                </h2>
                <p className="truncate text-xs text-ink-muted">
                  {dataset ? `${dataset.name} · ${config.chartType}` : 'Select a dataset to begin'}
                  {result?.meta ? ` · ${result.meta.groupCount} groups from ${result.meta.filteredRowCount.toLocaleString()} rows` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {saveTarget?.id && <Pill tone="ok">Saved</Pill>}
                <Button variant="ghost" size="sm" onClick={runQuery} disabled={!canBuild}>Refresh</Button>
              </div>
            </div>
            <div className="flex-1 p-4">
              <ChartView
                chartType={config.chartType}
                data={result?.data || []}
                loading={queryState.loading}
                error={queryState.error}
                onRetry={runQuery}
                xLabel={config.xField}
                yLabel={config.yField}
                height={440}
              />
            </div>
            {result?.meta?.truncated && (
              <div className="border-t border-edge px-5 py-2.5 text-[11px] text-warn">
                Showing the top {result.meta.limit} of {result.meta.groupCount} groups. Add a filter to narrow the view.
              </div>
            )}
          </section>

          {/* Right panel: saved charts */}
          <aside className="card h-fit xl:sticky xl:top-20" aria-label="Saved charts">
            <div className="border-b border-edge px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">Saved charts</h2>
              <p className="mt-0.5 text-xs text-ink-muted">For this dataset</p>
            </div>
            {savedCharts.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-ink-muted">
                No saved charts yet. Configure a chart and save it.
              </p>
            ) : (
              <ul className="divide-y divide-edge/70">
                {savedCharts.map((chart) => (
                  <li key={chart.id} className="flex items-center gap-2 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setConfig({ ...DEFAULT_CONFIG, ...chart.configuration, datasetId: chart.datasetId, chartType: chart.chartType, title: chart.title });
                        setSaveTarget({ id: chart.id, title: chart.title });
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-[13px] font-medium text-ink hover:text-accent">{chart.title}</span>
                      <span className="block text-[11px] text-ink-muted">{chart.chartType}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteChart(chart.id)}
                      className="rounded p-1 text-ink-faint hover:bg-danger/5 hover:text-danger"
                      aria-label={`Delete chart ${chart.title}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title={saveTarget?.id ? 'Save chart changes' : 'Save chart'}
        description="Saving stores the configuration so the chart can be reproduced and reused on dashboards."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSaveOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={saveChart} loading={busy}>Save chart</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Chart title" htmlFor="save-title" error={formErrors.title} required>
            <Input
              id="save-title"
              value={config.title}
              onChange={(e) => setConfig({ ...config, title: e.target.value })}
              placeholder="Revenue by region"
              error={formErrors.title}
              maxLength={200}
            />
          </Field>
          <div className="rounded-lg bg-navy-50/70 p-3 text-[12px] text-ink-muted">
            <p><span className="font-medium text-ink">Dataset:</span> {dataset?.name}</p>
            <p><span className="font-medium text-ink">Type:</span> {config.chartType}</p>
            <p><span className="font-medium text-ink">Fields:</span> {config.xField || config.yField} → {config.yField}</p>
            <p><span className="font-medium text-ink">Aggregation:</span> {config.aggregation}</p>
            {(config.filters || []).length > 0 && <p><span className="font-medium text-ink">Filters:</span> {config.filters.length}</p>}
          </div>
        </div>
      </Modal>

      <Modal
        open={!!addOpen}
        onClose={() => setAddOpen(false)}
        title="Add chart to dashboard"
        description="Choose a dashboard you can edit. The chart appears as a new widget you can rearrange."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={addToDashboard} loading={busy} disabled={!dashboards.length}>Add to dashboard</Button>
          </>
        }
      >
        {dashboards.length === 0 ? (
          <EmptyState
            icon={LayoutGrid}
            title="No editable dashboards"
            description="Create a dashboard first — shared dashboards you cannot edit are excluded here."
            action={<Button size="sm" onClick={() => navigate('/dashboards')}>Go to dashboards</Button>}
          />
        ) : (
          <Field label="Dashboard" htmlFor="dashboard-select">
            <Select id="dashboard-select" value={addOpen === true ? '' : addOpen} onChange={(e) => setAddOpen(e.target.value)}>
              <option value="">Select a dashboard…</option>
              {dashboards.map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.widgetCount} widgets)</option>
              ))}
            </Select>
          </Field>
        )}
      </Modal>
    </div>
  );
}
