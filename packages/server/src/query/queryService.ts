// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import {
  computeAnalyticsData,
  computeOverviewMetrics,
  DEFAULT_SORT,
  filterEvents,
  matchesFilters,
  PAGE_SIZE,
  paginateEvents,
  sortEvents,
} from '@k8s-events/domain';
import type {
  AnalyticsData,
  EventFilters,
  NormalisedEvent,
  OverviewMetrics,
  PaginatedResult,
  SortConfig,
  TimeBucket,
} from '@k8s-events/domain';
import type { ClusterInfo, ClusterRuntime } from '../clusters/types';

export const MAX_PAGE_SIZE = 200;

export class QueryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = 'QueryError';
  }
}

export type EventQuery = {
  clusterIds: string[];
  filters: EventFilters;
  sort: SortConfig;
  page: number;
  pageSize: number;
};

export type EventQueryResult = {
  items: NormalisedEvent[];
  totalItems: number;
  totalPages: number;
  page: number;
  pageSize: number;
  /** Records matching every filter except a bounded time range, excluded because their last-observed time is unusable. */
  invalidTimestampExcluded: number;
  serverTime: string;
  partial: boolean;
  clusters: ClusterInfo[];
};

export type SummaryResult = {
  metrics: OverviewMetrics;
  analytics: AnalyticsData;
  recentWarnings: NormalisedEvent[];
  volumeBuckets: TimeBucket[];
  invalidTimestampExcluded: number;
  serverTime: string;
  partial: boolean;
  clusters: ClusterInfo[];
};

export type FilterOptions = {
  namespaces: string[];
  reasons: string[];
  resourceKinds: string[];
  reporters: string[];
};

export type QueryContext = {
  clusters: ClusterRuntime[];
  serverTime: string;
};

export function isPartial(clusters: ClusterInfo[]): boolean {
  return clusters.some((cluster) => cluster.status !== 'live');
}

export function resolvePage(page: number, pageSize: number): { page: number; pageSize: number } {
  if (!Number.isInteger(page) || page < 1) {
    throw new QueryError('invalid_page', 'Page must be an integer of at least 1.');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new QueryError('invalid_page_size', 'Page size must be an integer of at least 1.');
  }
  if (pageSize > MAX_PAGE_SIZE) {
    throw new QueryError(
      'page_size_too_large',
      `Page size may not exceed ${MAX_PAGE_SIZE} records.`
    );
  }
  return { page, pageSize: pageSize || PAGE_SIZE };
}

function selectClusters(context: QueryContext, clusterIds: string[]): ClusterRuntime[] {
  if (clusterIds.length === 0) return context.clusters;
  const wanted = new Set(clusterIds);
  return context.clusters.filter((cluster) => wanted.has(cluster.info.id));
}

/** Records matching every filter except the bounded time range. */
function countInvalidTimestampExclusions(
  events: NormalisedEvent[],
  filters: EventFilters,
  anchorTime: string
): number {
  if (filters.timeRange.preset === 'all') return 0;
  const withoutTime: EventFilters = {
    ...filters,
    timeRange: { preset: 'all', customStart: null, customEnd: null },
  };
  let excluded = 0;
  for (const event of events) {
    if (event.timestampValid) continue;
    if (matchesFilters(event, withoutTime, anchorTime)) excluded++;
  }
  return excluded;
}

/**
 * Single query path for table rows, counts, summaries and exports. Every screen
 * and export is a view of the result computed here.
 */
export class QueryService {
  constructor(private readonly context: () => QueryContext) {}

  private collect(clusterIds: string[]): {
    events: NormalisedEvent[];
    clusters: ClusterRuntime[];
    serverTime: string;
  } {
    const context = this.context();
    const clusters = selectClusters(context, clusterIds);
    const events: NormalisedEvent[] = [];
    for (const cluster of clusters) {
      for (const record of cluster.store.snapshot()) {
        events.push(record);
      }
    }
    return { events, clusters, serverTime: context.serverTime };
  }

  private filtered(query: EventQuery): {
    events: NormalisedEvent[];
    clusters: ClusterRuntime[];
    serverTime: string;
    invalidTimestampExcluded: number;
    sorted: NormalisedEvent[];
  } {
    const { events, clusters, serverTime } = this.collect(query.clusterIds);
    const filtered = filterEvents(events, query.filters, serverTime);
    const invalidTimestampExcluded = countInvalidTimestampExclusions(
      events,
      query.filters,
      serverTime
    );
    return {
      events: filtered,
      clusters,
      serverTime,
      invalidTimestampExcluded,
      sorted: sortEvents(filtered, query.sort),
    };
  }

  queryEvents(query: EventQuery): EventQueryResult {
    const { page, pageSize } = resolvePage(query.page, query.pageSize);
    const { sorted, clusters, serverTime, invalidTimestampExcluded } =
      this.filtered({ ...query, sort: query.sort ?? DEFAULT_SORT });
    const paginated: PaginatedResult<NormalisedEvent> = paginateEvents(sorted, page, pageSize);
    const infos = clusters.map((cluster) => cluster.info);
    return {
      items: paginated.items,
      totalItems: paginated.totalItems,
      totalPages: paginated.totalPages,
      page: paginated.currentPage,
      pageSize: paginated.pageSize,
      invalidTimestampExcluded,
      serverTime,
      partial: isPartial(infos),
      clusters: infos,
    };
  }

  summary(query: EventQuery): SummaryResult {
    const { events, clusters, serverTime, invalidTimestampExcluded } = this.filtered(query);
    const metrics = computeOverviewMetrics(events);
    const analytics = computeAnalyticsData(events);
    const infos = clusters.map((cluster) => cluster.info);
    return {
      metrics,
      analytics,
      recentWarnings: metrics.recentWarnings,
      volumeBuckets: metrics.volumeBuckets,
      invalidTimestampExcluded,
      serverTime,
      partial: isPartial(infos),
      clusters: infos,
    };
  }

  /** Filter control values across the selected clusters, independent of active filters. */
  options(clusterIds: string[]): FilterOptions {
    const { events } = this.collect(clusterIds);
    const namespaces = new Set<string>();
    const reasons = new Set<string>();
    const resourceKinds = new Set<string>();
    const reporters = new Set<string>();
    for (const event of events) {
      if (event.namespace) namespaces.add(event.namespace);
      if (event.reason) reasons.add(event.reason);
      if (event.object.kind) resourceKinds.add(event.object.kind);
      if (event.reporter) reporters.add(event.reporter);
    }
    const order = (values: Set<string>) => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return {
      namespaces: order(namespaces),
      reasons: order(reasons),
      resourceKinds: order(resourceKinds),
      reporters: order(reporters),
    };
  }

  /** All records matching the query, ignoring pagination, for export. */
  exportRecords(query: EventQuery): NormalisedEvent[] {
    return this.filtered(query).sorted;
  }

  /** A single record by its logical ID. */
  find(id: string): NormalisedEvent | undefined {
    const slash = id.indexOf('/');
    if (slash <= 0) return undefined;
    const clusterId = id.slice(0, slash);
    const cluster = this.context().clusters.find((item) => item.info.id === clusterId);
    return cluster?.store.get(id);
  }

  exportCount(clusterIds: string[]): number {
    return this.collect(clusterIds).events.length;
  }
}
