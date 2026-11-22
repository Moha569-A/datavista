import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BarChart3, ChevronRight, Columns3, Rows3, AlertTriangle, Table2, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import {
  Button, Select, Skeleton, ErrorState, EmptyState, StatusBadge, Pagination, Pill, Banner,
} from '../components/ui';
import { formatNumber, formatFullNumber } from '../lib/format';

const TYPE_STYLES = {
  number: 'bg-accent/10 text-accent',
  date: 'bg-violet-100 text-violet-700',
  category: 'bg-emerald-100 text-emerald-700',
  boolean: 'bg-amber-100 text-amber-700',
  text: 'bg-navy-100 text-navy-600',
  empty: 'bg-navy-100 text-ink-faint',
};

/** Data explorer (UI spec §5.4): summary, column profile and paginated preview. */
export default function Explorer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState([]);
  const [selectedId, setSelectedId] = useState(id || '');
  const [dataset, setDataset] = useState(null);
  const [preview, setPreview] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [state, setState] = useState({ loading: true, error: null });
  const [previewError, setPreviewError] = useState(null);
  const [hiddenColumns, setHiddenColumns] = useState([]);

  const loadDatasetList = useCallback(async () => {
    try {
      const data = await api.datasets({ pageSize: 100, status: 'ready' });
      setDatasets(data.data);
      if (!id && data.data[0]) setSelectedId(data.data[0].id);
    } catch {
      /* handled by the main load */
    }
  }, [id]);

  useEffect(() => {
    loadDatasetList();
  }, [loadDatasetList]);

  useEffect(() => {
    if (!selectedId) {
      setState({ loading: false, error: null });
      return;
    }
    let cancelled = false;
    (async () => {
      setState({ loading: true, error: null });
      try {
        const data = await api.dataset(selectedId);
        if (cancelled) return;
        setDataset(data);
        setHiddenColumns([]);
        setState({ loading: false, error: null });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  const loadPreview = useCallback(async () => {
    if (!selectedId || dataset?.status !== 'ready') return;
    setPreviewError(null);
    try {
      const data = await api.datasetPreview(selectedId, page, pageSize);
      setPreview(data);
    } catch (err) {
      setPreviewError(err.message);
    }
  }, [selectedId, page, pageSize, dataset?.status]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const columns = (dataset?.columns || []).filter((c) => !hiddenColumns.includes(c.name));
  const warnings = (dataset?.warnings || []);

  if (!id && datasets.length === 0 && !state.loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <EmptyState
          icon={Table2}
          title="No datasets to explore"
          description="Upload a dataset first, then come back to inspect columns, types and data quality."
          action={<Button onClick={() => navigate('/datasets')}>Go to dataset library</Button>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Data explorer</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Inspect columns, inferred types and quality signals before building charts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setPage(1);
              navigate(`/explorer/${e.target.value}`, { replace: true });
            }}
            aria-label="Select dataset"
            className="w-64"
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
          {dataset?.canEdit && dataset?.status === 'ready' && (
            <Button size="sm" icon={BarChart3} onClick={() => navigate(`/charts?datasetId=${selectedId}`)}>
              Build chart
            </Button>
          )}
        </div>
      </div>

      {state.loading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={() => setSelectedId(selectedId)} />
      ) : dataset ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card px-4 py-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                <Rows3 size={12} /> Rows
              </div>
              <p className="mt-1 text-lg font-semibold tabular-nums">{formatNumber(dataset.row_count)}</p>
            </div>
            <div className="card px-4 py-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                <Columns3 size={12} /> Columns
              </div>
              <p className="mt-1 text-lg font-semibold tabular-nums">{dataset.column_count}</p>
            </div>
            <div className="card px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Status</div>
              <div className="mt-1.5"><StatusBadge status={dataset.status} /></div>
            </div>
            <div className="card px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Quality flags</div>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${warnings.length ? 'text-warn' : 'text-ok'}`}>
                {warnings.length}
              </p>
            </div>
          </div>

          {warnings.length > 0 && (
            <Banner tone="warn" title="Data quality notes" icon={AlertTriangle}>
              <ul className="list-inside list-disc space-y-0.5">
                {warnings.slice(0, 4).map((w, i) => <li key={i}>{w.message}</li>)}
              </ul>
              {warnings.length > 4 && <p className="mt-1 text-[11px] opacity-80">…and {warnings.length - 4} more.</p>}
            </Banner>
          )}

          {/* Column profile */}
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-5 py-3.5">
              <h2 className="text-sm font-semibold text-ink">Columns</h2>
              <p className="text-xs text-ink-muted">Click a column to include or exclude it from the preview</p>
            </div>
            <div className="flex flex-wrap gap-2 p-4">
              {(dataset.columns || []).map((col) => {
                const hidden = hiddenColumns.includes(col.name);
                return (
                  <button
                    key={col.name}
                    type="button"
                    onClick={() =>
                      setHiddenColumns((prev) =>
                        prev.includes(col.name) ? prev.filter((n) => n !== col.name) : [...prev, col.name],
                      )
                    }
                    aria-pressed={!hidden}
                    className={`rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                      hidden ? 'border-edge bg-navy-50 text-ink-faint line-through' : 'border-edge bg-white hover:border-navy-300'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium text-ink">{col.name}</span>
                      <span className={`badge ${TYPE_STYLES[col.type] || TYPE_STYLES.text} !px-1.5 !py-0 !text-[10px]`}>
                        {col.type}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[10px] text-ink-muted">
                      {col.nullCount ? `${formatNumber(col.nullCount)} missing` : 'complete'} · {formatNumber(col.distinctCount)} distinct
                      {col.type === 'number' && col.mean !== undefined ? ` · avg ${formatNumber(col.mean)}` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Preview table */}
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-5 py-3.5">
              <h2 className="text-sm font-semibold text-ink">Rows</h2>
              <div className="flex items-center gap-2">
                <Select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  aria-label="Rows per page"
                  className="h-8 w-28 py-1 text-[12px]"
                >
                  {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} per page</option>)}
                </Select>
              </div>
            </div>

            {previewError ? (
              <ErrorState message={previewError} onRetry={loadPreview} />
            ) : !preview ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
              </div>
            ) : preview.rows.length === 0 ? (
              <EmptyState icon={Table2} title="No rows imported" description="This dataset has no data rows." />
            ) : (
              <>
                <div className="scroll-x max-h-[62vh] overflow-y-auto">
                  <table className="w-full min-w-max border-collapse text-[13px]">
                    <thead className="sticky top-0 z-10 bg-navy-50">
                      <tr>
                        <th className="th sticky left-0 z-20 bg-navy-50 text-right">#</th>
                        {columns.map((c) => (
                          <th key={c.name} className="th whitespace-nowrap border-l border-edge/60">
                            <span className="block">{c.name}</span>
                            <span className="block text-[9px] font-normal normal-case tracking-normal text-ink-faint">{c.type}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => (
                        <tr key={row.__row} className="table-row">
                          <td className="td sticky left-0 z-10 bg-white text-right text-[11px] tabular-nums text-ink-faint">{row.__row + 1}</td>
                          {columns.map((c) => {
                            const value = row[c.name];
                            const isNumber = typeof value === 'number';
                            return (
                              <td
                                key={c.name}
                                className={`td max-w-[260px] truncate whitespace-nowrap border-l border-edge/40 ${isNumber ? 'text-right tabular-nums' : ''}`}
                                title={value === null || value === undefined ? 'null' : String(value)}
                              >
                                {value === null || value === undefined || value === '' ? (
                                  <span className="text-ink-faint italic">null</span>
                                ) : isNumber ? (
                                  formatFullNumber(value)
                                ) : (
                                  String(value)
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={preview.pagination.page}
                  pageSize={preview.pagination.pageSize}
                  total={preview.pagination.total}
                  onPage={setPage}
                />
              </>
            )}
          </section>

          <div className="flex items-center justify-between text-[11px] text-ink-faint">
            <Link to={`/datasets/${dataset.id}`} className="inline-flex items-center gap-1 hover:text-ink">
              <ArrowLeft size={12} /> Dataset details
            </Link>
            <span>Previews are paginated server-side; the full dataset is never loaded into the browser.</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
