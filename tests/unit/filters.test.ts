// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect } from 'vitest';
import { matchesFilters, filterEvents, extractFilterOptions } from '../../src/domain/filters';
import { DEFAULT_FILTERS } from '../../src/domain/constants';
import type { NormalisedEvent } from '../../src/domain/types';

function createMockEvent(overrides: Partial<NormalisedEvent> = {}): NormalisedEvent {
  return {
    id: 'test-event-1',
    apiVersion: 'events.k8s.io/v1',
    uid: 'uid-1',
    namespace: 'payments',
    type: 'Warning',
    reason: 'BackOff',
    message: 'Back-off pulling image auth:v1',
    action: 'Pulling',
    object: {
      apiVersion: 'v1',
      kind: 'Pod',
      name: 'auth-validator-123',
      namespace: 'payments',
      uid: 'pod-1',
    },
    reporter: 'k8s.io/kubelet',
    firstObservedAt: '2026-11-14T10:00:00.000Z',
    lastObservedAt: '2026-11-14T10:05:00.000Z',
    occurrenceCount: 3,
    occurrenceCountStatus: 'valid',
    createdAt: '2026-11-14T10:00:00.000Z',
    timestampSource: {
      first: 'eventTime',
      last: 'series',
    },
    timestampValid: true,
    validationIssues: [],
    rawEvent: {},
    ...overrides,
  };
}

describe('filters', () => {
  const clock = '2026-11-14T11:00:00.000Z';

  it('matches default filters', () => {
    const event = createMockEvent();
    expect(matchesFilters(event, DEFAULT_FILTERS, clock)).toBe(true);
  });

  it('matches namespace exact match and supports OR within namespaces', () => {
    const event = createMockEvent({ namespace: 'payments' });

    expect(matchesFilters(event, { ...DEFAULT_FILTERS, namespaces: ['payments'] }, clock)).toBe(true);
    expect(matchesFilters(event, { ...DEFAULT_FILTERS, namespaces: ['default', 'payments'] }, clock)).toBe(true);
    expect(matchesFilters(event, { ...DEFAULT_FILTERS, namespaces: ['default'] }, clock)).toBe(false);
  });

  it('matches type filter, selecting both Normal and Warning is no restriction', () => {
    const warnEvent = createMockEvent({ type: 'Warning' });
    const normEvent = createMockEvent({ type: 'Normal' });

    expect(matchesFilters(warnEvent, { ...DEFAULT_FILTERS, types: ['Warning'] }, clock)).toBe(true);
    expect(matchesFilters(warnEvent, { ...DEFAULT_FILTERS, types: ['Normal'] }, clock)).toBe(false);

    expect(matchesFilters(normEvent, { ...DEFAULT_FILTERS, types: ['Normal'] }, clock)).toBe(true);
    expect(matchesFilters(normEvent, { ...DEFAULT_FILTERS, types: ['Warning'] }, clock)).toBe(false);

    // Both selected
    expect(matchesFilters(warnEvent, { ...DEFAULT_FILTERS, types: ['Normal', 'Warning'] }, clock)).toBe(true);
    expect(matchesFilters(normEvent, { ...DEFAULT_FILTERS, types: ['Normal', 'Warning'] }, clock)).toBe(true);
  });

  it('matches reason with OR across multiple reasons', () => {
    const event = createMockEvent({ reason: 'BackOff' });

    expect(matchesFilters(event, { ...DEFAULT_FILTERS, reasons: ['BackOff', 'Failed'] }, clock)).toBe(true);
    expect(matchesFilters(event, { ...DEFAULT_FILTERS, reasons: ['Scheduled', 'Created'] }, clock)).toBe(false);
  });

  it('matches resource kind exact match and resource name substring case-insensitively', () => {
    const event = createMockEvent({
      object: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'auth-validator-xyz',
        namespace: 'payments',
        uid: 'uid-1',
      },
    });

    expect(matchesFilters(event, { ...DEFAULT_FILTERS, resourceKind: 'Pod' }, clock)).toBe(true);
    expect(matchesFilters(event, { ...DEFAULT_FILTERS, resourceKind: 'Deployment' }, clock)).toBe(false);

    expect(matchesFilters(event, { ...DEFAULT_FILTERS, resourceName: 'AUTH-VAL' }, clock)).toBe(true);
    expect(matchesFilters(event, { ...DEFAULT_FILTERS, resourceName: 'nonexistent' }, clock)).toBe(false);
  });

  it('matches reporter exact match', () => {
    const event = createMockEvent({ reporter: 'k8s.io/kubelet' });

    expect(matchesFilters(event, { ...DEFAULT_FILTERS, reporter: 'k8s.io/kubelet' }, clock)).toBe(true);
    expect(matchesFilters(event, { ...DEFAULT_FILTERS, reporter: 'k8s.io/kube-scheduler' }, clock)).toBe(false);
  });

  it('searches keyword case-insensitively across reason, message, object name, namespace, reporter', () => {
    const event = createMockEvent({
      reason: 'SpecialReason',
      message: 'Unique error message keyword inside',
      object: { apiVersion: 'v1', kind: 'Pod', name: 'my-service-pod', namespace: 'payments', uid: '1' },
      reporter: 'custom-reporter',
      namespace: 'custom-ns',
    });

    expect(matchesFilters(event, { ...DEFAULT_FILTERS, searchKeyword: 'specialreason' }, clock)).toBe(true);
    expect(matchesFilters(event, { ...DEFAULT_FILTERS, searchKeyword: 'UNIQUE ERROR' }, clock)).toBe(true);
    expect(matchesFilters(event, { ...DEFAULT_FILTERS, searchKeyword: 'SERVICE-POD' }, clock)).toBe(true);
    expect(matchesFilters(event, { ...DEFAULT_FILTERS, searchKeyword: 'custom-reporter' }, clock)).toBe(true);
    expect(matchesFilters(event, { ...DEFAULT_FILTERS, searchKeyword: 'custom-ns' }, clock)).toBe(true);
    expect(matchesFilters(event, { ...DEFAULT_FILTERS, searchKeyword: 'completely-missing' }, clock)).toBe(false);
  });

  it('combines multiple filter categories with AND', () => {
    const matching = createMockEvent({
      namespace: 'payments',
      type: 'Warning',
      reason: 'BackOff',
    });
    const wrongNs = createMockEvent({
      namespace: 'default',
      type: 'Warning',
      reason: 'BackOff',
    });
    const wrongType = createMockEvent({
      namespace: 'payments',
      type: 'Normal',
      reason: 'BackOff',
    });

    const combinedFilter = {
      ...DEFAULT_FILTERS,
      namespaces: ['payments'],
      types: ['Warning'] as ('Normal' | 'Warning')[],
      reasons: ['BackOff'],
    };

    expect(matchesFilters(matching, combinedFilter, clock)).toBe(true);
    expect(matchesFilters(wrongNs, combinedFilter, clock)).toBe(false);
    expect(matchesFilters(wrongType, combinedFilter, clock)).toBe(false);
  });

  it('extractFilterOptions extracts sorted distinct options', () => {
    const events = [
      createMockEvent({ namespace: 'payments', reason: 'BackOff', reporter: 'k8s.io/kubelet' }),
      createMockEvent({ namespace: 'default', reason: 'Scheduled', reporter: 'k8s.io/kube-scheduler' }),
      createMockEvent({ namespace: 'payments', reason: 'Scheduled', reporter: 'k8s.io/kubelet' }),
    ];

    const opts = extractFilterOptions(events);
    expect(opts.namespaces).toEqual(['default', 'payments']);
    expect(opts.reasons).toEqual(['BackOff', 'Scheduled']);
    expect(opts.resourceKinds).toEqual(['Pod']);
    expect(opts.reporters).toEqual(['k8s.io/kube-scheduler', 'k8s.io/kubelet']);
  });

  it('filterEvents filters a list of events', () => {
    const e1 = createMockEvent({ namespace: 'payments' });
    const e2 = createMockEvent({ namespace: 'default' });

    const result = filterEvents([e1, e2], { ...DEFAULT_FILTERS, namespaces: ['payments'] }, clock);
    expect(result.length).toBe(1);
    expect(result[0]?.namespace).toBe('payments');
  });
});
