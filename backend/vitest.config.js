import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],
    testTimeout: 15000,
    hookTimeout: 15000,
    // each test file gets its own worker -> its own in-memory SQLite database
    isolate: true,
  },
});
