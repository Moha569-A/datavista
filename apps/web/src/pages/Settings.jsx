import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, User, ShieldCheck, Info } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, Field, Input, RoleBadge, Banner, SectionHeader, Pill } from '../components/ui';
import { formatDateTime, localZoneLabel } from '../lib/format';

/** Profile and security settings (UI spec §4). */
export default function Settings() {
  const { user, permissions, refresh, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [nameForm, setNameForm] = useState({ name: user?.name || '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [passwordErrors, setPasswordErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const saveName = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api.updateProfile({ name: nameForm.name.trim() });
      await refresh();
      toast.success('Profile updated', 'Your display name has been saved.');
    } catch (err) {
      if (Object.keys(err.fields || {}).length) setErrors(err.fields);
      else toast.error('Could not update profile', err.message);
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPasswordErrors({});
    if (passwordForm.newPassword !== passwordForm.confirm) {
      setPasswordErrors({ confirm: 'Passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      const result = await api.updateProfile({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      if (result.reauthenticate) {
        toast.success('Password changed', 'For your security, please sign in again with the new password.');
        await logout();
        navigate('/login', { replace: true });
      }
    } catch (err) {
      if (Object.keys(err.fields || {}).length) setPasswordErrors(err.fields);
      else toast.error('Could not change password', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">Manage your profile and account security.</p>
      </div>

      <section className="card card-pad">
        <SectionHeader title="Account" description="Details associated with your sign-in." />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Email</p>
            <p className="mt-0.5 text-sm text-ink">{user?.email}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Role</p>
            <div className="mt-1"><RoleBadge role={user?.role} /></div>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Member since</p>
            <p className="mt-0.5 text-sm text-ink">{formatDateTime(user?.createdAt)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Timezone</p>
            <p className="mt-0.5 text-sm text-ink">{localZoneLabel()}</p>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-edge bg-navy-50/60 p-3.5">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
            <ShieldCheck size={13} /> What your role can do
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(permissions || {})
              .filter(([, allowed]) => allowed)
              .map(([key]) => (
                <Pill key={key} tone="accent">
                  {key.replace(/^can/, '').replace(/([A-Z])/g, ' $1').trim()}
                </Pill>
              ))}
          </div>
          <p className="mt-2 text-[11px] text-ink-muted">
            Permissions are enforced on the server for every request, not just hidden in the interface.
          </p>
        </div>
      </section>

      <section className="card card-pad">
        <SectionHeader title="Profile" description="How your name appears to collaborators." />
        <form onSubmit={saveName} className="mt-4 max-w-md space-y-3">
          <Field label="Display name" htmlFor="profile-name" error={errors.name} required>
            <Input
              id="profile-name"
              value={nameForm.name}
              onChange={(e) => setNameForm({ name: e.target.value })}
              error={errors.name}
              maxLength={150}
            />
          </Field>
          <Button type="submit" loading={busy} disabled={!nameForm.name.trim() || nameForm.name === user?.name} icon={User}>
            Save name
          </Button>
        </form>
      </section>

      <section className="card card-pad">
        <SectionHeader title="Password" description="Changing your password signs out every other session." />
        <form onSubmit={changePassword} className="mt-4 max-w-md space-y-3">
          <Field label="Current password" htmlFor="current-password" error={passwordErrors.currentPassword} required>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={passwordForm.currentPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
              error={passwordErrors.currentPassword}
            />
          </Field>
          <Field
            label="New password"
            htmlFor="new-password"
            error={passwordErrors.newPassword}
            hint="At least 10 characters, including a letter and a number."
            required
          >
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              error={passwordErrors.newPassword}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm-password" error={passwordErrors.confirm} required>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={passwordForm.confirm}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
              error={passwordErrors.confirm}
            />
          </Field>
          <Button
            type="submit"
            loading={busy}
            disabled={!passwordForm.currentPassword || !passwordForm.newPassword}
            icon={KeyRound}
          >
            Update password
          </Button>
        </form>
      </section>

      <Banner tone="info" title="Session security" icon={Info}>
        Sessions use HttpOnly, SameSite cookies with a configurable expiry (8 hours by default). Suspending
        an account or changing a role invalidates existing sessions on the next request.
      </Banner>
    </div>
  );
}
