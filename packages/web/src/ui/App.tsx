// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React, { useCallback, useRef, useState } from 'react';
import type { EventFilters } from '@k8s-events/domain';
import { useDashboard } from '../state/useDashboard';
import { Header, type Tab } from './Header';
import { OverviewPanel } from './Overview/OverviewPanel';
import { ExplorerPanel } from './Explorer/ExplorerPanel';
import { AnalyticsPanel } from './Analytics/AnalyticsPanel';
import { DetailPanel } from './DetailPanel/DetailPanel';
import { LoadingState } from './states/LoadingState';
import { EmptyDatasetState } from './states/EmptyDatasetState';

/**
 * Application shell. One shared query feeds the three sections; the detail
 * panel fetches a single record by ID from the same server store.
 */
export const App: React.FC = () => {
  const dashboard = useDashboard();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const keywordInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const handleSelectEvent = useCallback(
    (id: string, origin: HTMLElement) => {
      triggerRef.current = origin;
      dashboard.selectEvent(id);
    },
    [dashboard]
  );

  const handleApplyEvidence = useCallback(
    (partial: Partial<EventFilters>) => {
      dashboard.applyFilter(partial);
      setActiveTab('explorer');
    },
    [dashboard]
  );

  const observedRecords = (dashboard.page?.clusters ?? []).reduce(
    (sum, cluster) => sum + cluster.recordCount,
    0
  );
  const initialLoading = dashboard.loading && dashboard.page === null && dashboard.error === null;
  const emptyDataset =
    dashboard.page !== null && dashboard.page.totalItems === 0 && observedRecords === 0;

  return (
    <div className="app-container" data-testid="app-container">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <h1 className="visually-hidden">Kubernetes Events Explorer</h1>

      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        clusters={dashboard.clusters ?? []}
        selectedClusterIds={dashboard.query.clusterIds}
        onToggleCluster={dashboard.toggleCluster}
        onSelectAllClusters={() => dashboard.setClusterIds([])}
        serverTime={dashboard.serverTime}
        streamState={dashboard.streamState}
        partial={dashboard.page?.partial ?? false}
      />

      <main id="main-content" className="main-content" role="main">
        <p className="observation-banner-note" data-testid="observation-limits">
          Only Events held by the cluster during this observation are shown. The view is not a
          complete history, and an Event does not establish why a workload changed.
        </p>

        {dashboard.identity && (
          <p className="inline-note" data-testid="identity-note">
            Signed in as {dashboard.identity.user.name ?? dashboard.identity.user.id} · roles:{' '}
            {dashboard.identity.roles.join(', ') || 'none'} · access mode {dashboard.identity.mode}
            {dashboard.identity.mode === 'oidc' && (
              <>
                {' '}
                · <a href="/auth/logout" data-testid="sign-out-link">Sign out</a>
              </>
            )}
          </p>
        )}

        {dashboard.error && (
          <div className="state-container panel-card" role="alert" data-testid="error-state">
            <h2 className="state-title">
              {dashboard.errorCode === 'unauthenticated'
                ? 'Sign in to read Events'
                : 'The dashboard could not load Event data'}
            </h2>
            <p className="state-description">{dashboard.error}</p>
            {dashboard.errorCode === 'unauthenticated' ? (
              <a className="sim-btn sim-btn-primary" href="/auth/login" data-testid="sign-in-link">
                Sign in
              </a>
            ) : (
              <button type="button" className="sim-btn sim-btn-primary" onClick={dashboard.refresh}>
                Try again
              </button>
            )}
          </div>
        )}

        {initialLoading && <LoadingState />}

        {!initialLoading && !dashboard.error && emptyDataset && <EmptyDatasetState />}

        {!initialLoading && !dashboard.error && !emptyDataset && (
          <>
            {activeTab === 'overview' && (
              <OverviewPanel
                summary={dashboard.summary}
                onSelectEvent={handleSelectEvent}
                onApplyFilter={handleApplyEvidence}
              />
            )}
            {activeTab === 'explorer' && (
              <ExplorerPanel
                query={dashboard.query}
                page={dashboard.page}
                options={dashboard.options}
                selectedEventId={dashboard.selectedId}
                onSelectEvent={handleSelectEvent}
                onFiltersChange={dashboard.setFilters}
                onClearAll={dashboard.clearFilters}
                onSortChange={dashboard.setSort}
                onPageChange={dashboard.setPage}
                keywordInputRef={keywordInputRef}
              />
            )}
            {activeTab === 'analytics' && (
              <AnalyticsPanel summary={dashboard.summary} onApplyFilter={handleApplyEvidence} />
            )}
          </>
        )}
      </main>

      {dashboard.selectedId !== null && dashboard.detail && (
        <DetailPanel
          event={dashboard.detail}
          observationStartedAt={
            dashboard.page?.clusters.find((cluster) => cluster.id === dashboard.detail?.clusterId)
              ?.observationStartedAt ?? null
          }
          onClose={() => dashboard.selectEvent(null)}
          triggerRef={triggerRef}
          fallbackRef={keywordInputRef as React.RefObject<HTMLElement | null>}
        />
      )}

      {dashboard.selectedId !== null && dashboard.detailLoading && (
        <div className="detail-panel-loading panel-card" role="status" data-testid="detail-loading">
          Loading the selected Event record from the server.
        </div>
      )}

      {dashboard.selectedId !== null && dashboard.detailError && (
        <div className="detail-panel-loading panel-card" role="alert" data-testid="detail-error">
          <p>{dashboard.detailError}</p>
          <button
            type="button"
            className="sim-btn"
            onClick={() => dashboard.selectEvent(null)}
            data-testid="detail-error-close"
          >
            Close
          </button>
        </div>
      )}

      <footer className="app-footer">
        <span>
          Reading from the Kubernetes Events API with list and watch only; the dashboard never writes
          to a cluster. No Event content leaves this page.
        </span>
      </footer>
    </div>
  );
};
