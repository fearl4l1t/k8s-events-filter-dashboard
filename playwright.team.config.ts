// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { defineConfig } from '@playwright/test';

/**
 * Team-mode gate: OIDC login through a disposable Keycloak and per-grant
 * authorization across two logical clusters. Both clusters point at the same
 * kind API; only their granted identities differ.
 */
const PORT = Number(process.env['EVENTS_TEAM_PORT'] ?? 8091);
const KUBECONFIG_PATH = '.team-kubeconfig';
const SESSION_SECRET = Buffer.alloc(32, 7).toString('base64');

export default defineConfig({
  testDir: 'tests/e2e/team',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'bash scripts/team/start-keycloak.sh',
      url: 'http://127.0.0.1:8081/realms/events/.well-known/openid-configuration',
      timeout: 180_000,
      reuseExistingServer: true,
    },
    {
      command:
        'pnpm exec tsx scripts/team/clone-context.ts kind-k8s-events .team-kubeconfig && ' +
        'pnpm build && node --import tsx packages/server/src/main.ts',
      url: `http://127.0.0.1:${PORT}/healthz`,
      timeout: 240_000,
      reuseExistingServer: !process.env['CI'],
      env: {
        EVENTS_MODE: 'local',
        EVENTS_BIND_HOST: '127.0.0.1',
        EVENTS_PORT: String(PORT),
        EVENTS_KUBECONFIG: KUBECONFIG_PATH,
        EVENTS_CONTEXTS: 'kind-k8s-events,kind-k8s-events-b',
        EVENTS_STATIC_DIR: 'packages/web/dist',
        EVENTS_LOG_LEVEL: 'warn',
        EVENTS_AUTH_MODE: 'oidc',
        EVENTS_PUBLIC_URL: `http://127.0.0.1:${PORT}`,
        EVENTS_OIDC_ISSUER: 'http://127.0.0.1:8081/realms/events',
        EVENTS_OIDC_CLIENT_ID: 'k8s-events-explorer',
        EVENTS_OIDC_CLIENT_SECRET: 'team-e2e-client-secret',
        EVENTS_RBAC_FILE: 'deploy/keycloak/rbac-team.yaml',
        EVENTS_SESSION_SECRET: SESSION_SECRET,
      },
    },
  ],
});
