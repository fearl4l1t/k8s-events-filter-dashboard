// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect } from 'vitest';
import { paginateEvents } from '../../src/domain/paginate';

describe('paginateEvents', () => {
  const items = Array.from({ length: 125 }, (_, i) => `item-${i + 1}`);

  it('paginates 50 items per page by default', () => {
    const page1 = paginateEvents(items, 1);
    expect(page1.items.length).toBe(50);
    expect(page1.currentPage).toBe(1);
    expect(page1.totalPages).toBe(3);
    expect(page1.totalItems).toBe(125);
    expect(page1.items[0]).toBe('item-1');
    expect(page1.items[49]).toBe('item-50');

    const page2 = paginateEvents(items, 2);
    expect(page2.items.length).toBe(50);
    expect(page2.currentPage).toBe(2);
    expect(page2.items[0]).toBe('item-51');

    const page3 = paginateEvents(items, 3);
    expect(page3.items.length).toBe(25);
    expect(page3.currentPage).toBe(3);
    expect(page3.items[0]).toBe('item-101');
    expect(page3.items[24]).toBe('item-125');
  });

  it('clamps out-of-range page numbers', () => {
    const clampedLower = paginateEvents(items, 0);
    expect(clampedLower.currentPage).toBe(1);

    const clampedUpper = paginateEvents(items, 999);
    expect(clampedUpper.currentPage).toBe(3);
  });

  it('handles empty items array gracefully', () => {
    const empty = paginateEvents([], 1);
    expect(empty.items).toEqual([]);
    expect(empty.totalItems).toBe(0);
    expect(empty.totalPages).toBe(1);
    expect(empty.currentPage).toBe(1);
  });
});
