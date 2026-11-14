// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { PAGE_SIZE } from './constants';
import type { PaginatedResult } from './types';

/**
 * Paginates an array of items with a fixed page size and clamped page index.
 */
export function paginateEvents<T>(
  items: T[],
  page = 1,
  pageSize = PAGE_SIZE
): PaginatedResult<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);

  const startIndex = (clampedPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const pageItems = items.slice(startIndex, endIndex);

  return {
    items: pageItems,
    totalItems,
    totalPages,
    currentPage: clampedPage,
    pageSize,
  };
}
