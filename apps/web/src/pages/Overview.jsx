import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart3, Database, LayoutGrid, TrendingUp, Upload, ArrowRight, Clock,
  CheckCircle2, AlertTriangle, Activity, Users, Sparkles,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useCan } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { KpiCard, StatusBadge, Skeleton, EmptyState, Banner, Button, SectionHeader, Pill } from '../components/ui';
import ChartView from '../components/ChartView';
import { formatNumber, timeAgo, localZoneLabel } from '../lib/format';

/**
 * Role-aware overview (UI spec §5.2).
 * Every number on this page comes from a live API response — there are no
 * hard-coded KPI values (PRD §10 assumption about mockups).
 */
export default function Overview() {
  const { user } = useAuth();
  const { isAdmin, canUpload } = useCan();
  const { subscribe } = useRealtime();
  const navigate = useNavigate();

  const [state, setState] = useState({ loading: true, error: null });
  const [kpis, setKpis] = useState(null);
  const [dashboards, setDashboards] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [overview, setOverview] = useState(null);
  const [previewChart, setPreviewChart] = useState(null);
  const [deniedBanner, setDeniedBanner] = useState(false);

  const load = async () => {
    setState({ loading: true, error: null });
    try {
      const [dashRes, dsRes, chartRes] = await Promise.all([
        api.dashboards(),
        canUpload ? api.datasets({ pageSize: 5 }) : Promise.resolve({ data: [] }),
        canUpload ? api.charts().catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ]);
      setDashboards([...dashRes.owned, ...dashRes.shared]);
      setDatasets(dsRes.data);

      if (isAdmin) {
        const ov = await api.adminOverview().catch(() => null);
        setOverview(ov);
        setKpis({
          datasets: ov?.kpis?.datasets ?? 0,
          users: ov?.kpis?.users ?? 0,
          charts: ov?.kpis?.charts ?? 0,
          processing: ov?.kpis?.processing ?? 0,
          failed: ov?.kpis?.failed ?? 0,
          dashboards: ov?.kpis?.dashboards ?? 0,
        });
      } else {
        const ready = dsRes.data.filter((d) => d.status === 'ready').length;
        setKpis({
          datasets: dsRes.pagination?.total ?? dsRes.data.length,
          charts: chartRes.data.length,
          dashboards: dashRes.owned.length + dashRes.shared.length,
          processing: dsRes.data.filter((d) => ['pending', 'processing'].includes(d.status)).length,
          ready,
        });
      }

      // Preview the first chart of the default dashboard for a real data point.
      const firstDash = dashRes.owned[0] || dashRes.shared[0];
      if (firstDash) {
        const detail = await api.dashboard(firstDash.id).catch(() => null);
        const widget = detail?.widgets?.[0];
        if (widget) {
          const cfg = widget.configuration || {};
          const result = await api
            .queryChart({
              datasetId: widget.datasetId,
              chartType: widget.chartType,
              xField: cfg.xField,
              yField: cfg.yField,
              aggregation: cfg.aggregation || 'sum',
              filters: cfg.filters || [],
              limit: 12,
            })
            .catch(() => null);
          if (result) setPreviewChart({ widget, result });
        }
      }

      setState({ loading: false, error: null });
    } catch (err) {
      setState({ loading: false, error: err.message });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsub = subscribe('any', () => load());
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe]);

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const firstName = (user?.name || '').split(' ')[0];
  const sharedDashboards = dashboards.filter((d) => d.isShared);
  const ownedDashboards = dashboards.filter((d) => !d.isShared);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {deniedBanner && (
        <Banner tone="warn" title="Access restricted" onDismiss={() => setDeniedBanner(false)} icon={AlertTriangle}>
          Your role doesn't include that area. Ask an administrator if you need elevated access.
        </Banner>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
            {localZoneLabel()} · {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            {greeting}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {isAdmin
              ? 'System-wide activity across users, datasets and processing jobs.'
              : user?.role === 'viewer'
                ? 'Dashboards shared with you, ready to review.'
                : 'Your datasets, charts and dashboards at a glance.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUpload && (
            <Button onClick={() => navigate('/datasets')} icon={Upload}>Upload dataset</Button>
          )}
          <Button variant="secondary" onClick={() => navigate('/dashboards')} icon={LayoutGrid}>
            Dashboards
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={canUpload ? 'Your datasets' : 'Shared dashboards'}
          value={canUpload ? formatNumber(kpis?.datasets) : formatNumber(sharedDashboards.length)}
          sublabel={canUpload ? 'Accessible to your account' : 'Shared with you'}
          icon={Database}
          tone="accent"
          loading={state.loading}
        />
        <KpiCard
          label="Dashboards"
          value={formatNumber(kpis?.dashboards)}
          sublabel={`${ownedDashboards.length} owned · ${sharedDashboards.length} shared`}
          icon={LayoutGrid}
          tone="navy"
          loading={state.loading}
        />
        <KpiCard
          label={isAdmin ? 'Active users' : 'Charts created'}
          value={isAdmin ? formatNumber(kpis?.users) : formatNumber(kpis?.charts)}
          sublabel={isAdmin ? 'Accounts able to sign in' : 'Saved chart definitions'}
          icon={isAdmin ? Users : BarChart3}
          tone="ok"
          loading={state.loading}
        />
        <KpiCard
          label="Processing now"
          value={formatNumber(kpis?.processing)}
          sublabel={kpis?.failed ? `${kpis.failed} failed import(s) to review` : 'No failed imports'}
          icon={kpis?.processing > 0 ? Clock : CheckCircle2}
          tone={kpis?.processing > 0 ? 'warn' : 'ok'}
          loading={state.loading}
        />
      </div>

      {state.error && (
        <Banner tone="danger" title="Could not load your overview" icon={AlertTriangle}>
          {state.error}{' '}
          <button type="button" className="font-semibold underline" onClick={load}>Try again</button>
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Live chart preview */}
        <section className="card xl:col-span-2" aria-labelledby="preview-heading">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-5 py-3.5">
            <div>
              <h2 id="preview-heading" className="text-sm font-semibold text-ink">
                {previewChart ? previewChart.widget.title : 'Chart preview'}
              </h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                {previewChart ? `Live data from “${previewChart.widget.datasetName}”` : 'Your first saved chart appears here'}
              </p>
            </div>
            {previewChart && (
              <Link to={`/dashboards/${previewChart.widget.chartId ? dashboards[0]?.id : ''}`} className="text-xs">
                <Pill tone="accent">Live</Pill>
              </Link>
            )}
          </div>
          <div className="p-4">
            {state.loading ? (
              <Skeleton className="h-64 w-full" />
            ) : previewChart ? (
              <ChartView
                chartType={previewChart.widget.chartType}
                data={previewChart.result.data}
                height={260}
                xLabel={previewChart.widget.configuration?.xField}
                yLabel={previewChart.widget.configuration?.yField}
              />
            ) : (
              <EmptyState
                icon={BarChart3}
                title="No chart to preview yet"
                description={
                  canUpload
                    ? 'Upload a dataset, build a chart and add it to a dashboard to see it here.'
                    : 'Charts will appear here once a dashboard is shared with you.'
                }
                action={canUpload ? <Button onClick={() => navigate('/charts')} size="sm">Open chart builder</Button> : null}
              />
            )}
          </div>
        </section>

        {/* Jump-in panel */}
        <section className="card" aria-labelledby="actions-heading">
          <div className="border-b border-edge px-5 py-3.5">
            <h2 id="actions-heading" className="text-sm font-semibold text-ink">Jump back in</h2>
            <p className="mt-0.5 text-xs text-ink-muted">Shortcuts based on your role</p>
          </div>
          <div className="divide-y divide-edge/70">
            {(canUpload
              ? [
                  { to: '/datasets', icon: Database, title: 'Dataset library', hint: 'Upload, preview, validate' },
                  { to: '/explorer', icon: Activity, title: 'Data explorer', hint: 'Inspect columns and quality' },
                  { to: '/charts', icon: BarChart3, title: 'Chart builder', hint: 'Bar, pie, line and more' },
                  { to: '/predictive', icon: Sparkles, title: 'Predictive analytics', hint: 'Forecast with validation' },
                ]
              : [
                  { to: '/dashboards', icon: LayoutGrid, title: 'My dashboards', hint: 'Owned and shared with you' },
                  { to: '/settings', icon: Users, title: 'Account settings', hint: 'Profile and password' },
                ]
            ).map((item) => (
              <Link key={item.to} to={item.to} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-navy-50/70">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-600">
                  <item.icon size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink">{item.title}</span>
                  <span className="block truncate text-[11px] text-ink-muted">{item.hint}</span>
                </span>
                <ArrowRight size={14} className="text-ink-faint" />
              </Link>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent datasets */}
        {canUpload && (
          <section className="card" aria-labelledby="recent-datasets">
            <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
              <h2 id="recent-datasets" className="text-sm font-semibold text-ink">Recent datasets</h2>
              <Link to="/datasets" className="text-xs font-medium text-accent hover:underline">View all</Link>
            </div>
            {state.loading ? (
              <div className="space-y-3 p-5">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
              </div>
            ) : datasets.length === 0 ? (
              <EmptyState
                icon={Database}
                title="No datasets yet"
                description="Upload a CSV or Excel file to get started. You'll see a preview and quality checks before importing."
                action={<Button size="sm" onClick={() => navigate('/datasets')} icon={Upload}>Upload data</Button>}
              />
            ) : (
              <ul className="divide-y divide-edge/70">
                {datasets.slice(0, 5).map((ds) => (
                  <li key={ds.id}>
                    <Link to={`/datasets/${ds.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-navy-50/70">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-[10px] font-bold uppercase text-navy-600">
                        {ds.file_type}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{ds.name}</span>
                        <span className="block text-[11px] text-ink-muted">
                          {formatNumber(ds.row_count)} rows · {timeAgo(ds.created_at)}
                        </span>
                      </span>
                      <StatusBadge status={ds.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Dashboards */}
        <section className="card" aria-labelledby="recent-dashboards">
          <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
            <h2 id="recent-dashboards" className="text-sm font-semibold text-ink">Dashboards</h2>
            <Link to="/dashboards" className="text-xs font-medium text-accent hover:underline">View all</Link>
          </div>
          {state.loading ? (
            <div className="space-y-3 p-5">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : dashboards.length === 0 ? (
            <EmptyState
              icon={LayoutGrid}
              title="No dashboards yet"
              description={canUpload ? 'Create a dashboard and add charts to it.' : 'Nothing has been shared with you yet.'}
              action={canUpload ? <Button size="sm" onClick={() => navigate('/dashboards')}>Create dashboard</Button> : null}
            />
          ) : (
            <ul className="divide-y divide-edge/70">
              {dashboards.slice(0, 5).map((d) => (
                <li key={d.id}>
                  <Link to={`/dashboards/${d.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-navy-50/70">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <LayoutGrid size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{d.name}</span>
                      <span className="block text-[11px] text-ink-muted">
                        {d.widgetCount} widget{d.widgetCount === 1 ? '' : 's'} · {d.isShared ? `shared by ${d.ownerName}` : 'owned by you'}
                      </span>
                    </span>
                    {d.isShared && <Pill tone={d.permission === 'edit' ? 'accent' : 'neutral'}>{d.permission}</Pill>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Admin-only operational metrics */}
      {isAdmin && overview && (
        <section className="card" aria-labelledby="ops">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-5 py-3.5">
            <div>
              <h2 id="ops" className="text-sm font-semibold text-ink">Import activity — last 14 days</h2>
              <p className="mt-0.5 text-xs text-ink-muted">Live operational metric for administrators</p>
            </div>
            <Link to="/admin/activity" className="text-xs font-medium text-accent hover:underline">Full metrics</Link>
          </div>
          <div className="p-4">
            {overview.importTrend?.length ? (
              <ChartView
                chartType="bar"
                data={overview.importTrend.map((d) => ({ label: d.day, value: d.count }))}
                height={180}
                compact
                yLabel="Imports"
                xLabel="day"
              />
            ) : (
              <p className="py-6 text-center text-sm text-ink-muted">No import activity recorded in the last 14 days.</p>
            )}
          </div>
        </section>
      )}

      <p className="pb-2 text-center text-[11px] text-ink-faint">
        All figures are computed from live API data in your workspace. Timestamps shown in {localZoneLabel()}.
      </p>
    </div>
  );
}
