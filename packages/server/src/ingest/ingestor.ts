// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { normaliseEvent, parseIsoTimestamp } from '@k8s-events/domain';
import type { NormalisedEvent, NormaliseContext } from '@k8s-events/domain';
import type { Logger } from '../logging';
import type { ClusterStore } from '../store/clusterStore';
import type { ClusterError, ClusterStatus } from '../clusters/types';
import { KubeApiError, KubeClient } from '../kube/client';
import type { WatchMessage } from '../kube/client';

/** The subset of the Kubernetes client the ingestor needs, so tests can supply a scripted stream. */
export type EventSourceClient = {
  listEvents: (
    continueToken?: string,
    namespace?: string
  ) => Promise<{ items: unknown[]; resourceVersion: string | null }>;
  watchEvents: (
    resourceVersion: string,
    onMessage: (message: WatchMessage) => void,
    signal: AbortSignal,
    namespace?: string
  ) => Promise<void>;
};

export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_MAX_MS = 60_000;
export const BACKOFF_RESET_AFTER_MS = 60_000;

export type Clock = () => number;

export type IngestorOptions = {
  client: EventSourceClient;
  store: ClusterStore;
  context: NormaliseContext;
  logger: Logger;
  clock?: () => number;
  /** Deterministic jitter source in [0,1); defaults to a seeded generator. */
  jitter?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /**
   * Namespaces to list and watch. Empty means every namespace the identity may
   * read, which needs cluster-wide list and watch permission.
   */
  namespaces?: string[];
};

export function defaultJitter(): number {
  // Jitter only spreads retries between clusters; it never affects Event data.
  return Math.random();
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

type ScopeState = {
  /** Empty string represents the cluster-wide scope. */
  readonly namespace: string;
  status: ClusterStatus;
  error: ClusterError | null;
  resourceVersion: string | null;
  lastHealthyAt: number;
  attempt: number;
};

/**
 * One list-and-watch loop per watched namespace, all inside one cluster.
 *
 * Read-only: the loops only list and watch. A repeated series update replaces
 * the stored snapshot with the same logical ID instead of adding a row.
 */
export class Ingestor {
  observationStartedAt: string | null = null;
  readonly store: ClusterStore;
  private readonly client: EventSourceClient;
  private readonly context: NormaliseContext;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly jitter: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly scopes: Map<string, ScopeState>;
  private controller: AbortController | null = null;
  private loops: Promise<void>[] = [];
  private fallbackIndex = 0;
  private stopped = false;

  constructor(options: IngestorOptions) {
    this.client = options.client;
    this.store = options.store;
    this.context = options.context;
    this.logger = options.logger.child({ cluster: options.context.clusterId });
    this.clock = options.clock ?? Date.now;
    this.jitter = options.jitter ?? defaultJitter;
    this.sleep = options.sleep ?? defaultSleep;

    const namespaces = [...new Set(options.namespaces ?? [])];
    this.scopes = new Map(
      (namespaces.length > 0 ? namespaces : ['']).map((namespace) => [
        namespace,
        {
          namespace,
          status: 'connecting' as ClusterStatus,
          error: null,
          resourceVersion: null,
          lastHealthyAt: 0,
          attempt: 0,
        },
      ])
    );
  }

  /** Watched namespaces; empty means the cluster-wide scope. */
  get namespaces(): string[] {
    return [...this.scopes.keys()].filter((namespace) => namespace !== '');
  }

  get running(): boolean {
    return this.controller !== null && !this.controller.signal.aborted;
  }

  get status(): ClusterStatus {
    const states = [...this.scopes.values()];
    if (states.length === 0) return 'connecting';
    if (states.every((state) => state.status === 'live')) return 'live';
    // Partial coverage is reported as degraded; an authentication failure only
    // becomes the headline status when no watched namespace is readable.
    if (states.some((state) => state.status === 'live')) return 'degraded';
    if (states.some((state) => state.status === 'auth-failed')) return 'auth-failed';
    if (states.some((state) => state.status === 'connecting')) return 'connecting';
    if (states.some((state) => state.status === 'degraded')) return 'degraded';
    return 'unreachable';
  }

  get error(): ClusterError | null {
    for (const state of this.scopes.values()) {
      if (state.error) return state.error;
    }
    return null;
  }

  /** True only when every watched scope is streaming. */
  get allScopesLive(): boolean {
    return [...this.scopes.values()].every((state) => state.status === 'live');
  }

  start(): void {
    if (this.running) return;
    this.stopped = false;
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    this.loops = [...this.scopes.values()].map((state) => this.run(state, signal));
    void Promise.all(this.loops).catch((error: unknown) => {
      this.logger.error('ingest loop ended unexpectedly', {
        error: KubeClient.describeError(error).code,
      });
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.controller?.abort();
    await Promise.all(this.loops.map((loop) => loop.catch(() => undefined)));
    this.controller = null;
    this.loops = [];
  }

  /** Normalizes one raw Event and stores it. Exposed for the watch path and tests. */
  ingestObject(raw: unknown): NormalisedEvent {
    const record = this.normalise(raw);
    const result = this.store.upsert(record);
    if (result.evicted > 0) {
      this.logger.warn('record cap reached; oldest records were evicted', {
        evicted: result.evicted,
        cap: this.store.cap,
      });
    }
    return record;
  }

  private normalise(raw: unknown): NormalisedEvent {
    const record = normaliseEvent(raw, this.context, this.fallbackIndex);
    if (!record.uid) this.fallbackIndex++;
    return record;
  }

  private async run(state: ScopeState, signal: AbortSignal): Promise<void> {
    const scope = state.namespace || 'all namespaces';
    while (!signal.aborted && !this.stopped) {
      try {
        const listed = await this.client.listEvents(undefined, state.namespace || undefined);
        if (signal.aborted) return;
        this.replaceFromList(listed.items, state.namespace);
        state.resourceVersion = listed.resourceVersion;
        state.status = 'live';
        state.error = null;
        if (!this.observationStartedAt) {
          this.observationStartedAt = new Date(this.clock()).toISOString();
        }
        state.lastHealthyAt = this.clock();
        state.attempt = 0;
        this.logger.info('cluster scope is live', { scope, records: this.store.size });

        await this.client.watchEvents(
          state.resourceVersion ?? '0',
          (message) => this.handleWatchMessage(message, state),
          signal,
          state.namespace || undefined
        );

        if (signal.aborted || this.stopped) return;
        state.status = 'degraded';
        this.logger.warn('watch ended; reconnecting', { scope });
        await this.backoff(state, signal);
      } catch (error) {
        if (signal.aborted || this.stopped) return;
        if (error instanceof KubeApiError && error.statusCode === 410) {
          state.status = 'degraded';
          this.logger.warn('watch resource version expired; re-listing', { scope });
          continue;
        }
        const described = KubeClient.describeError(error);
        state.error = described;
        state.status =
          described.code === 'cluster_auth_failed' || described.code === 'cluster_forbidden'
            ? 'auth-failed'
            : 'unreachable';
        this.logger.warn('cluster read failed', { code: described.code, scope });
        await this.backoff(state, signal);
      }
    }
  }

  private backoff(state: ScopeState, signal: AbortSignal): Promise<void> {
    // Only a previously healthy scope resets the backoff; otherwise an
    // unreachable cluster would retry every second forever.
    if (state.lastHealthyAt > 0 && this.clock() - state.lastHealthyAt > BACKOFF_RESET_AFTER_MS) {
      state.attempt = 0;
    }
    const exponential = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** state.attempt);
    const jittered = exponential * (1 + (this.jitter() * 2 - 1) * 0.2);
    state.attempt = Math.min(state.attempt + 1, 16);
    return this.sleep(Math.max(BACKOFF_MIN_MS, Math.round(jittered)), signal);
  }

  private replaceFromList(items: unknown[], namespace: string): void {
    const records = items.map((raw) => this.normalise(raw));
    if (namespace === '') {
      this.store.clear();
      this.fallbackIndex = 0;
      for (const record of records) {
        const result = this.store.upsert(record);
        if (result.evicted > 0) this.warnEviction(result.evicted);
      }
      return;
    }

    // Replace only this namespace's records; other scopes keep theirs.
    const keep = new Set(records.map((record) => record.id));
    for (const existing of this.store.snapshot()) {
      if (existing.namespace === namespace && !keep.has(existing.id)) {
        this.store.delete(existing.id);
      }
    }
    for (const record of records) {
      const result = this.store.upsert(record);
      if (result.evicted > 0) this.warnEviction(result.evicted);
    }
  }

  private warnEviction(evicted: number): void {
    this.logger.warn('record cap reached; oldest records were evicted', {
      evicted,
      cap: this.store.cap,
    });
  }

  private handleWatchMessage(message: WatchMessage, state: ScopeState): void {
    if (message.type === 'BOOKMARK') {
      const resourceVersion = (message.object as { metadata?: { resourceVersion?: unknown } } | null)
        ?.metadata?.resourceVersion;
      if (typeof resourceVersion === 'string') state.resourceVersion = resourceVersion;
      return;
    }
    if (message.type === 'ERROR') return;
    if (!message.object || typeof message.object !== 'object') return;
    const metadata = (message.object as { metadata?: { uid?: unknown; resourceVersion?: unknown } })
      .metadata;
    if (typeof metadata?.resourceVersion === 'string') state.resourceVersion = metadata.resourceVersion;

    if (message.type === 'DELETED') {
      const uid = typeof metadata?.uid === 'string' ? metadata.uid : null;
      if (uid) this.store.delete(`${this.context.clusterId}/${uid}`);
      return;
    }

    const record = this.ingestObject(message.object);
    this.store.publish([record]);
    // Receiving data means this scope is streaming again.
    if (state.status !== 'live') state.status = 'live';
  }
}

/** Parses a resourceVersion safely; used when resuming a watch. */
export function isResourceVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Exposed for the cluster status endpoint. */
export function observationStart(value: string | null): string | null {
  return value && parseIsoTimestamp(value) ? value : null;
}
