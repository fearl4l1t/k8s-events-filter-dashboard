// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import type {
  AnalyticsData,
  AvailableFilterOptions,
  EventFilters,
  NormalisedEvent,
  OverviewMetrics,
  SortConfig,
} from '@k8s-events/domain';

export type ClusterStatus = 'connecting' | 'live' | 'degraded' | 'unreachable' | 'auth-failed';

export type ClusterError = { code: string; message: string };

export type ClusterSummary = {
  id: string;
  name: string;
  source: 'local' | 'in-cluster';
  status: ClusterStatus;
  observationStartedAt: string | null;
  lastEventAt: string | null;
  recordCount: number;
  evictedCount: number;
  error: ClusterError | null;
};

export type ClustersResponse = {
  clusters: ClusterSummary[];
  serverTime: string;
  partial: boolean;
};

export type EventsResponse = {
  items: NormalisedEvent[];
  totalItems: number;
  totalPages: number;
  page: number;
  pageSize: number;
  invalidTimestampExcluded: number;
  serverTime: string;
  partial: boolean;
  clusters: ClusterSummary[];
};

export type SummaryResponse = OverviewMetrics &
  Pick<AnalyticsData, 'totalOccurrences' | 'recordsWithKnownOccurrenceCount'> &
  Pick<AnalyticsData, 'typeBreakdown' | 'reasonBreakdown' | 'namespaceBreakdown'> & {
    invalidTimestampExcluded: number;
    serverTime: string;
    partial: boolean;
    clusters: ClusterSummary[];
  };

export type EventDetailResponse = {
  event: NormalisedEvent;
  cluster: ClusterSummary | null;
  serverTime: string;
};

export type OptionsResponse = {
  options: AvailableFilterOptions;
  serverTime: string;
};

export type IdentityResponse = {
  mode: 'none' | 'oidc';
  authenticated: boolean;
  user: { id: string; name: string | null };
  roles: string[];
  grants: { clusterId: string; namespaces: string[] }[];
};

/** The query all data screens share; every route receives the same parameters. */
export type DashboardQuery = {
  clusterIds: string[];
  filters: EventFilters;
  sort: SortConfig;
  page: number;
  pageSize: number;
};

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/** Serializes the shared query into the parameters the server parses. */
export function queryParams(query: DashboardQuery, includePaging = true): URLSearchParams {
  const params = new URLSearchParams();
  const { filters } = query;
  for (const clusterId of query.clusterIds) params.append('clusters', clusterId);
  if (filters.searchKeyword.trim()) params.set('q', filters.searchKeyword.trim());
  if (filters.timeRange.preset !== 'all') {
    params.set('range', filters.timeRange.preset);
    if (filters.timeRange.preset === 'custom') {
      if (filters.timeRange.customStart) params.set('from', filters.timeRange.customStart);
      if (filters.timeRange.customEnd) params.set('to', filters.timeRange.customEnd);
    }
  }
  for (const namespace of filters.namespaces) params.append('namespaces', namespace);
  for (const type of filters.types) params.append('types', type);
  for (const reason of filters.reasons) params.append('reasons', reason);
  if (filters.resourceKind) params.set('kind', filters.resourceKind);
  if (filters.resourceName.trim()) params.set('name', filters.resourceName.trim());
  if (filters.reporter) params.set('reporter', filters.reporter);
  params.set('sort', `${query.sort.field}:${query.sort.direction}`);
  if (includePaging) {
    params.set('page', String(query.page));
    params.set('pageSize', String(query.pageSize));
  }
  return params;
}

async function request<T>(path: string, params?: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const suffix = params && [...params.keys()].length > 0 ? `?${params.toString()}` : '';
  let response: Response;
  try {
    response = await fetch(`${path}${suffix}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiClientError('network_error', 'The dashboard server could not be reached.', 0);
  }
  if (!response.ok) {
    let code = 'request_failed';
    let message = `The dashboard server answered with status ${response.status}.`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      // A non-JSON error body keeps the status-derived message.
    }
    throw new ApiClientError(code, message, response.status);
  }
  return (await response.json()) as T;
}

export const api = {
  clusters: (signal?: AbortSignal) => request<ClustersResponse>('/api/clusters', undefined, signal),
  me: (signal?: AbortSignal) => request<IdentityResponse>('/api/me', undefined, signal),
  events: (query: DashboardQuery, signal?: AbortSignal) =>
    request<EventsResponse>('/api/events', queryParams(query), signal),
  summary: (query: DashboardQuery, signal?: AbortSignal) =>
    request<SummaryResponse>('/api/summary', queryParams(query, false), signal),
  options: (query: DashboardQuery, signal?: AbortSignal) =>
    request<OptionsResponse>('/api/options', queryParams(query, false), signal),
  event: (id: string, signal?: AbortSignal) =>
    request<EventDetailResponse>(`/api/events/${encodeURIComponent(id)}`, undefined, signal),
  exportUrl: (query: DashboardQuery, format: 'csv' | 'json') =>
    `/api/export?${queryParams(query, false).toString()}&format=${format}`,
  streamUrl: (query: DashboardQuery) => `/api/stream?${queryParams(query, false).toString()}`,
};
