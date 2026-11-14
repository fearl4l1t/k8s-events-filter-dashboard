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

/**
 * Exports normalized events to a CSV string containing all filtered records.
 */
export function exportEventsToCsv(events: NormalisedEvent[]): string {
  const headers = [
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
  ];

  const rows = events.map((e) => [
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
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
}

/**
 * Exports events to a JSON string preserving the original untouched rawEvent records.
 */
export function exportEventsToJson(events: NormalisedEvent[]): string {
  const rawList = events.map((e) => e.rawEvent);
  return JSON.stringify(rawList, null, 2);
}

/**
 * Downloads a string payload as a client-side file.
 */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: 'text/csv;charset=utf-8;' | 'application/json;charset=utf-8;'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
