// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { NOT_SUPPLIED } from './constants';
import type { NormalisedEvent } from './types';

/**
 * Sanitizes a cell string to prevent spreadsheet formula injection.
 * Prepends a single quote if the value starts with =, +, -, @, \t, or \r.
 */
export function sanitizeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return NOT_SUPPLIED;
  }
  const str = String(value);

  // Check formula injection triggers
  const firstChar = str.charAt(0);
  let safeStr = str;
  if (['=', '+', '-', '@', '\t', '\r'].includes(firstChar)) {
    safeStr = `'${str}`;
  }

  // Quote if contains commas, newlines, or quotes
  if (safeStr.includes(',') || safeStr.includes('"') || safeStr.includes('\n') || safeStr.includes('\r')) {
    return `"${safeStr.replace(/"/g, '""')}"`;
  }
  return safeStr;
}

/** Column order shared by CSV export and the streaming exporter. */
export const CSV_HEADERS = [
  'Last Observed (UTC)',
  'First Observed (UTC)',
  'Namespace',
  'Type',
  'Reason',
  'Object Kind',
  'Object Name',
  'Count',
  'Message',
  'Reporter',
] as const;

/** One CSV data row for an Event, without a trailing newline. */
export function eventToCsvRow(e: NormalisedEvent): string {
  return [
    sanitizeCsvCell(e.lastObservedAt),
    sanitizeCsvCell(e.firstObservedAt),
    sanitizeCsvCell(e.namespace),
    sanitizeCsvCell(e.type),
    sanitizeCsvCell(e.reason),
    sanitizeCsvCell(e.object.kind),
    sanitizeCsvCell(e.object.name),
    sanitizeCsvCell(e.occurrenceCountStatus === 'valid' ? e.occurrenceCount : NOT_SUPPLIED),
    sanitizeCsvCell(e.message),
    sanitizeCsvCell(e.reporter),
  ].join(',');
}

/**
 * Exports normalized events to a CSV string containing all filtered records.
 * Accepts any iterable so a server can supply a cursor over a store snapshot.
 */
export function exportEventsToCsv(events: Iterable<NormalisedEvent>): string {
  const rows: string[] = [];
  for (const e of events) {
    rows.push(eventToCsvRow(e));
  }
  return [CSV_HEADERS.join(','), ...rows].join('\r\n');
}

/**
 * Exports events to a JSON string preserving the original untouched rawEvent records.
 * Accepts any iterable so a server can supply a cursor over a store snapshot.
 */
export function exportEventsToJson(events: Iterable<NormalisedEvent>): string {
  const rawList: unknown[] = [];
  for (const e of events) {
    rawList.push(e.rawEvent);
  }
  return JSON.stringify(rawList, null, 2);
}
