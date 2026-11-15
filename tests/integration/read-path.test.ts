// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { NormalisedEvent } from '../../packages/domain/src/index';
import { createApp, type App } from '../../packages/server/src/app';
import { testConfig } from '../../packages/server/tests/unit/helpers';
import { createLogger } from '../../packages/server/src/logging';
import { ClusterManager } from '../../packages/server/src/clusters/manager';
import { parseKubeconfig, defaultKubeconfigPath } from '../../packages/server/src/kube/kubeconfig';

/**
 * Real read path: the server lists and watches the seeded kind cluster through
 * the Kubernetes API. There is no fake API server here.
 */
const CONTEXT = process.env['EVENTS_E2E_CONTEXT'] ?? '';
const KUBECONFIG = process.env['KUBECONFIG'] ?? defaultKubeconfigPath();

const enabled = CONTEXT !== '';
const logger = createLogger('error', {}, () => undefined);

let manager: ClusterManager | null = null;
let app: App | null = null;
let server: Server | null = null;
let baseUrl = '';

async function waitForLive(timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = manager?.get(CONTEXT)?.info.status;
    if (status === 'live') return;
    if (status === 'unreachable' || status === 'auth-failed') {
      throw new Error(`Cluster ${CONTEXT} reported ${status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for the cluster to reach live.');
}

describe.skipIf(!enabled)('read path against a seeded kind cluster', () => {
  beforeAll(async () => {
    const connections = parseKubeconfig({ path: KUBECONFIG, contextNames: [CONTEXT] });
    manager = new ClusterManager({
      connections,
      capPerCluster: 100_000,
      logger,
    });
    manager.start();
    await waitForLive();

    app = createApp({
      config: testConfig(),
      logger,
      registry: manager,
      auth: null,
      staticDir: 'packages/web/dist',
    });
    server = app.server;
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('No server address.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server.closeAllConnections?.();
    }
    await manager?.stop();
  });

  it('reports the observation start and a live cluster', async () => {
    const response = await fetch(`${baseUrl}/api/clusters`);
    const body = (await response.json()) as {
      clusters: { id: string; status: string; source: string; observationStartedAt: string | null }[];
    };
    expect(body.clusters[0]?.id).toBe(CONTEXT);
    expect(body.clusters[0]?.status).toBe('live');
    expect(body.clusters[0]?.source).toBe('local');
    expect(body.clusters[0]?.observationStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns the seeded Event records with their source shapes', async () => {
    const namespaces = ['events-e2e-shop', 'events-e2e-platform', 'events-e2e-ops'];
    const query = namespaces.map((namespace) => `namespaces=${namespace}`).join('&');
    const response = await fetch(`${baseUrl}/api/events?pageSize=200&${query}`);
    const body = (await response.json()) as {
      items: NormalisedEvent[];
      totalItems: number;
    };
    expect(body.totalItems).toBeGreaterThanOrEqual(8);
    for (const item of body.items) {
      // A Kubernetes list omits apiVersion inside each item, so the untouched
      // source is checked for its metadata while the detected version is
      // reported on the normalized record.
      expect(['v1', 'events.k8s.io/v1']).toContain(item.apiVersion);
      const raw = item.rawEvent as { metadata?: { name?: string } };
      expect(raw.metadata?.name).toBeTruthy();
      expect(namespaces).toContain(item.namespace);
    }
    expect(new Set(body.items.map((item) => item.namespace)).size).toBe(3);
  });

  it('applies Warning and namespace filters to the same records the summary counts', async () => {
    const page = await fetch(`${baseUrl}/api/events?types=Warning&pageSize=200`);
    const events = (await page.json()) as { items: NormalisedEvent[]; totalItems: number };
    const summary = await fetch(`${baseUrl}/api/summary?types=Warning`);
    const totals = (await summary.json()) as { totalEvents: number; warningCount: number };
    expect(totals.totalEvents).toBe(events.totalItems);
    expect(totals.warningCount).toBe(events.totalItems);
    expect(events.items.every((item) => item.type === 'Warning')).toBe(true);
  });

  it('serves one record by logical ID with the untouched source', async () => {
    const page = await fetch(`${baseUrl}/api/events?pageSize=1`);
    const body = (await page.json()) as { items: NormalisedEvent[] };
    const id = body.items[0]?.id;
    expect(id).toBeDefined();
    const detail = await fetch(`${baseUrl}/api/events/${encodeURIComponent(id ?? '')}`);
    const payload = (await detail.json()) as { event: NormalisedEvent; cluster: { id: string } };
    expect(payload.event.id).toBe(id);
    expect(payload.cluster.id).toBe(CONTEXT);
    expect(payload.event.rawEvent).not.toBeNull();
  });

  it('exports every matching record, not only one page', async () => {
    const page = await fetch(`${baseUrl}/api/events?pageSize=50`);
    const body = (await page.json()) as { totalItems: number };
    const csv = await (await fetch(`${baseUrl}/api/export?format=csv`)).text();
    const json = (await (await fetch(`${baseUrl}/api/export?format=json`)).json()) as unknown[];
    expect(csv.trim().split('\r\n').length - 1).toBe(body.totalItems);
    expect(json).toHaveLength(body.totalItems);
  });

  it('streams a summary signal without sourcing counts from the stream', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/stream`, { signal: controller.signal });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) throw new Error('The stream response has no reader.');
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 15_000;
    while (!text.includes('event: summary-tick') && Date.now() < deadline) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    controller.abort();
    expect(text).toContain('event: summary-tick');
  });

  it('reports readiness only while a cluster is usable', async () => {
    const ready = await fetch(`${baseUrl}/readyz`);
    const body = (await ready.json()) as { ready: boolean };
    expect(body.ready).toBe(true);
  });
});
