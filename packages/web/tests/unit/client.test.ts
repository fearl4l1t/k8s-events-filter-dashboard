// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_FILTERS, DEFAULT_SORT } from '@k8s-events/domain';
import {
  api,
  ApiClientError,
  queryParams,
  type DashboardQuery,
} from '../../src/api/client';

function query(overrides: Partial<DashboardQuery> = {}): DashboardQuery {
  return {
    clusterIds: [],
    filters: DEFAULT_FILTERS,
    sort: DEFAULT_SORT,
    page: 1,
    pageSize: 50,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('queryParams', () => {
  it('sends only the default sort and paging for an unfiltered query', () => {
    const params = queryParams(query());
    expect([...params.keys()].sort()).toEqual(['page', 'pageSize', 'sort']);
    expect(params.get('sort')).toBe('lastObservedAt:desc');
  });

  it('serializes every filter category', () => {
    const params = queryParams(
      query({
        clusterIds: ['ctx-a', 'ctx-b'],
        filters: {
          ...DEFAULT_FILTERS,
          searchKeyword: '  backoff ',
          namespaces: ['default', 'payments'],
          types: ['Warning', 'Normal'],
          reasons: ['BackOff', 'Failed'],
          resourceKind: 'Pod',
          resourceName: 'web',
          reporter: 'kubelet',
          timeRange: {
            preset: 'custom',
            customStart: '2026-11-14T09:00:00.000Z',
            customEnd: '2026-11-14T10:00:00.000Z',
          },
        },
      })
    );
    expect(params.getAll('clusters')).toEqual(['ctx-a', 'ctx-b']);
    expect(params.get('q')).toBe('backoff');
    expect(params.getAll('namespaces')).toEqual(['default', 'payments']);
    expect(params.getAll('types')).toEqual(['Warning', 'Normal']);
    expect(params.getAll('reasons')).toEqual(['BackOff', 'Failed']);
    expect(params.get('kind')).toBe('Pod');
    expect(params.get('name')).toBe('web');
    expect(params.get('reporter')).toBe('kubelet');
    expect(params.get('range')).toBe('custom');
    expect(params.get('from')).toBe('2026-11-14T09:00:00.000Z');
    expect(params.get('to')).toBe('2026-11-14T10:00:00.000Z');
  });

  it('omits paging for export and stream URLs', () => {
    const params = queryParams(query({ page: 7 }), false);
    expect(params.has('page')).toBe(false);
    expect(api.exportUrl(query(), 'csv')).toBe('/api/export?sort=lastObservedAt%3Adesc&format=csv');
    expect(api.streamUrl(query())).toContain('/api/stream?');
    expect(api.exportUrl(query(), 'json')).toContain('format=json');
  });

  it('does not send a relative range without a preset', () => {
    const params = queryParams(query());
    expect(params.has('range')).toBe(false);
    const preset = queryParams(
      query({ filters: { ...DEFAULT_FILTERS, timeRange: { preset: '1h', customStart: null, customEnd: null } } })
    );
    expect(preset.get('range')).toBe('1h');
    expect(preset.has('from')).toBe(false);
  });
});

describe('api client', () => {
  it('reads JSON responses with same-origin credentials', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ clusters: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await api.clusters();
    expect(result.clusters).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/clusters',
      expect.objectContaining({ credentials: 'same-origin', method: 'GET' })
    );
  });

  it('encodes the record ID when fetching one Event', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.event('ctx-a/uid/with space');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/events/ctx-a%2Fuid%2Fwith%20space');
  });

  it('surfaces the server error code and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'forbidden', message: 'No access.' } }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        })
      )
    );
    const error = await api.events(query()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe('forbidden');
    expect((error as ApiClientError).status).toBe(403);
    expect((error as ApiClientError).message).toBe('No access.');
  });

  it('keeps a status message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })));
    const error = await api.summary(query()).catch((caught: unknown) => caught);
    expect((error as ApiClientError).code).toBe('request_failed');
    expect((error as ApiClientError).message).toContain('502');
  });

  it('reports an unreachable server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      })
    );
    const error = await api.me().catch((caught: unknown) => caught);
    expect((error as ApiClientError).code).toBe('network_error');
  });
});
