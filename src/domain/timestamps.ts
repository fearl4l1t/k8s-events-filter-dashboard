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
    const startTime = timeRange.customStart ? new Date(timeRange.customStart).getTime() : -Infinity;
    const endTime = timeRange.customEnd ? new Date(timeRange.customEnd).getTime() : Infinity;

    if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
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
