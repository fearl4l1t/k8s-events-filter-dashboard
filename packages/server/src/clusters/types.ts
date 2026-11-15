// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import type { EventSource } from '@k8s-events/domain';
import type { ClusterStore } from '../store/clusterStore';

export type ClusterStatus =
  | 'connecting'
  | 'live'
  | 'degraded'
  | 'auth-failed'
  | 'unreachable';

export type ClusterError = {
  code: string;
  message: string;
};

/** Public cluster description returned by the API. */
export type ClusterInfo = {
  id: string;
  name: string;
  source: EventSource;
  status: ClusterStatus;
  /** Set when the first successful list completes; not reset by later re-lists. */
  observationStartedAt: string | null;
  lastEventAt: string | null;
  recordCount: number;
  evictedCount: number;
  error: ClusterError | null;
};

export type ClusterRuntime = {
  info: ClusterInfo;
  store: ClusterStore;
};

export type ClusterRegistry = {
  list: () => ClusterRuntime[];
  get: (id: string) => ClusterRuntime | undefined;
};
