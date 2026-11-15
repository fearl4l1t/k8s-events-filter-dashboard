// @vitest-environment jsdom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDashboard, type Dashboard } from '../../src/state/useDashboard';

type ClusterFixture = {
  id: string;
  name: string;
  source: 'local' | 'in-cluster';
  status: 'live' | 'degraded';
  observationStartedAt: string | null;
  lastEventAt: string | null;
  recordCount: number;
  evictedCount: number;
  error: null;
};

const CLUSTER: ClusterFixture = {
  id: 'ctx-a',
  name: 'kind-events',
  source: 'local',
  status: 'live',
  observationStartedAt: '2026-11-14T09:00:00.000Z',
  lastEventAt: '2026-11-14T10:05:00.000Z',
  recordCount: 1,
  evictedCount: 0,
  error: null,
};

type FetchCall = { url: string };

let calls: FetchCall[] = [];
let latest: Dashboard | null = null;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function respond(url: string): Response {
  if (url.startsWith('/api/clusters')) {
    return json({ clusters: [CLUSTER], serverTime: '2026-11-14T10:06:00.000Z', partial: false });
  }
  if (url.startsWith('/api/me')) {
    return json({
      mode: 'none',
      authenticated: true,
      user: { id: 'local', name: 'Local operator' },
      roles: ['local'],
      grants: [],
    });
  }
  if (url.startsWith('/api/events/')) {
    return json({
      event: { id: 'ctx-a/uid-1', reason: 'BackOff' },
      cluster: CLUSTER,
      serverTime: '2026-11-14T10:06:00.000Z',
    });
  }
  if (url.startsWith('/api/summary')) {
    return json({
      totalEvents: 1,
      warningCount: 1,
      normalCount: 0,
      namespaceCount: 1,
      recentWarnings: [],
      commonReasons: [],
      volumeBuckets: [],
      invalidTimestampCount: 0,
      totalOccurrences: 3,
      recordsWithKnownOccurrenceCount: 1,
      typeBreakdown: [],
      reasonBreakdown: [],
      namespaceBreakdown: [],
      invalidTimestampExcluded: 1,
      serverTime: '2026-11-14T10:06:00.000Z',
      partial: false,
      clusters: [CLUSTER],
    });
  }
  if (url.startsWith('/api/options')) {
    return json({
      options: { namespaces: ['default'], reasons: ['BackOff'], resourceKinds: ['Pod'], reporters: [] },
      serverTime: '2026-11-14T10:06:00.000Z',
    });
  }
  return json({
    items: [],
    totalItems: 0,
    totalPages: 1,
    page: 1,
    pageSize: 50,
    invalidTimestampExcluded: 0,
    serverTime: '2026-11-14T10:06:00.000Z',
    partial: false,
    clusters: [CLUSTER],
  });
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Set<() => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: () => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  close() {
    this.closed = true;
  }
}

function Harness() {
  latest = useDashboard();
  return null;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  calls = [];
  latest = null;
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', async (input: string) => {
    calls.push({ url: input });
    return respond(input);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function waitFor(check: () => boolean, attempts = 200): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (check()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error('Timed out waiting for dashboard state.');
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<Harness />);
  });
  await waitFor(() => latest !== null && latest.page !== null);
}

describe('useDashboard', () => {
  it('loads clusters, identity, one page and one summary from the server', async () => {
    await mount();
    expect(latest?.clusters?.[0]?.name).toBe('kind-events');
    expect(latest?.identity?.user.id).toBe('local');
    expect(latest?.page?.totalItems).toBe(0);
    expect(latest?.summary?.invalidTimestampExcluded).toBe(1);
    expect(latest?.loading).toBe(false);
    expect(calls.some((call) => call.url.startsWith('/api/events?'))).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('shares the query parameters across events, summary and options', async () => {
    await mount();
    calls = [];
    await act(async () => {
      latest?.setFilters({
        ...latest.query.filters,
        namespaces: ['payments'],
        types: ['Warning'],
      });
    });
    await waitFor(() => calls.some((call) => call.url.includes('namespaces=payments')));
    const events = calls.find((call) => call.url.startsWith('/api/events?'));
    const summary = calls.find((call) => call.url.startsWith('/api/summary?'));
    expect(events?.url).toContain('types=Warning');
    expect(events?.url).toContain('page=1');
    expect(summary?.url).toContain('namespaces=payments');
    expect(summary?.url).not.toContain('page=');
    expect(latest?.query.page).toBe(1);
  });

  it('resets sorting and paging on clear', async () => {
    await mount();
    await act(async () => {
      latest?.setSort({ field: 'reason', direction: 'asc' });
      latest?.setPage(4);
    });
    await waitFor(() => latest?.query.page === 4);
    await act(async () => {
      latest?.clearFilters();
    });
    expect(latest?.query.sort.field).toBe('lastObservedAt');
    expect(latest?.query.page).toBe(1);
  });

  it('keeps page numbers at or above one', async () => {
    await mount();
    await act(async () => {
      latest?.setPage(0);
    });
    expect(latest?.query.page).toBe(1);
  });

  it('adds and removes a cluster from the selection', async () => {
    await mount();
    await act(async () => {
      latest?.toggleCluster('ctx-a');
    });
    expect(latest?.query.clusterIds).toEqual(['ctx-a']);
    await act(async () => {
      latest?.toggleCluster('ctx-a');
    });
    expect(latest?.query.clusterIds).toEqual([]);
    await act(async () => {
      latest?.setClusterIds(['ctx-b']);
    });
    expect(latest?.query.clusterIds).toEqual(['ctx-b']);
    expect(latest?.query.page).toBe(1);
  });

  it('applies a chart filter and returns to page one', async () => {
    await mount();
    await act(async () => {
      latest?.setPage(3);
    });
    await act(async () => {
      latest?.applyFilter({ reasons: ['BackOff'] });
    });
    expect(latest?.query.filters.reasons).toEqual(['BackOff']);
    expect(latest?.query.page).toBe(1);
  });

  it('fetches the selected record and clears it on close', async () => {
    await mount();
    await act(async () => {
      latest?.selectEvent('ctx-a/uid-1');
    });
    await waitFor(() => latest?.detail !== null);
    expect(calls.some((call) => call.url === '/api/events/ctx-a%2Fuid-1')).toBe(true);
    expect(latest?.detail?.reason).toBe('BackOff');
    await act(async () => {
      latest?.selectEvent(null);
    });
    expect(latest?.detail).toBeNull();
    expect(latest?.selectedId).toBeNull();
  });

  it('re-queries when the stream signals an update', async () => {
    await mount();
    calls = [];
    const source = FakeEventSource.instances[0];
    if (!source) throw new Error('Expected a stream connection.');
    await act(async () => {
      source.emit('summary-tick');
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    await waitFor(() => calls.some((call) => call.url.startsWith('/api/events?')));
  });

  it('reports a server error without losing the shell', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(
        JSON.stringify({ error: { code: 'unauthenticated', message: 'Sign in required.' } }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      );
    });
    await act(async () => {
      root.render(<Harness />);
    });
    await waitFor(() => latest?.error === 'Sign in required.');
    expect(latest?.loading).toBe(false);
    expect(latest?.clusters).toBeNull();
  });

  it('surfaces a missing record in the detail error', async () => {
    vi.stubGlobal('fetch', async (input: string) => {
      if (input.startsWith('/api/events/')) {
        return new Response(
          JSON.stringify({ error: { code: 'record_not_found', message: 'That record is gone.' } }),
          { status: 404, headers: { 'content-type': 'application/json' } }
        );
      }
      return respond(input);
    });
    await mount();
    await act(async () => {
      latest?.selectEvent('ctx-a/gone');
    });
    await waitFor(() => latest?.detailError === 'That record is gone.');
    expect(latest?.detail).toBeNull();
  });
});
