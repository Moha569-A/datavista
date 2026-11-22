import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, BarChart3, Database, Download, RefreshCw, Share2, Table2, Trash2,
  AlertTriangle, CheckCircle2, Users, X, Plus,
} from 'lucide-react';
import { api } from '../lib/api';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import {
  Button, StatusBadge, Skeleton, ErrorState, Banner, Field, Input, Select, Modal,
  ConfirmDialog, SectionHeader, Pill, EmptyState,
} from '../components/ui';
import { formatNumber, formatDateTime, formatBytes, timeAgo, localZoneLabel } from '../lib/format';

const TYPE_STYLES = {
  number: 'bg-accent/10 text-accent',
  date: 'bg-violet-100 text-violet-700',
  category: 'bg-emerald-100 text-emerald-700',
  boolean: 'bg-amber-100 text-amber-700',
  text: 'bg-navy-100 text-navy-600',
  empty: 'bg-navy-100 text-ink-faint',
};

export default function DatasetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { subscribe } = useRealtime();

  const [state, setState] = useState({ loading: true, error: null });
  const [dataset, setDataset] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareForm, setShareForm] = useState({ email: '', permission: 'view' });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  const load = useCallback(async () => {
    setState({ loading: true, error: null });
    try {
      const data = await api.dataset(id);
      setDataset(data);
      setState({ loading: false, error: null });
      if (data.status === 'ready') {
        const p = await api.datasetPreview(id, 1, 25).catch(() => null);
        setPreview(p);
        setPreviewPage(1);
      }
    } catch (err) {
      setState({ loading: false, error: err.message });
    }
  }, [id]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const off = subscribe('any', (payload) => {
      if (payload?.datasetId === id) load();
    });
    return off;
  }, [subscribe, id, load]);

  const loadPreview = async (page) => {
    setPreviewLoading(true);
    try {
      const p = await api.datasetPreview(id, page, 25);
      setPreview(p);
      setPreviewPage(page);
    } catch (err) {
      toast.error('Preview unavailable', err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const retry = async () => {
    try {
      await api.retryImport(id);
      toast.info('Import restarted', 'A new job has been queued.');
      load();
    } catch (err) {
      toast.error('Retry failed', err.message);
    }
  };

  const download = async () => {
    try {
      const { url } = await api.downloadLink(id);
      window.location.assign(url);
    } catch (err) {
      toast.error('Download unavailable', err.message);
    }
  };

  const submitShare = async () => {
    setBusy(true);
    setFormErrors({});
    try {
      const updated = await api.shareDataset(id, shareForm);
      setDataset(updated);
      setShareOpen(false);
      setShareForm({ email: '', permission: 'view' });
      toast.success('Dataset shared', 'The recipient can now access this dataset.');
    } catch (err) {
      if (Object.keys(err.fields || {}).length) setFormErrors(err.fields);
      else toast.error('Sharing failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (userId, email) => {
    try {
      const updated = await api.revokeDatasetShare(id, userId);
      setDataset(updated);
      toast.success('Access revoked', `${email} no longer has access.`);
    } catch (err) {
      toast.error('Could not revoke access', err.message);
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.deleteDataset(id);
      toast.success('Dataset deleted');
      navigate('/datasets');
    } catch (err) {
      toast.error('Delete failed', err.message);
      setBusy(false);
    }
  };

  if (state.loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState
          title="Dataset unavailable"
          message={state.error}
          onRetry={load}
        />
        <div className="mt-4 text-center">
          <Link to="/datasets" className="link text-sm">Back to dataset library</Link>
        </div>
      </div>
    );
  }

  const warnings = dataset.warnings || [];
  const errorWarnings = warnings.filter((w) => w.severity === 'error');
  const softWarnings = warnings.filter((w) => w.severity !== 'error');

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link to="/datasets" className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink">
        <ArrowLeft size={14} /> Dataset library
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight text-ink">{dataset.name}</h1>
            <StatusBadge status={dataset.status} />
            <Pill>{dataset.file_type.toUpperCase()}</Pill>
            {dataset.isOwner && <Pill tone="accent">Owner</Pill>}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {dataset.original_name} · uploaded {timeAgo(dataset.created_at)} by {dataset.isOwner ? 'you' : dataset.owner_name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Navigation is expressed as links so it can be opened in a new tab,
              copied, and reached with assistive technology — not as buttons. */}
          {dataset.canEdit && (
            <Link to={`/explorer/${dataset.id}`}>
              <Button variant="secondary" size="sm" icon={Table2}>Explore</Button>
            </Link>
          )}
          {dataset.canEdit && dataset.status === 'ready' && (
            <Link to={`/charts?datasetId=${dataset.id}`}>
              <Button variant="secondary" size="sm" icon={BarChart3}>New chart</Button>
            </Link>
          )}
          {dataset.isOwner && (
            <Button variant="secondary" size="sm" onClick={() => setShareOpen(true)} icon={Share2}>
              Share
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={download} icon={Download}>Download</Button>
          {dataset.isOwner && (
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)} icon={Trash2} className="text-danger hover:bg-danger/5">
              Delete
            </Button>
          )}
        </div>
      </div>

      {dataset.status === 'failed' && (
        <Banner tone="danger" title="Import failed" icon={AlertTriangle}>
          <p>{dataset.error_message || 'The file could not be processed.'}</p>
          {dataset.error_code && <p className="mt-1 font-mono text-[11px] opacity-80">Error code: {dataset.error_code}</p>}
          <div className="mt-2.5 flex gap-2">
            <Button size="sm" variant="secondary" onClick={retry} icon={RefreshCw}>Retry import</Button>
            <Link to="/datasets"><Button size="sm" variant="ghost">Upload a different file</Button></Link>
          </div>
        </Banner>
      )}

      {(dataset.status === 'processing' || dataset.status === 'pending') && (
        <Banner tone="info" title="Processing your file" icon={RefreshCw}>
          This page refreshes automatically when the import finishes. You can safely navigate away.
        </Banner>
      )}

      {errorWarnings.length > 0 && (
        <Banner tone="danger" title="Data quality issues" icon={AlertTriangle}>
          <ul className="list-inside list-disc space-y-0.5">
            {errorWarnings.slice(0, 4).map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
        </Banner>
      )}

      {softWarnings.length > 0 && (
        <Banner tone="warn" title={`${softWarnings.length} data quality warning${softWarnings.length === 1 ? '' : 's'}`} icon={AlertTriangle}>
          <ul className="list-inside list-disc space-y-0.5">
            {softWarnings.slice(0, 5).map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
          {softWarnings.length > 5 && (
            <p className="mt-1 text-[11px] opacity-80">…and {softWarnings.length - 5} more. See the column profile below.</p>
          )}
        </Banner>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Rows', value: formatNumber(dataset.row_count), icon: Database },
          { label: 'Columns', value: dataset.column_count, icon: Table2 },
          { label: 'Duplicates', value: formatNumber(dataset.duplicate_rows), icon: RefreshCw },
          { label: 'File size', value: formatBytes(dataset.file_size), icon: Download },
        ].map((tile) => (
          <div key={tile.label} className="card px-4 py-3.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              <tile.icon size={12} /> {tile.label}
            </div>
            <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{tile.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Column profile */}
        <section className="card lg:col-span-2" aria-labelledby="profile-heading">
          <div className="border-b border-edge px-5 py-3.5">
            <h2 id="profile-heading" className="text-sm font-semibold text-ink">Column profile</h2>
            <p className="mt-0.5 text-xs text-ink-muted">Inferred types and quality per column</p>
          </div>
          <div className="scroll-x">
            <table className="w-full min-w-[560px]">
              <thead className="bg-navy-50/70">
                <tr>
                  <th className="th">Column</th>
                  <th className="th">Type</th>
                  <th className="th">Missing</th>
                  <th className="th">Distinct</th>
                  <th className="th">Range / top values</th>
                </tr>
              </thead>
              <tbody>
                {(dataset.columns || []).map((col) => (
                  <tr key={col.name} className="table-row">
                    <td className="td font-medium">{col.name}</td>
                    <td className="td">
                      <span className={`badge ${TYPE_STYLES[col.type] || TYPE_STYLES.text}`}>{col.type}</span>
                    </td>
                    <td className="td tabular-nums">
                      {col.nullCount > 0 ? (
                        <span className="text-warn">{formatNumber(col.nullCount)} <span className="text-[11px] text-ink-faint">({Math.round((col.nullRatio || 0) * 100)}%)</span></span>
                      ) : (
                        <span className="text-ok">0</span>
                      )}
                    </td>
                    <td className="td tabular-nums">{formatNumber(col.distinctCount)}</td>
                    <td className="td max-w-[220px] truncate text-[12px] text-ink-muted">
                      {col.type === 'number' && col.min !== undefined
                        ? `${formatNumber(col.min)} – ${formatNumber(col.max)}`
                        : col.topValues?.length
                          ? col.topValues.map((t) => t.value).slice(0, 3).join(', ')
                          : col.min && col.max
                            ? `${String(col.min).slice(0, 10)} → ${String(col.max).slice(0, 10)}`
                            : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Sharing + import job */}
        <div className="space-y-4">
          <section className="card" aria-labelledby="sharing-heading">
            <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
              <h2 id="sharing-heading" className="text-sm font-semibold text-ink">Sharing</h2>
              <Users size={14} className="text-ink-faint" />
            </div>
            <div className="p-4">
              {!dataset.isOwner ? (
                <p className="text-[13px] text-ink-muted">
                  Owned by {dataset.owner_name}. Only the owner can change sharing settings.
                </p>
              ) : (dataset.shares || []).length === 0 ? (
                <p className="text-[13px] text-ink-muted">
                  Private to you. Share this dataset to let a colleague build charts from it.
                </p>
              ) : (
                <ul className="space-y-2">
                  {dataset.shares.map((share) => (
                    <li key={share.userId} className="flex items-center gap-2 rounded-lg border border-edge px-2.5 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-ink">{share.name}</p>
                        <p className="truncate text-[11px] text-ink-muted">{share.email}</p>
                      </div>
                      <Pill tone={share.permission === 'edit' ? 'accent' : 'neutral'}>{share.permission}</Pill>
                      <button
                        type="button"
                        onClick={() => revoke(share.userId, share.email)}
                        className="rounded p-1 text-ink-faint hover:bg-danger/5 hover:text-danger"
                        aria-label={`Revoke access for ${share.email}`}
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {dataset.isOwner && (
                <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => setShareOpen(true)} icon={Plus}>
                  Add person
                </Button>
              )}
            </div>
          </section>

          <section className="card" aria-labelledby="job-heading">
            <div className="border-b border-edge px-5 py-3.5">
              <h2 id="job-heading" className="text-sm font-semibold text-ink">Latest import job</h2>
            </div>
            <div className="space-y-2 p-4 text-[13px]">
              {dataset.latest_job ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Status</span>
                    <StatusBadge status={dataset.latest_job.status} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Attempts</span>
                    <span className="tabular-nums text-ink">{dataset.latest_job.attempts ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Started</span>
                    <span className="text-ink">{dataset.latest_job.started_at ? formatDateTime(dataset.latest_job.started_at) : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Finished</span>
                    <span className="text-ink">{dataset.latest_job.finished_at ? formatDateTime(dataset.latest_job.finished_at) : '—'}</span>
                  </div>
                </>
              ) : (
                <p className="text-ink-muted">No import job recorded.</p>
              )}
              <p className="pt-1 text-[11px] text-ink-faint">Times shown in {localZoneLabel()}.</p>
            </div>
          </section>
        </div>
      </div>

      {/* Preview */}
      <section className="card" aria-labelledby="preview-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-5 py-3.5">
          <div>
            <h2 id="preview-heading" className="text-sm font-semibold text-ink">Row preview</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              {dataset.status === 'ready' ? 'First 25 rows · paginated, never loaded in full' : 'Available once the import completes'}
            </p>
          </div>
          {preview && (
            <Pill>Page {preview.pagination.page} of {preview.pagination.totalPages}</Pill>
          )}
        </div>
        {!preview ? (
          <EmptyState
            icon={Table2}
            title="No preview available"
            description={dataset.status === 'ready' ? 'The preview could not be loaded.' : 'The dataset is still being processed.'}
          />
        ) : (
          <>
            <div className="scroll-x">
              <table className="w-full min-w-max">
                <thead className="bg-navy-50/70">
                  <tr>
                    <th className="th w-12 text-right">#</th>
                    {(dataset.columns || []).map((c) => (
                      <th key={c.name} className="th whitespace-nowrap">{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.__row} className="table-row">
                      <td className="td text-right text-[11px] tabular-nums text-ink-faint">{row.__row + 1}</td>
                      {(dataset.columns || []).map((c) => {
                        const value = row[c.name];
                        return (
                          <td key={c.name} className="td max-w-[240px] truncate whitespace-nowrap">
                            {value === null || value === undefined || value === '' ? (
                              <span className="text-ink-faint italic">null</span>
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
            <div className="flex items-center justify-between gap-3 border-t border-edge px-4 py-3">
              <p className="text-xs text-ink-muted">
                Showing rows {((preview.pagination.page - 1) * preview.pagination.pageSize) + 1}–
                {Math.min(preview.pagination.page * preview.pagination.pageSize, preview.pagination.total)} of{' '}
                {formatNumber(preview.pagination.total)}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={preview.pagination.page <= 1 || previewLoading}
                  onClick={() => loadPreview(preview.pagination.page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={preview.pagination.page >= preview.pagination.totalPages || previewLoading}
                  onClick={() => loadPreview(preview.pagination.page + 1)}
                  loading={previewLoading}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      <Modal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Share this dataset"
        description="The recipient can inspect rows and build charts, subject to the permission you choose."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShareOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submitShare} loading={busy} disabled={!shareForm.email.trim()}>Share</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Recipient email" htmlFor="ds-share-email" error={formErrors.email} required>
            <Input
              id="ds-share-email"
              type="email"
              value={shareForm.email}
              onChange={(e) => setShareForm({ ...shareForm, email: e.target.value })}
              placeholder="colleague@company.com"
              error={formErrors.email}
            />
          </Field>
          <Field label="Permission" htmlFor="ds-share-permission">
            <Select
              id="ds-share-permission"
              value={shareForm.permission}
              onChange={(e) => setShareForm({ ...shareForm, permission: e.target.value })}
            >
              <option value="view">Can view</option>
              <option value="edit">Can edit</option>
            </Select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        loading={busy}
        title={`Delete “${dataset.name}”?`}
        description="The source file, imported rows and dependent charts will be removed permanently."
        confirmLabel="Delete permanently"
      />
    </div>
  );
}
