// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect } from 'vitest';
import { DEFAULT_FILTERS, DEFAULT_SORT } from '@k8s-events/domain';
import { QueryService, QueryError } from '../../src/query/queryService';
import type { EventQuery, QueryContext } from '../../src/query/queryService';
import { makeEvent, makeRegistry } from './helpers';

function buildQuery(overrides: Partial<EventQuery> = {}): EventQuery {
  return {
    clusterIds: ['ctx-a'],
    filters: { ...DEFAULT_FILTERS },
    sort: DEFAULT_SORT,
    page: 1,
    pageSize: 50,
    ...overrides,
  };
}

function service(records: ReturnType<typeof makeEvent>[], now = '2026-11-14T12:00:00.000Z') {
  const { registry } = makeRegistry(records);
  const context: QueryContext = { clusters: registry.list(), serverTime: now };
  return new QueryService(() => context);
}

describe('QueryService', () => {
  it('applies the shared filter semantics', () => {
    const svc = service([
      makeEvent({ uid: 'w', type: 'Warning', namespace: 'default' }),
      makeEvent({ uid: 'n', type: 'Normal', namespace: 'payments' }),
    ]);
    const result = svc.queryEvents(
      buildQuery({
        filters: { ...DEFAULT_FILTERS, types: ['Warning'], namespaces: ['default'] },
      })
    );
    expect(result.totalItems).toBe(1);
    expect(result.items[0]?.type).toBe('Warning');
  });

  it('sorts newest last-observed first by default', () => {
    const svc = service([
      makeEvent({ uid: 'old', lastObservedAt: '2026-11-14T09:00:00.000Z' }),
      makeEvent({ uid: 'new', lastObservedAt: '2026-11-14T11:00:00.000Z' }),
    ]);
    expect(svc.queryEvents(buildQuery()).items.map((e) => e.uid)).toEqual(['new', 'old']);
  });

  it('paginates and reports totals across pages', () => {
    const records = Array.from({ length: 120 }, (_, index) => makeEvent({ uid: `u-${index}` }));
    const svc = service(records);
    const page2 = svc.queryEvents(buildQuery({ page: 2 }));
    expect(page2.totalItems).toBe(120);
    expect(page2.totalPages).toBe(3);
    expect(page2.items).toHaveLength(50);
    expect(page2.page).toBe(2);
  });

  it('rejects page sizes above the maximum', () => {
    const svc = service([makeEvent()]);
    expect(() => svc.queryEvents(buildQuery({ pageSize: 201 }))).toThrow(QueryError);
  });

  it('counts records excluded only because their timestamp is unusable', () => {
    const svc = service([
      makeEvent({ uid: 'valid', lastObservedAt: '2026-11-14T11:59:00.000Z' }),
      makeEvent({
        uid: 'invalid',
        lastObservedAt: null,
        timestampValid: false,
        timestampSource: { first: 'eventTime', last: 'series' },
      }),
    ]);
    const result = svc.queryEvents(
      buildQuery({ filters: { ...DEFAULT_FILTERS, timeRange: { preset: '1h' } } })
    );
    expect(result.totalItems).toBe(1);
    expect(result.invalidTimestampExcluded).toBe(1);
  });

  it('anchors relative ranges to the server time, not the record clock', () => {
    const svc = service(
      [makeEvent({ uid: 'stale', lastObservedAt: '2026-11-14T08:00:00.000Z' })],
      '2026-11-14T12:00:00.000Z'
    );
    const result = svc.queryEvents(
      buildQuery({ filters: { ...DEFAULT_FILTERS, timeRange: { preset: '1h' } } })
    );
    expect(result.totalItems).toBe(0);
    expect(result.serverTime).toBe('2026-11-14T12:00:00.000Z');
  });

  it('builds a summary from the same filtered set as the table', () => {
    const svc = service([
      makeEvent({ uid: 'w', type: 'Warning' }),
      makeEvent({ uid: 'n', type: 'Normal', reason: 'Pulled' }),
    ]);
    const summary = svc.summary(buildQuery());
    const table = svc.queryEvents(buildQuery());
    expect(summary.metrics.totalEvents).toBe(table.totalItems);
    expect(summary.metrics.warningCount).toBe(1);
    expect(summary.analytics.totalOccurrences).toBe(6);
  });

  it('lists filter options across all records, not the filtered set', () => {
    const svc = service([
      makeEvent({ uid: 'a', namespace: 'default' }),
      makeEvent({ uid: 'b', namespace: 'payments', reason: 'Failed' }),
    ]);
    const options = svc.options(['ctx-a']);
    expect(options.namespaces).toEqual(['default', 'payments']);
    expect(options.reasons).toEqual(['BackOff', 'Failed']);
    expect(options.resourceKinds).toEqual(['Pod']);
    expect(options.reporters).toEqual(['kubelet']);
  });

  it('finds a record by logical ID and reports unknown clusters', () => {
    const svc = service([makeEvent({ uid: 'target' })]);
    expect(svc.find('ctx-a/target')?.uid).toBe('target');
    expect(svc.find('ctx-b/target')).toBeUndefined();
    expect(svc.find('noslash')).toBeUndefined();
  });

  it('marks a response partial when a covered cluster is not live', () => {
    const { registry } = makeRegistry([makeEvent()], { status: 'unreachable' });
    const svc = new QueryService(() => ({
      clusters: registry.list(),
      serverTime: '2026-11-14T12:00:00.000Z',
    }));
    expect(svc.queryEvents(buildQuery()).partial).toBe(true);
  });

  it('exports the whole filtered set in sort order', () => {
    const svc = service([
      makeEvent({ uid: 'old', lastObservedAt: '2026-11-14T09:00:00.000Z' }),
      makeEvent({ uid: 'new', lastObservedAt: '2026-11-14T11:00:00.000Z' }),
    ]);
    expect(svc.exportRecords(buildQuery()).map((e) => e.uid)).toEqual(['new', 'old']);
    expect(svc.exportCount(['ctx-a'])).toBe(2);
  });
});
