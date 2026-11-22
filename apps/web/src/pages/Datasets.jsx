import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Database, MoreHorizontal, Trash2, Pencil, Eye, RefreshCw, Share2, Download, Upload, FileWarning,
} from 'lucide-react';
import { api } from '../lib/api';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { useCan } from '../context/AuthContext';
import DatasetUpload from '../components/DatasetUpload';
import {
  Button, SearchInput, Select, StatusBadge, Pagination, EmptyState, ErrorState,
  SkeletonTable, Menu, MenuItem, Modal, Field, Input, ConfirmDialog, Banner, useDebounced, Tabs,
} from '../components/ui';
import { formatNumber, timeAgo, localZoneLabel } from '../lib/format';

export default function Datasets() {
  const navigate = useNavigate();
  const toast = useToast();
  const { subscribe } = useRealtime();
  const { canUpload } = useCan();

  const [listState, setListState] = useState({ loading: true, error: null });
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [showUpload, setShowUpload] = useState(false);

  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [shareTarget, setShareTarget] = useState(null);
  const [shareForm, setShareForm] = useState({ email: '', permission: 'view' });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  const debouncedSearch = useDebounced(search, 320);

  const load = useCallback(async () => {
    setListState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.datasets({ page, pageSize: pagination.pageSize, search: debouncedSearch, status });
      setRows(data.data);
      setPagination(data.pagination);
      setListState({ loading: false, error: null });
    } catch (err) {
      setListState({ loading: false, error: err.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, status, pagination.pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  // Live import status: refresh the affected row (and re-query on completion).
  useEffect(() => {
    const off = subscribe('any', (payload) => {
      if (!payload?.datasetId) return;
      setRows((prev) =>
        prev.map((r) =>
          r.id === payload.datasetId
            ? {
                ...r,
                status: payload.errorCode ? 'failed' : payload.rowCount !== undefined ? 'ready' : 'processing',
                row_count: payload.rowCount ?? r.row_count,
                error_message: payload.message ?? r.error_message,
              }
            : r,
        ),
      );
      if (payload.rowCount !== undefined) setTimeout(load, 600);
    });
    return off;
  }, [subscribe, load]);

  const submitRename = async () => {
    setBusy(true);
    setFormErrors({});
    try {
      await api.renameDataset(renameTarget.id, renameValue.trim());
      toast.success('Dataset renamed', `Now called “${renameValue.trim()}”.`);
      setRenameTarget(null);
      load();
    } catch (err) {
      if (Object.keys(err.fields || {}).length) setFormErrors(err.fields);
      else toast.error('Rename failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitShare = async () => {
    setBusy(true);
    setFormErrors({});
    try {
      await api.shareDataset(shareTarget.id, shareForm);
      toast.success('Dataset shared', `${shareForm.email} can now ${shareForm.permission} this dataset.`);
      setShareTarget(null);
      setShareForm({ email: '', permission: 'view' });
      load();
    } catch (err) {
      if (Object.keys(err.fields || {}).length) setFormErrors(err.fields);
      else toast.error('Sharing failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.deleteDataset(deleteTarget.id);
      toast.success('Dataset deleted', 'The source file and imported rows were removed.');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error('Delete failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const retry = async (dataset) => {
    try {
      await api.retryImport(dataset.id);
      toast.info('Import restarted', 'A new import job has been queued.');
      setRows((prev) => prev.map((r) => (r.id === dataset.id ? { ...r, status: 'pending' } : r)));
    } catch (err) {
      toast.error('Could not retry', err.message);
    }
  };

  const download = async (dataset) => {
    try {
      const { url } = await api.downloadLink(dataset.id);
      window.location.assign(url);
    } catch (err) {
      toast.error('Download unavailable', err.message);
    }
  };

  const usable = rows.filter((r) => r.status === 'ready').length;
  const issues = rows.filter((r) => r.status === 'failed').length;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Dataset library</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Upload, validate and manage your CSV and Excel datasets. Files are stored privately.
          </p>
        </div>
        {canUpload && (
          <Button onClick={() => setShowUpload((v) => !v)} icon={Upload}>
            {showUpload ? 'Hide upload' : 'Upload dataset'}
          </Button>
        )}
      </div>

      {showUpload && canUpload && (
        <div className="card card-pad animate-fade-in">
          <DatasetUpload
            onUploaded={(result) => {
              toast.info('Upload accepted', 'Processing in the background — status updates automatically.');
              setShowUpload(false);
              setPage(1);
              setTimeout(load, 800);
            }}
          />
        </div>
      )}

      {issues > 0 && (
        <Banner tone="warn" title={`${issues} import${issues === 1 ? '' : 's'} failed on this page`} icon={FileWarning}>
          Open a failed dataset to see the error code and retry the import.
        </Banner>
      )}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-edge px-4 py-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search datasets by name…"
            className="w-full sm:w-72"
          />
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
            className="w-full sm:w-40"
          >
            <option value="">All statuses</option>
            <option value="ready">Ready</option>
            <option value="processing">Processing</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </Select>
          <div className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
            <span>{formatNumber(pagination.total)} dataset{pagination.total === 1 ? '' : 's'}</span>
            {!listState.loading && <span className="text-ink-faint">· {usable} ready on this page</span>}
          </div>
        </div>

        {listState.loading ? (
          <SkeletonTable rows={6} cols={6} />
        ) : listState.error ? (
          <ErrorState message={listState.error} onRetry={load} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Database}
            title={search || status ? 'No datasets match your filters' : 'No datasets yet'}
            description={
              search || status
                ? 'Try a different search term or clear the status filter.'
                : 'Upload a CSV or Excel file to start exploring your data. You will see a preview and quality checks before anything is imported.'
            }
            action={
              search || status ? (
                <Button variant="secondary" size="sm" onClick={() => { setSearch(''); setStatus(''); }}>Clear filters</Button>
              ) : canUpload ? (
                <Button size="sm" onClick={() => setShowUpload(true)} icon={Upload}>Upload dataset</Button>
              ) : null
            }
          />
        ) : (
          <>
            <div className="scroll-x">
              <table className="w-full min-w-[860px] border-collapse">
                <thead className="bg-navy-50/70">
                  <tr>
                    <th className="th">Name</th>
                    <th className="th">Type</th>
                    <th className="th">Rows</th>
                    <th className="th">Columns</th>
                    <th className="th">Owner</th>
                    <th className="th">Status</th>
                    <th className="th">Updated</th>
                    <th className="th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((ds) => (
                    <tr key={ds.id} className="table-row">
                      <td className="td">
                        <Link to={`/datasets/${ds.id}`} className="group block max-w-[280px]">
                          <span className="block truncate font-medium text-ink group-hover:text-accent">{ds.name}</span>
                          <span className="block truncate text-[11px] text-ink-faint">{ds.original_name}</span>
                        </Link>
                      </td>
                      <td className="td">
                        <span className="rounded bg-navy-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-navy-600">
                          {ds.file_type}
                        </span>
                      </td>
                      <td className="td tabular-nums">{formatNumber(ds.row_count)}</td>
                      <td className="td tabular-nums">{ds.column_count}</td>
                      <td className="td">
                        <span className="text-[13px]">{ds.isOwner ? 'You' : ds.owner_name}</span>
                      </td>
                      <td className="td">
                        <StatusBadge status={ds.status} />
                        {ds.status === 'failed' && ds.error_code && (
                          <span className="mt-1 block text-[10px] font-mono text-danger">{ds.error_code}</span>
                        )}
                      </td>
                      <td className="td whitespace-nowrap text-[12px] text-ink-muted">{timeAgo(ds.updated_at)}</td>
                      <td className="td text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/explorer/${ds.id}`)} className="hidden sm:inline-flex">
                            <Eye size={14} /> Explore
                          </Button>
                          <Menu
                            trigger={
                              <button type="button" className="rounded-lg p-1.5 text-ink-faint hover:bg-navy-50 hover:text-ink" aria-label={`Actions for ${ds.name}`}>
                                <MoreHorizontal size={16} />
                              </button>
                            }
                          >
                            <MenuItem icon={Eye} onClick={() => navigate(`/datasets/${ds.id}`)}>Open details</MenuItem>
                            <MenuItem icon={RefreshCw} onClick={() => navigate(`/explorer/${ds.id}`)}>Data explorer</MenuItem>
                            {ds.isOwner && (
                              <MenuItem
                                icon={Pencil}
                                onClick={() => { setRenameTarget(ds); setRenameValue(ds.name); setFormErrors({}); }}
                              >
                                Rename
                              </MenuItem>
                            )}
                            {ds.isOwner && (
                              <MenuItem icon={Share2} onClick={() => { setShareTarget(ds); setFormErrors({}); }}>
                                Share
                              </MenuItem>
                            )}
                            <MenuItem icon={Download} onClick={() => download(ds)} disabled={ds.status !== 'ready'}>
                              Download source
                            </MenuItem>
                            {['failed', 'pending'].includes(ds.status) && (
                              <MenuItem icon={RefreshCw} onClick={() => retry(ds)}>Retry import</MenuItem>
                            )}
                            {ds.isOwner && (
                              <MenuItem icon={Trash2} danger onClick={() => setDeleteTarget(ds)}>Delete</MenuItem>
                            )}
                          </Menu>
                        </div>
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
      </div>

      <p className="text-[11px] text-ink-faint">
        Timestamps are shown in {localZoneLabel()}. Import status updates arrive over a live connection.
      </p>

      <Modal
        open={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title="Rename dataset"
        description="Only the display name changes — the source file and imported rows are untouched."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameTarget(null)} disabled={busy}>Cancel</Button>
            <Button onClick={submitRename} loading={busy} disabled={!renameValue.trim()}>Save name</Button>
          </>
        }
      >
        <Field label="Dataset name" htmlFor="rename-input" error={formErrors.name} required>
          <Input
            id="rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={200}
            error={formErrors.name}
            onKeyDown={(e) => e.key === 'Enter' && renameValue.trim() && submitRename()}
          />
        </Field>
      </Modal>

      <Modal
        open={!!shareTarget}
        onClose={() => setShareTarget(null)}
        title="Share dataset"
        description="Grant another active account access to this dataset's rows and schema."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShareTarget(null)} disabled={busy}>Cancel</Button>
            <Button onClick={submitShare} loading={busy} disabled={!shareForm.email.trim()}>Share dataset</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Recipient email" htmlFor="share-email" error={formErrors.email} required>
            <Input
              id="share-email"
              type="email"
              value={shareForm.email}
              onChange={(e) => setShareForm({ ...shareForm, email: e.target.value })}
              placeholder="colleague@company.com"
              error={formErrors.email}
            />
          </Field>
          <Field label="Permission" htmlFor="share-permission" hint="Viewers cannot create charts from a shared dataset.">
            <Select
              id="share-permission"
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
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={busy}
        title={`Delete “${deleteTarget?.name}”?`}
        description="This permanently removes the source file, imported rows and any charts built on this dataset."
        confirmLabel="Delete dataset"
      />
    </div>
  );
}
