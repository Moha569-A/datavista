import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, Database, LayoutGrid, Users, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import {
  KpiCard, Pagination, SkeletonTable, ErrorState, EmptyState, Banner, Pill, Skeleton, Button,
} from '../components/ui';
import { formatNumber, timeAgo, formatDateTime } from '../lib/format';

/** Audit trail and operational metrics (PRD FR-07). */
export default function AdminActivity() {
  const [metrics, setMetrics] = useState(null);
  const [metricsError, setMetricsError] = useState(null);
  const [activity, setActivity] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadMetrics = async () => {
    try {
      setMetrics(await api.adminMetrics());
      setMetricsError(null);
    } catch (err) {
      setMetricsError(err.message);
    }
  };

  const loadActivity = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.adminActivity({ page, pageSize: pagination.pageSize });
      setActivity(data.data);
      setPagination(data.pagination);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadMetrics(); }, []);
  useEffect(() => { loadActivity(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page]);

  const actionTone = (action) => {
    if (action.startsWith('admin.')) return 'danger';
    if (action.includes('delete') || action.includes('suspend')) return 'warn';
    if (action.startsWith('auth.') || action.includes('create') || action.includes('upload')) return 'ok';
    return 'neutral';
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Activity & metrics</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Operational metrics and the append-only audit trail. Audit records cannot be edited or deleted by users.
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => { loadMetrics(); loadActivity(); }}>
          Refresh
        </Button>
      </div>

      {metricsError && (
        <Banner tone="danger" title="Metrics unavailable" icon={AlertTriangle}>{metricsError}</Banner>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Users"
          value={metrics ? formatNumber(metrics.users.total) : '—'}
          sublabel={metrics ? `${metrics.users.active} active` : ''}
          icon={Users}
          tone="accent"
          loading={!metrics}
        />
        <KpiCard
          label="Datasets"
          value={metrics ? formatNumber(metrics.datasets.total) : '—'}
          sublabel={metrics ? `${formatNumber(metrics.datasets.rows)} rows imported total` : ''}
          icon={Database}
          tone="navy"
          loading={!metrics}
        />
        <KpiCard
          label="Import success rate"
          value={metrics ? `${metrics.datasets.successRate}%` : '—'}
          sublabel={metrics ? `${metrics.datasets.byStatus.failed} failed` : ''}
          icon={BarChart3}
          tone={metrics?.datasets.successRate >= 90 ? 'ok' : 'warn'}
          loading={!metrics}
        />
        <KpiCard
          label="Actions (24h)"
          value={metrics ? formatNumber(metrics.actionsLast24h) : '—'}
          sublabel={metrics ? `${formatNumber(metrics.dashboards)} dashboards · ${formatNumber(metrics.charts)} charts` : ''}
          icon={Activity}
          tone="accent"
          loading={!metrics}
        />
      </div>

      {metrics && (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-ink">Processing status</h2>
            <div className="mt-3 space-y-2">
              {Object.entries(metrics.datasets.byStatus).map(([status, count]) => {
                const total = Math.max(1, metrics.datasets.total);
                const pct = Math.round((count / total) * 100);
                const barColor = {
                  ready: 'bg-ok',
                  processing: 'bg-accent',
                  pending: 'bg-warn',
                  failed: 'bg-danger',
                }[status];
                return (
                  <div key={status}>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="capitalize text-ink">{status}</span>
                      <span className="tabular-nums text-ink-muted">{count} ({pct}%)</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-navy-100">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-ink">Failure reasons</h2>
            {metrics.failures.length === 0 ? (
              <p className="mt-3 text-[13px] text-ink-muted">No failed imports recorded. </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {metrics.failures.map((f) => (
                  <li key={f.error_code || 'unknown'} className="flex items-center justify-between rounded-lg border border-edge px-3 py-2">
                    <span className="font-mono text-[11px] text-danger">{f.error_code || 'UNKNOWN'}</span>
                    <span className="text-[12px] tabular-nums text-ink-muted">{f.count}×</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-ink">Totals</h2>
            <dl className="mt-3 space-y-2 text-[13px]">
              {[
                { label: 'Dashboards', value: metrics.dashboards, icon: LayoutGrid },
                { label: 'Charts', value: metrics.charts, icon: BarChart3 },
                { label: 'Forecast runs', value: metrics.forecasts, icon: Activity },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-ink-muted"><item.icon size={13} /> {item.label}</dt>
                  <dd className="font-semibold tabular-nums text-ink">{formatNumber(item.value)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[11px] text-ink-faint">
              Generated {metrics.generatedAt ? formatDateTime(metrics.generatedAt) : '—'}
            </p>
          </section>
        </div>
      )}

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">Audit trail</h2>
          <span className="text-xs text-ink-muted">{pagination.total} events</span>
        </div>

        {loading ? (
          <SkeletonTable rows={8} cols={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={loadActivity} />
        ) : activity.length === 0 ? (
          <EmptyState icon={Activity} title="No activity recorded" description="Audit events appear here as users act in the system." />
        ) : (
          <>
            <div className="scroll-x">
              <table className="w-full min-w-[760px]">
                <thead className="bg-navy-50/70">
                  <tr>
                    <th className="th">When</th>
                    <th className="th">Actor</th>
                    <th className="th">Action</th>
                    <th className="th">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((event) => (
                    <tr key={event.id} className="table-row">
                      <td className="td whitespace-nowrap">
                        <span className="block text-[12px] text-ink">{formatDateTime(event.created_at)}</span>
                        <span className="block text-[10px] text-ink-faint">{timeAgo(event.created_at)}</span>
                      </td>
                      <td className="td">
                        {event.user_name ? (
                          <>
                            <span className="block text-[13px]">{event.user_name}</span>
                            <span className="block text-[11px] text-ink-muted">{event.user_email}</span>
                          </>
                        ) : (
                          <span className="text-[12px] italic text-ink-faint">System / anonymous</span>
                        )}
                      </td>
                      <td className="td"><Pill tone={actionTone(event.action)}>{event.action}</Pill></td>
                      <td className="td max-w-[420px]">
                        <code className="block truncate rounded bg-navy-50 px-2 py-1 font-mono text-[11px] text-ink-muted">
                          {JSON.stringify(event.details || {})}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={pagination.total}
              onPage={setPage}
            />
          </>
        )}
      </section>
    </div>
  );
}
