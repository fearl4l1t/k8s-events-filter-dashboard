// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import type { EventFilters, SortConfig } from './types';

export const PAGE_SIZE = 50;

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
