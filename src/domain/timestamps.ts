// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { NOT_SUPPLIED } from './constants';
import type { TimeRangeFilter } from './types';

/**
 * Parses and validates an ISO 8601 timestamp string.
 * Returns normalized UTC ISO string if valid, otherwise null.
 */
export function parseIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const date = new Date(trimmed);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    return null;
  }
  // Basic ISO regex check to avoid parsing arbitrary non-date strings that Date.parse might accept
  if (!/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(trimmed)) {
    return null;
  }
  return date.toISOString();
}

/** Parses a datetime-local input as a UTC wall-clock value, independent of browser timezone. */
export function parseUtcDateTimeLocal(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return null;

  const [, year, month, day, hour, minute, second = '0', fraction = ''] = match;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    millisecond: Number(fraction.padEnd(3, '0')),
  };
  const date = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond
  ));
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() + 1 !== parts.month ||
    date.getUTCDate() !== parts.day ||
    date.getUTCHours() !== parts.hour ||
    date.getUTCMinutes() !== parts.minute ||
    date.getUTCSeconds() !== parts.second ||
    date.getUTCMilliseconds() !== parts.millisecond
  ) return null;
  return date.getTime();
}

/** Parses a UTC ISO bound or a zone-less datetime-local value whose contract is UTC. */
export function parseCustomTimeBound(value: string): number | null {
  const localUtc = parseUtcDateTimeLocal(value);
  if (localUtc !== null) return localUtc;
  const iso = parseIsoTimestamp(value);
  return iso === null ? null : new Date(iso).getTime();
}

/** Formats a UTC instant for a datetime-local field whose displayed values are explicitly UTC. */
export function utcTimestampToDateTimeLocal(value: string): string {
  const timestamp = parseCustomTimeBound(value);
  return timestamp === null ? '' : new Date(timestamp).toISOString().slice(0, -1);
}

/** Builds an inclusive custom UTC range for a chart bucket. Intermediate bucket ends are exclusive. */
export function timeBucketToUtcRange(
  start: string,
  end: string,
  isLastBucket: boolean
): TimeRangeFilter {
  const endTime = new Date(end).getTime();
  const inclusiveEnd = isLastBucket ? endTime : endTime - 1;
  return {
    preset: 'custom',
    customStart: start,
    customEnd: new Date(inclusiveEnd).toISOString(),
  };
}

/**
 * Formats an ISO UTC timestamp for human display, showing local time and timezone.
 */
export function formatDisplayTimestamp(isoString: string | null): string {
  if (!isoString) {
    return NOT_SUPPLIED;
  }
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return NOT_SUPPLIED;
    }
    // Formats as YYYY-MM-DD HH:mm:ss TZ
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return NOT_SUPPLIED;
  }
}

/**
 * Formats an ISO UTC timestamp for compact table display.
 */
export function formatCompactTimestamp(isoString: string | null): string {
  if (!isoString) {
    return NOT_SUPPLIED;
  }
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return NOT_SUPPLIED;
    }
    return new Intl.DateTimeFormat(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return NOT_SUPPLIED;
  }
}

/**
 * Returns whether an event's timestamp falls within the specified time range.
 * Bounded ranges strictly exclude records with invalid or missing timestamps.
 */
export function isWithinTimeRange(
  eventTimestamp: string | null,
  timestampValid: boolean,
  timeRange: TimeRangeFilter,
  scenarioClock: string | null
): boolean {
  if (timeRange.preset === 'all') {
    return true;
  }

  // Bounded ranges require valid last-observed timestamp
  if (!timestampValid || !eventTimestamp) {
    return false;
  }

  const eventTime = new Date(eventTimestamp).getTime();
  if (Number.isNaN(eventTime)) {
    return false;
  }

  if (timeRange.preset === 'custom') {
    const parsedStart = timeRange.customStart ? parseCustomTimeBound(timeRange.customStart) : null;
    const parsedEnd = timeRange.customEnd ? parseCustomTimeBound(timeRange.customEnd) : null;
    const startTime = timeRange.customStart ? parsedStart : -Infinity;
    const endTime = timeRange.customEnd ? parsedEnd : Infinity;

    if (startTime === null || endTime === null) {
      return false;
    }

    return eventTime >= startTime && eventTime <= endTime;
  }

  // Relative presets anchored to scenarioClock
  const anchorTime = scenarioClock ? new Date(scenarioClock).getTime() : eventTime;
  if (Number.isNaN(anchorTime)) {
    return false;
  }

  let durationMs = 0;
  switch (timeRange.preset) {
    case '15m':
      durationMs = 15 * 60 * 1000;
      break;
    case '1h':
      durationMs = 60 * 60 * 1000;
      break;
    case '6h':
      durationMs = 6 * 60 * 60 * 1000;
      break;
    case '24h':
      durationMs = 24 * 60 * 60 * 1000;
      break;
    default:
      return true;
  }

  const windowStart = anchorTime - durationMs;
  return eventTime >= windowStart && eventTime <= anchorTime;
}
