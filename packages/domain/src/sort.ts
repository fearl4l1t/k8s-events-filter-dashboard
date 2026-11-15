// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import type { NormalisedEvent, SortConfig } from './types';

/**
 * Extracts the sortable comparison key for a given event and field.
 */
function getSortKey(
  event: NormalisedEvent,
  field: SortConfig['field']
): string | number | null {
  switch (field) {
    case 'firstObservedAt':
      return event.firstObservedAt ? new Date(event.firstObservedAt).getTime() : null;
    case 'lastObservedAt':
      return event.lastObservedAt ? new Date(event.lastObservedAt).getTime() : null;
    case 'namespace':
      return event.namespace ?? null;
    case 'type':
      return event.type ?? null;
    case 'reason':
      return event.reason ?? null;
    case 'objectName':
      return event.object.name ?? null;
    case 'occurrenceCount':
      return event.occurrenceCount ?? null;
    default:
      return null;
  }
}

/** Locale-independent code-unit comparison so ordering never depends on the viewer. */
function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Sorts events stably. Missing values always sort last in either direction.
 * Ties preserve original store order; stable ID is used as fallback tie-break.
 */
export function sortEvents(
  events: NormalisedEvent[],
  config: SortConfig
): NormalisedEvent[] {
  // Map items with original index for stable tie-breaking
  const indexed = events.map((event, index) => ({ event, index }));

  indexed.sort((a, b) => {
    const keyA = getSortKey(a.event, config.field);
    const keyB = getSortKey(b.event, config.field);

    const aMissing = keyA === null || keyA === undefined;
    const bMissing = keyB === null || keyB === undefined;

    // Rule: Missing values sort last in either direction
    if (aMissing && !bMissing) {
      return 1;
    }
    if (!aMissing && bMissing) {
      return -1;
    }
    if (aMissing && bMissing) {
      // Both missing: maintain original relative store order
      return a.index - b.index;
    }

    let comparison = 0;
    if (typeof keyA === 'number' && typeof keyB === 'number') {
      comparison = keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
    } else {
      comparison = compareCodeUnits(String(keyA), String(keyB));
    }

    if (comparison !== 0) {
      return config.direction === 'asc' ? comparison : -comparison;
    }

    // Stable tie-break by original index, fallback to ID
    if (a.index !== b.index) {
      return a.index - b.index;
    }
    return compareCodeUnits(a.event.id, b.event.id);
  });

  return indexed.map((item) => item.event);
}
