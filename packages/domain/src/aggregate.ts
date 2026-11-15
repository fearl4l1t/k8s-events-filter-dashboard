// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import type {
  NormalisedEvent,
  OverviewMetrics,
  AnalyticsData,
  TimeBucket,
} from './types';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Formats a bucket label in UTC. Buckets shorter than a minute include seconds
 * so labels stay distinct within one result.
 */
function formatBucketLabel(time: number, includeDate: boolean, includeSeconds: boolean): string {
  const date = new Date(time);
  const clock = includeSeconds
    ? `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
    : `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
  return includeDate
    ? `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${clock}`
    : clock;
}

/**
 * Builds consistent time buckets across the valid timestamps in the filtered set.
 * Excludes records where timestampValid is false.
 */
export function buildTimeBuckets(
  events: NormalisedEvent[],
  bucketCount = 10
): { buckets: TimeBucket[]; invalidTimestampCount: number } {
  const validEvents: { event: NormalisedEvent; time: number }[] = [];
  let invalidTimestampCount = 0;

  for (const event of events) {
    if (!event.timestampValid || !event.lastObservedAt) {
      invalidTimestampCount++;
      continue;
    }
    const t = new Date(event.lastObservedAt).getTime();
    if (Number.isNaN(t)) {
      invalidTimestampCount++;
      continue;
    }
    validEvents.push({ event, time: t });
  }

  if (validEvents.length === 0) {
    return { buckets: [], invalidTimestampCount };
  }

  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const item of validEvents) {
    if (item.time < minTime) minTime = item.time;
    if (item.time > maxTime) maxTime = item.time;
  }

  // If all events have identical timestamp, expand by 1 minute
  if (minTime === maxTime) {
    minTime -= 30_000;
    maxTime += 30_000;
  }

  const range = maxTime - minTime;
  const interval = Math.max(1000, Math.ceil(range / bucketCount));
  const includeDate = range >= 24 * 60 * 60 * 1000;
  const includeSeconds = interval < 60_000;
  const usedLabels = new Set<string>();

  const buckets: TimeBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const bucketStart = minTime + i * interval;
    const bucketEnd = i === bucketCount - 1 ? maxTime : bucketStart + interval;

    let label = formatBucketLabel(bucketStart, includeDate, includeSeconds);
    if (usedLabels.has(label)) {
      const base = formatBucketLabel(bucketStart, true, true);
      label = base;
      let suffix = 2;
      while (usedLabels.has(label)) {
        label = `${base} (${suffix})`;
        suffix++;
      }
    }
    usedLabels.add(label);

    buckets.push({
      start: new Date(bucketStart).toISOString(),
      end: new Date(bucketEnd).toISOString(),
      label,
      count: 0,
      normalCount: 0,
      warningCount: 0,
      occurrenceCount: 0,
      normalOccurrenceCount: 0,
      warningOccurrenceCount: 0,
    });
  }

  for (const { event, time } of validEvents) {
    let index = Math.floor((time - minTime) / interval);
    if (index >= bucketCount) {
      index = bucketCount - 1;
    }
    if (index < 0) {
      index = 0;
    }

    const bucket = buckets[index];
    if (bucket) {
      bucket.count++;
      if (event.type === 'Normal') {
        bucket.normalCount++;
      } else if (event.type === 'Warning') {
        bucket.warningCount++;
      }
      // Only source-provided valid counts contribute. A missing count is unknown, not one.
      if (event.occurrenceCountStatus === 'valid' && event.occurrenceCount !== null) {
        bucket.occurrenceCount += event.occurrenceCount;
        if (event.type === 'Normal') bucket.normalOccurrenceCount += event.occurrenceCount;
        if (event.type === 'Warning') bucket.warningOccurrenceCount += event.occurrenceCount;
      }
    }
  }

  return { buckets, invalidTimestampCount };
}

/**
 * Computes overview metrics from the current filtered event dataset.
 */
export function computeOverviewMetrics(events: NormalisedEvent[]): OverviewMetrics {
  let warningCount = 0;
  let normalCount = 0;
  const namespaces = new Set<string>();
  const reasonCounts = new Map<string, number>();
  const warnings: NormalisedEvent[] = [];

  for (const event of events) {
    if (event.type === 'Warning') {
      warningCount++;
      warnings.push(event);
    } else if (event.type === 'Normal') {
      normalCount++;
    }

    if (event.namespace) {
      namespaces.add(event.namespace);
    }

    const reason = event.reason ?? 'Unknown';
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }

  // Sort common reasons by count desc
  const commonReasons = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Recent warnings sorted deterministically, newest lastObservedAt first
  const recentWarnings = warnings
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const timeA = a.event.lastObservedAt ? new Date(a.event.lastObservedAt).getTime() : 0;
      const timeB = b.event.lastObservedAt ? new Date(b.event.lastObservedAt).getTime() : 0;
      if (timeA !== timeB) return timeB - timeA;
      return a.index - b.index;
    })
    .slice(0, 5)
    .map((entry) => entry.event);

  const { buckets: volumeBuckets, invalidTimestampCount } = buildTimeBuckets(events, 8);

  return {
    totalEvents: events.length,
    warningCount,
    normalCount,
    namespaceCount: namespaces.size,
    recentWarnings,
    commonReasons,
    volumeBuckets,
    invalidTimestampCount,
  };
}

/**
 * Computes comprehensive analytics breakdowns from the current filtered event dataset.
 */
export function computeAnalyticsData(events: NormalisedEvent[]): AnalyticsData {
  let totalOccurrences = 0;
  let recordsWithKnownOccurrenceCount = 0;
  let normalEvents = 0;
  let normalOccurrences = 0;
  let warningEvents = 0;
  let warningOccurrences = 0;
  let otherEvents = 0;
  let otherOccurrences = 0;

  const reasonStats = new Map<string, { count: number; occurrenceCount: number }>();
  const namespaceStats = new Map<string, { count: number; occurrenceCount: number }>();

  for (const event of events) {
    const occurrences = event.occurrenceCountStatus === 'valid' && event.occurrenceCount !== null
      ? event.occurrenceCount
      : 0;
    if (event.occurrenceCountStatus === 'valid' && event.occurrenceCount !== null) {
      recordsWithKnownOccurrenceCount++;
    }
    totalOccurrences += occurrences;

    if (event.type === 'Normal') {
      normalEvents++;
      normalOccurrences += occurrences;
    } else if (event.type === 'Warning') {
      warningEvents++;
      warningOccurrences += occurrences;
    } else {
      otherEvents++;
      otherOccurrences += occurrences;
    }

    const reason = event.reason ?? 'Unknown';
    const currentReason = reasonStats.get(reason) ?? { count: 0, occurrenceCount: 0 };
    reasonStats.set(reason, {
      count: currentReason.count + 1,
      occurrenceCount: currentReason.occurrenceCount + occurrences,
    });

    const ns = event.namespace ?? 'cluster-scoped';
    const currentNs = namespaceStats.get(ns) ?? { count: 0, occurrenceCount: 0 };
    namespaceStats.set(ns, {
      count: currentNs.count + 1,
      occurrenceCount: currentNs.occurrenceCount + occurrences,
    });
  }

  const typeBreakdown: { name: 'Normal' | 'Warning' | 'Other'; count: number; occurrenceCount: number }[] = [
    {
      name: 'Normal' as const,
      count: normalEvents,
      occurrenceCount: normalOccurrences,
    },
    {
      name: 'Warning' as const,
      count: warningEvents,
      occurrenceCount: warningOccurrences,
    },
  ];

  if (otherEvents > 0) {
    typeBreakdown.push({
      name: 'Other' as const,
      count: otherEvents,
      occurrenceCount: otherOccurrences,
    });
  }

  const reasonBreakdown = Array.from(reasonStats.entries())
    .map(([reason, stats]) => ({
      reason,
      count: stats.count,
      occurrenceCount: stats.occurrenceCount,
    }))
    .sort((a, b) => b.count - a.count);

  const namespaceBreakdown = Array.from(namespaceStats.entries())
    .map(([namespace, stats]) => ({
      namespace,
      count: stats.count,
      occurrenceCount: stats.occurrenceCount,
    }))
    .sort((a, b) => b.count - a.count);

  const { buckets: volumeBuckets, invalidTimestampCount } = buildTimeBuckets(events, 12);

  return {
    totalEvents: events.length,
    totalOccurrences,
    recordsWithKnownOccurrenceCount,
    volumeBuckets,
    typeBreakdown,
    reasonBreakdown,
    namespaceBreakdown,
    invalidTimestampCount,
  };
}
