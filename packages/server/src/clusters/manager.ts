// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import type { Logger } from '../logging';
import type { ConnectionSpec } from '../kube/kubeconfig';
import { KubeClient } from '../kube/client';
import { ClusterStore } from '../store/clusterStore';
import { Ingestor } from '../ingest/ingestor';
import type { ClusterInfo, ClusterRegistry, ClusterRuntime } from './types';

export type ClusterManagerOptions = {
  connections: ConnectionSpec[];
  capPerCluster: number;
  /** Watched namespaces; empty means every namespace the identity can read. */
  namespaces?: string[];
  logger: Logger;
  /** Overridable for tests; defaults to a real read-only API client per connection. */
  clientFactory?: (connection: ConnectionSpec) => ConstructorParameters<typeof Ingestor>[0]['client'];
  clock?: () => number;
};

/**
 * Owns one store and one ingest loop per configured cluster. A failure in one
 * cluster never stops another: each loop backs off independently.
 */
export class ClusterManager implements ClusterRegistry {
  private readonly runtimes = new Map<string, ClusterRuntime & { ingestor: Ingestor }>();

  constructor(options: ClusterManagerOptions) {
    const seen = new Set<string>();
    for (const connection of options.connections) {
      if (seen.has(connection.clusterId)) {
        throw new Error(`Duplicate cluster context "${connection.clusterId}".`);
      }
      seen.add(connection.clusterId);
      const store = new ClusterStore(connection.clusterId, options.capPerCluster);
      const client = options.clientFactory
        ? options.clientFactory(connection)
        : new KubeClient(connection);
      const ingestor = new Ingestor({
        client,
        store,
        context: {
          clusterId: connection.clusterId,
          clusterName: connection.clusterName,
          source: connection.source,
        },
        logger: options.logger,
        clock: options.clock,
        namespaces: options.namespaces,
      });
      this.runtimes.set(connection.clusterId, {
        info: {
          id: connection.clusterId,
          name: connection.clusterName,
          source: connection.source,
          status: 'connecting',
          observationStartedAt: null,
          lastEventAt: null,
          recordCount: 0,
          evictedCount: 0,
          error: null,
        },
        store,
        ingestor,
      });
    }
  }

  start(): void {
    for (const runtime of this.runtimes.values()) runtime.ingestor.start();
  }

  async stop(): Promise<void> {
    await Promise.all([...this.runtimes.values()].map((runtime) => runtime.ingestor.stop()));
  }

  list(): ClusterRuntime[] {
    return [...this.runtimes.values()].map((runtime) => this.describe(runtime));
  }

  get(id: string): ClusterRuntime | undefined {
    const runtime = this.runtimes.get(id);
    return runtime ? this.describe(runtime) : undefined;
  }

  private describe(runtime: ClusterRuntime & { ingestor: Ingestor }): ClusterRuntime {
    const info: ClusterInfo = {
      id: runtime.info.id,
      name: runtime.info.name,
      source: runtime.info.source,
      status: runtime.ingestor.status,
      observationStartedAt: runtime.ingestor.observationStartedAt,
      lastEventAt: runtime.store.latestObservedAt,
      recordCount: runtime.store.size,
      evictedCount: runtime.store.evictedCount,
      error: runtime.ingestor.error,
    };
    return { info, store: runtime.store };
  }
}
