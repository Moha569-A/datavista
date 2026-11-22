import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, Database, Table2, BarChart3, LayoutGrid, TrendingUp, Users,
  Settings, Menu as MenuIcon, X, Bell, Search, LogOut, ChevronDown, Circle,
  Activity, WifiOff, BookOpen,
} from 'lucide-react';
import { useAuth, useCan } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { RoleBadge, Pill } from './ui';

/**
 * Role-aware navigation (UI spec §4). Items a role cannot use are hidden, and
 * the corresponding routes are additionally guarded server- and client-side.
 */
const NAV = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard, roles: ['viewer', 'analyst', 'admin', 'super_admin'] },
  { to: '/datasets', label: 'Datasets', icon: Database, roles: ['analyst', 'admin', 'super_admin'] },
  { to: '/explorer', label: 'Data Explorer', icon: Table2, roles: ['analyst', 'admin', 'super_admin'] },
  { to: '/charts', label: 'Chart Builder', icon: BarChart3, roles: ['analyst', 'admin', 'super_admin'] },
  { to: '/dashboards', label: 'My Dashboards', icon: LayoutGrid, roles: ['viewer', 'analyst', 'admin', 'super_admin'] },
  { to: '/predictive', label: 'Predictive Analytics', icon: TrendingUp, roles: ['analyst', 'admin', 'super_admin'] },
  { to: '/admin/users', label: 'User Management', icon: Users, roles: ['admin', 'super_admin'] },
  { to: '/admin/activity', label: 'Activity & Metrics', icon: Activity, roles: ['admin', 'super_admin'] },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ['viewer', 'analyst', 'admin', 'super_admin'] },
];

function Brand({ compact }) {
  return (
    <Link to="/overview" className="flex items-center gap-2.5" aria-label="DataVista Analytics home">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white shadow-sm">
        <BarChart3 size={17} aria-hidden />
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold tracking-tight text-white">DataVista</span>
          <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-navy-300">Analytics</span>
        </span>
      )}
    </Link>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const { subscribe } = useRealtime();
  const ref = useRef(null);

  const load = async () => {
    try {
      const data = await api.notifications();
      setItems(data.data);
      setUnread(data.unreadCount);
    } catch {
      /* silent: the bell is non-critical */
    }
  };

  useEffect(() => {
    load();
    const unsub = subscribe('any', load);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const markAll = async () => {
    await api.markAllRead().catch(() => {});
    load();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-ink-muted transition-colors hover:bg-navy-50 hover:text-ink"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-edge bg-white shadow-pop animate-fade-in">
          <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
            <p className="text-sm font-semibold text-ink">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="text-xs font-medium text-accent hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-muted">You have no notifications yet.</p>
            ) : (
              items.map((n) => (
                <Link
                  key={n.id}
                  to={n.link || '/overview'}
                  onClick={() => setOpen(false)}
                  className={clsx('block border-b border-edge/60 px-4 py-3 last:border-0 hover:bg-navy-50', !n.is_read && 'bg-accent-soft/50')}
                >
                  <div className="flex items-start gap-2">
                    <Circle
                      size={7}
                      className={clsx('mt-1.5 shrink-0', n.is_read ? 'fill-navy-200 text-navy-200' : 'fill-accent text-accent')}
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-ink">{n.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{n.message}</p>
                      <p className="mt-1 text-[11px] text-ink-faint">{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const initials = (user?.name || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-navy-50"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-700 text-xs font-semibold text-white">
          {initials}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-[13px] font-medium leading-tight text-ink">{user?.name}</span>
          <span className="block text-[11px] leading-tight text-ink-muted">{user?.role?.replace('_', ' ')}</span>
        </span>
        <ChevronDown size={14} className="text-ink-faint" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-edge bg-white shadow-pop animate-fade-in">
          <div className="border-b border-edge px-4 py-3">
            <p className="truncate text-sm font-medium text-ink">{user?.name}</p>
            <p className="truncate text-xs text-ink-muted">{user?.email}</p>
            <div className="mt-2"><RoleBadge role={user?.role} /></div>
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); navigate('/settings'); }}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink hover:bg-navy-50"
          >
            <Settings size={15} /> Settings
          </button>
          <button
            type="button"
            onClick={async () => { await logout(); navigate('/login'); }}
            className="flex w-full items-center gap-2.5 border-t border-edge px-4 py-2.5 text-left text-sm text-danger hover:bg-danger/5"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await api.datasets({ search: query.trim(), pageSize: 5 });
        setResults(data.data.map((d) => ({ id: d.id, name: d.name, type: 'Dataset' })));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative w-full max-w-md" ref={ref}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden />
      <input
        type="search"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search datasets…"
        aria-label="Search datasets"
        className="h-9 w-full rounded-lg border border-edge bg-canvas pl-9 pr-3 text-sm placeholder:text-ink-faint focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20"
      />
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 z-40 mt-1.5 overflow-hidden rounded-xl border border-edge bg-white shadow-pop animate-fade-in">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => { navigate(`/datasets/${r.id}`); setOpen(false); setQuery(''); }}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-navy-50"
            >
              <span className="truncate text-sm text-ink">{r.name}</span>
              <Pill>{r.type}</Pill>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  const { user } = useAuth();
  const { isAdmin } = useCan();
  const { connected } = useRealtime();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const items = NAV.filter((item) => item.roles.includes(user?.role));
  const current = items.find((i) => location.pathname.startsWith(i.to));

  const navContent = (
    <>
      <div className={clsx('flex h-16 items-center border-b border-white/10 px-4', collapsed && 'justify-center px-2')}>
        <Brand compact={collapsed} />
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main navigation">
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  clsx(
                    'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors',
                    collapsed && 'justify-center',
                    isActive
                      ? 'bg-white/10 text-white'
                      : 'text-navy-200 hover:bg-white/5 hover:text-white',
                  )
                }
              >
                <item.icon size={17} className="shrink-0" aria-hidden />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            </li>
          ))}
        </ul>

        {!collapsed && (
          <div className="mt-6 rounded-lg bg-white/5 p-3">
            <div className="flex items-center gap-1.5">
              <span className={clsx('h-1.5 w-1.5 rounded-full', connected ? 'bg-emerald-400' : 'bg-amber-400')} />
              <p className="text-[11px] font-medium text-navy-200">
                {connected ? 'Live updates on' : 'Reconnecting…'}
              </p>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-navy-300">
              Import and refresh events stream to this session.
            </p>
          </div>
        )}
      </nav>
      <div className={clsx('border-t border-white/10 p-3', collapsed && 'px-2')}>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="hidden w-full items-center justify-center gap-2 rounded-lg px-2 py-2 text-[12px] text-navy-300 hover:bg-white/5 hover:text-white lg:flex"
        >
          {collapsed ? <MenuIcon size={15} /> : <><X size={13} /> Collapse</>}
        </button>
        {!collapsed && (
          <p className="px-2 pt-1 text-[10px] uppercase tracking-wider text-navy-400">v1.0 · MVP</p>
        )}
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Desktop sidebar */}
      <aside
        className={clsx(
          'hidden shrink-0 flex-col bg-navy-900 transition-[width] duration-200 lg:flex',
          collapsed ? 'w-[68px]' : 'w-64',
        )}
      >
        {navContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="relative flex h-full w-72 flex-col bg-navy-900 shadow-pop">
            {navContent}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-edge bg-white/95 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-ink-muted hover:bg-navy-50 lg:hidden"
            aria-label="Open navigation"
          >
            <MenuIcon size={19} />
          </button>

          <div className="hidden min-w-0 flex-1 md:block">
            <p className="truncate text-sm font-medium text-ink">{current?.label || 'DataVista'}</p>
          </div>

          <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
            <GlobalSearch />
            {!connected && (
              <span className="hidden items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-warn sm:flex">
                <WifiOff size={11} /> Offline
              </span>
            )}
            <NotificationBell />
            <div className="h-6 w-px bg-edge" aria-hidden />
            <ProfileMenu />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8" id="main-content">
          <Outlet />
        </main>

        <footer className="border-t border-edge px-6 py-4 text-xs text-ink-faint">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>DataVista Analytics · MVP build</span>
            <a
              href="/api/../health"
              className="inline-flex items-center gap-1.5 hover:text-ink"
              target="_blank"
              rel="noreferrer"
            >
              <BookOpen size={12} /> Service health
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
