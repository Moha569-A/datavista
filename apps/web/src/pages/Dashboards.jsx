import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  LayoutGrid, Plus, MoreHorizontal, Copy, Trash2, Pencil, Users, Star, Lock,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useCan } from '../context/AuthContext';
import {
  Button, EmptyState, ErrorState, Skeleton, Modal, Field, Input, Menu, MenuItem,
  ConfirmDialog, Pill, Tabs, Banner,
} from '../components/ui';
import { timeAgo } from '../lib/format';

/** Dashboard library (UI spec §5.6, PRD FR-04). */
export default function Dashboards() {
  const navigate = useNavigate();
  const toast = useToast();
  const { canUpload } = useCan();

  const [state, setState] = useState({ loading: true, error: null });
  const [data, setData] = useState({ owned: [], shared: [] });
  const [tab, setTab] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setState({ loading: true, error: null });
    try {
      const res = await api.dashboards();
      setData(res);
      setState({ loading: false, error: null });
    } catch (err) {
      setState({ loading: false, error: err.message });
    }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true);
    setErrors({});
    try {
      const dashboard = await api.createDashboard({
        name: form.name.trim(),
        description: form.description.trim() || null,
      });
      toast.success('Dashboard created', 'Add charts to it from the chart builder or the dashboard editor.');
      setCreateOpen(false);
      setForm({ name: '', description: '' });
      navigate(`/dashboards/${dashboard.id}`);
    } catch (err) {
      if (Object.keys(err.fields || {}).length) setErrors(err.fields);
      else toast.error('Could not create dashboard', err.message);
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api.updateDashboard(renameTarget.id, { name: form.name.trim() });
      toast.success('Dashboard renamed');
      setRenameTarget(null);
      load();
    } catch (err) {
      if (Object.keys(err.fields || {}).length) setErrors(err.fields);
      else toast.error('Rename failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (dashboard) => {
    try {
      const copy = await api.duplicateDashboard(dashboard.id);
      toast.success('Dashboard duplicated', `Created “${copy.name}”.`);
      load();
    } catch (err) {
      toast.error('Could not duplicate', err.message);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteDashboard(deleteTarget.id);
      toast.success('Dashboard deleted');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error('Delete failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const all = [...data.owned, ...data.shared];
  const shown = tab === 'owned' ? data.owned : tab === 'shared' ? data.shared : all;

  const Card = ({ dashboard }) => (
    <div className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-pop">
      <Link to={`/dashboards/${dashboard.id}`} className="block flex-1 p-5">
        <div className="flex items-start justify-between gap-2">
          <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${dashboard.isShared ? 'bg-navy-100 text-navy-600' : 'bg-accent/10 text-accent'}`}>
            {dashboard.isShared ? <Users size={16} /> : <LayoutGrid size={16} />}
          </span>
          <div className="flex flex-wrap justify-end gap-1">
            {dashboard.isDefault && <Pill tone="ok"><Star size={9} /> Default</Pill>}
            {dashboard.isShared ? (
              <Pill tone={dashboard.permission === 'edit' ? 'accent' : 'neutral'}>
                {dashboard.permission === 'edit' ? 'Can edit' : 'View only'}
              </Pill>
            ) : (
              <Pill tone="neutral"><Lock size={9} /> Private</Pill>
            )}
          </div>
        </div>
        <h3 className="mt-3 truncate text-[15px] font-semibold text-ink group-hover:text-accent">{dashboard.name}</h3>
        <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-[13px] leading-relaxed text-ink-muted">
          {dashboard.description || 'No description provided.'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
          <span>{dashboard.widgetCount} widget{dashboard.widgetCount === 1 ? '' : 's'}</span>
          <span>·</span>
          <span>updated {timeAgo(dashboard.updatedAt)}</span>
          {dashboard.isShared && (
            <>
              <span>·</span>
              <span>by {dashboard.ownerName}</span>
            </>
          )}
        </div>
      </Link>
      <div className="flex items-center justify-between border-t border-edge px-3 py-2">
        <Link to={`/dashboards/${dashboard.id}`} className="btn btn-ghost btn-sm text-[12px]">
          Open
        </Link>
        <Menu
          trigger={
            <button type="button" className="rounded-lg p-1.5 text-ink-faint hover:bg-navy-50 hover:text-ink" aria-label={`Actions for ${dashboard.name}`}>
              <MoreHorizontal size={16} />
            </button>
          }
        >
          <MenuItem icon={LayoutGrid} onClick={() => navigate(`/dashboards/${dashboard.id}`)}>Open dashboard</MenuItem>
          {dashboard.permission === 'owner' && (
            <MenuItem
              icon={Pencil}
              onClick={() => { setRenameTarget(dashboard); setForm({ name: dashboard.name, description: dashboard.description || '' }); setErrors({}); }}
            >
              Rename
            </MenuItem>
          )}
          <MenuItem icon={Copy} onClick={() => duplicate(dashboard)}>Duplicate</MenuItem>
          {dashboard.permission === 'owner' && (
            <MenuItem icon={Trash2} danger onClick={() => setDeleteTarget(dashboard)}>Delete</MenuItem>
          )}
        </Menu>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">My dashboards</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Dashboards you own and dashboards explicitly shared with you.
          </p>
        </div>
        {canUpload && (
          <Button icon={Plus} onClick={() => { setCreateOpen(true); setErrors({}); setForm({ name: '', description: '' }); }}>
            New dashboard
          </Button>
        )}
      </div>

      {data.shared.length > 0 && tab === 'all' && (
        <Banner tone="info" title="Read-only access is shown explicitly">
          Dashboards shared with you display a permission badge. You can rearrange widgets only where you have edit access.
        </Banner>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: 'All', count: all.length },
          { value: 'owned', label: 'Owned by me', count: data.owned.length },
          { value: 'shared', label: 'Shared with me', count: data.shared.length },
        ]}
      />

      {state.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={load} />
      ) : shown.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={LayoutGrid}
            title={tab === 'shared' ? 'Nothing shared with you yet' : 'No dashboards here'}
            description={
              tab === 'shared'
                ? 'When a colleague shares a dashboard with you it appears here with a permission badge.'
                : 'Create a dashboard, then add charts to it. You can drag widgets to rearrange them.'
            }
            action={
              canUpload && tab !== 'shared' ? (
                <Button onClick={() => setCreateOpen(true)} icon={Plus}>Create your first dashboard</Button>
              ) : null
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((dashboard) => <Card key={dashboard.id} dashboard={dashboard} />)}
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create a dashboard"
        description="Give it a name you will recognise. You can rename it later."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={create} loading={busy} disabled={!form.name.trim()}>Create dashboard</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" htmlFor="dash-name" error={errors.name} required>
            <Input
              id="dash-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Revenue overview"
              error={errors.name}
              maxLength={200}
            />
          </Field>
          <Field label="Description" htmlFor="dash-desc" hint="Optional — helps when sharing with colleagues.">
            <Input
              id="dash-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What this dashboard answers"
              maxLength={1000}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title="Rename dashboard"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameTarget(null)} disabled={busy}>Cancel</Button>
            <Button onClick={rename} loading={busy} disabled={!form.name.trim()}>Save</Button>
          </>
        }
      >
        <Field label="Name" htmlFor="rename-dash" error={errors.name} required>
          <Input
            id="rename-dash"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={errors.name}
            maxLength={200}
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        loading={busy}
        title={`Delete “${deleteTarget?.name}”?`}
        description="The dashboard and its widget layout will be removed. Charts themselves are kept."
        confirmLabel="Delete dashboard"
      />
    </div>
  );
}
