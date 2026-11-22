import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppShell from './components/AppShell';
import { useAuth } from './context/AuthContext';
import { InlineSpinner } from './components/ui';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Overview = lazy(() => import('./pages/Overview'));
const Datasets = lazy(() => import('./pages/Datasets'));
const DatasetDetail = lazy(() => import('./pages/DatasetDetail'));
const Explorer = lazy(() => import('./pages/Explorer'));
const ChartBuilder = lazy(() => import('./pages/ChartBuilder'));
const Dashboards = lazy(() => import('./pages/Dashboards'));
const DashboardView = lazy(() => import('./pages/DashboardView'));
const Predictive = lazy(() => import('./pages/Predictive'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const AdminActivity = lazy(() => import('./pages/AdminActivity'));
const Settings = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));

const ROLE_ALL = ['viewer', 'analyst', 'admin', 'super_admin'];
const ROLE_EDITORS = ['analyst', 'admin', 'super_admin'];
const ROLE_ADMINS = ['admin', 'super_admin'];

function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <InlineSpinner label="Loading DataVista…" />
    </div>
  );
}

/** Blocks unauthenticated access and remembers where the user was heading. */
function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'anonymous') return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

/** Role-based route guard (mirrors the server-side middleware). */
function RequireRole({ roles, children }) {
  const { user, status } = useAuth();
  if (status === 'loading') return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) {
    return <Navigate to="/overview" replace state={{ denied: true }} />;
  }
  return children;
}

function PublicOnly({ children }) {
  const { status } = useAuth();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'authenticated') return <Navigate to="/overview" replace />;
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Routes>
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />

        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/datasets" element={<RequireRole roles={ROLE_EDITORS}><Datasets /></RequireRole>} />
          <Route path="/datasets/:id" element={<RequireRole roles={ROLE_EDITORS}><DatasetDetail /></RequireRole>} />
          <Route path="/explorer" element={<RequireRole roles={ROLE_EDITORS}><Explorer /></RequireRole>} />
          <Route path="/explorer/:id" element={<RequireRole roles={ROLE_EDITORS}><Explorer /></RequireRole>} />
          <Route path="/charts" element={<RequireRole roles={ROLE_EDITORS}><ChartBuilder /></RequireRole>} />
          <Route path="/charts/:id" element={<RequireRole roles={ROLE_EDITORS}><ChartBuilder /></RequireRole>} />
          <Route path="/dashboards" element={<RequireRole roles={ROLE_ALL}><Dashboards /></RequireRole>} />
          <Route path="/dashboards/:id" element={<RequireRole roles={ROLE_ALL}><DashboardView /></RequireRole>} />
          <Route path="/predictive" element={<RequireRole roles={ROLE_EDITORS}><Predictive /></RequireRole>} />
          <Route path="/admin/users" element={<RequireRole roles={ROLE_ADMINS}><AdminUsers /></RequireRole>} />
          <Route path="/admin/activity" element={<RequireRole roles={ROLE_ADMINS}><AdminActivity /></RequireRole>} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
