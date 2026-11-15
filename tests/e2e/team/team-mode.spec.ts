// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { test, expect, type Page } from '@playwright/test';

/**
 * E2E-11/E2E-12: team mode over a disposable Keycloak. Two identities have
 * grants on two different logical clusters, and the server must refuse every
 * route that asks for the other one.
 */

async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.getByTestId('sign-in-link').click();
  await page.waitForURL(/127\.0\.0\.1:8081\/realms\/events\/protocol\/openid-connect\/auth/);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  await page.waitForURL(`http://127.0.0.1:${process.env['EVENTS_TEAM_PORT'] ?? '8091'}/`);
  await expect(page.getByTestId('identity-note')).toContainText(new RegExp(username, 'i'));
}

async function signOut(page: Page): Promise<void> {
  await page.getByTestId('sign-out-link').click();
  await page.waitForURL(`http://127.0.0.1:${process.env['EVENTS_TEAM_PORT'] ?? '8091'}/`);
  await expect(page.getByTestId('sign-in-link')).toBeVisible();
}

test.describe('team mode sign-in', () => {
  test('an anonymous visitor is offered a sign-in action and no Event data', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('error-state')).toContainText('Sign in to read Events');
    await expect(page.getByTestId('sign-in-link')).toBeVisible();
    await expect(page.getByTestId('observation-cluster')).toContainText('No cluster selected');

    const events = await page.request.get('/api/events');
    expect(events.status()).toBe(401);
    const clusters = await page.request.get('/api/clusters');
    expect(clusters.status()).toBe(401);
  });

  test('Alice signs in and sees only her granted cluster', async ({ page }) => {
    await page.goto('/');
    await signIn(page, 'alice', 'alice-password');

    await expect(page.getByTestId('observation-cluster')).toContainText('kind-k8s-events');
    await expect(page.getByTestId('cluster-kind-k8s-events')).toBeVisible();
    await expect(page.getByTestId('cluster-kind-k8s-events-b')).toHaveCount(0);

    const me = await page.request.get('/api/me');
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ mode: 'oidc', authenticated: true });

    // The other cluster is not readable through any route.
    const events = await page.request.get('/api/events?clusters=kind-k8s-events-b');
    expect(events.status()).toBe(403);
    const exported = await page.request.get('/api/export?clusters=kind-k8s-events-b&format=csv');
    expect(exported.status()).toBe(403);

    await signOut(page);
    const after = await page.request.get('/api/events');
    expect(after.status()).toBe(401);
  });

  test('Bob sees his cluster and is refused the other namespaces and cluster', async ({ page }) => {
    await page.goto('/');
    await signIn(page, 'bob', 'bob-password');

    await expect(page.getByTestId('cluster-kind-k8s-events-b')).toBeVisible();
    await expect(page.getByTestId('cluster-kind-k8s-events')).toHaveCount(0);

    const clusters = await page.request.get('/api/clusters');
    const body = (await clusters.json()) as { clusters: { id: string }[] };
    expect(body.clusters.map((cluster) => cluster.id)).toEqual(['kind-k8s-events-b']);

    const own = await page.request.get(
      '/api/events?clusters=kind-k8s-events-b&namespaces=events-e2e-shop'
    );
    expect(own.status()).toBe(200);

    const otherNamespace = await page.request.get(
      '/api/events?clusters=kind-k8s-events-b&namespaces=events-e2e-platform'
    );
    expect(otherNamespace.status()).toBe(403);

    const otherCluster = await page.request.get('/api/events?clusters=kind-k8s-events');
    expect(otherCluster.status()).toBe(403);
    const stream = await page.request.get('/api/stream?clusters=kind-k8s-events');
    expect(stream.status()).toBe(403);

    await signOut(page);
  });
});
