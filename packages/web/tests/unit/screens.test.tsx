// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NormalisedEvent } from '@k8s-events/domain';
import { DEFAULT_FILTERS, DEFAULT_SORT } from '@k8s-events/domain';
import { OverviewPanel } from '../../src/ui/Overview/OverviewPanel';
import { AnalyticsPanel } from '../../src/ui/Analytics/AnalyticsPanel';
import { ExplorerPanel } from '../../src/ui/Explorer/ExplorerPanel';
import { Header } from '../../src/ui/Header';
import { FilterPanel } from '../../src/ui/Explorer/FilterPanel';
import { downloadFile } from '../../src/api/download';
import type {
  ClusterSummary,
  DashboardQuery,
  EventsResponse,
  SummaryResponse,
} from '../../src/api/client';

const CLUSTER: ClusterSummary = {
  id: 'ctx-a',
  name: 'kind-events',
  source: 'local',
  status: 'live',
  observationStartedAt: '2026-11-14T09:00:00.000Z',
  lastEventAt: '2026-11-14T10:05:00.000Z',
  recordCount: 2,
  evictedCount: 0,
  error: null,
};

const EVENT: NormalisedEvent = {
  id: 'ctx-a/uid-1',
  clusterId: 'ctx-a',
  clusterName: 'kind-events',
  source: 'local',
  apiVersion: 'v1',
  uid: 'uid-1',
  namespace: 'default',
  type: 'Warning',
  reason: 'BackOff',
  message: 'Back-off restarting failed container',
  action: null,
  object: { apiVersion: 'v1', kind: 'Pod', name: 'web-1', namespace: 'default', uid: 'pod-1' },
  reporter: 'kubelet',
  firstObservedAt: '2026-11-14T10:00:00.000Z',
  lastObservedAt: '2026-11-14T10:05:00.000Z',
  occurrenceCount: 3,
  occurrenceCountStatus: 'valid',
  createdAt: null,
  timestampSource: { first: 'eventTimestamp', last: 'lastTimestamp' },
  timestampValid: true,
  validationIssues: [],
  rawEvent: { kind: 'Event' },
};

const BUCKET = {
  start: '2026-11-14T10:00:00.000Z',
  end: '2026-11-14T10:05:00.000Z',
  label: '14 Nov 10:00',
  count: 3,
  normalCount: 1,
  warningCount: 2,
  occurrenceCount: 7,
  normalOccurrenceCount: 2,
  warningOccurrenceCount: 5,
};

const SUMMARY: SummaryResponse = {
  totalEvents: 3,
  warningCount: 2,
  normalCount: 1,
  namespaceCount: 2,
  recentWarnings: [EVENT],
  commonReasons: [{ reason: 'BackOff', count: 2 }],
  volumeBuckets: [BUCKET],
  invalidTimestampCount: 1,
  totalOccurrences: 7,
  recordsWithKnownOccurrenceCount: 2,
  typeBreakdown: [
    { name: 'Warning', count: 2, occurrenceCount: 5 },
    { name: 'Normal', count: 1, occurrenceCount: 2 },
  ],
  reasonBreakdown: [{ reason: 'BackOff', count: 2, occurrenceCount: 5 }],
  namespaceBreakdown: [
    { namespace: 'default', count: 2, occurrenceCount: 5 },
    { namespace: 'payments', count: 1, occurrenceCount: 2 },
  ],
  invalidTimestampExcluded: 1,
  serverTime: '2026-11-14T10:06:00.000Z',
  partial: false,
  clusters: [CLUSTER],
};

const QUERY: DashboardQuery = {
  clusterIds: [],
  filters: DEFAULT_FILTERS,
  sort: DEFAULT_SORT,
  page: 1,
  pageSize: 50,
};

const PAGE: EventsResponse = {
  items: [EVENT],
  totalItems: 1,
  totalPages: 1,
  page: 1,
  pageSize: 50,
  invalidTimestampExcluded: 0,
  serverTime: '2026-11-14T10:06:00.000Z',
  partial: false,
  clusters: [CLUSTER],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OverviewPanel', () => {
  it('renders server summary totals and the accessible chart table', () => {
    const html = renderToStaticMarkup(
      <OverviewPanel summary={SUMMARY} onSelectEvent={() => undefined} onApplyFilter={() => undefined} />
    );
    expect(html).toContain('Total Events');
    expect(html).toContain('Warnings');
    expect(html).toContain('BackOff');
    expect(html).toContain('Filter to this interval and Warning');
    expect(html).toContain('missing or invalid timestamps excluded');
  });

  it('renders empty placeholders before a summary arrives', () => {
    const html = renderToStaticMarkup(
      <OverviewPanel summary={null} onSelectEvent={() => undefined} onApplyFilter={() => undefined} />
    );
    expect(html).toContain('No time-bucketed data available');
    expect(html).toContain('No recent warnings');
  });
});

describe('AnalyticsPanel', () => {
  it('distinguishes Event objects from recorded occurrences', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPanel summary={SUMMARY} onApplyFilter={() => undefined} />
    );
    expect(html).toContain('Event Records (3)');
    expect(html).toContain('Recorded Occurrences (7)');
    expect(html).toContain('Filter Explorer to reason BackOff');
    expect(html).toContain('Filter Explorer to namespace payments');
    expect(html).toContain('Filter Explorer to Warning');
  });
});

describe('ExplorerPanel', () => {
  it('shows the server result count, rows and paging', () => {
    const html = renderToStaticMarkup(
      <ExplorerPanel
        query={QUERY}
        page={PAGE}
        options={{
          namespaces: ['default', 'payments'],
          reasons: ['BackOff'],
          resourceKinds: ['Pod'],
          reporters: ['kubelet'],
        }}
        selectedEventId={null}
        onSelectEvent={() => undefined}
        onFiltersChange={() => undefined}
        onClearAll={() => undefined}
        onSortChange={() => undefined}
        onPageChange={() => undefined}
        refreshing={false}
      />
    );
    expect(html).toContain('Showing 1–1 of 1 Event records');
    expect(html).toContain('Back-off restarting failed container');
    expect(html).toContain('/api/export?');
    expect(html).toContain('Page 1 of 1');
  });

  it('distinguishes no matching rows from an empty observation', () => {
    const noMatch = renderToStaticMarkup(
      <ExplorerPanel
        query={QUERY}
        page={{ ...PAGE, items: [], totalItems: 0, totalPages: 1 }}
        options={null}
        selectedEventId={null}
        onSelectEvent={() => undefined}
        onFiltersChange={() => undefined}
        onClearAll={() => undefined}
        onSortChange={() => undefined}
        onPageChange={() => undefined}
        refreshing
      />
    );
    expect(noMatch).toContain('No matching Events');
    expect(noMatch).toContain('Clear all filters');

    const empty = renderToStaticMarkup(
      <ExplorerPanel
        query={QUERY}
        page={{ ...PAGE, items: [], totalItems: 0, clusters: [{ ...CLUSTER, recordCount: 0 }] }}
        options={null}
        selectedEventId={null}
        onSelectEvent={() => undefined}
        onFiltersChange={() => undefined}
        onClearAll={() => undefined}
        onSortChange={() => undefined}
        onPageChange={() => undefined}
        refreshing={false}
      />
    );
    expect(empty).toContain('No Events observed yet');
  });

  it('reports records excluded by a bounded time range', () => {
    const html = renderToStaticMarkup(
      <ExplorerPanel
        query={QUERY}
        page={{ ...PAGE, invalidTimestampExcluded: 2 }}
        options={null}
        selectedEventId={null}
        onSelectEvent={() => undefined}
        onFiltersChange={() => undefined}
        onClearAll={() => undefined}
        onSortChange={() => undefined}
        onPageChange={() => undefined}
        refreshing={false}
      />
    );
    expect(html).toContain('excluded because the effective last-observed timestamp');
  });
});

describe('FilterPanel', () => {
  it('lists active filters as removable chips', () => {
    const html = renderToStaticMarkup(
      <FilterPanel
        filters={{
          ...DEFAULT_FILTERS,
          searchKeyword: 'backoff',
          namespaces: ['default'],
          types: ['Warning'],
          reasons: ['BackOff'],
          reporter: 'kubelet',
        }}
        onFiltersChange={() => undefined}
        onClearAll={() => undefined}
        availableOptions={{
          namespaces: ['default'],
          reasons: ['BackOff'],
          resourceKinds: ['Pod'],
          reporters: ['kubelet'],
        }}
      />
    );
    expect(html).toContain('Search: backoff');
    expect(html).toContain('NS: default');
    expect(html).toContain('Type: Warning');
    expect(html).toContain('Reason: BackOff');
    expect(html).toContain('Clear filters');
  });
});

describe('Header', () => {
  it('keeps simulator-free navigation and observation provenance together', () => {
    const html = renderToStaticMarkup(
      <Header
        activeTab="analytics"
        onTabChange={() => undefined}
        clusters={[CLUSTER]}
        selectedClusterIds={[]}
        onToggleCluster={() => undefined}
        onSelectAllClusters={() => undefined}
        serverTime="2026-11-14T10:06:00.000Z"
        streamState="open"
        partial={false}
      />
    );
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('kind-events');
    expect(html).toContain('Observed clusters');
    expect(html).not.toMatch(/simulat/i);
  });
});

describe('downloadFile', () => {
  it('creates, clicks and revokes the object URL', () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal('document', {
      createElement: () => ({ click, set href(_value: string) {}, set download(_value: string) {} }),
      body: { appendChild: vi.fn(), removeChild: remove },
    });
    downloadFile('a,b', 'events.csv', 'text/csv;charset=utf-8;');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });
});
