// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect } from 'vitest';
import { sortEvents } from '../../src/sort';
import type { NormalisedEvent, SortField } from '../../src/types';

function mockEvent(id: string, overrides: Partial<NormalisedEvent> = {}): NormalisedEvent {
  return {
    id,
    clusterId: 'kind-dev',
    clusterName: 'kind-dev',
    source: 'local',
    apiVersion: 'events.k8s.io/v1',
    uid: id,
    namespace: 'default',
    type: 'Normal',
    reason: 'Scheduled',
    message: 'Test message',
    action: null,
    object: { apiVersion: 'v1', kind: 'Pod', name: 'pod-1', namespace: 'default', uid: '1' },
    reporter: 'kubelet',
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

describe('sortEvents', () => {
  it('sorts by lastObservedAt descending (newest first)', () => {
    const e1 = mockEvent('e1', { lastObservedAt: '2026-11-14T10:00:00.000Z' });
    const e2 = mockEvent('e2', { lastObservedAt: '2026-11-14T12:00:00.000Z' });
    const e3 = mockEvent('e3', { lastObservedAt: '2026-11-14T11:00:00.000Z' });

    const sorted = sortEvents([e1, e2, e3], { field: 'lastObservedAt', direction: 'desc' });
    expect(sorted.map((e) => e.id)).toEqual(['e2', 'e3', 'e1']);
  });

  it('sorts by lastObservedAt ascending (oldest first)', () => {
    const e1 = mockEvent('e1', { lastObservedAt: '2026-11-14T10:00:00.000Z' });
    const e2 = mockEvent('e2', { lastObservedAt: '2026-11-14T12:00:00.000Z' });
    const e3 = mockEvent('e3', { lastObservedAt: '2026-11-14T11:00:00.000Z' });

    const sorted = sortEvents([e1, e2, e3], { field: 'lastObservedAt', direction: 'asc' });
    expect(sorted.map((e) => e.id)).toEqual(['e1', 'e3', 'e2']);
  });

  it('places missing values last in BOTH ascending and descending order', () => {
    const eValid1 = mockEvent('e1', { occurrenceCount: 10 });
    const eValid2 = mockEvent('e2', { occurrenceCount: 20 });
    const eMissing1 = mockEvent('eMissing1', { occurrenceCount: null });
    const eMissing2 = mockEvent('eMissing2', { occurrenceCount: null });

    const sortedAsc = sortEvents([eMissing1, eValid2, eMissing2, eValid1], { field: 'occurrenceCount', direction: 'asc' });
    expect(sortedAsc.map((e) => e.id)).toEqual(['e1', 'e2', 'eMissing1', 'eMissing2']);

    const sortedDesc = sortEvents([eMissing1, eValid1, eMissing2, eValid2], { field: 'occurrenceCount', direction: 'desc' });
    expect(sortedDesc.map((e) => e.id)).toEqual(['e2', 'e1', 'eMissing1', 'eMissing2']);
  });

  it('sorts all supported fields in asc and desc', () => {
    const fields: SortField[] = [
      'firstObservedAt',
      'lastObservedAt',
      'namespace',
      'type',
      'reason',
      'objectName',
      'occurrenceCount',
    ];

    const e1 = mockEvent('e1', {
      firstObservedAt: '2026-11-14T10:00:00Z',
      lastObservedAt: '2026-11-14T10:00:00Z',
      namespace: 'alpha',
      type: 'Normal',
      reason: 'BackOff',
      object: { apiVersion: 'v1', kind: 'Pod', name: 'app-a', namespace: 'alpha', uid: '1' },
      occurrenceCount: 2,
    });

    const e2 = mockEvent('e2', {
      firstObservedAt: '2026-11-14T11:00:00Z',
      lastObservedAt: '2026-11-14T11:00:00Z',
      namespace: 'beta',
      type: 'Warning',
      reason: 'Created',
      object: { apiVersion: 'v1', kind: 'Pod', name: 'app-b', namespace: 'beta', uid: '2' },
      occurrenceCount: 10,
    });

    for (const field of fields) {
      const asc = sortEvents([e2, e1], { field, direction: 'asc' });
      expect(asc[0]?.id).toBe('e1');

      const desc = sortEvents([e1, e2], { field, direction: 'desc' });
      expect(desc[0]?.id).toBe('e2');
    }
  });

  it('keeps ties stable using original store order', () => {
    const e1 = mockEvent('e1', { reason: 'BackOff' });
    const e2 = mockEvent('e2', { reason: 'BackOff' });
    const e3 = mockEvent('e3', { reason: 'BackOff' });

    const sorted = sortEvents([e1, e2, e3], { field: 'reason', direction: 'asc' });
    expect(sorted.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('handles unsupported sort field gracefully via default branch', () => {
    const e1 = mockEvent('e1');
    const e2 = mockEvent('e2');
    const sorted = sortEvents([e1, e2], { field: 'invalidField' as unknown as SortField, direction: 'asc' });
    expect(sorted.length).toBe(2);
  });
});
