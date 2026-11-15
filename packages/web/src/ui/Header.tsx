// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React from 'react';
import type { ClusterSummary } from '../api/client';
import type { StreamState } from '../state/useDashboard';
import { ClusterSelector } from './ClusterSelector';
import { ObservationBanner } from './ObservationBanner';

export type Tab = 'overview' | 'explorer' | 'analytics';

interface HeaderProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  clusters: ClusterSummary[];
  selectedClusterIds: string[];
  onToggleCluster: (id: string) => void;
  onSelectAllClusters: () => void;
  serverTime: string | null;
  streamState: StreamState;
  partial: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  clusters,
  selectedClusterIds,
  onToggleCluster,
  onSelectAllClusters,
  serverTime,
  streamState,
  partial,
}) => {
  return (
    <header className="app-header" role="banner">
      <div className="header-top">
        <div className="brand-section">
          <svg
            className="brand-logo"
            viewBox="0 0 28 28"
            fill="none"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="14" cy="14" r="13" stroke="#326ce5" strokeWidth="2" />
            <path
              d="M14 6l2.5 5.5h5.5l-4.5 3.5 1.75 5.5L14 17.5l-5.25 3 1.75-5.5L6 11.5h5.5L14 6z"
              fill="#326ce5"
            />
          </svg>
          <span className="brand-title">K8s Events</span>
        </div>

        <nav className="nav-tabs" role="navigation" aria-label="Main sections">
          {(['overview', 'explorer', 'analytics'] as Tab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`nav-tab-btn${activeTab === tab ? ' active' : ''}`}
              onClick={() => onTabChange(tab)}
              aria-current={activeTab === tab ? 'page' : undefined}
              data-testid={`nav-tab-${tab}`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      <ObservationBanner
        clusters={clusters}
        serverTime={serverTime}
        streamState={streamState}
        partial={partial}
        compact
      />

      <ClusterSelector
        clusters={clusters}
        selectedIds={selectedClusterIds}
        onToggle={onToggleCluster}
        onSelectAll={onSelectAllClusters}
      />
    </header>
  );
};
