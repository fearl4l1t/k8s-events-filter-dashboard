// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect } from 'vitest';
import { EventStore } from '../../src/store/eventStore';
import { MAX_IN_MEMORY_EVENTS } from '../../src/domain/constants';
import type { ScenarioManifest } from '../../src/domain/types';

describe('EventStore', () => {
  const mockManifest: ScenarioManifest = {
    id: 'normal-rollout',
    name: 'Normal rollout',
    description: 'Test manifest',
    seedEvents: [
      {
        apiVersion: 'events.k8s.io/v1',
        kind: 'Event',
        metadata: { uid: 'seed-1', namespace: 'default' },
        eventTime: '2026-11-14T10:00:00Z',
        reason: 'Scheduled',
      },
      {
        apiVersion: 'events.k8s.io/v1',
        kind: 'Event',
        metadata: { uid: 'seed-2', namespace: 'default' },
        eventTime: '2026-11-14T10:01:00Z',
        reason: 'Pulling',
      },
    ],
    steps: [],
  };

  it('loads scenario seed events and sets scenario clock to latest timestamp', () => {
    const store = new EventStore();
    store.loadScenario(mockManifest);

    expect(store.getEvents().length).toBe(2);
    expect(store.getActiveScenarioId()).toBe('normal-rollout');
    expect(store.getScenarioClock()).toBe('2026-11-14T10:01:00.000Z');
  });

  it('notifies subscribers on store updates', () => {
    const store = new EventStore();
    let called = 0;
    const unsub = store.subscribe(() => {
      called++;
    });

    store.loadScenario(mockManifest);
    expect(called).toBe(1);

    store.appendEvent({
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: { uid: 'arrival-1' },
      eventTime: '2026-11-14T10:02:00Z',
      reason: 'Pulled',
    });
    expect(called).toBe(2);

    unsub();
    store.appendEvent({
      apiVersion: 'events.k8s.io/v1',
      metadata: { uid: 'arrival-2' },
    });
    expect(called).toBe(2);
  });

  it('updates repeated series by replacing the record without creating duplicate row', () => {
    const store = new EventStore();
    store.loadScenario({
      ...mockManifest,
      seedEvents: [
        {
          apiVersion: 'events.k8s.io/v1',
          kind: 'Event',
          metadata: { uid: 'series-uid-100' },
          eventTime: '2026-11-14T10:00:00Z',
          reason: 'BackOff',
          series: { count: 1, lastObservedTime: '2026-11-14T10:00:00Z' },
        },
      ],
    });

    expect(store.getEvents().length).toBe(1);
    expect(store.getEvents()[0]?.occurrenceCount).toBe(1);

    // Repeated series update arrival
    const updated = store.appendEvent(
      {
        apiVersion: 'events.k8s.io/v1',
        kind: 'Event',
        metadata: { uid: 'series-uid-100' },
        eventTime: '2026-11-14T10:00:00Z',
        reason: 'BackOff',
        series: { count: 5, lastObservedTime: '2026-11-14T10:05:00Z' },
      },
      true, // isSeriesUpdate
      1
    );

    expect(updated).toBe(true);
    expect(store.getEvents().length).toBe(1); // STILL ONE ROW!
    expect(store.getEvents()[0]?.id).toBe('series-uid-100');
    expect(store.getEvents()[0]?.occurrenceCount).toBe(5);
    expect(store.getEvents()[0]?.lastObservedAt).toBe('2026-11-14T10:05:00.000Z');
  });

  it('resets scenario restoring initial seeds and removing simulated arrivals', () => {
    const store = new EventStore();
    store.loadScenario(mockManifest);
    expect(store.getEvents().length).toBe(2);

    store.appendEvent({
      apiVersion: 'events.k8s.io/v1',
      metadata: { uid: 'arrival-99' },
    });
    expect(store.getEvents().length).toBe(3);

    store.resetScenario();
    expect(store.getEvents().length).toBe(2);
    expect(store.getEvents().map((e) => e.id)).toEqual(['seed-1', 'seed-2']);
    expect(store.getScenarioClock()).toBe('2026-11-14T10:01:00.000Z');
  });

  it('respects MAX_IN_MEMORY_EVENTS cap and sets limitReached', () => {
    const store = new EventStore();
    // Fill up to max
    const fakeEvents = Array.from({ length: MAX_IN_MEMORY_EVENTS }, (_, i) => ({
      apiVersion: 'events.k8s.io/v1',
      metadata: { uid: `event-${i}` },
    }));

    store.loadScenario({
      id: 'normal-rollout',
      name: 'Max Test',
      description: 'Test',
      seedEvents: fakeEvents,
      steps: [],
    });

    expect(store.getEvents().length).toBe(MAX_IN_MEMORY_EVENTS);
    expect(store.isLimitReached()).toBe(false);

    // Try to append one more
    const success = store.appendEvent({
      apiVersion: 'events.k8s.io/v1',
      metadata: { uid: 'overflow-event' },
    });

    expect(success).toBe(false);
    expect(store.isLimitReached()).toBe(true);
    expect(store.getEvents().length).toBe(MAX_IN_MEMORY_EVENTS);
  });

  it('handles series update when target is not found (appends instead)', () => {
    const store = new EventStore();
    store.loadScenario(mockManifest);

    const success = store.appendEvent(
      {
        apiVersion: 'events.k8s.io/v1',
        metadata: { uid: 'nonexistent-series' },
        eventTime: '2026-11-14T10:05:00Z',
      },
      true // isSeriesUpdate
    );

    expect(success).toBe(true);
    expect(store.getEvents().some((e) => e.id === 'nonexistent-series')).toBe(true);
  });

  it('ignores invalid or earlier timestamps when updating scenario clock', () => {
    const store = new EventStore();
    store.loadScenario(mockManifest);
    const clockBefore = store.getScenarioClock();

    // Earlier timestamp
    store.appendEvent({
      apiVersion: 'events.k8s.io/v1',
      metadata: { uid: 'earlier' },
      eventTime: '2026-11-14T08:00:00Z',
    });
    expect(store.getScenarioClock()).toBe(clockBefore);

    // Invalid timestamp
    store.appendEvent({
      apiVersion: 'events.k8s.io/v1',
      metadata: { uid: 'invalid-time' },
      eventTime: 'invalid',
    });
    expect(store.getScenarioClock()).toBe(clockBefore);
  });
});
