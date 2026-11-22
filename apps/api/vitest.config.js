import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // PGlite instances are heavy: run files sequentially to keep memory bounded.
    fileParallelism: false,
    testTimeout: 45000,
    hookTimeout: 60000,
    reporters: 'verbose',
  },
});
