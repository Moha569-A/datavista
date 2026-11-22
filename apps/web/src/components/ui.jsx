import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import {
  AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Inbox,
  Loader2, Search, ShieldCheck, ShieldAlert, X, XCircle, Users,
} from 'lucide-react';

/* ------------------------------------------------------------------ Button */
export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, icon: Icon, children, className, ...props },
  ref,
) {
  const variantCls = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
  }[variant];
  const sizeCls = { sm: 'btn-sm', md: 'btn-md', lg: 'btn-lg' }[size];
  return (
    <button
      ref={ref}
      className={clsx(variantCls, sizeCls, className)}
      disabled={props.disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : Icon ? <Icon size={15} aria-hidden /> : null}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ Fields */
export function Field({ label, htmlFor, error, hint, required, children, className }) {
  return (
    <div className={className}>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="field-error" role="alert">{error}</p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ error, className, ...props }, ref) {
  return <input ref={ref} className={clsx('input', error && 'border-danger focus:border-danger', className)} aria-invalid={!!error} {...props} />;
});

export const Select = forwardRef(function Select({ error, className, children, ...props }, ref) {
  return (
    <select ref={ref} className={clsx('input pr-8', error && 'border-danger', className)} aria-invalid={!!error} {...props}>
      {children}
    </select>
  );
});

export function SearchInput({ value, onChange, placeholder = 'Search…', className, ...props }) {
  return (
    <div className={clsx('relative', className)}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden />
      <input
        type="search"
        className="input pl-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        {...props}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ Status */
const STATUS_MAP = {
  ready: { cls: 'bg-ok/10 text-ok', icon: CheckCircle2, label: 'Ready' },
  processing: { cls: 'bg-accent/10 text-accent', icon: Loader2, label: 'Processing' },
  pending: { cls: 'bg-warn/10 text-warn', icon: Clock, label: 'Pending' },
  failed: { cls: 'bg-danger/10 text-danger', icon: XCircle, label: 'Failed' },
  active: { cls: 'bg-ok/10 text-ok', icon: CheckCircle2, label: 'Active' },
  suspended: { cls: 'bg-danger/10 text-danger', icon: XCircle, label: 'Suspended' },
};

export function StatusBadge({ status, className }) {
  const meta = STATUS_MAP[status] || { cls: 'bg-navy-100 text-ink-muted', icon: AlertCircle, label: status || 'Unknown' };
  const Icon = meta.icon;
  return (
    <span className={clsx('badge', meta.cls, className)}>
      <Icon size={11} className={status === 'processing' ? 'animate-spin' : ''} aria-hidden />
      {meta.label}
    </span>
  );
}

const ROLE_META = {
  super_admin: { label: 'Super admin', cls: 'bg-navy-800 text-white', icon: ShieldCheck },
  admin: { label: 'Admin', cls: 'bg-navy-600 text-white', icon: ShieldAlert },
  analyst: { label: 'Analyst', cls: 'bg-accent/10 text-accent', icon: Users },
  viewer: { label: 'Viewer', cls: 'bg-navy-100 text-ink-muted', icon: Users },
};

export function RoleBadge({ role }) {
  const meta = ROLE_META[role] || ROLE_META.viewer;
  const Icon = meta.icon;
  return (
    <span className={clsx('badge', meta.cls)}>
      <Icon size={11} aria-hidden />
      {meta.label}
    </span>
  );
}

export function Pill({ children, tone = 'neutral', className }) {
  const tones = {
    neutral: 'bg-navy-100 text-ink-muted',
    accent: 'bg-accent/10 text-accent',
    ok: 'bg-ok/10 text-ok',
    warn: 'bg-warn/10 text-warn',
    danger: 'bg-danger/10 text-danger',
  };
  return <span className={clsx('badge', tones[tone], className)}>{children}</span>;
}

/* ------------------------------------------------------------------ States */
export function EmptyState({ icon: Icon = Inbox, title, description, action, className }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-navy-50 text-ink-faint">
        <Icon size={22} aria-hidden />
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, className }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 py-12 text-center', className)} role="alert">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AlertCircle size={20} aria-hidden />
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {message && <p className="mt-1 max-w-md text-sm text-ink-muted">{message}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={clsx('skel', className)} aria-hidden />;
}

export function SkeletonTable({ rows = 6, cols = 5 }) {
  return (
    <div className="p-5" aria-busy="true" aria-label="Loading content">
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4">
            {Array.from({ length: cols }).map((__, c) => (
              <Skeleton key={c} className={clsx('h-4', c === 0 ? 'w-48' : 'flex-1')} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartSkeleton({ className }) {
  return (
    <div className={clsx('flex h-full flex-col justify-end gap-2 p-4', className)} aria-busy="true" aria-label="Loading chart">
      <div className="flex flex-1 items-end gap-2">
        {[45, 70, 35, 88, 60, 75].map((h, i) => (
          <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
        ))}
      </div>
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

export function InlineSpinner({ label = 'Loading' }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-muted">
      <Loader2 size={15} className="animate-spin" aria-hidden />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ Modal */
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'Tab' && ref.current) {
        const focusables = ref.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setTimeout(() => ref.current?.querySelector('input,select,textarea,button')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-navy-950/45 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx(
          'relative w-full rounded-t-2xl bg-white shadow-pop animate-fade-in sm:rounded-xl',
          sizes[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-edge px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-faint hover:bg-navy-50 hover:text-ink" aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-edge bg-navy-50/50 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', tone = 'danger', loading }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-muted">
        This action is recorded in the audit log. Make sure you have selected the right item before continuing.
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Menu */
const MenuCtx = createContext(null);

export function Menu({ trigger, children, align = 'right', className }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={clsx('relative', className)}>
      <MenuCtx.Provider value={{ close: () => setOpen(false) }}>
        <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
        {open && (
          <div
            role="menu"
            className={clsx(
              'absolute z-30 mt-1.5 min-w-[12rem] overflow-hidden rounded-xl border border-edge bg-white py-1 shadow-pop animate-fade-in',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            {children}
          </div>
        )}
      </MenuCtx.Provider>
    </div>
  );
}

export function MenuItem({ icon: Icon, children, onClick, danger, disabled }) {
  const ctx = useContext(MenuCtx);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        ctx?.close();
        onClick?.();
      }}
      className={clsx(
        'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition-colors disabled:opacity-40',
        danger ? 'text-danger hover:bg-danger/5' : 'text-ink hover:bg-navy-50',
      )}
    >
      {Icon && <Icon size={15} aria-hidden />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ Pagination */
export function Pagination({ page, pageSize, total, onPage, className }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className={clsx('flex flex-wrap items-center justify-between gap-3 border-t border-edge px-4 py-3', className)}>
      <p className="text-xs text-ink-muted">
        Showing <span className="font-medium text-ink">{from}–{to}</span> of{' '}
        <span className="font-medium text-ink">{total.toLocaleString()}</span>
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="btn-secondary btn-sm h-8 w-8 p-0"
          aria-label="Previous page"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="px-2 text-xs text-ink-muted">Page {page} of {totalPages}</span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          className="btn-secondary btn-sm h-8 w-8 p-0"
          aria-label="Next page"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Tabs */
export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={clsx('flex gap-1 border-b border-edge', className)} role="tablist">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={clsx(
              '-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors',
              active ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={clsx('rounded-full px-1.5 py-0.5 text-[11px]', active ? 'bg-accent/10 text-accent' : 'bg-navy-100 text-ink-muted')}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Misc */
export function KpiCard({ label, value, sublabel, trend, icon: Icon, tone = 'accent', loading }) {
  const tones = {
    accent: 'bg-accent/10 text-accent',
    ok: 'bg-ok/10 text-ok',
    warn: 'bg-warn/10 text-warn',
    danger: 'bg-danger/10 text-danger',
    navy: 'bg-navy-100 text-navy-700',
  };
  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-muted">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-20" />
          ) : (
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-ink">{value}</p>
          )}
          {(sublabel || trend) && <p className="mt-1 truncate text-xs text-ink-muted">{trend || sublabel}</p>}
        </div>
        {Icon && (
          <div className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tones[tone])}>
            <Icon size={17} aria-hidden />
          </div>
        )}
      </div>
    </div>
  );
}

export function SectionHeader({ title, description, actions, className }) {
  return (
    <div className={clsx('flex flex-wrap items-start justify-between gap-3', className)}>
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Inline banner used for non-blocking warnings (e.g. dataset quality). */
export function Banner({ tone = 'info', title, children, onDismiss, icon: Icon }) {
  const tones = {
    info: 'border-accent/30 bg-accent-soft text-accent',
    warn: 'border-warn/30 bg-amber-50 text-warn',
    danger: 'border-danger/30 bg-red-50 text-danger',
    ok: 'border-ok/30 bg-emerald-50 text-ok',
  };
  return (
    <div className={clsx('flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm', tones[tone])}>
      {Icon && <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className={clsx('leading-relaxed', title && 'mt-0.5 opacity-90')}>{children}</div>
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="rounded p-0.5 hover:bg-black/5" aria-label="Dismiss">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/** Hook: debounce a changing value (search inputs). */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      setState({ loading: false, data, error: null });
      return data;
    } catch (error) {
      setState({ loading: false, data: null, error });
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load, setData: (d) => setState((s) => ({ ...s, data: d })) };
}
