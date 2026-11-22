#!/usr/bin/env node
/**
 * One-command development environment.
 *
 * Starts the Python analytics service, then the Express API, waits for both
 * health checks, and finally starts Vite so the browser proxy is live on the
 * first page load. Ctrl-C shuts everything down.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];

function run(name, command, args, cwd, env = {}) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `[${name}]`;
  const relay = (stream, isErr) =>
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        (isErr ? process.stderr : process.stdout).write(`${prefix} ${line}\n`);
      }
    });
  relay(child.stdout, false);
  relay(child.stderr, true);
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`${prefix} exited with code ${code}`);
  });
  children.push(child);
  return child;
}

async function waitFor(url, label, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        console.log(`[dev] ${label} is ready (${url})`);
        return true;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn(`[dev] ${label} did not respond in time — continuing`);
  return false;
}

function shutdown() {
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 800);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const analyticsDir = path.join(root, 'services/analytics');
const python = existsSync(path.join(analyticsDir, '.venv/bin/python'))
  ? path.join(analyticsDir, '.venv/bin/python')
  : 'python3';

run('analytics', python, ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8788'], analyticsDir, {
  ANALYTICS_SERVICE_TOKEN: process.env.ANALYTICS_SERVICE_TOKEN || 'dev-analytics-token',
});
await waitFor('http://127.0.0.1:8788/health', 'analytics service');

run('api', 'node', ['src/index.js'], path.join(root, 'apps/api'));
await waitFor('http://127.0.0.1:8787/health', 'API');

run('web', 'npx', ['vite', '--host', '0.0.0.0', '--port', '5173'], path.join(root, 'apps/web'));
console.log('\n[dev] DataVista is starting. Open http://localhost:5173');
console.log('[dev] Demo accounts: super@ / admin@ / analyst@ / viewer@datavista.dev (password DataVista123)\n');
