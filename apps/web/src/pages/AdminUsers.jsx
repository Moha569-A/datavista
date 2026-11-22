import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MoreHorizontal, Search, ShieldCheck, UserPlus, Users, UserX, UserCheck, KeyRound } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useCan } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  Button, SearchInput, Select, RoleBadge, StatusBadge, Pagination, EmptyState, ErrorState,
  SkeletonTable, Menu, MenuItem, Modal, Field, Input, ConfirmDialog, Banner, Pill, useDebounced,
} from '../components/ui';
import { formatDate, timeAgo } from '../lib/format';

/** Admin user management (UI spec §5.8, PRD FR-07). */
export default function AdminUsers() {
  const { user: me } = useAuth();
  const { isSuperAdmin } = useCan();
  const toast = useToast();

  const [state, setState] = useState({ loading: true, error: null });
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', email: '', password: '', role: 'analyst' });
  const [roleTarget, setRoleTarget] = useState(null);
  const [newRole, setNewRole] = useState('analyst');
  const [statusTarget, setStatusTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});

  const debouncedSearch = useDebounced(search, 300);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.adminUsers({
        page,
        pageSize: pagination.pageSize,
        search: debouncedSearch,
        role: roleFilter,
        status: statusFilter,
      });
      setRows(data.data);
      setPagination(data.pagination);
      setState({ loading: false, error: null });
    } catch (err) {
      setState({ loading: false, error: err.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, roleFilter, statusFilter, pagination.pageSize]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [debouncedSearch, roleFilter, statusFilter]);

  const createUser = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api.adminCreateUser(createForm);
      toast.success('Account created', `${createForm.email} can now sign in as ${createForm.role}.`);
      setCreateOpen(false);
      setCreateForm({ name: '', email: '', password: '', role: 'analyst' });
      load();
    } catch (err) {
      if (Object.keys(err.fields || {}).length) setErrors(err.fields);
      else toast.error('Could not create account', err.message);
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async () => {
    setBusy(true);
    try {
      await api.adminSetRole(roleTarget.id, newRole);
      toast.success('Role updated', `${roleTarget.email} is now ${newRole.replace('_', ' ')}.`);
      setRoleTarget(null);
      load();
    } catch (err) {
      toast.error('Role change failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async () => {
    setBusy(true);
    try {
      const result = await api.adminSetStatus(statusTarget.id, !statusTarget.isActive);
      toast.success(statusTarget.isActive ? 'Account suspended' : 'Account reactivated', result.message);
      setStatusTarget(null);
      load();
    } catch (err) {
      toast.error('Status change failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const assignableRoles = isSuperAdmin
    ? ['super_admin', 'admin', 'analyst', 'viewer']
    : ['analyst', 'viewer'];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">User management</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Manage accounts and roles. Every action here is written to the audit log.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/activity"><Button variant="secondary" size="sm">Activity & metrics</Button></Link>
          <Button size="sm" icon={UserPlus} onClick={() => { setCreateOpen(true); setErrors({}); }}>Add user</Button>
        </div>
      </div>

      <Banner tone="info" title="Privilege rules are enforced server-side" icon={ShieldCheck}>
        You cannot change your own role or suspend your own account. Administrators cannot modify other
        administrators; only a super admin can grant admin roles. The last active super admin is protected.
      </Banner>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-edge px-4 py-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name or email…" className="w-full sm:w-64" />
          <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role" className="w-full sm:w-40">
            <option value="">All roles</option>
            <option value="super_admin">Super admin</option>
            <option value="admin">Admin</option>
            <option value="analyst">Analyst</option>
            <option value="viewer">Viewer</option>
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status" className="w-full sm:w-36">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
          <span className="ml-auto text-xs text-ink-muted">{pagination.total} account{pagination.total === 1 ? '' : 's'}</span>
        </div>

        {state.loading ? (
          <SkeletonTable rows={6} cols={6} />
        ) : state.error ? (
          <ErrorState message={state.error} onRetry={load} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No accounts match those filters"
            description="Try a different search term or clear the role and status filters."
            action={<Button size="sm" variant="secondary" onClick={() => { setSearch(''); setRoleFilter(''); setStatusFilter(''); }}>Clear filters</Button>}
          />
        ) : (
          <>
            <div className="scroll-x">
              <table className="w-full min-w-[860px]">
                <thead className="bg-navy-50/70">
                  <tr>
                    <th className="th">Name</th>
                    <th className="th">Email</th>
                    <th className="th">Role</th>
                    <th className="th">Status</th>
                    <th className="th">Datasets</th>
                    <th className="th">Last sign-in</th>
                    <th className="th">Joined</th>
                    <th className="th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isSelf = row.id === me.id;
                    const canTouch = !isSelf && (isSuperAdmin || (row.role !== 'admin' && row.role !== 'super_admin'));
                    return (
                      <tr key={row.id} className="table-row">
                        <td className="td">
                          <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-100 text-[10px] font-semibold text-navy-700">
                              {row.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                            </span>
                            <span className="font-medium">{row.name}</span>
                            {isSelf && <Pill tone="accent">You</Pill>}
                          </div>
                        </td>
                        <td className="td text-[13px] text-ink-muted">{row.email}</td>
                        <td className="td"><RoleBadge role={row.role} /></td>
                        <td className="td"><StatusBadge status={row.isActive ? 'active' : 'suspended'} /></td>
                        <td className="td tabular-nums">{row.datasetCount}</td>
                        <td className="td whitespace-nowrap text-[12px] text-ink-muted">
                          {row.lastLoginAt ? timeAgo(row.lastLoginAt) : 'Never'}
                        </td>
                        <td className="td whitespace-nowrap text-[12px] text-ink-muted">{formatDate(row.createdAt)}</td>
                        <td className="td text-right">
                          {canTouch ? (
                            <Menu
                              trigger={
                                <button type="button" className="rounded-lg p-1.5 text-ink-faint hover:bg-navy-50 hover:text-ink" aria-label={`Actions for ${row.name}`}>
                                  <MoreHorizontal size={16} />
                                </button>
                              }
                            >
                              <MenuItem icon={KeyRound} onClick={() => { setRoleTarget(row); setNewRole(row.role); }}>
                                Change role
                              </MenuItem>
                              {row.isActive ? (
                                <MenuItem icon={UserX} danger onClick={() => setStatusTarget(row)}>Suspend account</MenuItem>
                              ) : (
                                <MenuItem icon={UserCheck} onClick={() => setStatusTarget(row)}>Reactivate account</MenuItem>
                              )}
                            </Menu>
                          ) : (
                            <span className="text-[11px] text-ink-faint">{isSelf ? 'Managed elsewhere' : 'Protected'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} onPage={setPage} />
          </>
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add a user"
        description="Create an account and assign its initial role. The user can change their password after signing in."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={createUser} loading={busy}>Create account</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Full name" htmlFor="new-name" error={errors.name} required>
            <Input id="new-name" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} error={errors.name} />
          </Field>
          <Field label="Email" htmlFor="new-email" error={errors.email} required>
            <Input id="new-email" type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} error={errors.email} />
          </Field>
          <Field label="Temporary password" htmlFor="new-password" error={errors.password} hint="At least 10 characters." required>
            <Input id="new-password" type="text" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} error={errors.password} />
          </Field>
          <Field label="Role" htmlFor="new-role">
            <Select id="new-role" value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}>
              {assignableRoles.map((r) => (
                <option key={r} value={r}>{r === 'super_admin' ? 'Super admin' : r.charAt(0).toUpperCase() + r.slice(1)}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!roleTarget}
        onClose={() => setRoleTarget(null)}
        title={`Change role for ${roleTarget?.name}`}
        description="Role changes take effect immediately — any existing session picks up the new permissions on its next request."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRoleTarget(null)} disabled={busy}>Cancel</Button>
            <Button onClick={changeRole} loading={busy} disabled={newRole === roleTarget?.role}>Update role</Button>
          </>
        }
      >
        <Field label="New role" htmlFor="role-select">
          <Select id="role-select" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            {assignableRoles.map((r) => (
              <option key={r} value={r}>{r === 'super_admin' ? 'Super admin' : r.charAt(0).toUpperCase() + r.slice(1)}</option>
            ))}
          </Select>
        </Field>
        <div className="mt-3 rounded-lg bg-navy-50/70 p-3 text-[12px] leading-relaxed text-ink-muted">
          <p><span className="font-medium text-ink">Analyst:</span> upload datasets, build charts, run forecasts.</p>
          <p><span className="font-medium text-ink">Viewer:</span> open dashboards shared with them, read-only.</p>
          <p><span className="font-medium text-ink">Admin:</span> manage users and review all datasets and metrics.</p>
          <p><span className="font-medium text-ink">Super admin:</span> full control including admin roles.</p>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!statusTarget}
        onClose={() => setStatusTarget(null)}
        onConfirm={toggleStatus}
        loading={busy}
        tone={statusTarget?.isActive ? 'danger' : 'primary'}
        title={statusTarget?.isActive ? `Suspend ${statusTarget?.name}?` : `Reactivate ${statusTarget?.name}?`}
        description={
          statusTarget?.isActive
            ? 'Their sessions are invalidated immediately and they will be unable to sign in until reactivated.'
            : 'The account will be able to sign in again with its existing password.'
        }
        confirmLabel={statusTarget?.isActive ? 'Suspend account' : 'Reactivate account'}
      />
    </div>
  );
}
