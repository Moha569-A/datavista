import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev server configuration.
 *
 * The browser only ever talks to this origin: /api and /socket.io are proxied
 * to the Express API so cookies stay first-party (no CORS, no SameSite issues).
 */
const API_TARGET = process.env.API_PROXY_TARGET || 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: false,
    allowedHosts: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/socket.io': { target: API_TARGET, ws: true, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
});
