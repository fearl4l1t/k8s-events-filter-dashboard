// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import type { EventFilters, SortConfig, SimulatorSpeed } from './types';

export const MAX_IN_MEMORY_EVENTS = 10_000;
export const PAGE_SIZE = 50;

export const DEFAULT_SIMULATOR_SPEED: SimulatorSpeed = 1;
export const AVAILABLE_SPEEDS: readonly SimulatorSpeed[] = [0.5, 1, 2, 4];

export const SIMULATED_DATA_LABEL = 'Simulated Data';
export const SIMULATED_DATA_BANNER =
  'Simulated environment: This dashboard reads synthetic fixtures and scripted local events only. It never connects to a live cluster.';

export const NOT_SUPPLIED = 'Not supplied';
export const INVALID_VALUE = 'Invalid value';

export const DEFAULT_FILTERS: EventFilters = {
  namespaces: [],
  types: [],
  reasons: [],
  resourceKind: null,
  resourceName: '',
  reporter: null,
  searchKeyword: '',
  timeRange: {
    preset: 'all',
    customStart: null,
    customEnd: null,
  },
};

export const DEFAULT_SORT: SortConfig = {
  field: 'lastObservedAt',
  direction: 'desc',
};
