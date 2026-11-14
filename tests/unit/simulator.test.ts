// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventStore } from '../../src/store/eventStore';
import { Simulator } from '../../src/store/simulator';

describe('Simulator', () => {
  let store: EventStore;
  let simulator: Simulator;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new EventStore();
    simulator = new Simulator(store, 'normal-rollout');
  });

  afterEach(() => {
    simulator.destroy();
    vi.useRealTimers();
  });

  it('initializes with normal-rollout scenario in idle status', () => {
    const state = simulator.getState();
    expect(state.status).toBe('idle');
    expect(state.activeScenarioId).toBe('normal-rollout');
    expect(state.currentStepIndex).toBe(0);
    expect(state.totalSteps).toBeGreaterThan(0);
  });

  it('plays, advances steps using timers, and reaches completed', () => {
    simulator.play();
    expect(simulator.getState().status).toBe('running');

    const initialEventCount = store.getEvents().length;

    // Advance by 1500ms for first step
    vi.advanceTimersByTime(1500);
    expect(store.getEvents().length).toBe(initialEventCount + 1);
    expect(simulator.getState().currentStepIndex).toBe(1);

    // Advance all remaining timers
    vi.runAllTimers();
    expect(simulator.getState().status).toBe('completed');
  });

  it('pauses and prevents further arrivals, resumes from next step', () => {
    simulator.play();
    const countBefore = store.getEvents().length;

    // Pause immediately
    simulator.pause();
    expect(simulator.getState().status).toBe('paused');

    // Time passes while paused
    vi.advanceTimersByTime(10000);
    // No new events arrive while paused!
    expect(store.getEvents().length).toBe(countBefore);
    expect(simulator.getState().currentStepIndex).toBe(0);

    // Resume
    simulator.play();
    expect(simulator.getState().status).toBe('running');
    vi.advanceTimersByTime(1500);
    expect(store.getEvents().length).toBe(countBefore + 1);
    expect(simulator.getState().currentStepIndex).toBe(1);
  });

  it('changes playback speed and affects timer delays proportionally', () => {
    simulator.setSpeed(2); // 2x speed
    expect(simulator.getState().speed).toBe(2);

    simulator.play();
    const countBefore = store.getEvents().length;

    // First step delay is 1000ms at 1x; at 2x it should trigger at ~500ms
    vi.advanceTimersByTime(550);
    expect(store.getEvents().length).toBe(countBefore + 1);
  });

  it('resets simulator state and restores initial store events', () => {
    simulator.play();
    vi.advanceTimersByTime(2000);
    expect(simulator.getState().currentStepIndex).toBeGreaterThan(0);

    simulator.reset();
    expect(simulator.getState().status).toBe('idle');
    expect(simulator.getState().currentStepIndex).toBe(0);
  });

  it('selects another scenario and resets step cursor', () => {
    simulator.selectScenario('image-pull-failure');
    const state = simulator.getState();
    expect(state.activeScenarioId).toBe('image-pull-failure');
    expect(state.status).toBe('idle');
    expect(state.currentStepIndex).toBe(0);
    expect(store.getActiveScenarioId()).toBe('image-pull-failure');
  });

  it('handles getAvailableScenarios, same speed, unknown scenario, and play when completed', () => {
    expect(simulator.getAvailableScenarios().length).toBe(5);

    // Same speed
    simulator.setSpeed(1);
    expect(simulator.getState().speed).toBe(1);

    // Unknown scenario
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    simulator.selectScenario('nonexistent' as any);
    expect(simulator.getState().activeScenarioId).toBe('normal-rollout');

    // Run to completed
    simulator.play();
    vi.runAllTimers();
    expect(simulator.getState().status).toBe('completed');

    // Play when completed
    simulator.play();
    expect(simulator.getState().status).toBe('completed');
  });
});
