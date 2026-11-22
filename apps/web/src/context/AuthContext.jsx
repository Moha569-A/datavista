import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous

  const hydrate = useCallback(async () => {
    try {
      const data = await api.me();
      setUser(data.user);
      setPermissions(data.permissions || {});
      setStatus('authenticated');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        setStatus('anonymous');
      } else {
        // Network/upstream issue: stay anonymous so the login screen renders
        // with a retry path rather than a blank shell.
        setStatus('anonymous');
      }
    }
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const login = useCallback(async (email, password) => {
    const data = await api.login(email, password);
    setUser(data.user);
    setPermissions(data.permissions || {});
    setStatus('authenticated');
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await api.register(payload);
    setUser(data.user);
    setPermissions(data.permissions || {});
    setStatus('authenticated');
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setPermissions({});
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo(
    () => ({ user, permissions, status, login, register, logout, refresh: hydrate, setUser }),
    [user, permissions, status, login, register, logout, hydrate],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Convenience role checks used across the shell and route guards. */
export function useCan() {
  const { user } = useAuth();
  const role = user?.role;
  return {
    isAdmin: role === 'admin' || role === 'super_admin',
    isSuperAdmin: role === 'super_admin',
    canUpload: role === 'analyst' || role === 'admin' || role === 'super_admin',
    canForecast: role === 'analyst' || role === 'admin' || role === 'super_admin',
    canManageUsers: role === 'admin' || role === 'super_admin',
  };
}
