// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect, afterEach } from 'vitest';
import { ClusterManager } from '../../src/clusters/manager';
import { createLogger } from '../../src/logging';
import type { ConnectionSpec } from '../../src/kube/kubeconfig';
import type { EventSourceClient } from '../../src/ingest/ingestor';
import type { WatchMessage } from '../../src/kube/client';

const logger = createLogger('error', {}, () => undefined);

function connection(clusterId: string, clusterName = clusterId): ConnectionSpec {
  return {
    clusterId,
    clusterName,
    source: 'local',
    server: new URL('https://cluster.example.test'),
    ca: null,
    clientCertificate: null,
    clientKey: null,
    token: 'token',
    credentialProvider: null,
  };
}

function rawEvent(uid: string, name = 'web-1'): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind: 'Event',
    metadata: { uid, name, namespace: 'default', resourceVersion: '10' },
    involvedObject: { kind: 'Pod', name, namespace: 'default' },
    type: 'Warning',
    reason: 'BackOff',
    message: 'Back-off restarting failed container',
    count: 2,
    firstTimestamp: '2026-11-14T10:00:00Z',
    lastTimestamp: '2026-11-14T10:05:00Z',
  };
}

class ScriptedClient implements EventSourceClient {
  listCalls = 0;
  stopped = false;

  constructor(private readonly items: unknown[]) {}

  async listEvents(): Promise<{ items: unknown[]; resourceVersion: string | null }> {
    this.listCalls++;
    return { items: this.items, resourceVersion: '10' };
  }

  async watchEvents(
    _resourceVersion: string,
    onMessage: (message: WatchMessage) => void,
    signal: AbortSignal
  ): Promise<void> {
    onMessage({ type: 'ADDED', object: rawEvent('uid-watch', 'api-1') });
    await new Promise<void>((resolve) => {
      const done = () => {
        this.stopped = true;
        resolve();
      };
      if (signal.aborted) done();
      else signal.addEventListener('abort', done, { once: true });
    });
  }
}

const running: ClusterManager[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((manager) => manager.stop()));
});

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for the cluster manager.');
}

describe('ClusterManager', () => {
  it('starts one loop per cluster and reports ingest progress', async () => {
    const clients = new Map<string, ScriptedClient>();
    const manager = new ClusterManager({
      connections: [connection('ctx-a', 'alpha'), connection('ctx-b', 'beta')],
      capPerCluster: 100,
      logger,
      clientFactory: (spec) => {
        const client = new ScriptedClient([rawEvent(`uid-${spec.clusterId}`)]);
        clients.set(spec.clusterId, client);
        return client;
      },
    });
    running.push(manager);
    manager.start();

    await waitFor(() => manager.list().every((runtime) => runtime.info.recordCount === 2));

    const [alpha, beta] = manager.list();
    expect(manager.list()).toHaveLength(2);
    expect(alpha?.info).toMatchObject({
      id: 'ctx-a',
      name: 'alpha',
      status: 'live',
      recordCount: 2,
      evictedCount: 0,
      error: null,
    });
    expect(alpha?.info.observationStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(alpha?.info.lastEventAt).toBe('2026-11-14T10:05:00.000Z');
    expect(beta?.info.recordCount).toBe(2);
    expect(manager.get('ctx-a')?.store.size).toBe(2);
    expect(manager.get('missing')).toBeUndefined();

    await manager.stop();
    expect(clients.get('ctx-a')?.stopped).toBe(true);
    expect(clients.get('ctx-b')?.stopped).toBe(true);
  });

  it('rejects duplicate context names', () => {
    expect(
      () =>
        new ClusterManager({
          connections: [connection('ctx-a'), connection('ctx-a')],
          capPerCluster: 10,
          logger,
          clientFactory: () => new ScriptedClient([]),
        })
    ).toThrow(/Duplicate cluster context/);
  });

  it('reports a failing cluster without stopping the others', async () => {
    const manager = new ClusterManager({
      connections: [connection('ctx-bad'), connection('ctx-good')],
      capPerCluster: 10,
      logger,
      clientFactory: (spec) =>
        spec.clusterId === 'ctx-bad'
          ? {
              listEvents: async () => {
                throw new Error('connection refused');
              },
              watchEvents: async () => undefined,
            }
          : new ScriptedClient([]),
    });
    running.push(manager);
    manager.start();

    await waitFor(() => manager.get('ctx-bad')?.info.status === 'unreachable');
    const bad = manager.get('ctx-bad');
    expect(bad?.info.error?.code).toBe('cluster_unreachable');
    await waitFor(() => manager.get('ctx-good')?.info.status === 'live');
    expect(manager.get('ctx-good')?.info.error).toBeNull();
  });
});
