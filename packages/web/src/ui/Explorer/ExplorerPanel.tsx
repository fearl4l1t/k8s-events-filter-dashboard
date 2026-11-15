// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React from 'react';
import type { AvailableFilterOptions, EventFilters, SortConfig, SortField } from '@k8s-events/domain';
import { DEFAULT_FILTERS, DEFAULT_SORT, NOT_SUPPLIED } from '@k8s-events/domain';
import { api, type DashboardQuery, type EventsResponse } from '../../api/client';
import { FilterPanel } from './FilterPanel';
import { EventTable } from './EventTable';

interface ExplorerPanelProps {
  query: DashboardQuery;
  page: EventsResponse | null;
  options: AvailableFilterOptions | null;
  selectedEventId: string | null;
  onSelectEvent: (id: string, origin: HTMLElement) => void;
  onFiltersChange: (filters: EventFilters) => void;
  onClearAll: () => void;
  onSortChange: (sort: SortConfig) => void;
  onPageChange: (page: number) => void;
  keywordInputRef?: React.RefObject<HTMLInputElement | null>;
}

const EMPTY_OPTIONS: AvailableFilterOptions = {
  namespaces: [],
  reasons: [],
  resourceKinds: [],
  reporters: [],
};

export const ExplorerPanel: React.FC<ExplorerPanelProps> = ({
  query,
  page,
  options,
  selectedEventId,
  onSelectEvent,
  onFiltersChange,
  onClearAll,
  onSortChange,
  onPageChange,
  keywordInputRef,
}) => {
  const handleClearAll = () => {
    onClearAll();
  };

  const handleSortChange = (field: SortField) => {
    let direction: SortConfig['direction'] = 'asc';
    if (query.sort.field === field) {
      direction = query.sort.direction === 'asc' ? 'desc' : 'asc';
    } else if (field === 'lastObservedAt' || field === 'firstObservedAt') {
      direction = 'desc';
    }
    onSortChange({ field, direction });
  };

  const items = page?.items ?? [];
  const totalItems = page?.totalItems ?? 0;
  const currentPage = page?.page ?? query.page;
  const totalPages = page?.totalPages ?? 1;
  const pageSize = page?.pageSize ?? query.pageSize;
  const startIdx = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endIdx = Math.min(currentPage * pageSize, totalItems);
  const observedRecords = (page?.clusters ?? []).reduce((sum, cluster) => sum + cluster.recordCount, 0);
  const hasFilters =
    JSON.stringify(query.filters) !== JSON.stringify(DEFAULT_FILTERS) ||
    JSON.stringify(query.sort) !== JSON.stringify(DEFAULT_SORT);

  return (
    <div
      className="explorer-panel"
      data-testid="explorer-panel"
      style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
    >
      <h2 className="visually-hidden">Event explorer</h2>

      <FilterPanel
        filters={query.filters}
        onFiltersChange={onFiltersChange}
        onClearAll={handleClearAll}
        availableOptions={options ?? EMPTY_OPTIONS}
        keywordInputRef={keywordInputRef}
        anchorTime={page?.serverTime ?? null}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <span
          style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}
          data-testid="result-count"
          aria-live="polite"
        >
          {totalItems === 0
            ? 'No Events match the active filters'
            : `Showing ${startIdx}–${endIdx} of ${totalItems} Event records`}
        </span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <a
            className="sim-btn"
            href={api.exportUrl(query, 'csv')}
            download="k8s-events.csv"
            data-testid="export-csv-link"
            aria-label="Download every filtered Event record as CSV"
          >
            Export CSV
          </a>
          <a
            className="sim-btn"
            href={api.exportUrl(query, 'json')}
            download="k8s-events.json"
            data-testid="export-json-link"
            aria-label="Download every filtered Event record as JSON"
          >
            Export JSON
          </a>
        </div>
      </div>

      {page?.invalidTimestampExcluded ? (
        <p className="inline-note" role="note" data-testid="invalid-time-note">
          {page.invalidTimestampExcluded} record
          {page.invalidTimestampExcluded === 1 ? '' : 's'} matching the other filters were excluded
          because the effective last-observed timestamp is missing or invalid. Remove the time range
          to see them.
        </p>
      ) : null}

      {totalItems === 0 ? (
        <div className="state-container panel-card" data-testid="no-results-state" role="status">
          {observedRecords === 0 ? (
            <>
              <h2 className="state-title">No Events observed yet</h2>
              <p className="state-description">
                The selected clusters have not reported any Events since observation started.
                Kubernetes keeps Events for a limited time, so a quiet cluster can look empty.
              </p>
            </>
          ) : (
            <>
              <h2 className="state-title">No matching Events</h2>
              <p className="state-description">
                No observed Event record matches the active filters. {NOT_SUPPLIED} values are never
                replaced with invented ones, so broadening the filters may help.
              </p>
              <button
                type="button"
                className="sim-btn sim-btn-primary"
                onClick={handleClearAll}
                data-testid="clear-all-btn"
              >
                Clear all filters
              </button>
            </>
          )}
        </div>
      ) : (
        <EventTable
          events={items}
          selectedEventId={selectedEventId}
          sortConfig={query.sort}
          onSelectEvent={onSelectEvent}
          onSortChange={handleSortChange}
        />
      )}

      {totalItems > 0 && (
        <div className="table-footer">
          <span>
            Page {currentPage} of {totalPages} · {totalItems} Event records total
          </span>
          <div className="pagination-controls">
            <button
              type="button"
              className="page-btn"
              disabled={currentPage <= 1}
              onClick={() => onPageChange(1)}
              aria-label="Go to first page"
            >
              &laquo;
            </button>
            <button
              type="button"
              className="page-btn"
              disabled={currentPage <= 1}
              onClick={() => onPageChange(currentPage - 1)}
              aria-label="Go to previous page"
            >
              &lsaquo;
            </button>
            <span style={{ padding: '0 0.5rem' }}>{currentPage}</span>
            <button
              type="button"
              className="page-btn"
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange(currentPage + 1)}
              aria-label="Go to next page"
            >
              &rsaquo;
            </button>
            <button
              type="button"
              className="page-btn"
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange(totalPages)}
              aria-label="Go to last page"
            >
              &raquo;
            </button>
          </div>
        </div>
      )}

      {hasFilters && totalItems > 0 && (
        <p className="inline-note">
          Filters and sort order are shared by the Overview, Explorer and Analytics sections.
        </p>
      )}
    </div>
  );
};
