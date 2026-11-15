// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

export type EventApiVersion = 'events.k8s.io/v1' | 'v1';

export type TimestampSource =
  | 'eventTime'
  | 'firstTimestamp'
  | 'series'
  | 'lastTimestamp'
  | 'creationTimestamp'
  | 'none';

/** How this server obtained the cluster connection. */
export type EventSource = 'local' | 'in-cluster';

export type NormalisedObjectRef = {
  apiVersion: string | null;
  kind: string | null;
  name: string | null;
  namespace: string | null;
  uid: string | null;
};

export type OccurrenceCountStatus = 'valid' | 'missing' | 'invalid';

export type NormalisedEvent = {
  id: string; // `${clusterId}/${uid}` or a deterministic cluster-scoped fallback.
  clusterId: string; // Kubeconfig context name, or `in-cluster`.
  clusterName: string;
  source: EventSource;
  apiVersion: EventApiVersion;
  uid: string | null;
  namespace: string | null;
  type: 'Normal' | 'Warning' | null;
  reason: string | null;
  message: string | null;
  action: string | null;
  object: NormalisedObjectRef;
  reporter: string | null;
  firstObservedAt: string | null; // ISO 8601 UTC if valid; otherwise null.
  lastObservedAt: string | null;  // ISO 8601 UTC if valid; otherwise null.
  occurrenceCount: number | null;
  occurrenceCountStatus: OccurrenceCountStatus;
  createdAt: string | null;
  timestampSource: {
    first: TimestampSource;
    last: TimestampSource;
  };
  timestampValid: boolean; // True only when effective lastObservedAt is valid.
  validationIssues: string[]; // Structural/source-field problems; rawEvent remains untouched.
  rawEvent: unknown;       // Untouched source record; never mutate it.
};

export type TimeRangePreset = 'all' | '15m' | '1h' | '6h' | '24h' | 'custom';

export type TimeRangeFilter = {
  preset: TimeRangePreset;
  customStart?: string | null;
  customEnd?: string | null;
};

export type EventFilters = {
  namespaces: string[];
  types: ('Normal' | 'Warning')[];
  reasons: string[];
  resourceKind: string | null;
  resourceName: string;
  reporter: string | null;
  searchKeyword: string;
  timeRange: TimeRangeFilter;
};

export type SortField =
  | 'firstObservedAt'
  | 'lastObservedAt'
  | 'namespace'
  | 'type'
  | 'reason'
  | 'objectName'
  | 'occurrenceCount';

export type SortDirection = 'asc' | 'desc';

export type SortConfig = {
  field: SortField;
  direction: SortDirection;
};

export type PaginationState = {
  page: number;
  pageSize: number;
};

export type PaginatedResult<T> = {
  items: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
};

/**
 * Reserved for keyset pagination when offset pagination does not meet the
 * latency target at the configured per-cluster record cap. Offset pagination
 * remains the default.
 */
export type PageCursor = {
  sortValue: string | number | null;
  id: string;
};

export type TimeBucket = {
  start: string;
  end: string;
  label: string;
  count: number;
  normalCount: number;
  warningCount: number;
  occurrenceCount: number;
  normalOccurrenceCount: number;
  warningOccurrenceCount: number;
};

export type OverviewMetrics = {
  totalEvents: number;
  warningCount: number;
  normalCount: number;
  namespaceCount: number;
  recentWarnings: NormalisedEvent[];
  commonReasons: { reason: string; count: number }[];
  volumeBuckets: TimeBucket[];
  invalidTimestampCount: number;
};

export type AnalyticsData = {
  totalEvents: number;
  totalOccurrences: number;
  recordsWithKnownOccurrenceCount: number;
  volumeBuckets: TimeBucket[];
  typeBreakdown: { name: 'Normal' | 'Warning' | 'Other'; count: number; occurrenceCount: number }[];
  reasonBreakdown: { reason: string; count: number; occurrenceCount: number }[];
  namespaceBreakdown: { namespace: string; count: number; occurrenceCount: number }[];
  invalidTimestampCount: number;
};
