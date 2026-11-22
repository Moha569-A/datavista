import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { client, createTestContext, login, registerUser, uniqueEmail } from './helpers.js';

let ctx;
let api;

beforeAll(async () => {
  ctx = await createTestContext('dv-auth');
  api = client(request, ctx.app);
});

afterAll(async () => {
  await ctx.cleanup();
});

describe('registration', () => {
  it('creates the first account as super_admin', async () => {
    const res = await registerUser(api, { name: 'First Admin', email: uniqueEmail('first') });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('super_admin');
    expect(res.body.permissions.canManageUsers).toBe(true);
  });

  it('creates later accounts as analyst', async () => {
    const res = await registerUser(api, { name: 'Second User', email: uniqueEmail('second') });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('analyst');
  });

  it('rejects duplicate emails', async () => {
    const email = uniqueEmail('dupe');
    await registerUser(api, { name: 'Alice Example', email });
    const res = await registerUser(api, { name: 'Bob Example', email });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details.fields.email).toBeTruthy();
  });

  it('validates weak passwords with field-level details', async () => {
    const res = await registerUser(api, { name: 'Weak', email: uniqueEmail('weak'), password: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.password).toMatch(/10 characters/i);
  });

  it('rejects malformed emails', async () => {
    const res = await registerUser(api, { name: 'Bad Email', email: 'not-an-email' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.email).toBeTruthy();
  });

  it('never returns the password hash', async () => {
    const res = await registerUser(api, { name: 'NoHash', email: uniqueEmail('hash') });
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|\$2[aby]\$/);
  });
});

describe('login and session', () => {
  it('signs in and exposes the current user', async () => {
    const email = uniqueEmail('session');
    await registerUser(api, { name: 'Session User', email });
    const fresh = client(request, ctx.app);
    const res = await login(fresh, email);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);

    const me = await fresh.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it('rejects a wrong password with a generic message', async () => {
    const email = uniqueEmail('wrongpw');
    await registerUser(api, { name: 'Wrong Pw', email });
    const fresh = client(request, ctx.app);
    const res = await login(fresh, email, 'CompletelyWrong123');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Incorrect email or password.');
  });

  it('does not disclose whether an email exists', async () => {
    const fresh = client(request, ctx.app);
    const unknown = await login(fresh, 'nobody-here@example.test', 'SomePassword123');
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe('Incorrect email or password.');
  });

  it('returns 401 for protected routes without a session', async () => {
    const anonymous = client(request, ctx.app);
    const res = await anonymous.get('/api/datasets');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('logout invalidates the session', async () => {
    const email = uniqueEmail('logout');
    await registerUser(api, { name: 'Logout User', email });
    const fresh = client(request, ctx.app);
    await login(fresh, email);
    await fresh.post('/api/auth/logout', {});
    const me = await fresh.get('/api/auth/me');
    expect(me.status).toBe(401);
  });
});

describe('CSRF protection', () => {
  it('blocks state-changing requests without a CSRF token', async () => {
    const email = uniqueEmail('csrf');
    await registerUser(api, { name: 'CSRF User', email });
    const fresh = client(request, ctx.app);
    await login(fresh, email);

    // Deliberately omit the double-submit header.
    const res = await fresh.raw
      .post('/api/dashboards')
      .set('Cookie', [...fresh.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '))
      .send({ name: 'No CSRF' });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/CSRF/i);
  });

  it('allows safe GET requests without a token', async () => {
    const res = await api.get('/api/auth/me');
    expect([200, 401]).toContain(res.status);
  });
});

describe('password reset', () => {
  it('returns an identical response for known and unknown addresses', async () => {
    const email = uniqueEmail('reset');
    await registerUser(api, { name: 'Reset User', email });
    const known = await api.post('/api/auth/forgot-password', { email });
    const unknown = await api.post('/api/auth/forgot-password', { email: 'ghost@example.test' });
    expect(known.status).toBe(unknown.status);
    expect(known.body.message).toBe(unknown.body.message);
  });
});
