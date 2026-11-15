// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import type { NormalisedEvent } from '@k8s-events/domain';

export const EVICTION_BATCH_FRACTION = 0.01;

export type StoreListener = (records: NormalisedEvent[]) => void;

export type UpsertResult = {
  /** True when the record was not already present. */
  inserted: boolean;
  /** Number of records removed to stay within the cap. */
  evicted: number;
};

/**
 * Bounded in-memory view of the Events one cluster has reported.
 *
 * The store keeps the immutable normalized snapshot for each logical Event and
 * replaces it in place when a watch reports a newer series count or timestamp.
 * Writes never mutate a snapshot: callers receive the array they supplied.
 */
export class ClusterStore {
  private readonly records = new Map<string, NormalisedEvent>();
  private readonly listeners = new Set<StoreListener>();
  private evicted = 0;
  private lastEventAt: string | null = null;
  private lastChangeAt: number;

  constructor(
    readonly clusterId: string,
    readonly cap: number
  ) {
    if (!Number.isInteger(cap) || cap < 1) {
      throw new Error('Cluster store cap must be a positive integer.');
    }
    this.lastChangeAt = Date.now();
  }

  get size(): number {
    return this.records.size;
  }

  get evictedCount(): number {
    return this.evicted;
  }

  /** Latest valid last-observed time among stored records, if any. */
  get latestObservedAt(): string | null {
    return this.lastEventAt;
  }

  get lastChangedAt(): number {
    return this.lastChangeAt;
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  get(id: string): NormalisedEvent | undefined {
    return this.records.get(id);
  }

  /** Removes a record; returns true when it was present. Used for watch DELETED messages. */
  delete(id: string): boolean {
    const existed = this.records.delete(id);
    if (existed) this.lastChangeAt = Date.now();
    return existed;
  }

  upsert(record: NormalisedEvent): UpsertResult {
    const inserted = !this.records.has(record.id);
    this.records.set(record.id, record);
    if (record.lastObservedAt) {
      if (!this.lastEventAt || record.lastObservedAt > this.lastEventAt) {
        this.lastEventAt = record.lastObservedAt;
      }
    }
    this.lastChangeAt = Date.now();

    let evicted = 0;
    if (this.records.size > this.cap) {
      evicted = this.evictOldest();
    }
    return { inserted, evicted };
  }

  /**
   * Removes records with the oldest last-observed time first. A record without
   * a usable timestamp is evicted before any timestamped record, because it
   * cannot be placed in the retention window.
   */
  private evictOldest(): number {
    const batch = Math.max(1, Math.ceil(this.cap * EVICTION_BATCH_FRACTION));
    const ordered = [...this.records.values()].sort(compareByLastObserved);
    let removed = 0;
    for (const record of ordered) {
      if (this.records.size <= this.cap - batch + 1 || removed >= batch) break;
      this.records.delete(record.id);
      removed++;
    }
    // Guarantee the cap even if the batch estimate was too small.
    let index = 0;
    while (this.records.size > this.cap && index < ordered.length) {
      const record = ordered[index];
      index++;
      if (record && this.records.delete(record.id)) removed++;
    }
    this.evicted += removed;
    return removed;
  }

  /** Detached copy in insertion order; safe to iterate while watches append. */
  snapshot(): NormalisedEvent[] {
    return [...this.records.values()];
  }

  clear(): void {
    this.records.clear();
    this.lastEventAt = null;
    this.lastChangeAt = Date.now();
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Notifies listeners with the records that changed. */
  publish(records: NormalisedEvent[]): void {
    if (records.length === 0) return;
    for (const listener of this.listeners) {
      try {
        listener(records);
      } catch {
        // A failing subscriber must not stop ingestion or other subscribers.
      }
    }
  }
}

function compareByLastObserved(a: NormalisedEvent, b: NormalisedEvent): number {
  if (a.lastObservedAt === b.lastObservedAt) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (a.lastObservedAt === null) return -1;
  if (b.lastObservedAt === null) return 1;
  return a.lastObservedAt < b.lastObservedAt ? -1 : 1;
}
