// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import type { NormalisedEvent } from '@k8s-events/domain';
import { ClusterStore } from '../../src/store/clusterStore';
import type { ClusterInfo, ClusterRegistry, ClusterRuntime } from '../../src/clusters/types';
import type { ServerConfig } from '../../src/config';
import type { App } from '../../src/app';
import { createApp } from '../../src/app';
import { createLogger } from '../../src/logging';

export function makeEvent(overrides: Partial<NormalisedEvent> = {}): NormalisedEvent {
  const uid = overrides.uid ?? 'uid-1';
  const clusterId = overrides.clusterId ?? 'ctx-a';
  return {
    id: `${clusterId}/${uid}`,
    clusterId,
    clusterName: overrides.clusterName ?? 'cluster-a',
    source: 'local',
    apiVersion: 'events.k8s.io/v1',
    uid,
    namespace: 'default',
    type: 'Warning',
    reason: 'BackOff',
    message: 'Back-off restarting failed container',
    action: 'Restart',
    object: {
      apiVersion: 'v1',
      kind: 'Pod',
      name: 'web-1',
      namespace: 'default',
      uid: 'pod-1',
    },
    reporter: 'kubelet',
    firstObservedAt: '2026-11-14T10:00:00.000Z',
    lastObservedAt: '2026-11-14T10:05:00.000Z',
    occurrenceCount: 3,
    occurrenceCountStatus: 'valid',
    createdAt: '2026-11-14T09:59:00.000Z',
    timestampSource: { first: 'eventTime', last: 'series' },
    timestampValid: true,
    validationIssues: [],
    rawEvent: { kind: 'Event' },
    ...overrides,
  };
}

export function makeRegistry(
  records: NormalisedEvent[],
  info: Partial<ClusterInfo> = {}
): { registry: ClusterRegistry; store: ClusterStore } {
  const store = new ClusterStore(info.id ?? 'ctx-a', info.recordCount ?? 1000);
  for (const record of records) store.upsert(record);
  const runtime: ClusterRuntime = {
    info: {
      id: 'ctx-a',
      name: 'cluster-a',
      source: 'local',
      status: 'live',
      observationStartedAt: '2026-11-14T09:00:00.000Z',
      lastEventAt: null,
      recordCount: store.size,
      evictedCount: 0,
      error: null,
      ...info,
    },
    store,
  };
  const describe = (): ClusterRuntime => ({
    info: {
      ...runtime.info,
      recordCount: store.size,
      evictedCount: store.evictedCount,
      lastEventAt: store.latestObservedAt,
    },
    store,
  });
  return {
    registry: {
      list: () => [describe()],
      get: (id) => (id === runtime.info.id ? describe() : undefined),
    },
    store,
  };
}

export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    mode: 'local',
    kubeconfigPath: '/nonexistent/config',
    contexts: null,
    bindHost: '127.0.0.1',
    port: 0,
    cacheMaxPerCluster: 1000,
    authMode: 'none',
    oidc: null,
    logLevel: 'error',
    staticDir: 'packages/web/dist',
    publicUrl: null,
    rbacFile: null,
    sessionSecret: null,
    watchNamespaces: [],
    ...overrides,
  };
}

const silentLogger = createLogger('error', {}, () => undefined);

export async function startApp(
  registry: ClusterRegistry,
  overrides: { auth?: Parameters<typeof createApp>[0]['auth'] } = {}
): Promise<{ app: App; baseUrl: string }> {
  const app = createApp({
    config: testConfig({ port: 0 }),
    logger: silentLogger,
    registry,
    auth: overrides.auth ?? null,
  });
  await new Promise<void>((resolve) => {
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('No server address.');
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}
