// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React, { useState } from 'react';
import type { EventFilters, TimeRangePreset } from '@k8s-events/domain';
import type { AvailableFilterOptions } from '@k8s-events/domain';
import {
  parseCustomTimeBound,
  parseUtcDateTimeLocal,
  utcTimestampToDateTimeLocal,
} from '@k8s-events/domain';

interface FilterPanelProps {
  filters: EventFilters;
  onFiltersChange: (filters: EventFilters) => void;
  onClearAll: () => void;
  availableOptions: AvailableFilterOptions;
  keywordInputRef?: React.RefObject<HTMLInputElement | null>;
  /** Server time used to prefill a custom range; never the browser clock. */
  anchorTime?: string | null;
}

function buildChips(filters: EventFilters): { key: string; label: string }[] {
  const chips: { key: string; label: string }[] = [];

  if (filters.searchKeyword.trim()) {
    chips.push({ key: 'keyword', label: `Search: ${filters.searchKeyword.trim()}` });
  }
  if (filters.timeRange.preset !== 'all') {
    const presetLabels: Record<string, string> = {
      '15m': 'Last 15 min',
      '1h': 'Last 1 hour',
      '6h': 'Last 6 hours',
      '24h': 'Last 24 hours',
      custom: 'Custom range',
    };
    chips.push({ key: 'timeRange', label: presetLabels[filters.timeRange.preset] ?? filters.timeRange.preset });
  }
  for (const ns of filters.namespaces) {
    chips.push({ key: `ns:${ns}`, label: `NS: ${ns}` });
  }
  for (const type of filters.types) {
    chips.push({ key: `type:${type}`, label: `Type: ${type}` });
  }
  for (const reason of filters.reasons) {
    chips.push({ key: `reason:${reason}`, label: `Reason: ${reason}` });
  }
  if (filters.resourceKind) {
    chips.push({ key: 'resourceKind', label: `Kind: ${filters.resourceKind}` });
  }
  if (filters.resourceName.trim()) {
    chips.push({ key: 'resourceName', label: `Name: ${filters.resourceName.trim()}` });
  }
  if (filters.reporter) {
    chips.push({ key: 'reporter', label: `Reporter: ${filters.reporter}` });
  }
  return chips;
}

function removeChip(chip: { key: string; label: string }, filters: EventFilters): EventFilters {
  if (chip.key === 'keyword') {
    return { ...filters, searchKeyword: '' };
  }
  if (chip.key === 'timeRange') {
    return { ...filters, timeRange: { preset: 'all', customStart: null, customEnd: null } };
  }
  if (chip.key.startsWith('ns:')) {
    const ns = chip.key.slice(3);
    return { ...filters, namespaces: filters.namespaces.filter((n) => n !== ns) };
  }
  if (chip.key.startsWith('type:')) {
    const t = chip.key.slice(5) as 'Normal' | 'Warning';
    return { ...filters, types: filters.types.filter((x) => x !== t) };
  }
  if (chip.key.startsWith('reason:')) {
    const r = chip.key.slice(7);
    return { ...filters, reasons: filters.reasons.filter((x) => x !== r) };
  }
  if (chip.key === 'resourceKind') {
    return { ...filters, resourceKind: null };
  }
  if (chip.key === 'resourceName') {
    return { ...filters, resourceName: '' };
  }
  if (chip.key === 'reporter') {
    return { ...filters, reporter: null };
  }
  return filters;
}

const TIME_RANGE_OPTIONS: { value: TimeRangePreset; label: string }[] = [
  { value: 'all', label: 'All available' },
  { value: '15m', label: 'Last 15 min' },
  { value: '1h', label: 'Last 1 hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: 'custom', label: 'Custom range' },
];

export const FilterPanel: React.FC<FilterPanelProps> = ({
  filters,
  onFiltersChange,
  onClearAll,
  availableOptions,
  keywordInputRef,
  anchorTime,
}) => {
  const [expanded, setExpanded] = useState(false);

  const chips = buildChips(filters);
  const hasActiveFilters =
    chips.length > 0;
  const customStartTime = filters.timeRange.customStart
    ? parseCustomTimeBound(filters.timeRange.customStart)
    : null;
  const customEndTime = filters.timeRange.customEnd
    ? parseCustomTimeBound(filters.timeRange.customEnd)
    : null;
  const invalidCustomRange = (filters.timeRange.customStart != null && customStartTime === null) ||
    (filters.timeRange.customEnd != null && customEndTime === null) ||
    (customStartTime !== null && customEndTime !== null && customStartTime > customEndTime);

  function handleKeywordChange(e: React.ChangeEvent<HTMLInputElement>) {
    onFiltersChange({ ...filters, searchKeyword: e.target.value });
  }

  function handleTimeRangeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const preset = e.target.value as TimeRangePreset;
    if (preset === 'custom') {
      // Prefill from the server clock so the range is complete before the first
      // request, instead of sending a half-entered range the server rejects.
      const anchor = anchorTime ? parseCustomTimeBound(anchorTime) : null;
      const end = anchor === null ? null : new Date(anchor).toISOString();
      const start = anchor === null ? null : new Date(anchor - 60 * 60_000).toISOString();
      onFiltersChange({
        ...filters,
        timeRange: { preset, customStart: start, customEnd: end },
      });
      return;
    }
    onFiltersChange({
      ...filters,
      timeRange: { preset, customStart: null, customEnd: null },
    });
  }

  function handleCustomStartChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    const timestamp = value ? parseUtcDateTimeLocal(value) : null;
    onFiltersChange({
      ...filters,
      timeRange: {
        ...filters.timeRange,
        customStart: timestamp === null ? value || null : new Date(timestamp).toISOString(),
      },
    });
  }

  function handleCustomEndChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    const timestamp = value ? parseUtcDateTimeLocal(value) : null;
    onFiltersChange({
      ...filters,
      timeRange: {
        ...filters.timeRange,
        customEnd: timestamp === null ? value || null : new Date(timestamp).toISOString(),
      },
    });
  }

  function toggleNamespace(ns: string) {
    const current = filters.namespaces;
    const updated = current.includes(ns) ? current.filter((n) => n !== ns) : [...current, ns];
    onFiltersChange({ ...filters, namespaces: updated });
  }

  function toggleType(type: 'Normal' | 'Warning') {
    const current = filters.types;
    const updated = current.includes(type) ? current.filter((t) => t !== type) : [...current, type];
    onFiltersChange({ ...filters, types: updated });
  }

  function toggleReason(reason: string) {
    const current = filters.reasons;
    const updated = current.includes(reason)
      ? current.filter((r) => r !== reason)
      : [...current, reason];
    onFiltersChange({ ...filters, reasons: updated });
  }

  function handleResourceKindChange(e: React.ChangeEvent<HTMLSelectElement>) {
    onFiltersChange({ ...filters, resourceKind: e.target.value || null });
  }

  function handleResourceNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    onFiltersChange({ ...filters, resourceName: e.target.value });
  }

  function handleReporterChange(e: React.ChangeEvent<HTMLSelectElement>) {
    onFiltersChange({ ...filters, reporter: e.target.value || null });
  }

  function handleRemoveChip(chip: { key: string; label: string }) {
    onFiltersChange(removeChip(chip, filters));
  }

  return (
    <div className="filter-toolbar" role="group" aria-label="Event filters">
      {/* Primary row */}
      <div className="toolbar-row">
        <input
          ref={keywordInputRef}
          type="search"
          className="search-input"
          placeholder="Search reason, message, object, namespace, reporter..."
          value={filters.searchKeyword}
          onChange={handleKeywordChange}
          data-testid="keyword-search"
          aria-label="Keyword search"
        />

        <div className="filter-control-group">
          <label className="filter-label" htmlFor="time-range-select">
            Time range
          </label>
          <select
            id="time-range-select"
            className="filter-select"
            value={filters.timeRange.preset}
            onChange={handleTimeRangeChange}
          >
            {TIME_RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Namespace multi-select (dropdown style checkboxes) */}
        {availableOptions.namespaces.length > 0 && (
          <div className="filter-control-group">
            <span className="filter-label">Namespace</span>
            <div
              style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', maxWidth: '280px' }}
              role="group"
              aria-label="Namespace filter"
            >
              {availableOptions.namespaces.map((ns) => (
                <label
                  key={ns}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    fontSize: '0.8125rem',
                    cursor: 'pointer',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={filters.namespaces.includes(ns)}
                    onChange={() => toggleNamespace(ns)}
                    aria-label={`Namespace: ${ns}`}
                  />
                  {ns}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Type checkboxes */}
        <div className="filter-control-group" role="group" aria-label="Event type filter">
          <span className="filter-label">Type</span>
          <label
            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8125rem', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={filters.types.includes('Normal')}
              onChange={() => toggleType('Normal')}
              aria-label="Filter Normal events"
              data-testid="type-filter-normal"
            />
            <span style={{ color: 'var(--color-normal)' }}>Normal</span>
          </label>
          <label
            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8125rem', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={filters.types.includes('Warning')}
              onChange={() => toggleType('Warning')}
              aria-label="Filter Warning events"
              data-testid="type-filter-warning"
            />
            <span style={{ color: 'var(--color-warning)' }}>Warning</span>
          </label>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            className="sim-btn"
            onClick={onClearAll}
            aria-label="Clear all filters"
            data-testid="clear-filters-btn"
          >
            Clear filters
          </button>
        )}

        <button
          type="button"
          className="sim-btn"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls="secondary-filters"
        >
          {expanded ? 'Fewer filters' : 'More filters'}
        </button>
      </div>

      {/* Custom time range inputs */}
      {filters.timeRange.preset === 'custom' && (
        <div className="toolbar-row" role="group" aria-label="Custom time range">
          <div className="filter-control-group">
            <label className="filter-label" htmlFor="custom-start">
              From (UTC)
            </label>
            <input
              id="custom-start"
              type="datetime-local"
              step="0.001"
              className="filter-select"
              value={filters.timeRange.customStart ? utcTimestampToDateTimeLocal(filters.timeRange.customStart) : ''}
              onChange={handleCustomStartChange}
            />
          </div>
          <div className="filter-control-group">
            <label className="filter-label" htmlFor="custom-end">
              To (UTC)
            </label>
            <input
              id="custom-end"
              type="datetime-local"
              step="0.001"
              className="filter-select"
              value={filters.timeRange.customEnd ? utcTimestampToDateTimeLocal(filters.timeRange.customEnd) : ''}
              onChange={handleCustomEndChange}
            />
          </div>
          <p role={invalidCustomRange ? 'alert' : 'note'} className="state-description">
            {invalidCustomRange
              ? 'Invalid time range. Enter valid UTC values and ensure the start is not after the end.'
              : 'Enter UTC date and time values. The range includes both endpoints.'}
          </p>
        </div>
      )}

      {/* Secondary filters (collapsible) */}
      {expanded && (
        <div
          id="secondary-filters"
          className="toolbar-row"
          role="group"
          aria-label="Additional filters"
        >
          {/* Reason multi-select */}
          {availableOptions.reasons.length > 0 && (
            <div className="filter-control-group" role="group" aria-label="Reason filter">
              <span className="filter-label">Reason</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', maxWidth: '320px' }}>
                {availableOptions.reasons.map((reason) => (
                  <label
                    key={reason}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      fontSize: '0.8125rem',
                      cursor: 'pointer',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={filters.reasons.includes(reason)}
                      onChange={() => toggleReason(reason)}
                      aria-label={`Reason: ${reason}`}
                    />
                    {reason}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Resource kind */}
          {availableOptions.resourceKinds.length > 0 && (
            <div className="filter-control-group">
              <label className="filter-label" htmlFor="resource-kind-select">
                Kind
              </label>
              <select
                id="resource-kind-select"
                className="filter-select"
                value={filters.resourceKind ?? ''}
                onChange={handleResourceKindChange}
              >
                <option value="">All</option>
                {availableOptions.resourceKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Resource name */}
          <div className="filter-control-group">
            <label className="filter-label" htmlFor="resource-name-input">
              Object name
            </label>
            <input
              id="resource-name-input"
              type="text"
              className="filter-select"
              placeholder="Substring match..."
              value={filters.resourceName}
              onChange={handleResourceNameChange}
            />
          </div>

          {/* Reporter */}
          {availableOptions.reporters.length > 0 && (
            <div className="filter-control-group">
              <label className="filter-label" htmlFor="reporter-select">
                Reporter
              </label>
              <select
                id="reporter-select"
                className="filter-select"
                value={filters.reporter ?? ''}
                onChange={handleReporterChange}
              >
                <option value="">All</option>
                {availableOptions.reporters.map((reporter) => (
                  <option key={reporter} value={reporter}>
                    {reporter}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div className="filter-chips-container" aria-label="Active filters" role="list">
          {chips.map((chip) => (
            <div key={chip.key} className="filter-chip" role="listitem">
              <span>{chip.label}</span>
              <button
                type="button"
                className="chip-remove-btn"
                onClick={() => handleRemoveChip(chip)}
                aria-label={`Remove filter: ${chip.label}`}
              >
                <span aria-hidden="true">x</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
