import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthLayout } from './Login';
import { Field, Input, Banner, Button } from '../components/ui';
import { ApiError } from '../lib/api';

const RULES = [
  { test: (v) => v.length >= 10, label: 'At least 10 characters' },
  { test: (v) => /[A-Za-z]/.test(v), label: 'Contains a letter' },
  { test: (v) => /[0-9]/.test(v), label: 'Contains a number' },
];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErrors({});
    setBanner(null);

    if (form.password !== form.confirm) {
      setErrors({ confirm: 'Passwords do not match.' });
      return;
    }

    setLoading(true);
    try {
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      navigate('/overview', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setErrors(err.fields);
      } else {
        setBanner({ tone: 'danger', title: 'Could not create account', message: err.message });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="New accounts start with analyst access so you can upload data and build charts straight away."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="link font-medium">Sign in</Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {banner && (
          <Banner tone={banner.tone} title={banner.title} onDismiss={() => setBanner(null)}>
            {banner.message}
          </Banner>
        )}

        <Field label="Full name" htmlFor="name" error={errors.name} required>
          <Input
            id="name"
            autoComplete="name"
            required
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={errors.name}
            placeholder="Ada Okonkwo"
          />
        </Field>

        <Field label="Work email" htmlFor="email" error={errors.email} required>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            error={errors.email}
            placeholder="you@company.com"
          />
        </Field>

        <Field label="Password" htmlFor="password" error={errors.password} required>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            error={errors.password}
          />
          <ul className="mt-2 space-y-1">
            {RULES.map((rule) => {
              const passes = rule.test(form.password);
              return (
                <li key={rule.label} className={`flex items-center gap-1.5 text-[11px] ${passes ? 'text-ok' : 'text-ink-faint'}`}>
                  <Check size={11} className={passes ? 'opacity-100' : 'opacity-40'} />
                  {rule.label}
                </li>
              );
            })}
          </ul>
        </Field>

        <Field label="Confirm password" htmlFor="confirm" error={errors.confirm} required>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            error={errors.confirm}
          />
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {loading ? 'Creating account…' : 'Create account'}
          {!loading && <ArrowRight size={15} />}
        </Button>

        <p className="text-center text-[11px] leading-relaxed text-ink-faint">
          The first account created on a new installation becomes the super admin.
          Administrators can adjust roles later.
        </p>
      </form>
    </AuthLayout>
  );
}
