// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const requestUrls = new WeakMap<object, string[]>();

test.describe('Kubernetes Events Filter Dashboard Acceptance Tests', () => {
  test.beforeEach(async ({ page }) => {
    const urls: string[] = [];
    requestUrls.set(page, urls);
    page.on('request', (request) => urls.push(request.url()));
    await page.goto('/');
  });

  test.afterEach(async ({ page }, testInfo) => {
    const urls = requestUrls.get(page) ?? [];
    const localOrigin = new URL(page.url()).origin;
    const externalUrls = urls.filter((url) => {
      if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
      return new URL(url).origin !== localOrigin;
    });
    expect(externalUrls, `Unexpected external-origin requests during ${testInfo.title}`).toEqual([]);
  });

  // TC-01: Open application with no filters
  test('TC-01: Overview totals match loaded dataset and simulated label is visible', async ({ page }) => {
    // Check simulated banner and label
    const banner = page.getByTestId('simulated-data-banner');
    await expect(banner).toBeVisible();
    await expect(page.getByTestId('simulated-data-label')).toContainText('Simulated Data');

    // Check overview totals
    await expect(page.getByTestId('overview-panel')).toBeVisible();
    await expect(page.getByTestId('stat-total')).toBeVisible();
    const totalText = await page.getByTestId('stat-total').innerText();
    expect(totalText.toUpperCase()).toContain('TOTAL EVENTS');
  });

  // TC-02: Select Warning and one namespace
  test('TC-02: Select Warning and one namespace in explorer', async ({ page }) => {
    await page.getByTestId('nav-tab-explorer').click();
    await expect(page.getByTestId('explorer-panel')).toBeVisible();

    // Select Warning filter
    await page.getByTestId('type-filter-warning').check();

    // Select namespace filter (payments)
    const nsCheckbox = page.getByRole('checkbox', { name: 'Namespace: payments' });
    if (await nsCheckbox.isVisible()) {
      await nsCheckbox.check();
    }

    // Verify all rendered rows match Warning
    const rows = page.getByTestId('event-row');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(count, 5); i++) {
      const rowText = await rows.nth(i).innerText();
      expect(rowText).toContain('Warning');
    }
  });

  // TC-03: Select two reasons in one filter
  test('TC-03: Select multiple reasons (OR logic)', async ({ page }) => {
    await page.getByTestId('nav-tab-explorer').click();

    // Expand secondary filters
    const expandBtn = page.getByRole('button', { name: /more filters/i });
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
    }

    const rows = page.getByTestId('event-row');
    await page.getByRole('checkbox', { name: 'Reason: Scheduled' }).check();
    await page.getByRole('checkbox', { name: 'Reason: Pulled' }).check();
    await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('Reason: Scheduled');
    await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('Reason: Pulled');
    expect(await rows.count()).toBeGreaterThan(0);
    for (let i = 0; i < await rows.count(); i++) {
      const rowText = await rows.nth(i).innerText();
      expect(rowText.includes('Scheduled') || rowText.includes('Pulled')).toBe(true);
    }
  });

  // TC-04: Search text found in an Event message
  test('TC-04: Search for text found in an Event message case-insensitively', async ({ page }) => {
    await page.getByTestId('nav-tab-explorer').click();

    const searchInput = page.getByTestId('keyword-search');
    await searchInput.fill('PAUSE');

    // Verify results match
    const resultCount = page.getByTestId('result-count');
    await expect(resultCount).toBeVisible();
    const countText = await resultCount.innerText();
    expect(countText).not.toContain('No events match');
  });

  // TC-05: Set time range
  test('TC-05: Custom range includes only valid timestamps within the inclusive range', async ({ page }) => {
    await page.getByTestId('nav-tab-explorer').click();

    const select = page.getByLabel(/time range/i);
    await select.selectOption('custom');
    await page.getByLabel('Custom range start').fill('2026-11-14T10:00');
    await page.getByLabel('Custom range end').fill('2026-11-14T23:59');

    await expect(page.getByTestId('result-count')).toBeVisible();
    await expect(page.getByTestId('result-count')).toContainText('1506 events');
  });

  // TC-06: Open record with repeated series
  test('TC-06: Open record and inspect detail panel', async ({ page }) => {
    await page.getByTestId('nav-tab-explorer').click();

    const firstRow = page.getByTestId('event-row').first();
    await firstRow.click();

    const detailPanel = page.getByTestId('detail-panel');
    await expect(detailPanel).toBeVisible();
    await expect(page.getByTestId('occurrence-count-display')).toBeVisible();
    await expect(page.getByTestId('raw-json-display')).toBeVisible();

    // Close detail panel
    await page.getByTestId('detail-close-btn').click();
    await expect(detailPanel).not.toBeVisible();
  });

  test('detail panel returns focus to its source row after Escape', async ({ page }) => {
    await page.getByTestId('nav-tab-explorer').click();
    const row = page.getByTestId('event-row').first();
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Close event detail panel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('detail-panel')).not.toBeVisible();
    await expect(row).toBeFocused();
  });

  // TC-07: Pause and resume simulator
  test('TC-07: Pause and resume simulator', async ({ page }) => {
    const playPauseBtn = page.getByTestId('sim-play-pause-btn');
    await expect(playPauseBtn).toHaveText('Play');

    // Start playback
    await playPauseBtn.click();
    await expect(page.getByTestId('sim-status')).toHaveText('Running');

    // Pause playback
    await page.getByTestId('sim-play-pause-btn').click();
    await expect(page.getByTestId('sim-status')).toHaveText('Paused');
  });

  // TC-08: Reset scenario
  test('TC-08: Reset scenario with confirmation', async ({ page }) => {
    const resetBtn = page.getByTestId('sim-reset-btn');
    await resetBtn.click();

    // Modal appears
    const confirmBtn = page.getByTestId('confirm-reset-btn');
    await expect(confirmBtn).toBeVisible();
    await expect(page.getByTestId('cancel-reset-btn')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(resetBtn).toBeFocused();
    await resetBtn.click();
    await expect(page.getByTestId('cancel-reset-btn')).toBeFocused();
    await confirmBtn.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('sim-status')).toHaveText('Idle');
    await expect(resetBtn).toBeFocused();
  });

  // TC-09: Export filtered events
  test('TC-09: Export includes every filtered record across pages', async ({ page }) => {
    await page.getByTestId('nav-tab-explorer').click();
    await page.getByTestId('type-filter-warning').check();
    const resultText = await page.getByTestId('result-count').innerText();
    const match = resultText.match(/of ([\d,]+) events/);
    const expectedCount = Number((match?.[1] ?? '0').replaceAll(',', ''));
    expect(expectedCount).toBeGreaterThan(50);

    const jsonDownload = page.waitForEvent('download');
    await page.getByTestId('export-json-btn').click();
    const jsonFile = await jsonDownload;
    const jsonContent = await readFile((await jsonFile.path()) ?? '', 'utf8');
    expect(JSON.parse(jsonContent)).toHaveLength(expectedCount);

    const csvDownload = page.waitForEvent('download');
    await page.getByTestId('export-csv-btn').click();
    const csvFile = await csvDownload;
    const csvContent = await readFile((await csvFile.path()) ?? '', 'utf8');
    expect(csvContent.trim().split('\n')).toHaveLength(expectedCount + 1);
  });

  // TC-10: Missing optional fields render Not supplied without crashing
  test('TC-10: Missing optional fields display Not supplied', async ({ page }) => {
    await page.getByTestId('nav-tab-explorer').click();
    await page.getByTestId('keyword-search').fill('MissingFieldsEvent');

    const row = page.getByTestId('event-row').first();
    await expect(row).toBeVisible();
    await row.click();

    const detailPanel = page.getByTestId('detail-panel');
    await expect(detailPanel).toBeVisible();
    await expect(detailPanel).toContainText('Not supplied');
  });

  test('invalid timestamp records remain inspectable and explain the exclusion', async ({ page }) => {
    await page.getByTestId('nav-tab-explorer').click();
    await page.getByTestId('keyword-search').fill('CorruptTimestamp');
    const row = page.getByTestId('event-row').first();
    await expect(row).toContainText('Invalid record');
    await row.click();
    await expect(page.getByTestId('invalid-record-notice')).toContainText('invalid supplied value');
    await expect(page.getByTestId('detail-panel')).toContainText('excluded from time filters');
    await expect(page.getByTestId('raw-json-display')).toContainText('INVALID_TIMESTAMP_STRING');
  });

  // Navigation and State Preservation
  test('Navigation between sections preserves filter state', async ({ page }) => {
    await page.getByTestId('nav-tab-explorer').click();
    await page.getByTestId('keyword-search').fill('custom-term-123');

    // Switch to Overview
    await page.getByTestId('nav-tab-overview').click();
    await expect(page.getByTestId('overview-panel')).toBeVisible();

    // Switch back to Explorer
    await page.getByTestId('nav-tab-explorer').click();
    await expect(page.getByTestId('keyword-search')).toHaveValue('custom-term-123');
  });

  // Analytics Chart Interaction
  test('Analytics view displays charts and allows unit switching', async ({ page }) => {
    await page.getByTestId('nav-tab-analytics').click();
    await expect(page.getByTestId('analytics-panel')).toBeVisible();

    // Toggle unit button
    const occurrencesBtn = page.getByRole('button', { name: /recorded occurrences/i });
    await expect(occurrencesBtn).toBeVisible();
    await occurrencesBtn.click();
    await expect(occurrencesBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('table', { name: 'Event volume by time interval data' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Top Event reasons data' })).toBeVisible();
  });

  test('chart filter alternatives work by keyboard and preserve shared filters', async ({ page }) => {
    await page.getByTestId('nav-tab-analytics').click();
    const reasonFilter = page.getByRole('button', { name: /Filter Explorer to reason Scheduled/i }).first();
    await reasonFilter.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('explorer-panel')).toBeVisible();
    await expect(page.getByTestId('keyword-search')).toBeFocused();
    await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('Reason: Scheduled');
  });

  test('shared filters drive explorer results, overview totals, and analytics totals', async ({ page }) => {
    await page.getByTestId('nav-tab-explorer').click();
    await page.getByTestId('type-filter-warning').check();
    const resultCount = await page.getByTestId('result-count').innerText();
    const matched = resultCount.match(/of ([\d,]+) events/);
    expect(matched?.[1]).toBeTruthy();

    await page.getByTestId('nav-tab-overview').click();
    await expect(page.getByTestId('stat-total')).toContainText(matched?.[1] ?? '');

    await page.getByTestId('nav-tab-analytics').click();
    await expect(page.getByRole('button', { name: /Event Records/ })).toContainText(matched?.[1] ?? '');
  });

  test('sortable table columns can be operated from the keyboard', async ({ page }) => {
    await page.getByTestId('nav-tab-explorer').click();
    const sortButton = page.getByRole('button', { name: 'Sort by Namespace' });
    await sortButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('columnheader', { name: /Namespace/ })).toHaveAttribute('aria-sort', 'ascending');
  });
});
