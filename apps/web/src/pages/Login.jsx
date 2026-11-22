import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, BarChart3, Eye, EyeOff, Loader2, ShieldCheck, Sparkles, Table2, LayoutGrid } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Field, Input, Banner, Button } from '../components/ui';
import { ApiError } from '../lib/api';

/**
 * Login screen (UI spec §5.1).
 *
 * Error handling is deliberately generic for bad credentials — the server never
 * discloses whether an email exists, and the UI does not either.
 */
export function AuthLayout({ children, title, subtitle, footer }) {
  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Marketing panel */}
      <div className="relative hidden w-[46%] flex-col justify-between bg-navy-900 p-10 lg:flex">
        <Link to="/login" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white">
            <BarChart3 size={18} />
          </span>
          <span className="leading-tight">
            <span className="block text-base font-semibold text-white">DataVista</span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-navy-300">Analytics</span>
          </span>
        </Link>

        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            From raw spreadsheets to decisions you can defend.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-navy-200">
            Upload CSV or Excel data, validate it, build bar, pie and line charts, and assemble
            dashboards you can share — with forecasts that show their working.
          </p>

          <ul className="mt-8 space-y-3.5">
            {[
              { icon: Table2, text: 'Schema validation and quality checks on every import' },
              { icon: BarChart3, text: 'Charts computed from your real data, not mockups' },
              { icon: LayoutGrid, text: 'Dashboards with explicit, revocable sharing' },
              { icon: Sparkles, text: 'Forecasts benchmarked against a naive baseline' },
            ].map((item) => (
              <li key={item.text} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/10 text-navy-100">
                  <item.icon size={14} />
                </span>
                <span className="text-[13px] leading-relaxed text-navy-100">{item.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-navy-400">
          <ShieldCheck size={13} />
          Role-based access control · audit logging · private file storage
        </div>
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-col justify-center px-5 py-10 sm:px-10 lg:w-[54%]">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white">
              <BarChart3 size={18} />
            </span>
            <span className="text-base font-semibold text-ink">DataVista Analytics</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink">{title}</h2>
          <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6 text-sm text-ink-muted">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErrors({});
    setBanner(null);
    setLoading(true);
    try {
      await login(form.email.trim(), form.password);
      const to = location.state?.from?.pathname || '/overview';
      navigate(to, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setErrors(err.fields);
      } else if (err?.code === 'FORBIDDEN') {
        setBanner({ tone: 'danger', title: 'Account unavailable', message: err.message });
      } else {
        setBanner({
          tone: 'danger',
          title: 'Sign-in failed',
          message: err.message || 'Check your email and password and try again.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: form.email.trim() }),
      });
    } catch {
      /* response is intentionally identical either way */
    } finally {
      setLoading(false);
      setResetSent(true);
    }
  };

  if (resetMode) {
    return (
      <AuthLayout
        title="Reset your password"
        subtitle="Enter the email address on your account and we'll queue reset instructions."
        footer={
          <button type="button" onClick={() => { setResetMode(false); setResetSent(false); }} className="link font-medium">
            Back to sign in
          </button>
        }
      >
        {resetSent ? (
          <Banner tone="ok" title="Check your inbox">
            If an account exists for that address, reset instructions have been requested. For security we
            don't confirm whether an email is registered.
          </Banner>
        ) : (
          <form onSubmit={submitReset} className="space-y-4">
            <Field label="Email address" htmlFor="reset-email" required>
              <Input
                id="reset-email"
                type="email"
                autoComplete="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@company.com"
              />
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={loading}>
              Request reset instructions
            </Button>
          </form>
        )}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in to DataVista"
      subtitle="Use your work email and password to access your analytics workspace."
      footer={
        <>
          Need an account?{' '}
          <Link to="/register" className="link font-medium">Create one</Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {banner && (
          <Banner tone={banner.tone} title={banner.title} onDismiss={() => setBanner(null)}>
            {banner.message}
          </Banner>
        )}

        <Field label="Email address" htmlFor="email" error={errors.email} required>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            error={errors.email}
            placeholder="you@company.com"
          />
        </Field>

        <Field label="Password" htmlFor="password" error={errors.password} required>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              error={errors.password}
              placeholder="Your password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint hover:text-ink"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-[13px] text-ink-muted">
            <input type="checkbox" className="h-3.5 w-3.5 rounded border-edge text-accent focus:ring-accent" defaultChecked />
            Keep me signed in
          </label>
          <button type="button" onClick={() => setResetMode(true)} className="text-[13px] font-medium text-accent hover:underline">
            Forgot password?
          </button>
        </div>

        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
          {!loading && <ArrowRight size={15} />}
        </Button>

        <div className="rounded-lg border border-edge bg-white p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Demo accounts</p>
          <div className="mt-2 grid gap-1 text-[12px] text-ink-muted">
            <p><span className="font-medium text-ink">super@datavista.dev</span> · super admin</p>
            <p><span className="font-medium text-ink">admin@datavista.dev</span> · admin</p>
            <p><span className="font-medium text-ink">analyst@datavista.dev</span> · analyst</p>
            <p><span className="font-medium text-ink">viewer@datavista.dev</span> · viewer</p>
          </div>
          <p className="mt-2 text-[11px] text-ink-faint">
            Password for all demo accounts: <span className="font-mono font-medium text-ink">DataVista123</span>
          </p>
        </div>
      </form>
    </AuthLayout>
  );
}
