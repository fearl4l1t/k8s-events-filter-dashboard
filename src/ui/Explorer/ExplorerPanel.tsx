// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React, { useMemo, useCallback } from 'react';
import type { EventFilters, SortConfig, SortField, NormalisedEvent } from '../../domain/types';
import { DEFAULT_FILTERS, DEFAULT_SORT } from '../../domain/constants';
import { extractFilterOptions } from '../../domain/filters';
import { sortEvents } from '../../domain/sort';
import { paginateEvents } from '../../domain/paginate';
import { exportEventsToCsv, exportEventsToJson, downloadFile } from '../../domain/export';
import { FilterPanel } from './FilterPanel';
import { EventTable } from './EventTable';

interface ExplorerPanelProps {
  allEvents: readonly NormalisedEvent[];
  filteredEvents: NormalisedEvent[];
  filters: EventFilters;
  onFiltersChange: (f: EventFilters) => void;
  sortConfig: SortConfig;
  onSortChange: (s: SortConfig) => void;
  currentPage: number;
  onPageChange: (p: number) => void;
  selectedEventId: string | null;
  onSelectEvent: (id: string, origin: HTMLElement) => void;
  keywordInputRef?: React.RefObject<HTMLInputElement | null>;
}

export const ExplorerPanel: React.FC<ExplorerPanelProps> = ({
  allEvents,
  filteredEvents,
  filters,
  onFiltersChange,
  sortConfig,
  onSortChange,
  currentPage,
  onPageChange,
  selectedEventId,
  onSelectEvent,
  keywordInputRef,
}) => {
  const availableOptions = useMemo(
    () => extractFilterOptions(allEvents as NormalisedEvent[]),
    [allEvents]
  );

  const sortedEvents = useMemo(
    () => sortEvents(filteredEvents, sortConfig),
    [filteredEvents, sortConfig]
  );

  const paginatedResult = useMemo(
    () => paginateEvents(sortedEvents, currentPage),
    [sortedEvents, currentPage]
  );

  const handleFiltersChange = useCallback(
    (newFilters: EventFilters) => {
      onFiltersChange(newFilters);
      onPageChange(1);
    },
    [onFiltersChange, onPageChange]
  );

  const handleClearAll = useCallback(() => {
    onFiltersChange(DEFAULT_FILTERS);
    onSortChange(DEFAULT_SORT);
    onPageChange(1);
  }, [onFiltersChange, onSortChange, onPageChange]);

  const handleSortChange = useCallback(
    (field: SortField) => {
      let newDirection: SortConfig['direction'] = 'asc';
      if (sortConfig.field === field) {
        newDirection = sortConfig.direction === 'asc' ? 'desc' : 'asc';
      } else if (field === 'lastObservedAt' || field === 'firstObservedAt') {
        newDirection = 'desc';
      }
      onSortChange({ field, direction: newDirection });
      onPageChange(1);
    },
    [sortConfig, onSortChange, onPageChange]
  );

  const handleExportCsv = useCallback(() => {
    const csvContent = exportEventsToCsv(sortedEvents);
    downloadFile(csvContent, 'k8s-events-filtered.csv', 'text/csv;charset=utf-8;');
  }, [sortedEvents]);

  const handleExportJson = useCallback(() => {
    const jsonContent = exportEventsToJson(sortedEvents);
    downloadFile(jsonContent, 'k8s-events-filtered.json', 'application/json;charset=utf-8;');
  }, [sortedEvents]);

  const startIdx = paginatedResult.totalItems === 0 ? 0 : (paginatedResult.currentPage - 1) * paginatedResult.pageSize + 1;
  const endIdx = Math.min(paginatedResult.currentPage * paginatedResult.pageSize, paginatedResult.totalItems);

  return (
    <div className="explorer-panel" data-testid="explorer-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <FilterPanel
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onClearAll={handleClearAll}
        availableOptions={availableOptions}
        keywordInputRef={keywordInputRef}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <span
          style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}
          data-testid="result-count"
          aria-live="polite"
        >
          {paginatedResult.totalItems === 0
            ? 'No events match the active filters'
            : `Showing ${startIdx}–${endIdx} of ${paginatedResult.totalItems} events`}
        </span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="sim-btn"
            onClick={handleExportCsv}
            data-testid="export-csv-btn"
            aria-label="Export filtered events as CSV"
          >
            Export CSV
          </button>
          <button
            type="button"
            className="sim-btn"
            onClick={handleExportJson}
            data-testid="export-json-btn"
            aria-label="Export filtered events as JSON"
          >
            Export JSON
          </button>
        </div>
      </div>

      {paginatedResult.totalItems === 0 ? (
        <div className="state-container panel-card" data-testid="no-results-state" role="status">
          <h3 className="state-title">No matching events</h3>
          <p className="state-description">
            No events match the currently applied filters. You can clear filters or broaden your search criteria.
          </p>
          <button
            type="button"
            className="sim-btn sim-btn-primary"
            onClick={handleClearAll}
            data-testid="clear-all-btn"
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <EventTable
          events={paginatedResult.items}
          selectedEventId={selectedEventId}
          sortConfig={sortConfig}
          onSelectEvent={onSelectEvent}
          onSortChange={handleSortChange}
        />
      )}

      {paginatedResult.totalItems > 0 && (
        <div className="table-footer">
          <span>
            Page {paginatedResult.currentPage} of {paginatedResult.totalPages} &bull; {paginatedResult.totalItems} events total
          </span>
          <div className="pagination-controls">
            <button
              type="button"
              className="page-btn"
              disabled={paginatedResult.currentPage <= 1}
              onClick={() => onPageChange(1)}
              aria-label="Go to first page"
            >
              &laquo;
            </button>
            <button
              type="button"
              className="page-btn"
              disabled={paginatedResult.currentPage <= 1}
              onClick={() => onPageChange(paginatedResult.currentPage - 1)}
              aria-label="Go to previous page"
            >
              &lsaquo;
            </button>
            <span style={{ padding: '0 0.5rem' }}>{paginatedResult.currentPage}</span>
            <button
              type="button"
              className="page-btn"
              disabled={paginatedResult.currentPage >= paginatedResult.totalPages}
              onClick={() => onPageChange(paginatedResult.currentPage + 1)}
              aria-label="Go to next page"
            >
              &rsaquo;
            </button>
            <button
              type="button"
              className="page-btn"
              disabled={paginatedResult.currentPage >= paginatedResult.totalPages}
              onClick={() => onPageChange(paginatedResult.totalPages)}
              aria-label="Go to last page"
            >
              &raquo;
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
