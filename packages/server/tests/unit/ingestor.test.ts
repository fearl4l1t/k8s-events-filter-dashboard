// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect, vi } from 'vitest';
import { Ingestor, isResourceVersion, observationStart } from '../../src/ingest/ingestor';
import type { EventSourceClient } from '../../src/ingest/ingestor';
import { ClusterStore } from '../../src/store/clusterStore';
import { KubeApiError } from '../../src/kube/client';
import type { WatchMessage } from '../../src/kube/client';
import { createLogger } from '../../src/logging';

const CONTEXT = { clusterId: 'ctx-a', clusterName: 'cluster-a', source: 'local' as const };
const silent = createLogger('error', {}, () => undefined);

function rawEvent(uid: string, count = 1, lastObserved = '2026-11-14T10:05:00Z'): Record<string, unknown> {
  return {
    apiVersion: 'events.k8s.io/v1',
    kind: 'Event',
    metadata: { uid, namespace: 'default', creationTimestamp: '2026-11-14T09:00:00Z' },
    type: 'Warning',
    reason: 'BackOff',
    note: 'Back-off restarting failed container',
    eventTime: '2026-11-14T10:00:00Z',
    regarding: { apiVersion: 'v1', kind: 'Pod', name: 'web', namespace: 'default', uid: 'pod' },
    reportingController: 'kubelet',
    series: { count, lastObservedTime: lastObserved },
  };
}

type ScriptedOptions = {
  items?: unknown[];
  resourceVersion?: string;
  watchScript?: (send: (message: WatchMessage) => void, signal: AbortSignal) => Promise<void>;
};

function scriptedClient(options: ScriptedOptions) {
  const state = { lists: 0, watches: 0, signal: null as AbortSignal | null };
  const client: EventSourceClient = {
    listEvents: async () => {
      state.lists++;
      return { items: options.items ?? [], resourceVersion: options.resourceVersion ?? '10' };
    },
    watchEvents: async (resourceVersion, onMessage, signal) => {
      state.watches++;
      state.signal = signal;
      expect(typeof resourceVersion).toBe('string');
      await options.watchScript?.(onMessage, signal);
    },
  };
  return { client, state };
}

function makeIngestor(client: EventSourceClient, store = new ClusterStore('ctx-a', 1000)) {
  return {
    ingestor: new Ingestor({
      client,
      store,
      context: CONTEXT,
      logger: silent,
      // Yield to the macrotask queue so the retry loop cannot starve timers.
      sleep: async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 1)));
      },
    }),
    store,
  };
}

describe('Ingestor', () => {
  it('lists records, then becomes live and records the observation start', async () => {
    const { client, state } = scriptedClient({
      items: [rawEvent('a'), rawEvent('b')],
      watchScript: (_send, signal) =>
        new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
    });
    const { ingestor, store } = makeIngestor(client);
    ingestor.start();
    await vi.waitFor(() => expect(state.watches).toBe(1));
    expect(ingestor.status).toBe('live');
    expect(store.size).toBe(2);
    expect(ingestor.observationStartedAt).not.toBeNull();
    await ingestor.stop();
  });

  it('replaces a series update with the same logical ID', async () => {
    const { client } = scriptedClient({
      items: [rawEvent('a', 1)],
      watchScript: async (send, signal) => {
        send({ type: 'MODIFIED', object: rawEvent('a', 4, '2026-11-14T10:09:00Z') });
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        );
      },
    });
    const { ingestor, store } = makeIngestor(client);
    ingestor.start();
    await vi.waitFor(() => expect(store.get('ctx-a/a')?.occurrenceCount).toBe(4));
    expect(store.size).toBe(1);
    expect(store.get('ctx-a/a')?.lastObservedAt).toBe('2026-11-14T10:09:00.000Z');
    await ingestor.stop();
  });

  it('publishes changed records to store subscribers', async () => {
    const stream: { send: ((message: WatchMessage) => void) | null } = { send: null };
    const { client } = scriptedClient({
      items: [],
      watchScript: async (emit, signal) => {
        stream.send = emit;
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        );
      },
    });
    const { ingestor, store } = makeIngestor(client);
    const listener = vi.fn();
    store.subscribe(listener);
    ingestor.start();
    await vi.waitFor(() => expect(stream.send).not.toBeNull());
    stream.send?.({ type: 'ADDED', object: rawEvent('new') });
    expect(listener).toHaveBeenCalledTimes(1);
    await ingestor.stop();
  });

  it('re-lists when the watch position expires', async () => {
    let watchCalls = 0;
    const { client, state } = scriptedClient({
      items: [rawEvent('a')],
      watchScript: async (_send, signal) => {
        watchCalls++;
        if (watchCalls === 1) throw new KubeApiError(410, 'expired');
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        );
      },
    });
    const { ingestor, store } = makeIngestor(client);
    ingestor.start();
    await vi.waitFor(() => expect(state.lists).toBeGreaterThanOrEqual(2));
    expect(store.size).toBe(1);
    await ingestor.stop();
  });

  it('marks auth failures distinctly', async () => {
    const client: EventSourceClient = {
      listEvents: async () => {
        throw new KubeApiError(403, 'denied');
      },
      watchEvents: async () => undefined,
    };
    const { ingestor } = makeIngestor(client);
    ingestor.start();
    await vi.waitFor(() => expect(ingestor.status).toBe('auth-failed'));
    expect(ingestor.error?.code).toBe('cluster_forbidden');
    await ingestor.stop();
  });

  it('marks unreachable clusters and backoff starts at one second', async () => {
    const sleeps: number[] = [];
    const client: EventSourceClient = {
      listEvents: async () => {
        throw new KubeApiError(0, 'down');
      },
      watchEvents: async () => undefined,
    };
    const ingestor = new Ingestor({
      client,
      store: new ClusterStore('ctx-a', 10),
      context: CONTEXT,
      logger: silent,
      jitter: () => 0.5,
      sleep: async (ms) => {
        sleeps.push(ms);
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    });
    ingestor.start();
    await vi.waitFor(() => expect(sleeps.length).toBeGreaterThanOrEqual(2));
    expect(ingestor.status).toBe('unreachable');
    expect(sleeps[0]).toBe(1000);
    expect(sleeps[1]).toBe(2000);
    await ingestor.stop();
  });

  it('stops ingesting after stop and does not start twice', async () => {
    const { client, state } = scriptedClient({
      items: [],
      watchScript: (_send, signal) =>
        new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
    });
    const { ingestor } = makeIngestor(client);
    ingestor.start();
    ingestor.start();
    await vi.waitFor(() => expect(state.watches).toBe(1));
    await ingestor.stop();
    expect(ingestor.running).toBe(false);
    const listsAfterStop = state.lists;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(state.lists).toBe(listsAfterStop);
  });

  it('handles deleted records and bookmarks', async () => {
    const stream: { send: ((message: WatchMessage) => void) | null } = { send: null };
    const { client } = scriptedClient({
      items: [rawEvent('gone')],
      watchScript: async (emit, signal) => {
        stream.send = emit;
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        );
      },
    });
    const { ingestor, store } = makeIngestor(client);
    ingestor.start();
    await vi.waitFor(() => expect(stream.send).not.toBeNull());
    stream.send?.({ type: 'BOOKMARK', object: { metadata: { resourceVersion: '99' } } });
    stream.send?.({
      type: 'DELETED',
      object: { metadata: { uid: 'gone', resourceVersion: '100' } },
    });
    expect(store.get('ctx-a/gone')).toBeUndefined();
    await ingestor.stop();
  });

  it('ignores malformed watch messages without failing the loop', async () => {
    const stream: { send: ((message: WatchMessage) => void) | null } = { send: null };
    const { client } = scriptedClient({
      items: [rawEvent('kept')],
      watchScript: async (emit, signal) => {
        stream.send = emit;
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        );
      },
    });
    const { ingestor, store } = makeIngestor(client);
    ingestor.start();
    await vi.waitFor(() => expect(stream.send).not.toBeNull());
    stream.send?.({ type: 'ERROR', object: { code: 500 } });
    stream.send?.({ type: 'ADDED', object: null as unknown as Record<string, unknown> });
    stream.send?.({ type: 'ADDED', object: 'not-an-object' as unknown as Record<string, unknown> });
    stream.send?.({ type: 'DELETED', object: { metadata: {} } });
    stream.send?.({ type: 'BOOKMARK', object: null as unknown as Record<string, unknown> });
    stream.send?.({ type: 'MODIFIED', object: rawEvent('kept', 2) });
    expect(store.size).toBe(1);
    expect(store.get('ctx-a/kept')?.occurrenceCount).toBe(2);
    await ingestor.stop();
  });

  it('keeps ingesting when one subscriber throws', async () => {
    const stream: { send: ((message: WatchMessage) => void) | null } = { send: null };
    const { client } = scriptedClient({
      items: [],
      watchScript: async (emit, signal) => {
        stream.send = emit;
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        );
      },
    });
    const { ingestor, store } = makeIngestor(client);
    const healthy = vi.fn();
    store.subscribe(() => {
      throw new Error('subscriber failed');
    });
    store.subscribe(healthy);
    ingestor.start();
    await vi.waitFor(() => expect(stream.send).not.toBeNull());
    stream.send?.({ type: 'ADDED', object: rawEvent('new') });
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);
    await ingestor.stop();
  });

  it('marks a closed watch as degraded before re-listing', async () => {
    const sleeps: number[] = [];
    let lists = 0;
    const client: EventSourceClient = {
      listEvents: async () => {
        lists++;
        return { items: [], resourceVersion: '1' };
      },
      watchEvents: async () => Promise.resolve(),
    };
    const ingestor = new Ingestor({
      client,
      store: new ClusterStore('ctx-a', 10),
      context: CONTEXT,
      logger: silent,
      jitter: () => 0.5,
      sleep: async (ms) => {
        sleeps.push(ms);
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    });
    ingestor.start();
    await vi.waitFor(() => expect(sleeps.length).toBeGreaterThanOrEqual(1));
    expect(ingestor.status).toBe('degraded');
    expect(lists).toBeGreaterThanOrEqual(1);
    await ingestor.stop();
  });

  it('logs eviction when the cluster cap is reached', async () => {
    const warnings: string[] = [];
    const { client } = scriptedClient({
      items: [rawEvent('a', 1, '2026-11-14T10:01:00Z'), rawEvent('b', 1, '2026-11-14T10:02:00Z'), rawEvent('c', 1, '2026-11-14T10:03:00Z')],
      watchScript: (_send, signal) =>
        new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
    });
    const store = new ClusterStore('ctx-a', 2);
    const ingestor = new Ingestor({
      client,
      store,
      context: CONTEXT,
      logger: createLogger('warn', {}, (line) => warnings.push(JSON.parse(line).message)),
      sleep: async () => new Promise((resolve) => setTimeout(resolve, 1)),
    });
    ingestor.start();
    await vi.waitFor(() => expect(store.evictedCount).toBeGreaterThan(0));
    expect(warnings).toContain('record cap reached; oldest records were evicted');
    expect(store.size).toBeLessThanOrEqual(2);
    expect(store.get('ctx-a/c')).toBeDefined();
    await ingestor.stop();
  });

  it('derives stable fallback IDs when the source UID is absent', () => {
    const { client } = scriptedClient({ items: [] });
    const { ingestor, store } = makeIngestor(client);
    const withoutUid = rawEvent('unused');
    delete (withoutUid['metadata'] as Record<string, unknown>)['uid'];
    const first = ingestor.ingestObject(withoutUid);
    const second = ingestor.ingestObject(withoutUid);
    expect(first.id).not.toBe(second.id);
    expect(first.id.startsWith('ctx-a/')).toBe(true);
    expect(store.size).toBe(2);
  });

  it('validates resource versions and observation start values', () => {
    expect(isResourceVersion('10')).toBe(true);
    expect(isResourceVersion('')).toBe(false);
    expect(isResourceVersion(10)).toBe(false);
    expect(observationStart('2026-11-14T10:00:00.000Z')).toBe('2026-11-14T10:00:00.000Z');
    expect(observationStart('not-a-date')).toBeNull();
    expect(observationStart(null)).toBeNull();
  });

  it('watches each configured namespace separately', async () => {
    const watched: (string | undefined)[] = [];
    const client: EventSourceClient = {
      listEvents: async (_token, namespace) => ({
        items: namespace === 'payments' ? [rawEvent('p1')] : [rawEvent('c1')],
        resourceVersion: '5',
      }),
      watchEvents: async (_rv, _onMessage, signal, namespace) => {
        watched.push(namespace);
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        );
      },
    };
    const ingestor = new Ingestor({
      client,
      store: new ClusterStore('ctx-a', 100),
      context: CONTEXT,
      logger: silent,
      namespaces: ['payments', 'checkout'],
      sleep: async () => new Promise((resolve) => setTimeout(resolve, 1)),
    });
    ingestor.start();
    await vi.waitFor(() => expect(watched).toHaveLength(2));
    expect(watched.sort()).toEqual(['checkout', 'payments']);
    expect(ingestor.namespaces.sort()).toEqual(['checkout', 'payments']);
    expect(ingestor.status).toBe('live');
    expect(ingestor.allScopesLive).toBe(true);
    await ingestor.stop();
  });

  it('reports degraded coverage when one watched namespace fails', async () => {
    const client: EventSourceClient = {
      listEvents: async (_token, namespace) => {
        if (namespace === 'payments') throw new KubeApiError(403, 'denied');
        return { items: [], resourceVersion: '5' };
      },
      watchEvents: async (_rv, _onMessage, signal) =>
        new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        ),
    };
    const ingestor = new Ingestor({
      client,
      store: new ClusterStore('ctx-a', 100),
      context: CONTEXT,
      logger: silent,
      namespaces: ['payments', 'checkout'],
      sleep: async () => new Promise((resolve) => setTimeout(resolve, 20)),
    });
    ingestor.start();
    await vi.waitFor(() => expect(ingestor.status).toBe('degraded'));
    expect(ingestor.error?.code).toBe('cluster_forbidden');
    expect(ingestor.allScopesLive).toBe(false);
    await ingestor.stop();
  });

  it('keeps other namespace records when one scope re-lists', async () => {
    let paymentsList = [rawEvent('p1')];
    const client: EventSourceClient = {
      listEvents: async (_token, namespace) => ({
        items: namespace === 'payments' ? paymentsList : [rawEvent('c1')],
        resourceVersion: '5',
      }),
      watchEvents: async (_rv, onMessage, signal, namespace) => {
        if (namespace === 'payments') {
          paymentsList = [];
          onMessage({ type: 'BOOKMARK', object: { metadata: { resourceVersion: '6' } } });
          // Let the first list settle, then close the watch so the ingestor re-lists.
        }
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        );
      },
    };
    const ingestor = new Ingestor({
      client,
      store: new ClusterStore('ctx-a', 100),
      context: CONTEXT,
      logger: silent,
      namespaces: ['payments', 'checkout'],
      sleep: async () => new Promise((resolve) => setTimeout(resolve, 1)),
    });
    ingestor.start();
    await vi.waitFor(() => expect(ingestor.status).toBe('live'));
    expect(ingestor.store.get('ctx-a/p1')).toBeDefined();
    expect(ingestor.store.get('ctx-a/c1')).toBeDefined();
    await ingestor.stop();
  });

  it('stops cleanly before starting', async () => {
    const { client } = scriptedClient({ items: [] });
    const { ingestor } = makeIngestor(client);
    await ingestor.stop();
    expect(ingestor.running).toBe(false);
  });

  it('restarts after an explicit stop', async () => {
    const { client, state } = scriptedClient({
      items: [rawEvent('a')],
      watchScript: (_send, signal) =>
        new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
    });
    const { ingestor } = makeIngestor(client);
    ingestor.start();
    await vi.waitFor(() => expect(state.watches).toBe(1));
    await ingestor.stop();
    ingestor.start();
    await vi.waitFor(() => expect(state.watches).toBe(2));
    await ingestor.stop();
  });
});
