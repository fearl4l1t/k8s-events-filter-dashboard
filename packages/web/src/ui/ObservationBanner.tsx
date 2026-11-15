// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React from 'react';
import { formatDisplayTimestamp } from '@k8s-events/domain';
import type { ClusterSummary } from '../api/client';
import type { StreamState } from '../state/useDashboard';

interface ObservationBannerProps {
  clusters: ClusterSummary[];
  serverTime: string | null;
  streamState: StreamState;
  partial: boolean;
  compact?: boolean;
}

function sourceLabel(cluster: ClusterSummary): string {
  return cluster.source === 'in-cluster' ? 'in-cluster ServiceAccount' : 'local kubeconfig';
}

/**
 * Persistent provenance: which clusters are observed, from where, and since
 * when. It also states plainly that the view is not a complete history.
 */
export const ObservationBanner: React.FC<ObservationBannerProps> = ({
  clusters,
  serverTime,
  streamState,
  partial,
  compact = false,
}) => {
  const names = clusters.map((cluster) => cluster.name).join(', ');
  const sources = [...new Set(clusters.map(sourceLabel))].join(', ');
  const started = clusters
    .map((cluster) => cluster.observationStartedAt)
    .filter((value): value is string => value !== null)
    .sort();
  const earliestStart = started[0] ?? null;

  return (
    <aside className="observation-banner" data-testid="observation-banner" aria-label="Data source">
      <div className="observation-banner-main">
        <strong className="observation-banner-title">Read-only observation</strong>
        <span data-testid="observation-cluster">
          {clusters.length === 0 ? 'No cluster selected' : names}
        </span>
        {clusters.length > 0 && (
          <span className="observation-banner-meta" data-testid="observation-source">
            source: {sources}
          </span>
        )}
        <span className="observation-banner-meta" data-testid="observation-start">
          observing since{' '}
          {earliestStart ? formatDisplayTimestamp(earliestStart) : 'Not supplied'}
        </span>
        <span className="observation-banner-meta" data-testid="observation-server-time">
          server time {serverTime ? formatDisplayTimestamp(serverTime) : 'Not supplied'}
        </span>
        <span className="observation-banner-meta" data-testid="observation-stream">
          live updates: {streamState}
        </span>
      </div>
      {!compact && (
        <p className="observation-banner-note">
          Only Events currently held by the selected cluster are shown. Kubernetes keeps Events for a
          limited time, so this view is a partial observation rather than a complete history. It
          cannot establish why a workload changed.
        </p>
      )}
      {partial && (
        <p className="observation-banner-warning" role="status" data-testid="observation-partial">
          At least one selected cluster is not streaming live (see the cluster list). Totals describe
          what was observed so far.
        </p>
      )}
    </aside>
  );
};
