// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NormalisedEvent } from '@k8s-events/domain';
import { DEFAULT_FILTERS, DEFAULT_SORT, PAGE_SIZE, parseCustomTimeBound } from '@k8s-events/domain';
import type { EventFilters, SortConfig } from '@k8s-events/domain';
import {
  api,
  ApiClientError,
  type ClusterSummary,
  type DashboardQuery,
  type EventsResponse,
  type IdentityResponse,
  type OptionsResponse,
  type SummaryResponse,
} from '../api/client';

/** Coalesces stream notifications so a burst of arrivals causes one re-query. */
const STREAM_REFRESH_MS = 750;

export type StreamState = 'connecting' | 'open' | 'closed';

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return 'The dashboard could not load data from its server.';
}

/**
 * A half-entered or reversed custom range is not a query for the server. The
 * filter panel flags it, and the previous result stays on screen untouched.
 */
export function hasUsableTimeRange(filters: EventFilters): boolean {
  if (filters.timeRange.preset !== 'custom') return true;
  const { customStart, customEnd } = filters.timeRange;
  if (!customStart || !customEnd) return false;
  const start = parseCustomTimeBound(customStart);
  const end = parseCustomTimeBound(customEnd);
  return start !== null && end !== null && start <= end;
}

export type Dashboard = {
  query: DashboardQuery;
  clusters: ClusterSummary[] | null;
  identity: IdentityResponse | null;
  options: OptionsResponse['options'] | null;
  page: EventsResponse | null;
  summary: SummaryResponse | null;
  serverTime: string | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  streamState: StreamState;
  selectedId: string | null;
  detail: NormalisedEvent | null;
  detailLoading: boolean;
  detailError: string | null;
  setFilters: (filters: EventFilters, resetPage?: boolean) => void;
  applyFilter: (partial: Partial<EventFilters>) => void;
  clearFilters: () => void;
  setSort: (sort: SortConfig) => void;
  setPage: (page: number) => void;
  setClusterIds: (ids: string[]) => void;
  toggleCluster: (id: string) => void;
  selectEvent: (id: string | null) => void;
  refresh: () => void;
};

export function useDashboard(): Dashboard {
  const [query, setQuery] = useState<DashboardQuery>(() => ({
    clusterIds: [],
    filters: DEFAULT_FILTERS,
    sort: DEFAULT_SORT,
    page: 1,
    pageSize: PAGE_SIZE,
  }));
  const [clusters, setClusters] = useState<ClusterSummary[] | null>(null);
  const [identity, setIdentity] = useState<IdentityResponse | null>(null);
  const [options, setOptions] = useState<OptionsResponse['options'] | null>(null);
  const [page, setPageData] = useState<EventsResponse | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [serverTime, setServerTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<StreamState>('connecting');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NormalisedEvent | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      setTick((value) => value + 1);
    }, STREAM_REFRESH_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  // Cluster list and identity are the observation provenance for every screen.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [clusterData, me] = await Promise.all([
          api.clusters(controller.signal),
          api.me(controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setClusters(clusterData.clusters);
        setServerTime(clusterData.serverTime);
        setIdentity(me);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(messageFor(caught));
        setErrorCode(caught instanceof ApiClientError ? caught.code : 'network_error');
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const clusterKey = query.clusterIds.join(',');

  // One page query and one summary query share the same parameters.
  useEffect(() => {
    const controller = new AbortController();
    if (!hasUsableTimeRange(query.filters)) {
      return () => controller.abort();
    }
    void (async () => {
      try {
        const [pageData, summaryData] = await Promise.all([
          api.events(query, controller.signal),
          api.summary(query, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setPageData(pageData);
        setSummary(summaryData);
        setServerTime(pageData.serverTime);
        setError(null);
        setErrorCode(null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(messageFor(caught));
        setErrorCode(caught instanceof ApiClientError ? caught.code : 'network_error');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
    // The stream tick re-queries with the identical parameters.
  }, [query, tick]);

  // Filter options come from the same stores the query reads.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const data = await api.options(query, controller.signal);
        if (!controller.signal.aborted) setOptions(data.options);
      } catch {
        // Options are presentational; a failure leaves the current lists intact.
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterKey, tick]);

  // The stream carries a signal only; every number is re-read through the API.
  useEffect(() => {
    const source = new EventSource(api.streamUrl({ ...query, page: 1 }));
    source.onopen = () => setStreamState('open');
    source.onerror = () => setStreamState('closed');
    const onSignal = () => scheduleRefresh();
    source.addEventListener('update', onSignal);
    source.addEventListener('summary-tick', onSignal);
    return () => {
      source.removeEventListener('update', onSignal);
      source.removeEventListener('summary-tick', onSignal);
      source.close();
    };
    // Re-open the stream when the cluster or filter selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterKey, JSON.stringify(query.filters), scheduleRefresh]);

  // The detail panel reads one record by ID from the same server store.
  useEffect(() => {
    if (selectedId === null) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const data = await api.event(selectedId, controller.signal);
        if (controller.signal.aborted) return;
        setDetail(data.event);
        setDetailError(null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setDetail(null);
        setDetailError(messageFor(caught));
      }
    })();
    return () => controller.abort();
  }, [selectedId]);

  const setFilters = useCallback((filters: EventFilters, resetPage = true) => {
    setQuery((current) => ({ ...current, filters, page: resetPage ? 1 : current.page }));
  }, []);

  const applyFilter = useCallback((partial: Partial<EventFilters>) => {
    setQuery((current) => {
      const merged: EventFilters = { ...current.filters, ...partial };
      // Types are OR within the category; a chart selection replaces the set.
      return { ...current, filters: merged, page: 1 };
    });
  }, []);

  const clearFilters = useCallback(() => {
    setQuery((current) => ({
      ...current,
      filters: DEFAULT_FILTERS,
      sort: DEFAULT_SORT,
      page: 1,
    }));
  }, []);

  const setSort = useCallback((sort: SortConfig) => {
    setQuery((current) => ({ ...current, sort, page: 1 }));
  }, []);

  const setPage = useCallback((nextPage: number) => {
    setQuery((current) => ({ ...current, page: Math.max(1, nextPage) }));
  }, []);

  const setClusterIds = useCallback((ids: string[]) => {
    setQuery((current) => ({ ...current, clusterIds: ids, page: 1 }));
  }, []);

  const toggleCluster = useCallback((id: string) => {
    setQuery((current) => {
      const has = current.clusterIds.includes(id);
      return {
        ...current,
        clusterIds: has
          ? current.clusterIds.filter((value) => value !== id)
          : [...current.clusterIds, id],
        page: 1,
      };
    });
  }, []);

  const selectEvent = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id === null) {
      setDetail(null);
      setDetailError(null);
    }
  }, []);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  // Derived rather than stored, so no effect writes state on entry.
  const detailLoading = selectedId !== null && detail === null && detailError === null;

  return useMemo(
    () => ({
      query,
      clusters,
      identity,
      options,
      page,
      summary,
      serverTime,
      loading,
      error,
      errorCode,
      streamState,
      selectedId,
      detail,
      detailLoading,
      detailError,
      setFilters,
      applyFilter,
      clearFilters,
      setSort,
      setPage,
      setClusterIds,
      toggleCluster,
      selectEvent,
      refresh,
    }),
    [
      query,
      clusters,
      identity,
      options,
      page,
      summary,
      serverTime,
      loading,
      error,
      errorCode,
      streamState,
      selectedId,
      detail,
      detailLoading,
      detailError,
      setFilters,
      applyFilter,
      clearFilters,
      setSort,
      setPage,
      setClusterIds,
      toggleCluster,
      selectEvent,
      refresh,
    ]
  );
}
