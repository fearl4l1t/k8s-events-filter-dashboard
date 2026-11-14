// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect } from 'vitest';
import {
  buildTimeBuckets,
  computeOverviewMetrics,
  computeAnalyticsData,
} from '../../src/domain/aggregate';
import type { NormalisedEvent } from '../../src/domain/types';

function mockEvent(overrides: Partial<NormalisedEvent> = {}): NormalisedEvent {
  return {
    id: 'e-1',
    apiVersion: 'events.k8s.io/v1',
    uid: 'uid-1',
    namespace: 'payments',
    type: 'Normal',
    reason: 'Scheduled',
    message: 'Pod scheduled',
    action: null,
    object: { apiVersion: 'v1', kind: 'Pod', name: 'pod-1', namespace: 'payments', uid: '1' },
    reporter: 'kube-scheduler',
    firstObservedAt: '2026-11-14T10:00:00.000Z',
    lastObservedAt: '2026-11-14T10:00:00.000Z',
    occurrenceCount: 1,
    occurrenceCountStatus: 'valid',
    createdAt: '2026-11-14T10:00:00.000Z',
    timestampSource: { first: 'eventTime', last: 'eventTime' },
    timestampValid: true,
    validationIssues: [],
    rawEvent: {},
    ...overrides,
  };
}

describe('aggregate', () => {
  it('buildTimeBuckets excludes records with invalid timestamps and tracks count', () => {
    const valid1 = mockEvent({ lastObservedAt: '2026-11-14T10:00:00.000Z', timestampValid: true });
    const valid2 = mockEvent({ lastObservedAt: '2026-11-14T10:30:00.000Z', timestampValid: true, type: 'Warning' });
    const invalid = mockEvent({ lastObservedAt: null, timestampValid: false });

    const { buckets, invalidTimestampCount } = buildTimeBuckets([valid1, valid2, invalid], 5);
    expect(invalidTimestampCount).toBe(1);
    expect(buckets.length).toBe(5);

    const totalInBuckets = buckets.reduce((acc, b) => acc + b.count, 0);
    expect(totalInBuckets).toBe(2);
    expect(buckets.reduce((acc, b) => acc + b.normalOccurrenceCount, 0)).toBe(1);
    expect(buckets.reduce((acc, b) => acc + b.warningOccurrenceCount, 0)).toBe(1);
  });

  it('buildTimeBuckets handles single event where minTime === maxTime', () => {
    const single = mockEvent({ lastObservedAt: '2026-11-14T10:00:00.000Z', timestampValid: true, occurrenceCount: null, occurrenceCountStatus: 'missing' });
    const { buckets } = buildTimeBuckets([single], 5);
    expect(buckets.length).toBe(5);
    const populated = buckets.find((b) => b.count === 1);
    expect(populated).toBeDefined();
    expect(populated?.occurrenceCount).toBe(0); // missing counts are not inferred
    expect(populated?.normalOccurrenceCount).toBe(0);
  });

  it('buildTimeBuckets handles empty dataset', () => {
    const { buckets, invalidTimestampCount } = buildTimeBuckets([]);
    expect(buckets).toEqual([]);
    expect(invalidTimestampCount).toBe(0);
  });

  it('computeOverviewMetrics calculates totals, warnings, normals, namespaces, reasons, and recent warnings', () => {
    const events: NormalisedEvent[] = [
      mockEvent({ id: 'w1', type: 'Warning', reason: 'BackOff', lastObservedAt: '2026-11-14T10:05:00.000Z' }),
      mockEvent({ id: 'w2', type: 'Warning', reason: 'Failed', lastObservedAt: '2026-11-14T10:10:00.000Z' }),
      mockEvent({ id: 'n1', type: 'Normal', reason: 'Scheduled', namespace: 'default' }),
    ];

    const metrics = computeOverviewMetrics(events);
    expect(metrics.totalEvents).toBe(3);
    expect(metrics.warningCount).toBe(2);
    expect(metrics.normalCount).toBe(1);
    expect(metrics.namespaceCount).toBe(2); // 'payments' and 'default'
    expect(metrics.recentWarnings.length).toBe(2);
    expect(metrics.recentWarnings[0]?.id).toBe('w2'); // newest warning first
    expect(metrics.commonReasons[0]?.reason).toBeDefined();
  });

  it('computeAnalyticsData calculates breakdowns by type, reason, and namespace with occurrence counts', () => {
    const events: NormalisedEvent[] = [
      mockEvent({ type: 'Warning', reason: 'BackOff', namespace: 'payments', occurrenceCount: 5 }),
      mockEvent({ type: 'Normal', reason: 'Scheduled', namespace: 'default', occurrenceCount: 1 }),
    ];

    const analytics = computeAnalyticsData(events);
    expect(analytics.totalEvents).toBe(2);
    expect(analytics.totalOccurrences).toBe(6);

    const warnType = analytics.typeBreakdown.find((t) => t.name === 'Warning');
    expect(warnType?.count).toBe(1);
    expect(warnType?.occurrenceCount).toBe(5);

    const backoffReason = analytics.reasonBreakdown.find((r) => r.reason === 'BackOff');
    expect(backoffReason?.count).toBe(1);
    expect(backoffReason?.occurrenceCount).toBe(5);
  });

  it('does not infer occurrences for records with missing source counts', () => {
    const analytics = computeAnalyticsData([
      mockEvent({ occurrenceCount: null, occurrenceCountStatus: 'missing' }),
    ]);
    expect(analytics.totalEvents).toBe(1);
    expect(analytics.totalOccurrences).toBe(0);
    expect(analytics.reasonBreakdown[0]?.occurrenceCount).toBe(0);
  });
});
