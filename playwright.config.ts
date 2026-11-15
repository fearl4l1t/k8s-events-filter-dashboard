// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { defineConfig } from '@playwright/test';

/**
 * Browser acceptance gate. It runs the real built UI against the real server
 * reading the disposable kind cluster; no request is mocked. A second server
 * with an unreachable kubeconfig covers the partial-coverage state.
 */
const PORT = Number(process.env['EVENTS_E2E_PORT'] ?? 8090);
const UNREACHABLE_PORT = Number(process.env['EVENTS_E2E_UNREACHABLE_PORT'] ?? 8092);
const CONTEXT = process.env['EVENTS_E2E_CONTEXT'] ?? 'kind-k8s-events';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'read-path',
      // Team mode has its own config: it needs Keycloak and a second context.
      testIgnore: ['team/**', 'unreachable/**'],
      use: { baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      name: 'unreachable',
      testMatch: 'unreachable/**/*.spec.ts',
      use: { baseURL: `http://127.0.0.1:${UNREACHABLE_PORT}` },
    },
  ],
  webServer: [
    {
      command: 'pnpm build && node --import tsx packages/server/src/main.ts',
      url: `http://127.0.0.1:${PORT}/healthz`,
      timeout: 180_000,
      reuseExistingServer: !process.env['CI'],
      env: {
        EVENTS_MODE: 'local',
        EVENTS_BIND_HOST: '127.0.0.1',
        EVENTS_PORT: String(PORT),
        EVENTS_CONTEXTS: CONTEXT,
        EVENTS_STATIC_DIR: 'packages/web/dist',
        EVENTS_LOG_LEVEL: process.env['EVENTS_LOG_LEVEL'] ?? 'warn',
        KUBECONFIG: process.env['KUBECONFIG'] ?? '',
      },
    },
    {
      command: 'node --import tsx packages/server/src/main.ts',
      url: `http://127.0.0.1:${UNREACHABLE_PORT}/healthz`,
      timeout: 120_000,
      reuseExistingServer: !process.env['CI'],
      env: {
        EVENTS_MODE: 'local',
        EVENTS_BIND_HOST: '127.0.0.1',
        EVENTS_PORT: String(UNREACHABLE_PORT),
        EVENTS_CONTEXTS: 'unreachable',
        EVENTS_KUBECONFIG: 'tests/e2e/unreachable/kubeconfig.yaml',
        EVENTS_STATIC_DIR: 'packages/web/dist',
        EVENTS_LOG_LEVEL: 'warn',
      },
    },
  ],
});
