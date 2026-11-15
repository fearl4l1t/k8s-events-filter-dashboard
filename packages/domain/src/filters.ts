// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { isWithinTimeRange } from './timestamps';
import type { NormalisedEvent, EventFilters } from './types';

/**
 * Checks whether a single event matches the active filter set.
 * Different filter categories combine with AND; multiple values within a category combine with OR.
 * Relative time ranges are anchored to the server time supplied by the query.
 */
export function matchesFilters(
  event: NormalisedEvent,
  filters: EventFilters,
  anchorTime: string | null
): boolean {
  // 1. Namespace filter (exact match, OR across selected)
  if (filters.namespaces.length > 0) {
    if (!event.namespace || !filters.namespaces.includes(event.namespace)) {
      return false;
    }
  }

  // 2. Type filter (exact match, OR across selected; selecting both = no restriction)
  if (filters.types.length === 1) {
    const requiredType = filters.types[0];
    if (event.type !== requiredType) {
      return false;
    }
  }

  // 3. Reason filter (exact match, OR across selected)
  if (filters.reasons.length > 0) {
    if (!event.reason || !filters.reasons.includes(event.reason)) {
      return false;
    }
  }

  // 4. Resource kind filter (exact match against object.kind)
  if (filters.resourceKind && filters.resourceKind.trim()) {
    if (event.object.kind !== filters.resourceKind.trim()) {
      return false;
    }
  }

  // 5. Resource name filter (case-insensitive substring match against object.name)
  if (filters.resourceName && filters.resourceName.trim()) {
    const term = filters.resourceName.trim().toLowerCase();
    const objectName = (event.object.name ?? '').toLowerCase();
    if (!objectName.includes(term)) {
      return false;
    }
  }

  // 6. Reporter filter (exact match against normalized reporter)
  if (filters.reporter && filters.reporter.trim()) {
    if (event.reporter !== filters.reporter.trim()) {
      return false;
    }
  }

  // 7. Time range filter (effective lastObservedAt)
  if (
    !isWithinTimeRange(
      event.lastObservedAt,
      event.timestampValid,
      filters.timeRange,
      anchorTime
    )
  ) {
    return false;
  }

  // 8. Keyword search (case-insensitive substring search across reason, message, object name, namespace, reporter)
  if (filters.searchKeyword && filters.searchKeyword.trim()) {
    const term = filters.searchKeyword.trim().toLowerCase();
    const fieldsToSearch = [
      event.reason ?? '',
      event.message ?? '',
      event.object.name ?? '',
      event.namespace ?? '',
      event.reporter ?? '',
    ];
    const matchesAny = fieldsToSearch.some((field) =>
      field.toLowerCase().includes(term)
    );
    if (!matchesAny) {
      return false;
    }
  }

  return true;
}

/**
 * Filters a collection of events according to the active query rules.
 */
export function filterEvents(
  events: readonly NormalisedEvent[],
  filters: EventFilters,
  anchorTime: string | null
): NormalisedEvent[] {
  return events.filter((e) => matchesFilters(e, filters, anchorTime));
}

export type AvailableFilterOptions = {
  namespaces: string[];
  reasons: string[];
  resourceKinds: string[];
  reporters: string[];
};

/**
 * Extracts available distinct values for filter controls from an event dataset.
 */
export function extractFilterOptions(events: readonly NormalisedEvent[]): AvailableFilterOptions {
  const namespaces = new Set<string>();
  const reasons = new Set<string>();
  const resourceKinds = new Set<string>();
  const reporters = new Set<string>();

  for (const event of events) {
    if (event.namespace) {
      namespaces.add(event.namespace);
    }
    if (event.reason) {
      reasons.add(event.reason);
    }
    if (event.object.kind) {
      resourceKinds.add(event.object.kind);
    }
    if (event.reporter) {
      reporters.add(event.reporter);
    }
  }

  return {
    namespaces: Array.from(namespaces).sort(),
    reasons: Array.from(reasons).sort(),
    resourceKinds: Array.from(resourceKinds).sort(),
    reporters: Array.from(reporters).sort(),
  };
}
