import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowLeftRight, ArrowUpDown, GripVertical, MoreHorizontal, Pencil, Plus,
  RefreshCw, Save, Share2, Trash2, Users, X, LayoutGrid, Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import ChartView from '../components/ChartView';
import {
  Button, Modal, Field, Input, Select, ConfirmDialog, Skeleton, ErrorState, EmptyState,
  Pill, Banner, Menu, MenuItem,
} from '../components/ui';
import { timeAgo, localZoneLabel, formatDateTime } from '../lib/format';

/**
 * Dashboard editor / viewer (UI spec §5.6).
 *
 * Editor controls only render when the API reports `canEdit`. Layout changes are
 * assembled locally and persisted in one PUT, so a failed save never leaves the
 * server in a partially updated state.
 */
export default function DashboardView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { subscribe } = useRealtime();

  const [state, setState] = useState({ loading: true, error: null });
  const [dashboard, setDashboard] = useState(null);
  const [widgets, setWidgets] = useState([]); // local layout
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [chartData, setChartData] = useState({});
  const [dataErrors, setDataErrors] = useState({});
  const [loadingData, setLoadingData] = useState({});
  const [shareOpen, setShareOpen] = useState(false);
  const [shareForm, setShareForm] = useState({ email: '', permission: 'view' });
  const [addOpen, setAddOpen] = useState(false);
  const [availableCharts, setAvailableCharts] = useState([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [lastSync, setLastSync] = useState(null);
  const dragIndex = useRef(null);

  const load = useCallback(async () => {
    setState({ loading: true, error: null });
    try {
      const data = await api.dashboard(id);
      setDashboard(data);
      setWidgets(data.widgets.map((w) => ({ ...w })));
      setNameValue(data.name);
      setDirty(false);
      setState({ loading: false, error: null });
      loadAllChartData(data.widgets);
    } catch (err) {
      setState({ loading: false, error: err.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadChartData = useCallback(async (widget) => {
    const cfg = widget.configuration || {};
    setLoadingData((prev) => ({ ...prev, [widget.chartId]: true }));
    try {
      const res = await api.queryChart({
        datasetId: widget.datasetId,
        chartType: widget.chartType,
        xField: cfg.xField,
        yField: cfg.yField,
        aggregation: cfg.aggregation || 'sum',
        filters: cfg.filters || [],
        limit: cfg.limit || 12,
      });
      setChartData((prev) => ({ ...prev, [widget.chartId]: res }));
      setDataErrors((prev) => ({ ...prev, [widget.chartId]: null }));
    } catch (err) {
      setDataErrors((prev) => ({ ...prev, [widget.chartId]: err.message }));
    } finally {
      setLoadingData((prev) => ({ ...prev, [widget.chartId]: false }));
    }
  }, []);

  const loadAllChartData = useCallback(
    (list) => {
      list.forEach((widget) => loadChartData(widget));
      setLastSync(new Date().toISOString());
    },
    [loadChartData],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Live refresh when the underlying dataset or layout changes.
  useEffect(() => {
    const off = subscribe('dashboard:refresh', (payload) => {
      if (payload?.dashboardId === id) {
        load();
        toast.info('Dashboard refreshed', 'Underlying data changed and has been reloaded.');
      }
    });
    return off;
  }, [subscribe, id, load, toast]);

  const markDirty = (next) => {
    setWidgets(next);
    setDirty(true);
  };

  const saveLayout = async () => {
    setSaving(true);
    try {
      const payload = widgets.map((w) => ({ chartId: w.chartId, position: w.position }));
      const updated = await api.setWidgets(id, payload);
      setDashboard(updated);
      setWidgets(updated.widgets.map((w) => ({ ...w })));
      setDirty(false);
      toast.success('Layout saved', 'The arrangement is persisted for everyone with access.');
    } catch (err) {
      toast.error('Could not save layout', err.message);
    } finally {
      setSaving(false);
    }
  };

  const move = (index, direction) => {
    const next = [...widgets];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    // Recompute y positions so the server order matches the visual order.
    markDirty(next.map((w, i) => ({ ...w, position: { ...w.position, y: i * 4 } })));
  };

  const toggleWidth = (index) => {
    const next = [...widgets];
    const w = next[index].position?.w || 6;
    next[index] = { ...next[index], position: { ...next[index].position, w: w === 12 ? 6 : 12 } };
    markDirty(next);
  };

  const removeWidget = (index) => {
    markDirty(widgets.filter((_, i) => i !== index));
  };

  const onDragStart = (index) => { dragIndex.current = index; };
  const onDrop = (index) => {
    if (dragIndex.current === null || dragIndex.current === index) return;
    const next = [...widgets];
    const [moved] = next.splice(dragIndex.current, 1);
    next.splice(index, 0, moved);
    dragIndex.current = null;
    markDirty(next.map((w, i) => ({ ...w, position: { ...w.position, y: i * 4 } })));
  };

  const openAdd = async () => {
    try {
      const { data } = await api.charts();
      const existing = new Set(widgets.map((w) => w.chartId));
      setAvailableCharts(data.filter((c) => !existing.has(c.id)));
      setAddOpen(true);
    } catch (err) {
      toast.error('Could not load charts', err.message);
    }
  };

  const addChart = (chart) => {
    const next = [
      ...widgets,
      {
        chartId: chart.id,
        datasetId: chart.datasetId,
        datasetName: chart.datasetName,
        title: chart.title,
        chartType: chart.chartType,
        configuration: chart.configuration,
        position: { x: 0, y: widgets.length * 4, w: 6, h: 4 },
      },
    ];
    markDirty(next);
    setAddOpen(false);
    loadChartData(next[next.length - 1]);
    toast.info('Widget added', 'Save the layout to persist this change.');
  };

  const submitShare = async () => {
    setBusy(true);
    setFormErrors({});
    try {
      const updated = await api.shareDashboard(id, shareForm);
      setDashboard(updated);
      setShareOpen(false);
      setShareForm({ email: '', permission: 'view' });
      toast.success('Dashboard shared', `${shareForm.email} can now ${shareForm.permission} this dashboard.`);
    } catch (err) {
      if (Object.keys(err.fields || {}).length) setFormErrors(err.fields);
      else toast.error('Sharing failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (userId, email) => {
    try {
      const updated = await api.revokeDashboardShare(id, userId);
      setDashboard(updated);
      toast.success('Access revoked', `${email} no longer has access.`);
    } catch (err) {
      toast.error('Could not revoke access', err.message);
    }
  };

  const rename = async () => {
    setBusy(true);
    try {
      const updated = await api.updateDashboard(id, { name: nameValue.trim() });
      setDashboard(updated);
      setRenameOpen(false);
      toast.success('Dashboard renamed');
    } catch (err) {
      toast.error('Rename failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteDashboard(id);
      toast.success('Dashboard deleted');
      navigate('/dashboards');
    } catch (err) {
      toast.error('Delete failed', err.message);
      setBusy(false);
    }
  };

  const stats = useMemo(() => {
    const total = Object.values(chartData).reduce((acc, d) => acc + (d?.meta?.filteredRowCount || 0), 0);
    return { widgets: widgets.length, rows: total };
  }, [chartData, widgets]);

  if (state.loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-72" />)}
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState title="Dashboard unavailable" message={state.error} onRetry={load} />
        <div className="mt-4 text-center">
          <Link to="/dashboards" className="link text-sm">Back to dashboards</Link>
        </div>
      </div>
    );
  }

  const canEdit = dashboard.canEdit;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <Link to="/dashboards" className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink">
        <ArrowLeft size={14} /> My dashboards
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight text-ink">{dashboard.name}</h1>
            {dashboard.isShared && (
              <Pill tone={canEdit ? 'accent' : 'neutral'}>
                {canEdit ? 'Shared · can edit' : 'Shared · view only'}
              </Pill>
            )}
            {!dashboard.isShared && <Pill tone="neutral">Private</Pill>}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {dashboard.description || 'No description.'}
            {' · '}
            <span className="text-ink-faint">
              owner {dashboard.isOwner ? 'you' : dashboard.ownerName} · updated {timeAgo(dashboard.updatedAt)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => { loadAllChartData(widgets); toast.info('Refreshing data'); }}>
            Refresh data
          </Button>
          {canEdit && (
            <>
              <Button variant="secondary" size="sm" icon={Plus} onClick={openAdd}>Add chart</Button>
              {dirty && (
                <Button size="sm" icon={Save} onClick={saveLayout} loading={saving}>
                  Save layout
                </Button>
              )}
            </>
          )}
          {dashboard.isOwner && (
            <Button variant="secondary" size="sm" icon={Share2} onClick={() => setShareOpen(true)}>Share</Button>
          )}
          <Menu
            trigger={
              <button type="button" className="rounded-lg border border-edge bg-white p-1.5 text-ink-muted hover:bg-navy-50" aria-label="Dashboard actions">
                <MoreHorizontal size={16} />
              </button>
            }
          >
            {dashboard.isOwner && <MenuItem icon={Pencil} onClick={() => setRenameOpen(true)}>Rename dashboard</MenuItem>}
            <MenuItem icon={RefreshCw} onClick={() => loadAllChartData(widgets)}>Reload all widgets</MenuItem>
            {dashboard.isOwner && <MenuItem icon={Trash2} danger onClick={() => setDeleteOpen(true)}>Delete dashboard</MenuItem>}
          </Menu>
        </div>
      </div>

      {dirty && (
        <Banner tone="warn" title="Unsaved layout changes">
          Widget order and sizes have changed. Save the layout to persist it for everyone with access.
        </Banner>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-faint">
        <span className="inline-flex items-center gap-1"><LayoutGrid size={11} /> {stats.widgets} widget{stats.widgets === 1 ? '' : 's'}</span>
        <span className="inline-flex items-center gap-1"><Users size={11} /> {dashboard.shares.length} collaborator{dashboard.shares.length === 1 ? '' : 's'}</span>
        {lastSync && <span className="inline-flex items-center gap-1"><Clock size={11} /> data as of {formatDateTime(lastSync)} ({localZoneLabel()})</span>}
      </div>

      {dashboard.shares.length > 0 && dashboard.isOwner && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-white px-3 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Shared with</span>
          {dashboard.shares.map((s) => (
            <span key={s.userId} className="inline-flex items-center gap-1 rounded-full bg-navy-50 px-2 py-0.5 text-[11px] text-ink">
              {s.email}
              <Pill tone={s.permission === 'edit' ? 'accent' : 'neutral'} className="!px-1 !py-0 !text-[9px]">{s.permission}</Pill>
              <button type="button" onClick={() => revoke(s.userId, s.email)} aria-label={`Revoke ${s.email}`} className="text-ink-faint hover:text-danger">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {widgets.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={LayoutGrid}
            title="This dashboard is empty"
            description={
              canEdit
                ? 'Add a saved chart to start building your report. Charts keep their saved configuration.'
                : 'The owner has not added any charts yet.'
            }
            action={canEdit ? <Button onClick={openAdd} icon={Plus}>Add a chart</Button> : null}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {widgets.map((widget, index) => {
            const data = chartData[widget.chartId];
            const span = widget.position?.w === 12 ? 'lg:col-span-12' : 'lg:col-span-6';
            return (
              <article
                key={`${widget.chartId}-${index}`}
                className={`card flex flex-col ${span}`}
                draggable={canEdit}
                onDragStart={() => onDragStart(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(index)}
                aria-label={`Widget: ${widget.title}`}
              >
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    {canEdit && <GripVertical size={14} className="shrink-0 cursor-grab text-ink-faint" aria-hidden />}
                    <div className="min-w-0">
                      <h2 className="truncate text-[13px] font-semibold text-ink">{widget.title}</h2>
                      <p className="truncate text-[11px] text-ink-faint">
                        {widget.datasetName} · {widget.chartType}
                        {data?.meta ? ` · ${data.meta.filteredRowCount.toLocaleString()} rows` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => loadChartData(widget)}
                      className="rounded p-1.5 text-ink-faint hover:bg-navy-50 hover:text-ink"
                      aria-label={`Refresh ${widget.title}`}
                    >
                      <RefreshCw size={13} className={loadingData[widget.chartId] ? 'animate-spin' : ''} />
                    </button>
                    {canEdit && (
                      <>
                        <button
                          type="button"
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                          className="rounded p-1.5 text-ink-faint hover:bg-navy-50 hover:text-ink disabled:opacity-30"
                          aria-label={`Move ${widget.title} earlier`}
                        >
                          <ArrowUpDown size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleWidth(index)}
                          className="rounded p-1.5 text-ink-faint hover:bg-navy-50 hover:text-ink"
                          aria-label={`Toggle width for ${widget.title}`}
                          title="Toggle full / half width"
                        >
                          <ArrowLeftRight size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeWidget(index)}
                          className="rounded p-1.5 text-ink-faint hover:bg-danger/5 hover:text-danger"
                          aria-label={`Remove ${widget.title}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </header>
                <div className="flex-1 p-3">
                  <ChartView
                    chartType={widget.chartType}
                    data={data?.data || []}
                    loading={loadingData[widget.chartId] && !data}
                    error={dataErrors[widget.chartId]}
                    onRetry={() => loadChartData(widget)}
                    xLabel={widget.configuration?.xField}
                    yLabel={widget.configuration?.yField}
                    height={280}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a chart"
        description="Saved charts you can access. Widgets keep the chart's saved configuration."
      >
        {availableCharts.length === 0 ? (
          <EmptyState
            icon={LayoutGrid}
            title="No charts available"
            description="Every accessible chart is already on this dashboard, or none have been saved yet."
            action={<Button size="sm" onClick={() => navigate('/charts')}>Open chart builder</Button>}
          />
        ) : (
          <ul className="divide-y divide-edge/70">
            {availableCharts.map((chart) => (
              <li key={chart.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{chart.title}</p>
                  <p className="truncate text-[11px] text-ink-muted">{chart.datasetName} · {chart.chartType}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => addChart(chart)}>Add</Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Share dashboard"
        description="Recipients see the dashboard in their shared list. Permission is re-checked on every request."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShareOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submitShare} loading={busy} disabled={!shareForm.email.trim()}>Share</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Recipient email" htmlFor="dash-share-email" error={formErrors.email} required>
            <Input
              id="dash-share-email"
              type="email"
              value={shareForm.email}
              onChange={(e) => setShareForm({ ...shareForm, email: e.target.value })}
              placeholder="colleague@company.com"
              error={formErrors.email}
            />
          </Field>
          <Field label="Permission" htmlFor="dash-share-permission" hint="View-only recipients cannot add, move or remove widgets.">
            <Select
              id="dash-share-permission"
              value={shareForm.permission}
              onChange={(e) => setShareForm({ ...shareForm, permission: e.target.value })}
            >
              <option value="view">Can view</option>
              <option value="edit">Can edit</option>
            </Select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename dashboard"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={rename} loading={busy} disabled={!nameValue.trim()}>Save</Button>
          </>
        }
      >
        <Field label="Name" htmlFor="dash-rename" required>
          <Input id="dash-rename" value={nameValue} onChange={(e) => setNameValue(e.target.value)} maxLength={200} />
        </Field>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={remove}
        loading={busy}
        title={`Delete “${dashboard.name}”?`}
        description="The dashboard layout is removed. Saved charts remain available in the chart builder."
        confirmLabel="Delete dashboard"
      />
    </div>
  );
}
