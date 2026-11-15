// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect } from 'vitest';
import { DEFAULT_FILTERS, DEFAULT_SORT } from '@k8s-events/domain';
import { parseEventQuery, serializeEventQuery } from '../../src/api/params';
import { QueryError } from '../../src/query/queryService';

describe('parseEventQuery', () => {
  it('treats an empty query string as the default view', () => {
    const query = parseEventQuery(new URLSearchParams(''));
    expect(query.filters).toEqual(DEFAULT_FILTERS);
    expect(query.sort).toEqual(DEFAULT_SORT);
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(50);
    expect(query.clusterIds).toEqual([]);
  });

  it('reads repeated and comma-separated values without duplicates', () => {
    const query = parseEventQuery(
      new URLSearchParams('namespaces=default,payments&namespaces=default&reasons=A,B')
    );
    expect(query.filters.namespaces).toEqual(['default', 'payments']);
    expect(query.filters.reasons).toEqual(['A', 'B']);
  });

  it('rejects unknown types, ranges and sort fields', () => {
    expect(() => parseEventQuery(new URLSearchParams('types=Critical'))).toThrow(QueryError);
    expect(() => parseEventQuery(new URLSearchParams('range=7d'))).toThrow(QueryError);
    expect(() => parseEventQuery(new URLSearchParams('sort=message:desc'))).toThrow(QueryError);
    expect(() => parseEventQuery(new URLSearchParams('sort=reason:sideways'))).toThrow(QueryError);
  });

  it('requires both bounds for a custom range and rejects inverted bounds', () => {
    expect(() => parseEventQuery(new URLSearchParams('range=custom&from=2026-11-14T10:00:00Z'))).toThrow(
      QueryError
    );
    expect(() =>
      parseEventQuery(
        new URLSearchParams(
          'range=custom&from=2026-11-14T12:00:00Z&to=2026-11-14T10:00:00Z'
        )
      )
    ).toThrow(QueryError);
  });

  it('normalizes custom bounds to UTC ISO strings', () => {
    const query = parseEventQuery(
      new URLSearchParams('range=custom&from=2026-11-14T10:00:00Z&to=2026-11-14T11:00:00Z')
    );
    expect(query.filters.timeRange.customStart).toBe('2026-11-14T10:00:00.000Z');
    expect(query.filters.timeRange.customEnd).toBe('2026-11-14T11:00:00.000Z');
  });

  it('rejects from and to without range=custom', () => {
    expect(() =>
      parseEventQuery(new URLSearchParams('range=1h&from=2026-11-14T10:00:00Z'))
    ).toThrow(QueryError);
  });

  it('rejects non-numeric pagination values', () => {
    expect(() => parseEventQuery(new URLSearchParams('page=two'))).toThrow(QueryError);
  });
});

describe('serializeEventQuery', () => {
  it('round-trips the filters it writes', () => {
    const original = parseEventQuery(
      new URLSearchParams(
        'clusters=ctx-a,ctx-b&namespaces=default&types=Warning&reasons=BackOff&kind=Pod&name=web&reporter=kubelet&q=restart&range=custom&from=2026-11-14T10:00:00Z&to=2026-11-14T11:00:00Z&sort=reason:asc&page=3&pageSize=25'
      )
    );
    const roundTripped = parseEventQuery(new URLSearchParams(serializeEventQuery(original)));
    expect(roundTripped).toEqual(original);
  });

  it('omits default values from the serialized query', () => {
    const query = parseEventQuery(new URLSearchParams(''));
    expect(serializeEventQuery(query)).toBe('');
  });
});
