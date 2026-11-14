// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SimulatedBanner } from '../../src/ui/SimulatedBanner';
import { LoadingState } from '../../src/ui/states/LoadingState';
import { EmptyDatasetState } from '../../src/ui/states/EmptyDatasetState';
import { Header } from '../../src/ui/Header';
import { DetailPanel } from '../../src/ui/DetailPanel/DetailPanel';
import { OverviewPanel } from '../../src/ui/Overview/OverviewPanel';
import { FilterPanel } from '../../src/ui/Explorer/FilterPanel';
import { EventTable } from '../../src/ui/Explorer/EventTable';
import { ExplorerPanel } from '../../src/ui/Explorer/ExplorerPanel';
import { AnalyticsPanel } from '../../src/ui/Analytics/AnalyticsPanel';
import { App } from '../../src/ui/App';
import { DEFAULT_FILTERS, DEFAULT_SORT } from '../../src/domain/constants';
import type { NormalisedEvent } from '../../src/domain/types';

const mockEvent: NormalisedEvent = {
  id: 'e1',
  apiVersion: 'events.k8s.io/v1',
  uid: 'uid-1',
  namespace: 'payments',
  type: 'Warning',
  reason: 'BackOff',
  message: 'Back-off pulling image auth:v1',
  action: 'Pulling',
  object: {
    apiVersion: 'v1',
    kind: 'Pod',
    name: 'auth-validator',
    namespace: 'payments',
    uid: 'pod-1',
  },
  reporter: 'k8s.io/kubelet',
  firstObservedAt: '2026-11-14T10:00:00.000Z',
  lastObservedAt: '2026-11-14T10:05:00.000Z',
  occurrenceCount: 5,
  occurrenceCountStatus: 'valid',
  createdAt: '2026-11-14T10:00:00.000Z',
  timestampSource: {
    first: 'eventTime',
    last: 'series',
  },
  timestampValid: true,
  validationIssues: [],
  rawEvent: { metadata: { name: 'raw-event' } },
};

// Mock ResizeObserver for Recharts
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
  configurable: true,
  value(this: HTMLDialogElement) {
    this.setAttribute('open', '');
    this.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  },
});
Object.defineProperty(HTMLDialogElement.prototype, 'close', {
  configurable: true,
  value(this: HTMLDialogElement, returnValue = '') {
    this.returnValue = returnValue;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  },
});

describe('UI Components', () => {
  afterEach(() => {
    cleanup();
  });
  it('renders SimulatedBanner with simulation label and message', () => {
    render(<SimulatedBanner />);
    expect(screen.getByTestId('simulated-data-banner')).toBeDefined();
    expect(screen.getByTestId('simulated-data-label')).toBeDefined();
    expect(screen.getByText(/Simulated environment/i)).toBeDefined();
  });

  it('renders LoadingState', () => {
    render(<LoadingState />);
    expect(screen.getByTestId('loading-state')).toBeDefined();
  });

  it('renders EmptyDatasetState and triggers reset', () => {
    const onReset = vi.fn();
    render(<EmptyDatasetState onReset={onReset} />);
    expect(screen.getByTestId('empty-dataset-state')).toBeDefined();
    fireEvent.click(screen.getByText('Reset Scenario'));
    expect(onReset).toHaveBeenCalled();
  });

  it('renders Header with controls and switches tabs', () => {
    const onTabChange = vi.fn();
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const onReset = vi.fn();
    const onSelectScenario = vi.fn();
    const onSetSpeed = vi.fn();

    render(
      <Header
        activeTab="overview"
        onTabChange={onTabChange}
        simulatorStatus="idle"
        scenarioName="Normal rollout"
        activeScenarioId="normal-rollout"
        speed={1}
        currentStepIndex={0}
        totalSteps={5}
        availableScenarios={[{ id: 'normal-rollout', name: 'Normal rollout', description: 'desc' }]}
        onPlay={onPlay}
        onPause={onPause}
        onReset={onReset}
        onSelectScenario={onSelectScenario}
        onSetSpeed={onSetSpeed}
      />
    );

    // Nav tabs
    fireEvent.click(screen.getByTestId('nav-tab-explorer'));
    expect(onTabChange).toHaveBeenCalledWith('explorer');

    // Play button
    fireEvent.click(screen.getByTestId('sim-play-pause-btn'));
    expect(onPlay).toHaveBeenCalled();

    // Reset button opens confirmation dialog
    fireEvent.click(screen.getByTestId('sim-reset-btn'));
    expect(screen.getByTestId('confirm-reset-btn')).toBeDefined();
    expect(screen.getByRole('dialog', { name: 'Reset Scenario' })).toBeDefined();
    expect(document.activeElement).toBe(screen.getByTestId('cancel-reset-btn'));
    fireEvent.click(screen.getByTestId('confirm-reset-btn'));
    expect(onReset).toHaveBeenCalled();
  });

  it('renders DetailPanel as a native modal and closes through its button', () => {
    const onClose = vi.fn();
    render(<DetailPanel event={mockEvent} onClose={onClose} />);

    expect(screen.getByTestId('detail-panel')).toBeDefined();
    expect(screen.getByText('Back-off pulling image auth:v1')).toBeDefined();
    expect(screen.getByTestId('occurrence-count-display')).toBeDefined();
    expect(screen.getByRole('dialog', { name: 'Event Detail' })).toBeDefined();
    expect(document.activeElement).toBe(screen.getByTestId('detail-close-btn'));

    // Close button
    fireEvent.click(screen.getByTestId('detail-close-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the explorer fallback when a detail row is no longer connected', async () => {
    const onClose = vi.fn();
    const detachedTrigger = document.createElement('button');
    const fallback = document.createElement('input');
    document.body.appendChild(fallback);
    render(
      <DetailPanel
        event={mockEvent}
        onClose={onClose}
        triggerRef={{ current: detachedTrigger }}
        fallbackRef={{ current: fallback }}
      />
    );

    fireEvent.click(screen.getByTestId('detail-close-btn'));
    await waitFor(() => expect(document.activeElement).toBe(fallback));
    expect(onClose).toHaveBeenCalled();
    fallback.remove();
  });

  it('renders OverviewPanel and lists recent warnings', () => {
    const onSelectEvent = vi.fn();
    const onApplyFilter = vi.fn();
    render(<OverviewPanel events={[mockEvent]} onSelectEvent={onSelectEvent} onApplyFilter={onApplyFilter} />);

    expect(screen.getByTestId('overview-panel')).toBeDefined();
    expect(screen.getByTestId('stat-total')).toBeDefined();
    expect(screen.getByTestId('stat-warnings')).toBeDefined();
    const warningBucketButton = screen.getAllByRole('button', { name: 'Filter to this interval and Warning' })[0];
    expect(warningBucketButton).toBeDefined();
    if (warningBucketButton) fireEvent.click(warningBucketButton);
    expect(onApplyFilter).toHaveBeenCalledWith(expect.objectContaining({ types: ['Warning'] }));
  });

  it('renders FilterPanel and triggers filter changes', () => {
    const onFiltersChange = vi.fn();
    render(
      <FilterPanel
        filters={DEFAULT_FILTERS}
        onFiltersChange={onFiltersChange}
        onClearAll={vi.fn()}
        availableOptions={{
          namespaces: ['default', 'payments'],
          reasons: ['BackOff', 'Scheduled'],
          resourceKinds: ['Pod'],
          reporters: ['k8s.io/kubelet'],
        }}
      />
    );

    // Keyword search
    const searchInput = screen.getByTestId('keyword-search');
    fireEvent.change(searchInput, { target: { value: 'payment' } });
    expect(onFiltersChange).toHaveBeenCalled();

    // Type filter
    const warnCheckbox = screen.getByTestId('type-filter-warning');
    fireEvent.click(warnCheckbox);
    expect(onFiltersChange).toHaveBeenCalled();
  });

  it('stores custom range input as UTC ISO timestamps', () => {
    const onFiltersChange = vi.fn();
    const props = {
      onFiltersChange,
      onClearAll: vi.fn(),
      availableOptions: { namespaces: [], reasons: [], resourceKinds: [], reporters: [] },
    };
    const { rerender } = render(<FilterPanel filters={DEFAULT_FILTERS} {...props} />);
    fireEvent.change(screen.getByLabelText('Time range'), { target: { value: 'custom' } });
    const customFilters = {
      ...DEFAULT_FILTERS,
      timeRange: { preset: 'custom' as const, customStart: null, customEnd: null },
    };
    rerender(<FilterPanel filters={customFilters} {...props} />);
    fireEvent.change(screen.getByLabelText('Custom range start'), { target: { value: '2026-11-14T10:30' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({
      timeRange: expect.objectContaining({ customStart: '2026-11-14T10:30:00.000Z' }),
    }));
  });

  it('renders EventTable and handles sorting and row selection', () => {
    const onSelectEvent = vi.fn();
    const onSortChange = vi.fn();

    render(
      <EventTable
        events={[mockEvent]}
        selectedEventId={null}
        sortConfig={DEFAULT_SORT}
        onSelectEvent={onSelectEvent}
        onSortChange={onSortChange}
      />
    );

    expect(screen.getByTestId('event-table')).toBeDefined();
    expect(screen.getByText('BackOff')).toBeDefined();

    // Click row
    fireEvent.click(screen.getByTestId('event-row'));
    expect(onSelectEvent).toHaveBeenCalledWith('e1', expect.any(HTMLElement));

    // Sort header
    fireEvent.click(screen.getByText('Namespace'));
    expect(onSortChange).toHaveBeenCalledWith('namespace');
  });

  it('renders AnalyticsPanel and switches metric units and applies filters', () => {
    const onApplyFilter = vi.fn();
    render(<AnalyticsPanel events={[mockEvent]} onApplyFilter={onApplyFilter} />);

    expect(screen.getByTestId('analytics-panel')).toBeDefined();
    expect(screen.getByText(/Event Records/i)).toBeDefined();

    // Toggle unit
    fireEvent.click(screen.getByRole('button', { name: /Recorded Occurrences/i }));
    expect(screen.getByRole('button', { name: /Recorded Occurrences/i }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('table', { name: 'Event volume by time interval data' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Filter Explorer to reason BackOff/i }));
    expect(onApplyFilter).toHaveBeenCalledWith({ reasons: ['BackOff'] });
    const normalBucketButton = screen.getAllByRole('button', { name: 'Filter to this interval and Normal' })[0];
    expect(normalBucketButton).toBeDefined();
    if (normalBucketButton) fireEvent.click(normalBucketButton);
    expect(onApplyFilter).toHaveBeenCalledWith(expect.objectContaining({ types: ['Normal'], timeRange: expect.objectContaining({ preset: 'custom' }) }));
  });

  it('loads local fixtures then navigates across tabs and controls', async () => {
    render(<App />);
    expect(screen.getByTestId('app-container')).toBeDefined();
    expect(screen.getByTestId('loading-state')).toBeDefined();
    // The simulator module imports the bundled scenario fixtures; give CI enough
    // time to finish that asynchronous initialization on slower workers.
    await waitFor(() => expect(screen.getByTestId('overview-panel')).toBeDefined(), { timeout: 10_000 });

    // Switch to Explorer
    fireEvent.click(screen.getByTestId('nav-tab-explorer'));
    expect(screen.getByTestId('explorer-panel')).toBeDefined();

    // Switch to Analytics
    fireEvent.click(screen.getByTestId('nav-tab-analytics'));
    expect(screen.getByTestId('analytics-panel')).toBeDefined();

    // Switch back to Overview
    fireEvent.click(screen.getByTestId('nav-tab-overview'));
    expect(screen.getByTestId('overview-panel')).toBeDefined();
  });

  it('renders ExplorerPanel and handles exports, sorting, and pagination', () => {
    const onFiltersChange = vi.fn();
    const onSortChange = vi.fn();
    const onPageChange = vi.fn();
    const onSelectEvent = vi.fn();

    // Mock downloadFile
    window.URL.createObjectURL = vi.fn(() => 'blob:mock');
    window.URL.revokeObjectURL = vi.fn();

    render(
      <ExplorerPanel
        allEvents={[mockEvent]}
        filteredEvents={[mockEvent]}
        filters={DEFAULT_FILTERS}
        onFiltersChange={onFiltersChange}
        sortConfig={DEFAULT_SORT}
        onSortChange={onSortChange}
        currentPage={1}
        onPageChange={onPageChange}
        selectedEventId={null}
        onSelectEvent={onSelectEvent}
      />
    );

    expect(screen.getByTestId('explorer-panel')).toBeDefined();
    expect(screen.getByTestId('result-count')).toBeDefined();

    // Click Export CSV and JSON
    fireEvent.click(screen.getByTestId('export-csv-btn'));
    fireEvent.click(screen.getByTestId('export-json-btn'));

    // Empty results state test
    cleanup();
    render(
      <ExplorerPanel
        allEvents={[]}
        filteredEvents={[]}
        filters={DEFAULT_FILTERS}
        onFiltersChange={onFiltersChange}
        sortConfig={DEFAULT_SORT}
        onSortChange={onSortChange}
        currentPage={1}
        onPageChange={onPageChange}
        selectedEventId={null}
        onSelectEvent={onSelectEvent}
      />
    );
    expect(screen.getByTestId('no-results-state')).toBeDefined();
    fireEvent.click(screen.getByTestId('clear-all-btn'));
    expect(onFiltersChange).toHaveBeenCalled();
  });

  it('interacts with secondary filters and chips in FilterPanel', () => {
    const onFiltersChange = vi.fn();
    const onClearAll = vi.fn();
    const activeFilters = {
      ...DEFAULT_FILTERS,
      namespaces: ['payments'],
      reasons: ['BackOff'],
      resourceKind: 'Pod',
      resourceName: 'auth',
      reporter: 'kubelet',
      searchKeyword: 'test',
    };

    render(
      <FilterPanel
        filters={activeFilters}
        onFiltersChange={onFiltersChange}
        onClearAll={onClearAll}
        availableOptions={{
          namespaces: ['default', 'payments'],
          reasons: ['BackOff', 'Scheduled'],
          resourceKinds: ['Pod'],
          reporters: ['kubelet'],
        }}
      />
    );

    // Expand secondary
    fireEvent.click(screen.getByText(/More filters/i));
    expect(screen.getByText(/Fewer filters/i)).toBeDefined();

    // Clear filters button
    fireEvent.click(screen.getByTestId('clear-filters-btn'));
    expect(onClearAll).toHaveBeenCalled();
  });
});
