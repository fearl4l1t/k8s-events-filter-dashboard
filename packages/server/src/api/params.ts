// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { DEFAULT_SORT, PAGE_SIZE, parseCustomTimeBound } from '@k8s-events/domain';
import type { EventFilters, SortConfig, SortField, TimeRangePreset } from '@k8s-events/domain';
import type { EventQuery } from '../query/queryService';
import { QueryError } from '../query/queryService';

const SORT_FIELDS: readonly SortField[] = [
  'firstObservedAt',
  'lastObservedAt',
  'namespace',
  'type',
  'reason',
  'objectName',
  'occurrenceCount',
];

const PRESETS: readonly TimeRangePreset[] = ['all', '15m', '1h', '6h', '24h', 'custom'];

function list(params: URLSearchParams, key: string): string[] {
  const values: string[] = [];
  for (const raw of params.getAll(key)) {
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (trimmed !== '' && !values.includes(trimmed)) values.push(trimmed);
    }
  }
  return values;
}

function single(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readTypes(params: URLSearchParams): ('Normal' | 'Warning')[] {
  const raw = list(params, 'types');
  const types: ('Normal' | 'Warning')[] = [];
  for (const value of raw) {
    if (value !== 'Normal' && value !== 'Warning') {
      throw new QueryError('invalid_type', 'types must contain only Normal or Warning.');
    }
    types.push(value);
  }
  return types;
}

function readTimeRange(params: URLSearchParams): EventFilters['timeRange'] {
  const raw = single(params, 'range') ?? 'all';
  if (!PRESETS.includes(raw as TimeRangePreset)) {
    throw new QueryError(
      'invalid_range',
      'range must be one of all, 15m, 1h, 6h, 24h or custom.'
    );
  }
  const preset = raw as TimeRangePreset;
  const from = single(params, 'from');
  const to = single(params, 'to');

  if (preset !== 'custom') {
    if (from !== null || to !== null) {
      throw new QueryError('invalid_range', 'from and to require range=custom.');
    }
    return { preset, customStart: null, customEnd: null };
  }

  if (from === null || to === null) {
    throw new QueryError('invalid_range', 'A custom range requires both from and to.');
  }
  const start = parseCustomTimeBound(from);
  const end = parseCustomTimeBound(to);
  if (start === null || end === null) {
    throw new QueryError('invalid_range', 'from and to must be ISO 8601 timestamps.');
  }
  if (start > end) {
    throw new QueryError('invalid_range', 'from must not be after to.');
  }
  return { preset, customStart: new Date(start).toISOString(), customEnd: new Date(end).toISOString() };
}

function readSort(params: URLSearchParams): SortConfig {
  const raw = single(params, 'sort');
  if (raw === null) return DEFAULT_SORT;
  const [field, direction = 'desc'] = raw.split(':');
  if (!SORT_FIELDS.includes(field as SortField)) {
    throw new QueryError('invalid_sort', `sort field must be one of ${SORT_FIELDS.join(', ')}.`);
  }
  if (direction !== 'asc' && direction !== 'desc') {
    throw new QueryError('invalid_sort', 'sort direction must be asc or desc.');
  }
  return { field: field as SortField, direction };
}

function readInteger(params: URLSearchParams, key: string, fallback: number): number {
  const raw = single(params, key);
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new QueryError('invalid_pagination', `${key} must be a whole number.`);
  }
  return Number(raw);
}

/** Parses the shared query string used by events, summary, export and the stream. */
export function parseEventQuery(params: URLSearchParams): EventQuery {
  const filters: EventFilters = {
    namespaces: list(params, 'namespaces'),
    types: readTypes(params),
    reasons: list(params, 'reasons'),
    resourceKind: single(params, 'kind'),
    resourceName: single(params, 'name') ?? '',
    reporter: single(params, 'reporter'),
    searchKeyword: single(params, 'q') ?? '',
    timeRange: readTimeRange(params),
  };
  return {
    clusterIds: list(params, 'clusters'),
    filters,
    sort: readSort(params),
    page: readInteger(params, 'page', 1),
    pageSize: readInteger(params, 'pageSize', PAGE_SIZE),
  };
}

/** Serializes a query for links and SSE resumes. */
export function serializeEventQuery(query: EventQuery): string {
  const params = new URLSearchParams();
  if (query.clusterIds.length > 0) params.set('clusters', query.clusterIds.join(','));
  if (query.filters.namespaces.length > 0) params.set('namespaces', query.filters.namespaces.join(','));
  if (query.filters.types.length > 0) params.set('types', query.filters.types.join(','));
  if (query.filters.reasons.length > 0) params.set('reasons', query.filters.reasons.join(','));
  if (query.filters.resourceKind) params.set('kind', query.filters.resourceKind);
  if (query.filters.resourceName.trim()) params.set('name', query.filters.resourceName.trim());
  if (query.filters.reporter) params.set('reporter', query.filters.reporter);
  if (query.filters.searchKeyword.trim()) params.set('q', query.filters.searchKeyword.trim());
  if (query.filters.timeRange.preset !== 'all') params.set('range', query.filters.timeRange.preset);
  if (query.filters.timeRange.customStart) params.set('from', query.filters.timeRange.customStart);
  if (query.filters.timeRange.customEnd) params.set('to', query.filters.timeRange.customEnd);
  if (query.sort.field !== DEFAULT_SORT.field || query.sort.direction !== DEFAULT_SORT.direction) {
    params.set('sort', `${query.sort.field}:${query.sort.direction}`);
  }
  if (query.page !== 1) params.set('page', String(query.page));
  if (query.pageSize !== PAGE_SIZE) params.set('pageSize', String(query.pageSize));
  return params.toString();
}
