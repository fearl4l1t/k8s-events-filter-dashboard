// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React from 'react';
import { NOT_SUPPLIED, formatCompactTimestamp } from '@k8s-events/domain';
import type { ClusterSummary } from '../api/client';

interface ClusterSelectorProps {
  clusters: ClusterSummary[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
}

const STATUS_TEXT: Record<ClusterSummary['status'], string> = {
  connecting: 'connecting',
  live: 'live',
  degraded: 'degraded',
  unreachable: 'unreachable',
  'auth-failed': 'authentication failed',
};

export const ClusterSelector: React.FC<ClusterSelectorProps> = ({
  clusters,
  selectedIds,
  onToggle,
  onSelectAll,
}) => {
  return (
    <fieldset className="cluster-selector" data-testid="cluster-selector">
      <legend className="cluster-selector-legend">
        Observed clusters
        <button
          type="button"
          className="table-action-button"
          onClick={onSelectAll}
          data-testid="cluster-select-all"
        >
          All clusters
        </button>
      </legend>
      <ul className="cluster-list">
        {clusters.map((cluster) => {
          const checked = selectedIds.length === 0 || selectedIds.includes(cluster.id);
          return (
            <li key={cluster.id} className="cluster-item" data-testid={`cluster-${cluster.id}`}>
              <label className="cluster-label">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(cluster.id)}
                  aria-describedby={`cluster-status-${cluster.id}`}
                />
                <span className="cluster-name">{cluster.name}</span>
              </label>
              <span
                id={`cluster-status-${cluster.id}`}
                className={`cluster-status cluster-status-${cluster.status}`}
                data-testid={`cluster-status-${cluster.id}`}
              >
                {STATUS_TEXT[cluster.status]} · {cluster.source} · {cluster.recordCount} records
                {cluster.evictedCount > 0 ? ` · ${cluster.evictedCount} oldest evicted` : ''} · last
                event {cluster.lastEventAt ? formatCompactTimestamp(cluster.lastEventAt) : NOT_SUPPLIED}
              </span>
              {cluster.error && (
                <span className="cluster-error" role="status">
                  {cluster.error.message}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
};
