// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { test, expect } from '@playwright/test';

/**
 * E2E-11: a selected cluster that cannot be reached must be named as such, the
 * partial-coverage notice must show, and totals must not be presented as a
 * complete view.
 */
test.describe('E2E-11 unreachable cluster', () => {
  test('the cluster, its status and the partial notice are visible', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('cluster-status-unreachable')).toContainText('unreachable');
    await expect(page.getByTestId('observation-cluster')).toContainText('unreachable');
    await expect(page.getByTestId('observation-partial')).toBeVisible();
    await expect(page.getByTestId('observation-partial')).toContainText(
      'Totals describe what was observed so far'
    );

    const clusters = await page.request.get('/api/clusters');
    expect(clusters.status()).toBe(200);
    const body = (await clusters.json()) as {
      partial: boolean;
      clusters: { status: string; observationStartedAt: string | null }[];
    };
    expect(body.partial).toBe(true);
    expect(body.clusters[0]?.status).toBe('unreachable');
    expect(body.clusters[0]?.observationStartedAt).toBeNull();

    const ready = await page.request.get('/readyz');
    expect(ready.status()).toBe(503);
  });
});
