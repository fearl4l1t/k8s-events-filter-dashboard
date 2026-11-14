// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import normalRolloutData from '../../fixtures/normal-rollout.json';
import imagePullFailureData from '../../fixtures/image-pull-failure.json';
import schedulingPressureData from '../../fixtures/scheduling-pressure.json';
import containerHealthData from '../../fixtures/container-health.json';
import nodeConditionData from '../../fixtures/node-condition.json';

import { DEFAULT_SIMULATOR_SPEED } from '../domain/constants';
import type {
  ScenarioId,
  ScenarioManifest,
  ScriptedStep,
  SimulatorSpeed,
  SimulatorStatus,
} from '../domain/types';
import type { EventStore } from './eventStore';

export interface SimulatorState {
  status: SimulatorStatus;
  activeScenarioId: ScenarioId;
  speed: SimulatorSpeed;
  currentStepIndex: number;
  totalSteps: number;
  scenarioName: string;
  scenarioDescription: string;
}

export type SimulatorListener = (state: SimulatorState) => void;

function toManifest(data: unknown): ScenarioManifest {
  const d = data as {
    scenarioId: ScenarioId;
    name: string;
    description: string;
    seedEvents: unknown[];
    steps: ScriptedStep[];
  };
  return {
    id: d.scenarioId,
    name: d.name,
    description: d.description,
    seedEvents: d.seedEvents,
    steps: d.steps,
  };
}

const SCENARIO_CATALOG: Record<ScenarioId, ScenarioManifest> = {
  'normal-rollout': toManifest(normalRolloutData),
  'image-pull-failure': toManifest(imagePullFailureData),
  'scheduling-pressure': toManifest(schedulingPressureData),
  'container-health': toManifest(containerHealthData),
  'node-condition': toManifest(nodeConditionData),
};

export class Simulator {
  private store: EventStore;
  private activeScenario: ScenarioManifest;
  private currentStepIndex = 0;
  private speed: SimulatorSpeed = DEFAULT_SIMULATOR_SPEED;
  private status: SimulatorStatus = 'idle';
  private timerHandle: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<SimulatorListener>();

  constructor(store: EventStore, initialScenarioId: ScenarioId = 'normal-rollout') {
    this.store = store;
    this.activeScenario = SCENARIO_CATALOG[initialScenarioId] ?? SCENARIO_CATALOG['normal-rollout'];
    this.store.loadScenario(this.activeScenario);
  }

  public subscribe(listener: SimulatorListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  public getState(): SimulatorState {
    return {
      status: this.status,
      activeScenarioId: this.activeScenario.id,
      speed: this.speed,
      currentStepIndex: this.currentStepIndex,
      totalSteps: this.activeScenario.steps.length,
      scenarioName: this.activeScenario.name,
      scenarioDescription: this.activeScenario.description,
    };
  }

  public getAvailableScenarios(): readonly { id: ScenarioId; name: string; description: string }[] {
    return Object.values(SCENARIO_CATALOG).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
    }));
  }

  public selectScenario(id: ScenarioId): void {
    this.pause();
    const manifest = SCENARIO_CATALOG[id];
    if (!manifest) {
      return;
    }
    this.activeScenario = manifest;
    this.currentStepIndex = 0;
    this.status = 'idle';
    this.store.loadScenario(manifest);
    this.notify();
  }

  public play(): void {
    if (this.status === 'running') {
      return;
    }

    if (this.currentStepIndex >= this.activeScenario.steps.length) {
      this.status = 'completed';
      this.notify();
      return;
    }

    this.status = 'running';
    this.notify();
    this.scheduleNextStep();
  }

  public pause(): void {
    this.clearTimer();
    if (this.status === 'running') {
      this.status = 'paused';
      this.notify();
    }
  }

  public setSpeed(newSpeed: SimulatorSpeed): void {
    if (this.speed === newSpeed) {
      return;
    }
    this.speed = newSpeed;
    if (this.status === 'running') {
      // Re-schedule current step with updated speed
      this.clearTimer();
      this.scheduleNextStep();
    } else {
      this.notify();
    }
  }

  public reset(): void {
    this.clearTimer();
    this.currentStepIndex = 0;
    this.status = 'idle';
    this.store.resetScenario();
    this.notify();
  }

  private scheduleNextStep(): void {
    if (this.status !== 'running') {
      return;
    }

    if (this.currentStepIndex >= this.activeScenario.steps.length) {
      this.status = 'completed';
      this.notify();
      return;
    }

    const step = this.activeScenario.steps[this.currentStepIndex];
    if (!step) {
      this.status = 'completed';
      this.notify();
      return;
    }

    const delay = Math.max(50, Math.round(step.delayMs / this.speed));

    this.timerHandle = setTimeout(() => {
      this.timerHandle = null;

      const success = this.store.appendEvent(
        step.event,
        step.isSeriesUpdate,
        this.currentStepIndex
      );

      if (!success && this.store.isLimitReached()) {
        this.status = 'limit-reached';
        this.notify();
        return;
      }

      this.currentStepIndex++;

      if (this.currentStepIndex >= this.activeScenario.steps.length) {
        this.status = 'completed';
        this.notify();
      } else {
        this.notify();
        this.scheduleNextStep();
      }
    }, delay);
  }

  private clearTimer(): void {
    if (this.timerHandle !== null) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  public destroy(): void {
    this.clearTimer();
    this.listeners.clear();
  }
}
