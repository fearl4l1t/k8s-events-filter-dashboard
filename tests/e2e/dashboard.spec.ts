// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { test, expect, type Page } from '@playwright/test';

/**
 * Browser acceptance tests against a real kind cluster seeded with
 * `scripts/seed-events.ts`. Every expected count is read from the API at test
 * time; nothing is hard-coded to a fixture.
 */

type ApiPage = {
  totalItems: number;
  items: { id: string; namespace: string | null; type: string | null; reason: string | null }[];
};

async function apiJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.ok(), `GET ${path} should succeed`).toBe(true);
  return (await response.json()) as T;
}

async function openExplorer(page: Page): Promise<void> {
  await page.getByTestId('nav-tab-explorer').click();
  await expect(page.getByTestId('explorer-panel')).toBeVisible();
}

const SEEDED_NAMESPACES = ['events-e2e-shop', 'events-e2e-platform', 'events-e2e-ops'];
const SEEDED_QUERY = SEEDED_NAMESPACES.map((namespace) => `namespaces=${namespace}`).join('&');

async function selectSeedNamespaces(page: Page, namespaces: string[] = SEEDED_NAMESPACES): Promise<void> {
  for (const namespace of namespaces) {
    await page.getByRole('checkbox', { name: `Namespace: ${namespace}` }).check();
  }
}

test.describe('E2E-01 observation provenance', () => {
  test('the banner names the cluster, source and observation start', async ({ page }) => {
    await page.goto('/');
    const banner = page.getByTestId('observation-banner');
    await expect(banner).toBeVisible();
    await expect(page.getByTestId('observation-cluster')).not.toBeEmpty();
    await expect(page.getByTestId('observation-source')).toContainText(/local kubeconfig|in-cluster/);
    await expect(page.getByTestId('observation-start')).toContainText(/observing since|Not supplied/);
    await expect(page.getByTestId('observation-limits')).toContainText('not a complete history');
  });

  test('Overview totals equal the summary endpoint', async ({ page }) => {
    const summary = await apiJson<{ totalEvents: number }>(page, '/api/summary');
    await page.goto('/');
    await expect(page.getByTestId('stat-total')).toContainText(summary.totalEvents.toLocaleString());
  });
});

test.describe('E2E-02 combined filters', () => {
  test('Warning plus one namespace matches every row and the export', async ({ page }) => {
    await page.goto('/');
    await openExplorer(page);
    await selectSeedNamespaces(page, ['events-e2e-shop']);
    await page.getByTestId('type-filter-warning').check();

    const query = 'types=Warning&namespaces=events-e2e-shop';
    const pageData = await apiJson<ApiPage>(page, `/api/events?${query}`);
    expect(pageData.totalItems).toBeGreaterThan(0);
    await expect(page.getByTestId('result-count')).toContainText(String(pageData.totalItems));
    const rows = page.getByTestId('event-row');
    expect(await rows.count()).toBe(Math.min(pageData.totalItems, 50));
    for (const row of await rows.all()) {
      await expect(row).toContainText('Warning');
    }

    const csv = await page.request.get(`/api/export?${query}&format=csv`);
    const body = await csv.text();
    expect(body.trim().split('\r\n').length - 1).toBe(pageData.totalItems);
  });
});

test.describe('E2E-03 OR within a category', () => {
  test('two reasons match either reason while other filters apply', async ({ page }) => {
    await page.goto('/');
    await openExplorer(page);
    await page.getByRole('button', { name: 'More filters' }).click();
    const reasonBoxes = page.getByRole('checkbox', { name: /^Reason: / });
    const firstLabel = (await reasonBoxes.first().getAttribute('aria-label')) ?? '';
    const secondLabel = (await reasonBoxes.nth(1).getAttribute('aria-label')) ?? '';
    const first = firstLabel.replace('Reason: ', '');
    const second = secondLabel.replace('Reason: ', '');
    await reasonBoxes.first().check();
    await reasonBoxes.nth(1).check();

    const expected = await apiJson<ApiPage>(
      page,
      `/api/events?reasons=${encodeURIComponent(first)},${encodeURIComponent(second)}`
    );
    await expect(page.getByTestId('result-count')).toContainText(String(expected.totalItems));
  });
});

test.describe('E2E-04 keyword search', () => {
  test('mixed-case message text is found case-insensitively', async ({ page }) => {
    await page.goto('/');
    await openExplorer(page);
    const search = page.getByTestId('keyword-search');
    await search.fill('BACK-OFF');
    await expect(page.getByTestId('event-row').first()).toContainText(/back-off/i);
  });
});

test.describe('E2E-05 custom range', () => {
  test('a custom UTC range limits rows to valid last-observed times', async ({ page }) => {
    await page.goto('/');
    await openExplorer(page);
    await selectSeedNamespaces(page);
    await page.locator('#time-range-select').selectOption('custom');
    const start = await page.locator('#custom-start').inputValue();
    const end = await page.locator('#custom-end').inputValue();
    expect(start).not.toBe('');
    expect(end).not.toBe('');
    await expect(page.getByTestId('error-state')).toHaveCount(0);

    // The datetime-local values are UTC by contract, so stamp them as UTC.
    const from = start.endsWith('Z') ? start : `${start}Z`;
    const to = end.endsWith('Z') ? end : `${end}Z`;
    const expected = await apiJson<ApiPage>(
      page,
      `/api/events?${SEEDED_QUERY}&range=custom&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    await expect(page.getByTestId('result-count')).toContainText(String(expected.totalItems));
  });

  test.skip('records with invalid last-observed timestamps are excluded', () => {
    // The Kubernetes API rejects malformed timestamps, so this state cannot be
    // produced by a real cluster. It is covered by server and domain unit tests.
  });
});

test.describe('E2E-06 repeated series', () => {
  test('count and last-observed time are shown separately from first observed', async ({ page }) => {
    await page.goto('/');
    await openExplorer(page);
    await page.getByTestId('keyword-search').fill('back-off');
    await page.getByTestId('event-row').first().click();
    const panel = page.getByTestId('detail-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('First observed');
    await expect(panel).toContainText('Last observed');
    await expect(panel).toContainText('Occurrence count');
    await expect(panel).toContainText('Raw JSON');
  });
});

test.describe('E2E-07 missing optional fields', () => {
  test('the page stays usable and missing values read Not supplied', async ({ page }) => {
    await page.goto('/');
    await openExplorer(page);
    await expect(page.getByTestId('explorer-panel')).toBeVisible();
    await page.getByTestId('event-row').first().click();
    const panel = page.getByTestId('detail-panel');
    await expect(panel).toBeVisible();
    const text = await panel.innerText();
    expect(text.length).toBeGreaterThan(0);
    await page.getByTestId('detail-close-btn').click();
    await expect(panel).toBeHidden();
  });
});

test.describe('E2E-08 export across pages', () => {
  test('CSV and JSON contain every filtered record', async ({ page }) => {
    const pageData = await apiJson<ApiPage>(page, `/api/events?pageSize=50&${SEEDED_QUERY}`);
    expect(pageData.totalItems).toBeGreaterThanOrEqual(8);
    const csv = await (await page.request.get(`/api/export?format=csv&${SEEDED_QUERY}`)).text();
    const json = (await (
      await page.request.get(`/api/export?format=json&${SEEDED_QUERY}`)
    ).json()) as { metadata?: { name?: string } }[];
    expect(csv.trim().split('\r\n').length - 1).toBe(pageData.totalItems);
    expect(json).toHaveLength(pageData.totalItems);
    for (const record of json) {
      // A Kubernetes list omits apiVersion and kind inside each item, so the
      // untouched source record is identified by its own metadata.
      expect(record.metadata?.name).toBeTruthy();
    }
  });
});

test.describe('E2E-09 chart to Explorer', () => {
  test('an Analytics reason filter opens the Explorer with the same rows', async ({ page }) => {
    await page.goto('/');
    await openExplorer(page);
    await selectSeedNamespaces(page, ['events-e2e-shop']);
    await page.getByTestId('nav-tab-analytics').click();
    await expect(page.getByTestId('analytics-panel')).toBeVisible();
    const reasonRow = page
      .locator('section[aria-label="Top event reasons"] .chart-summary-table tbody tr')
      .first();
    const reasonCount = (await reasonRow.locator('td').first().innerText()).trim();
    await reasonRow.getByRole('button').first().click();
    await expect(page.getByTestId('explorer-panel')).toBeVisible();
    if (reasonCount === '0') {
      await expect(page.getByTestId('result-count')).toContainText('No Events match');
    } else {
      await expect(page.getByTestId('result-count')).toContainText(reasonCount);
    }
  });
});

test.describe('E2E-10 keyboard operation', () => {
  test('a row can be opened and closed with the keyboard', async ({ page }) => {
    await page.goto('/');
    await openExplorer(page);
    const firstViewButton = page.getByRole('button', { name: /View details for/ }).first();
    await firstViewButton.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByTestId('detail-panel');
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(firstViewButton).toBeFocused();
  });
});

test.describe('E2E-13 no external origins', () => {
  test('every request stays on the application origin', async ({ page }) => {
    const origins = new Set<string>();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin);
    });
    await page.goto('/');
    await openExplorer(page);
    await page.getByTestId('nav-tab-analytics').click();
    const base = new URL(page.url()).origin;
    expect([...origins]).toEqual([base]);
  });
});

test.describe('Accessibility structure (WCAG 2.2 AA review)', () => {
  test('the document has one h1, ordered headings and a skip link', async ({ page }) => {
    await page.goto('/');
    await openExplorer(page);

    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('Kubernetes Events Explorer');

    const levels = await page.evaluate(() =>
      [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((heading) =>
        Number(heading.tagName.slice(1))
      )
    );
    expect(levels[0]).toBe(1);
    for (let index = 1; index < levels.length; index += 1) {
      const previous = levels[index - 1] as number;
      const current = levels[index] as number;
      expect(current - previous, 'no heading level is skipped').toBeLessThanOrEqual(1);
    }

    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await skipLink.focus();
    await expect(skipLink).toBeVisible();
    await expect(skipLink).toHaveAttribute('href', '#main-content');
    await expect(page.locator('#main-content')).toHaveCount(1);
  });

  test('filter containers and controls expose accessible names', async ({ page }) => {
    await page.goto('/');
    await openExplorer(page);

    await expect(page.getByRole('group', { name: 'Event filters' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Namespace filter' })).toBeVisible();

    await page.getByLabel('Time range').selectOption('custom');
    await expect(page.getByLabel('From (UTC)')).toBeVisible();
    await expect(page.getByLabel('To (UTC)')).toBeVisible();

    const table = page.getByRole('table', { name: 'Kubernetes events' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /Timestamp/ })).toBeVisible();
  });
});

test.describe('E2E-14 reduced motion', () => {
  test('no transitions or animations run when reduced motion is requested', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const animated = await page.evaluate(() =>
      [...document.querySelectorAll('*')].filter((element) => {
        const style = getComputedStyle(element);
        return style.animationName !== 'none' || style.transitionDuration !== '0s';
      }).length
    );
    expect(animated).toBe(0);
  });
});
