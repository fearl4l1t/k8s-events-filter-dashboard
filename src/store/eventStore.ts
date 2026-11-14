// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { MAX_IN_MEMORY_EVENTS } from '../domain/constants';
import { normaliseEvent } from '../domain/normalise';
import type {
  NormalisedEvent,
  ScenarioId,
  ScenarioManifest,
} from '../domain/types';

export type StoreListener = () => void;

export class EventStore {
  private events: NormalisedEvent[] = [];
  private initialEvents: NormalisedEvent[] = [];
  private scenarioClock: string | null = null;
  private initialClock: string | null = null;
  private activeScenarioId: ScenarioId = 'normal-rollout';
  private limitReached = false;
  private listeners = new Set<StoreListener>();

  constructor() {
    // Initialized empty; scenarios load via loadScenario
  }

  public subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public loadScenario(manifest: ScenarioManifest): void {
    this.activeScenarioId = manifest.id;
    this.limitReached = false;

    let latestTime: number | null = null;
    const normalisedSeeds: NormalisedEvent[] = manifest.seedEvents.map((raw, idx) => {
      const norm = normaliseEvent(raw, idx, `${manifest.id}-seed`);
      if (norm.timestampValid && norm.lastObservedAt) {
        const t = new Date(norm.lastObservedAt).getTime();
        if (!Number.isNaN(t)) {
          if (latestTime === null || t > latestTime) {
            latestTime = t;
          }
        }
      }
      return norm;
    });

    this.initialEvents = [...normalisedSeeds];
    this.events = [...normalisedSeeds];
    this.initialClock = latestTime ? new Date(latestTime).toISOString() : null;
    this.scenarioClock = this.initialClock;

    this.notify();
  }

  public appendEvent(
    rawEvent: unknown,
    isSeriesUpdate = false,
    stepIndex = 0
  ): boolean {
    const norm = normaliseEvent(rawEvent, stepIndex, `${this.activeScenarioId}-arrival`);

    if (isSeriesUpdate) {
      const existingIndex = this.events.findIndex(
        (e) => e.id === norm.id || (norm.uid !== null && e.uid === norm.uid)
      );

      if (existingIndex !== -1) {
        const existingEvent = this.events[existingIndex];
        if (!existingEvent) {
          return false;
        }
        // Replace with new immutable snapshot keeping same logical ID
        const targetId = existingEvent.id;
        const updatedRecord: NormalisedEvent = {
          ...norm,
          id: targetId,
        };

        const nextEvents = [...this.events];
        nextEvents[existingIndex] = updatedRecord;
        this.events = nextEvents;

        this.updateScenarioClock(updatedRecord.lastObservedAt);
        this.notify();
        return true;
      }
    }

    if (this.events.length >= MAX_IN_MEMORY_EVENTS) {
      this.limitReached = true;
      this.notify();
      return false;
    }

    // Normal append
    this.events = [...this.events, norm];
    this.updateScenarioClock(norm.lastObservedAt);
    this.notify();
    return true;
  }

  private updateScenarioClock(timestamp: string | null): void {
    if (!timestamp) {
      return;
    }
    const t = new Date(timestamp).getTime();
    if (Number.isNaN(t)) {
      return;
    }
    if (!this.scenarioClock) {
      this.scenarioClock = timestamp;
      return;
    }
    const currentT = new Date(this.scenarioClock).getTime();
    if (t > currentT) {
      this.scenarioClock = timestamp;
    }
  }

  public resetScenario(): void {
    this.events = [...this.initialEvents];
    this.scenarioClock = this.initialClock;
    this.limitReached = false;
    this.notify();
  }

  public getEvents(): readonly NormalisedEvent[] {
    return this.events;
  }

  public getScenarioClock(): string | null {
    return this.scenarioClock;
  }

  public getActiveScenarioId(): ScenarioId {
    return this.activeScenarioId;
  }

  public isLimitReached(): boolean {
    return this.limitReached;
  }
}
