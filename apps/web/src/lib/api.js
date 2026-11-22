/**
 * API client.
 *
 * All requests are same-origin relative URLs (Vite proxies /api to Express) so
 * the HttpOnly session cookie and the double-submit CSRF token work without
 * CORS. Errors are normalized into ApiError carrying the server's error code
 * and per-field details, which the UI uses for inline form messages.
 */

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details || {};
    this.fields = details?.fields || {};
  }
}

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function request(path, { method = 'GET', body, headers = {}, raw = false, signal } = {}) {
  const opts = {
    method,
    credentials: 'include',
    headers: { ...headers },
    signal,
  };

  if (body !== undefined && !raw) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (raw) {
    opts.body = body;
  }

  if (!['GET', 'HEAD'].includes(method)) {
    const csrf = readCookie('dv_csrf');
    if (csrf) opts.headers['x-csrf-token'] = csrf;
  }

  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }

  if (res.status === 204) return null;

  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await res.json().catch(() => ({})) : {};

  if (!res.ok) {
    const err = payload.error || {};
    throw new ApiError(
      res.status,
      err.code || 'REQUEST_FAILED',
      err.message || `Request failed (${res.status}).`,
      err.details,
    );
  }
  return payload;
}

export const api = {
  get: (path, opts) => request(path, opts),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),

  upload(path, formData) {
    return request(path, { method: 'POST', body: formData, raw: true });
  },

  // --- auth -------------------------------------------------------------
  login: (email, password) => api.post('/api/auth/login', { email, password }),
  register: (payload) => api.post('/api/auth/register', payload),
  logout: () => api.post('/api/auth/logout', {}),
  me: () => api.get('/api/auth/me'),
  updateProfile: (payload) => api.patch('/api/auth/me', payload),
  forgotPassword: (email) => api.post('/api/auth/forgot-password', { email }),

  // --- datasets ---------------------------------------------------------
  datasets: (params = {}) => api.get(`/api/datasets?${new URLSearchParams(params)}`),
  dataset: (id) => api.get(`/api/datasets/${id}`),
  datasetPreview: (id, page = 1, pageSize = 50) =>
    api.get(`/api/datasets/${id}/preview?page=${page}&pageSize=${pageSize}`),
  uploadDataset: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.upload('/api/datasets/upload', fd);
  },
  renameDataset: (id, name) => api.patch(`/api/datasets/${id}`, { name }),
  deleteDataset: (id) => api.del(`/api/datasets/${id}`),
  retryImport: (id) => api.post(`/api/datasets/${id}/retry`, {}),
  shareDataset: (id, payload) => api.post(`/api/datasets/${id}/shares`, payload),
  revokeDatasetShare: (id, userId) => api.del(`/api/datasets/${id}/shares/${userId}`),
  downloadLink: (id) => api.get(`/api/datasets/${id}/download-link`),

  // --- charts -----------------------------------------------------------
  queryChart: (payload) => api.post('/api/charts/query', payload),
  validateChart: (payload) => api.post('/api/charts/validate', payload),
  charts: (datasetId) => api.get(`/api/charts${datasetId ? `?datasetId=${datasetId}` : ''}`),
  saveChart: (payload) => api.post('/api/charts', payload),
  updateChart: (id, payload) => api.patch(`/api/charts/${id}`, payload),
  deleteChart: (id) => api.del(`/api/charts/${id}`),

  // --- dashboards -------------------------------------------------------
  dashboards: () => api.get('/api/dashboards'),
  dashboard: (id) => api.get(`/api/dashboards/${id}`),
  createDashboard: (payload) => api.post('/api/dashboards', payload),
  updateDashboard: (id, payload) => api.patch(`/api/dashboards/${id}`, payload),
  deleteDashboard: (id) => api.del(`/api/dashboards/${id}`),
  duplicateDashboard: (id) => api.post(`/api/dashboards/${id}/duplicate`, {}),
  setWidgets: (id, widgets) => api.put(`/api/dashboards/${id}/widgets`, { widgets }),
  shareDashboard: (id, payload) => api.post(`/api/dashboards/${id}/shares`, payload),
  revokeDashboardShare: (id, userId) => api.del(`/api/dashboards/${id}/shares/${userId}`),

  // --- analytics --------------------------------------------------------
  forecastCheck: (payload) => api.post('/api/analytics/forecast/check', payload),
  startForecast: (payload) => api.post('/api/analytics/forecast', payload),
  forecasts: () => api.get('/api/analytics/forecast'),
  forecast: (id) => api.get(`/api/analytics/forecast/${id}`),

  // --- admin ------------------------------------------------------------
  adminUsers: (params = {}) => api.get(`/api/admin/users?${new URLSearchParams(params)}`),
  adminCreateUser: (payload) => api.post('/api/admin/users', payload),
  adminSetRole: (id, role) => api.patch(`/api/admin/users/${id}/role`, { role }),
  adminSetStatus: (id, isActive) => api.patch(`/api/admin/users/${id}/status`, { isActive }),
  adminMetrics: () => api.get('/api/admin/metrics'),
  adminActivity: (params = {}) => api.get(`/api/admin/activity?${new URLSearchParams(params)}`),
  adminOverview: () => api.get('/api/admin/overview'),

  // --- misc -------------------------------------------------------------
  notifications: () => api.get('/api/notifications'),
  markAllRead: () => api.post('/api/notifications/read-all', {}),
  health: () => api.get('/health'),
};
