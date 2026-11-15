// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect, vi } from 'vitest';
import { ClusterStore } from '../../src/store/clusterStore';
import { makeEvent } from './helpers';

describe('ClusterStore', () => {
  it('stores records by logical ID', () => {
    const store = new ClusterStore('ctx-a', 10);
    store.upsert(makeEvent({ uid: 'a' }));
    store.upsert(makeEvent({ uid: 'b' }));
    expect(store.size).toBe(2);
    expect(store.get('ctx-a/a')?.uid).toBe('a');
  });

  it('replaces a repeated series instead of adding a row', () => {
    const store = new ClusterStore('ctx-a', 10);
    store.upsert(makeEvent({ uid: 'a', occurrenceCount: 2, lastObservedAt: '2026-11-14T10:00:00.000Z' }));
    const result = store.upsert(
      makeEvent({ uid: 'a', occurrenceCount: 5, lastObservedAt: '2026-11-14T10:04:00.000Z' })
    );
    expect(result.inserted).toBe(false);
    expect(store.size).toBe(1);
    expect(store.get('ctx-a/a')?.occurrenceCount).toBe(5);
    expect(store.latestObservedAt).toBe('2026-11-14T10:04:00.000Z');
  });

  it('evicts the oldest last-observed records at the cap and counts them', () => {
    const store = new ClusterStore('ctx-a', 10);
    for (let index = 0; index < 20; index++) {
      const minute = String(index).padStart(2, '0');
      store.upsert(
        makeEvent({ uid: `a-${index}`, lastObservedAt: `2026-11-14T10:${minute}:00.000Z` })
      );
    }
    expect(store.size).toBeLessThanOrEqual(10);
    expect(store.evictedCount).toBeGreaterThan(0);
    expect(store.get('ctx-a/a-0')).toBeUndefined();
  });

  it('never exceeds the cap even when the eviction batch is smaller than the overflow', () => {
    const store = new ClusterStore('ctx-a', 3);
    for (let index = 0; index < 50; index++) {
      store.upsert(makeEvent({ uid: `a-${index}` }));
    }
    expect(store.size).toBeLessThanOrEqual(3);
  });

  it('deletes a record and reports whether it existed', () => {
    const store = new ClusterStore('ctx-a', 10);
    store.upsert(makeEvent({ uid: 'a' }));
    expect(store.delete('ctx-a/a')).toBe(true);
    expect(store.delete('ctx-a/a')).toBe(false);
    expect(store.size).toBe(0);
  });

  it('returns a detached snapshot', () => {
    const store = new ClusterStore('ctx-a', 10);
    store.upsert(makeEvent({ uid: 'a' }));
    const snapshot = store.snapshot();
    snapshot.pop();
    expect(store.size).toBe(1);
  });

  it('notifies subscribers and isolates subscriber failures', () => {
    const store = new ClusterStore('ctx-a', 10);
    const good = vi.fn();
    const unsubscribe = store.subscribe(() => {
      throw new Error('subscriber failed');
    });
    store.subscribe(good);
    store.publish([makeEvent({ uid: 'a' })]);
    expect(good).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('rejects an invalid cap', () => {
    expect(() => new ClusterStore('ctx-a', 0)).toThrow();
    expect(() => new ClusterStore('ctx-a', 1.5)).toThrow();
  });
});
