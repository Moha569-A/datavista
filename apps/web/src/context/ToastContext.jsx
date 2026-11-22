import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X, XCircle } from 'lucide-react';

const ToastContext = createContext(null);

const styles = {
  success: { icon: CheckCircle2, cls: 'border-ok/30 bg-white', iconCls: 'text-ok' },
  error: { icon: XCircle, cls: 'border-danger/30 bg-white', iconCls: 'text-danger' },
  warning: { icon: AlertTriangle, cls: 'border-warn/30 bg-white', iconCls: 'text-warn' },
  info: { icon: Info, cls: 'border-accent/30 bg-white', iconCls: 'text-accent' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast) => {
      const id = Math.random().toString(36).slice(2);
      const entry = { id, type: 'info', duration: 5000, ...toast };
      setToasts((prev) => [...prev.slice(-3), entry]);
      if (entry.duration) setTimeout(() => dismiss(id), entry.duration);
      return id;
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      push,
      dismiss,
      success: (title, description) => push({ type: 'success', title, description }),
      error: (title, description) => push({ type: 'error', title, description, duration: 8000 }),
      warning: (title, description) => push({ type: 'warning', title, description }),
      info: (title, description) => push({ type: 'info', title, description }),
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live keeps screen readers informed of async results (UI spec §8). */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const style = styles[toast.type] || styles.info;
          const Icon = style.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-3.5 shadow-pop animate-fade-in ${style.cls}`}
            >
              <Icon className={`mt-0.5 h-4.5 w-4.5 shrink-0 ${style.iconCls}`} size={18} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{toast.title}</p>
                {toast.description && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{toast.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="rounded p-0.5 text-ink-faint hover:bg-navy-50 hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
