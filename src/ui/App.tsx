// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { EventStore } from '../store/eventStore';
import type { Simulator, SimulatorState } from '../store/simulator';
import { DEFAULT_FILTERS, DEFAULT_SIMULATOR_SPEED, DEFAULT_SORT } from '../domain/constants';
import type { EventFilters, SortConfig, NormalisedEvent, ScenarioId } from '../domain/types';
import { Header } from './Header';
import { SimulatedBanner } from './SimulatedBanner';
import { OverviewPanel } from './Overview/OverviewPanel';
import { ExplorerPanel } from './Explorer/ExplorerPanel';
import { AnalyticsPanel } from './Analytics/AnalyticsPanel';
import { DetailPanel } from './DetailPanel/DetailPanel';
import { EmptyDatasetState } from './states/EmptyDatasetState';
import { LoadingState } from './states/LoadingState';
import { filterEvents } from '../domain/filters';

export const App: React.FC = () => {
  const store = useMemo(() => new EventStore(), []);
  const simulatorRef = useRef<Simulator | null>(null);

  const [activeTab, setActiveTab] = useState<'overview' | 'explorer' | 'analytics'>('overview');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [filters, setFilters] = useState<EventFilters>(DEFAULT_FILTERS);
  const [sortConfig, setSortConfig] = useState<SortConfig>(DEFAULT_SORT);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const [storeEvents, setStoreEvents] = useState<readonly NormalisedEvent[]>(() => store.getEvents());
  const [scenarioClock, setScenarioClock] = useState<string | null>(() => store.getScenarioClock());
  const [simState, setSimState] = useState<SimulatorState>({
    status: 'idle',
    activeScenarioId: 'normal-rollout',
    speed: DEFAULT_SIMULATOR_SPEED,
    currentStepIndex: 0,
    totalSteps: 0,
    scenarioName: 'Normal rollout',
    scenarioDescription: '',
  });
  const [availableScenarios, setAvailableScenarios] = useState<readonly {
    id: ScenarioId;
    name: string;
    description: string;
  }[]>([]);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const explorerTabRef = useRef<HTMLButtonElement | null>(null);
  const explorerPrimaryRef = useRef<HTMLInputElement | null>(null);
  const focusExplorerAfterChart = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeStore: (() => void) | null = null;
    let unsubscribeSimulator: (() => void) | null = null;
    let activeSimulator: Simulator | null = null;

    void import('../store/simulator').then(({ Simulator: SimulatorClass }) => {
      if (cancelled) return;
      activeSimulator = new SimulatorClass(store, 'normal-rollout');
      simulatorRef.current = activeSimulator;
      unsubscribeStore = store.subscribe(() => {
        setStoreEvents(store.getEvents());
        setScenarioClock(store.getScenarioClock());
      });
      unsubscribeSimulator = activeSimulator.subscribe(setSimState);
      setAvailableScenarios(activeSimulator.getAvailableScenarios());
      setStoreEvents(store.getEvents());
      setScenarioClock(store.getScenarioClock());
      setIsLoading(false);
    }).catch(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
      unsubscribeStore?.();
      unsubscribeSimulator?.();
      activeSimulator?.destroy();
      simulatorRef.current = null;
    };
  }, [store]);

  useEffect(() => {
    if (activeTab === 'explorer' && focusExplorerAfterChart.current) {
      explorerPrimaryRef.current?.focus();
      focusExplorerAfterChart.current = false;
    }
  }, [activeTab]);

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return storeEvents.find((e) => e.id === selectedEventId) ?? null;
  }, [selectedEventId, storeEvents]);

  const filteredEvents = useMemo(
    () => filterEvents([...storeEvents], filters, scenarioClock),
    [storeEvents, filters, scenarioClock]
  );

  const handleApplyAnalyticsFilter = useCallback((partial: Partial<EventFilters>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
    setCurrentPage(1);
    focusExplorerAfterChart.current = true;
    setActiveTab('explorer');
  }, []);

  const handleSelectRecentWarning = useCallback((id: string, origin: HTMLElement) => {
    detailTriggerRef.current = origin;
    setSelectedEventId(id);
  }, []);

  const handleExplorerSelect = useCallback((id: string, origin: HTMLElement) => {
    detailTriggerRef.current = origin;
    setSelectedEventId(id);
  }, []);

  const handleScenarioSelect = useCallback((id: ScenarioId) => {
    simulatorRef.current?.selectScenario(id);
    setSelectedEventId(null);
    setCurrentPage(1);
  }, []);

  const handleReset = useCallback(() => {
    simulatorRef.current?.reset();
    setSelectedEventId(null);
    setCurrentPage(1);
  }, []);

  return (
    <div className="app-container" data-testid="app-container">
      {!isLoading && (
        <Header
          explorerTabRef={explorerTabRef}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          simulatorStatus={simState.status}
          scenarioName={simState.scenarioName}
          activeScenarioId={simState.activeScenarioId}
          speed={simState.speed}
          currentStepIndex={simState.currentStepIndex}
          totalSteps={simState.totalSteps}
          availableScenarios={availableScenarios}
          onPlay={() => simulatorRef.current?.play()}
          onPause={() => simulatorRef.current?.pause()}
          onReset={handleReset}
          onSelectScenario={handleScenarioSelect}
          onSetSpeed={(s) => simulatorRef.current?.setSpeed(s)}
        />
      )}

      <SimulatedBanner />

      <main className="main-content" role="main">
        {isLoading ? (
          <LoadingState />
        ) : storeEvents.length === 0 ? (
          <EmptyDatasetState onReset={handleReset} />
        ) : (
          <>
            {activeTab === 'overview' && (
              <OverviewPanel
                events={filteredEvents}
                onSelectEvent={handleSelectRecentWarning}
                onApplyFilter={handleApplyAnalyticsFilter}
              />
            )}

            {activeTab === 'explorer' && (
              <ExplorerPanel
                allEvents={storeEvents}
                filteredEvents={filteredEvents}
                filters={filters}
                onFiltersChange={setFilters}
                sortConfig={sortConfig}
                onSortChange={setSortConfig}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                selectedEventId={selectedEventId}
                onSelectEvent={handleExplorerSelect}
                keywordInputRef={explorerPrimaryRef}
              />
            )}

            {activeTab === 'analytics' && (
              <AnalyticsPanel
                events={filteredEvents}
                onApplyFilter={handleApplyAnalyticsFilter}
              />
            )}
          </>
        )}
      </main>

      {/* Detail slide-over panel */}
      {selectedEvent && (
        <DetailPanel
          event={selectedEvent}
          onClose={() => setSelectedEventId(null)}
          triggerRef={detailTriggerRef}
          fallbackRef={activeTab === 'explorer' ? explorerPrimaryRef : explorerTabRef}
        />
      )}
    </div>
  );
};
