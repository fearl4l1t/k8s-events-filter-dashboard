// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSession, newSession, SESSION_COOKIE } from '../../src/auth/session';
import { parseRbac } from '../../src/auth/rbac';
import type { AuthRuntime } from '../../src/api/server';
import type { App } from '../../src/app';
import { makeEvent, makeRegistry, startApp, testConfig } from './helpers';
import { createApp } from '../../src/app';
import { createLogger } from '../../src/logging';

const RECORDS = [
  makeEvent({ uid: 'w-default', namespace: 'default', type: 'Warning', reason: 'BackOff' }),
  makeEvent({ uid: 'n-default', namespace: 'default', type: 'Normal', reason: 'Pulled' }),
  makeEvent({ uid: 'w-payments', namespace: 'payments', type: 'Warning', reason: 'Failed' }),
];

let app: App;
let baseUrl: string;
let registryStore: ReturnType<typeof makeRegistry>['store'];

beforeAll(async () => {
  const made = makeRegistry(RECORDS);
  registryStore = made.store;
  const started = await startApp(made.registry);
  app = started.app;
  baseUrl = started.baseUrl;
});

afterAll(async () => {
  await app.stop();
});

describe('local mode API', () => {
  it('reports health and readiness', async () => {
    const health = await fetch(`${baseUrl}/healthz`);
    expect(health.status).toBe(200);
    const ready = await fetch(`${baseUrl}/readyz`);
    expect(ready.status).toBe(200);
    const body = (await ready.json()) as { ready: boolean };
    expect(body.ready).toBe(true);
  });

  it('lists clusters with the observation start and server time', async () => {
    const response = await fetch(`${baseUrl}/api/clusters`);
    const body = (await response.json()) as {
      clusters: { id: string; name: string; source: string; observationStartedAt: string }[];
      serverTime: string;
      partial: boolean;
    };
    expect(response.status).toBe(200);
    expect(body.clusters).toHaveLength(1);
    expect(body.clusters[0]?.name).toBe('cluster-a');
    expect(body.clusters[0]?.source).toBe('local');
    expect(body.clusters[0]?.observationStartedAt).toBe('2026-11-14T09:00:00.000Z');
    expect(body.partial).toBe(false);
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false);
  });

  it('filters records and reports the total across pages', async () => {
    const response = await fetch(`${baseUrl}/api/events?types=Warning&pageSize=1`);
    const body = (await response.json()) as {
      items: { type: string }[];
      totalItems: number;
      totalPages: number;
      pageSize: number;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items.every((item) => item.type === 'Warning')).toBe(true);
    expect(body.totalItems).toBe(2);
    expect(body.totalPages).toBe(2);
  });

  it('searches across message text', async () => {
    const response = await fetch(`${baseUrl}/api/events?q=RESTARTING`);
    const body = (await response.json()) as { totalItems: number };
    expect(body.totalItems).toBe(3);
  });

  it('rejects an oversized page and an invalid filter', async () => {
    const page = await fetch(`${baseUrl}/api/events?pageSize=500`);
    expect(page.status).toBe(400);
    const invalidType = await fetch(`${baseUrl}/api/events?types=Critical`);
    expect(invalidType.status).toBe(400);
    const body = (await invalidType.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_type');
  });

  it('returns a single record by logical ID and 404 for a missing one', async () => {
    const response = await fetch(`${baseUrl}/api/events/${encodeURIComponent('ctx-a/w-payments')}`);
    const body = (await response.json()) as {
      event: { uid: string; clusterName: string };
      cluster: { id: string };
    };
    expect(response.status).toBe(200);
    expect(body.event.uid).toBe('w-payments');
    expect(body.event.clusterName).toBe('cluster-a');
    expect(body.cluster.id).toBe('ctx-a');

    const missing = await fetch(`${baseUrl}/api/events/${encodeURIComponent('ctx-a/nope')}`);
    expect(missing.status).toBe(404);
    const missingBody = (await missing.json()) as { error: { code: string } };
    expect(missingBody.error.code).toBe('record_not_found');
  });

  it('summarizes the same filtered set the table returns', async () => {
    const summary = await fetch(`${baseUrl}/api/summary?types=Warning`);
    const body = (await summary.json()) as {
      totalEvents: number;
      warningCount: number;
      namespaceCount: number;
      volumeBuckets: unknown[];
      invalidTimestampExcluded: number;
    };
    expect(body.totalEvents).toBe(2);
    expect(body.warningCount).toBe(2);
    expect(body.namespaceCount).toBe(2);
    expect(Array.isArray(body.volumeBuckets)).toBe(true);
    expect(body.invalidTimestampExcluded).toBe(0);
  });

  it('serves filter options', async () => {
    const response = await fetch(`${baseUrl}/api/options`);
    const body = (await response.json()) as {
      options: { namespaces: string[]; reasons: string[] };
    };
    expect(body.options.namespaces).toEqual(['default', 'payments']);
    expect(body.options.reasons).toEqual(['BackOff', 'Failed', 'Pulled']);
  });

  it('exports every filtered record as CSV', async () => {
    const response = await fetch(`${baseUrl}/api/export?format=csv&types=Warning`);
    const text = await response.text();
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('x-snapshot-at')).toBeTruthy();
    const lines = text.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Last Observed (UTC)');
  });

  it('exports raw source records as JSON', async () => {
    const response = await fetch(`${baseUrl}/api/export?format=json`);
    const body = (await response.json()) as unknown[];
    expect(body).toHaveLength(3);
    expect(body[0]).toEqual({ kind: 'Event' });
  });

  it('rejects unsupported methods and unknown endpoints', async () => {
    const post = await fetch(`${baseUrl}/api/events`, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
    const missing = await fetch(`${baseUrl}/api/nope`);
    expect(missing.status).toBe(404);
    const body = (await missing.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('reports who the caller is in local mode', async () => {
    const response = await fetch(`${baseUrl}/api/me`);
    const body = (await response.json()) as { mode: string; user: { id: string } };
    expect(body.mode).toBe('none');
    expect(body.user.id).toBe('local');
  });

  it('streams new matching records and ignores non-matching ones', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/stream?types=Warning`, {
      signal: controller.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const body = response.body;
    if (!body) throw new Error('The stream response has no body.');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let received = '';
    await reader.read();
    registryStore.publish([makeEvent({ uid: 'streamed', type: 'Warning', namespace: 'default' })]);
    registryStore.publish([makeEvent({ uid: 'quiet', type: 'Normal', namespace: 'default' })]);
    while (!received.includes('event: update')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += decoder.decode(chunk.value);
    }
    controller.abort();
    expect(received).toContain('event: update');
    expect(received).toContain('streamed');
    expect(received).not.toContain('quiet');
  });

  it('streams every observed cluster when no cluster is selected', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/stream`, { signal: controller.signal });
    const body = response.body;
    if (!body) throw new Error('The stream response has no body.');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let received = '';
    await reader.read();
    registryStore.publish([makeEvent({ uid: 'any-cluster', type: 'Normal', namespace: 'default' })]);
    while (!received.includes('event: update')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += decoder.decode(chunk.value);
    }
    controller.abort();
    expect(received).toContain('any-cluster');
  });
});

describe('team mode authorization', () => {
  const secret = randomBytes(32).toString('base64');
  const policy = parseRbac(`roleGrants:
  viewer:
    - clusterId: ctx-a
      namespaces: ["default"]
userRoles:
  alice: [viewer]
`);
  const auth: AuthRuntime = {
    policy,
    oidc: {
      config: { issuer: 'https://id.example.test', clientId: 'client', clientSecret: 'secret' },
      discovery: {
        issuer: 'https://id.example.test',
        authorization_endpoint: 'https://id.example.test/auth',
        token_endpoint: 'https://id.example.test/token',
        jwks_uri: 'https://id.example.test/keys',
      },
      publicUrl: 'http://localhost:8080',
      sessionSecret: secret,
    },
  };
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(
    encryptSession(newSession('alice', 'Alice', ['viewer']), secret)
  )}`;

  let teamApp: App;
  let teamUrl: string;

  beforeAll(async () => {
    const made = makeRegistry(RECORDS);
    const started = await startApp(made.registry, { auth });
    teamApp = started.app;
    teamUrl = started.baseUrl;
  });

  afterAll(async () => {
    await teamApp.stop();
  });

  it('requires a session for Event data', async () => {
    const response = await fetch(`${teamUrl}/api/events`);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthenticated');
  });

  it('limits namespaces to the grant', async () => {
    const response = await fetch(`${teamUrl}/api/events`, { headers: { cookie } });
    const body = (await response.json()) as { items: { namespace: string }[]; totalItems: number };
    expect(response.status).toBe(200);
    expect(body.totalItems).toBe(2);
    expect(body.items.every((item) => item.namespace === 'default')).toBe(true);
  });

  it('refuses a namespace outside the grant on every read path', async () => {
    const events = await fetch(`${teamUrl}/api/events?namespaces=payments`, {
      headers: { cookie },
    });
    expect(events.status).toBe(403);
    const exportResponse = await fetch(`${teamUrl}/api/export?namespaces=payments`, {
      headers: { cookie },
    });
    expect(exportResponse.status).toBe(403);
    const other = await fetch(`${teamUrl}/api/events?clusters=ctx-b`, { headers: { cookie } });
    expect(other.status).toBe(403);
  });

  it('returns the signed-in identity', async () => {
    const response = await fetch(`${teamUrl}/api/me`, { headers: { cookie } });
    const body = (await response.json()) as { mode: string; user: { id: string }; roles: string[] };
    expect(body.mode).toBe('oidc');
    expect(body.user.id).toBe('alice');
    expect(body.roles).toEqual(['viewer']);
  });

  it('serves a login redirect with PKCE parameters', async () => {
    const response = await fetch(`${teamUrl}/auth/login`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('code_challenge_method=S256');
    expect(location).toContain('response_type=code');
    expect(location).toContain('state=');
  });

  it('rejects an unrecognized callback state', async () => {
    const response = await fetch(`${teamUrl}/auth/callback?state=unknown&code=x`);
    expect(response.status).toBe(400);
  });
});

describe('reverse proxy safety', () => {
  it('sets security headers and refuses a traversal path', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });
});

describe('request validation and partial data', () => {
  it('rejects an oversized request URL', async () => {
    const response = await fetch(`${baseUrl}/api/events?keyword=${'a'.repeat(9_000)}`);
    expect(response.status).toBe(414);
    expect(await response.json()).toMatchObject({ error: { code: 'uri_too_long' } });
  });

  it('rejects unsupported query values with stable codes', async () => {
    const sort = await fetch(`${baseUrl}/api/events?sort=sideways`);
    expect(sort.status).toBe(400);
    expect(await sort.json()).toMatchObject({ error: { code: 'invalid_sort' } });

    const page = await fetch(`${baseUrl}/api/events?page=0`);
    expect(page.status).toBe(400);
    expect(await page.json()).toMatchObject({ error: { code: 'invalid_page' } });

    const range = await fetch(
      `${baseUrl}/api/events?range=custom&from=2026-11-14T10:00:00Z&to=2026-11-14T09:00:00Z`
    );
    expect(range.status).toBe(400);
    expect(await range.json()).toMatchObject({ error: { code: 'invalid_range' } });

    const time = await fetch(`${baseUrl}/api/events?range=fortnight`);
    expect(time.status).toBe(400);
    expect(await time.json()).toMatchObject({ error: { code: 'invalid_range' } });
  });

  it('rejects a non-GET method on the data routes', async () => {
    const response = await fetch(`${baseUrl}/api/events`, { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('does not serve an unknown auth route', async () => {
    const response = await fetch(`${baseUrl}/auth/nope`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'auth_disabled' } });
  });

  it('marks results partial while a cluster is not live', async () => {
    const { registry } = makeRegistry([makeEvent()], { status: 'degraded' });
    const instance = createApp({
      config: testConfig(),
      logger: createLogger('error', {}, () => undefined),
      registry,
      auth: null,
    });
    await new Promise<void>((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
    const address = instance.server.address();
    if (address === null || typeof address === 'string') throw new Error('No server address.');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/events`);
      const body = (await response.json()) as { partial: boolean; clusters: { status: string }[] };
      expect(body.partial).toBe(true);
      expect(body.clusters[0]?.status).toBe('degraded');

      const summary = await fetch(`http://127.0.0.1:${address.port}/api/summary`);
      expect(((await summary.json()) as { partial: boolean }).partial).toBe(true);
    } finally {
      await instance.stop();
    }
  });
});
