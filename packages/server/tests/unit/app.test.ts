// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, loadAuthRuntime, resolveConnections } from '../../src/app';
import type { App } from '../../src/app';
import { createLogger } from '../../src/logging';
import { makeEvent, makeRegistry, testConfig } from './helpers';
import {
  ApiError,
  requestPath,
  requestUrl,
  sendError,
  sendMethodNotAllowed,
  serveStatic,
} from '../../src/api/http';
import type { IncomingMessage, ServerResponse } from 'node:http';

const logger = createLogger('error', {}, () => undefined);

let staticDir = '';
let app: App;
let baseUrl = '';

beforeAll(async () => {
  staticDir = await mkdtemp(join(tmpdir(), 'events-static-'));
  await mkdir(join(staticDir, 'assets'), { recursive: true });
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>Events</title>');
  await writeFile(join(staticDir, 'assets', 'app.js'), 'console.log(1);');
  await writeFile(join(staticDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

  const { registry } = makeRegistry([makeEvent()]);
  app = createApp({
    config: testConfig(),
    logger,
    registry,
    auth: null,
    staticDir,
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('No server address.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.stop();
  await rm(staticDir, { recursive: true, force: true });
});

describe('static asset serving', () => {
  it('serves the built shell at the root', async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await response.text()).toContain('Events');
  });

  it('serves hashed assets with a long-lived cache policy', async () => {
    const response = await fetch(`${baseUrl}/assets/app.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('falls back to the shell for a deep link', async () => {
    const response = await fetch(`${baseUrl}/explorer/details`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Events');
  });

  it('answers HEAD requests without a body', async () => {
    const response = await fetch(`${baseUrl}/assets/app.js`, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('rejects a path that escapes the asset root', async () => {
    let status = 0;
    let body = '';
    const fake = {
      setHeader: () => undefined,
      writeHead(code: number) {
        status = code;
        return this;
      },
      end(payload?: string) {
        body = payload ?? '';
      },
    } as unknown as ServerResponse;
    const handled = await serveStatic(
      { method: 'GET' } as IncomingMessage,
      fake,
      staticDir,
      '/../../etc/passwd'
    );
    expect(handled).toBe(true);
    expect(status).toBe(400);
    expect(JSON.parse(body)).toMatchObject({ error: { code: 'invalid_path' } });
  });

  it('does not answer API paths with the shell', async () => {
    const response = await fetch(`${baseUrl}/api/unknown`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('rejects a non-GET method on a static path', async () => {
    const response = await fetch(`${baseUrl}/explorer`, { method: 'POST' });
    expect(response.status).toBe(404);
  });
});

describe('http helpers', () => {
  type FakeResponse = {
    status?: number;
    body?: string;
    headers: Record<string, string>;
    setHeader: (name: string, value: string) => void;
    writeHead: (status: number, headers: Record<string, string>) => FakeResponse;
    end: (payload?: string) => void;
  };

  function response(): FakeResponse {
    const res: FakeResponse = {
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      writeHead(status, headers) {
        this.status = status;
        Object.assign(this.headers, headers);
        return this;
      },
      end(payload) {
        this.body = payload;
      },
    };
    return res;
  }

  it('writes an error body and an allow header', () => {
    const res = response();
    sendMethodNotAllowed(res as unknown as ServerResponse, 'GET, HEAD');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET, HEAD');
    expect(JSON.parse(res.body ?? '{}')).toMatchObject({
      error: { code: 'method_not_allowed' },
    });
  });

  it('keeps errors typed and status-aware', () => {
    sendError(response() as unknown as ServerResponse, 403, 'forbidden', 'No access.');
    const error = new ApiError('forbidden', 'No access.', 403);
    expect(error.status).toBe(403);
    expect(error.name).toBe('ApiError');
  });

  it('parses request paths and tolerates a malformed URL', () => {
    expect(requestPath({ url: '/api/events?page=1' } as IncomingMessage)).toBe('/api/events');
    expect(requestPath({} as IncomingMessage)).toBe('/');
    expect(requestUrl({ url: '/api/events?page=2' } as IncomingMessage).searchParams.get('page')).toBe(
      '2'
    );
    expect(requestUrl({} as IncomingMessage).pathname).toBe('/');
  });
});

describe('application wiring', () => {
  it('resolves local connections from the kubeconfig file', () => {
    expect(() => resolveConnections(testConfig())).toThrow();
  });

  it('resolves the in-cluster connection', () => {
    const config = testConfig({ mode: 'in-cluster', cacheMaxPerCluster: 10 });
    expect(() => resolveConnections(config)).toThrow();
  });

  it('returns no auth runtime outside team mode', async () => {
    expect(await loadAuthRuntime(testConfig())).toBeNull();
  });

  it('loads a policy and discovery document for team mode', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'events-rbac-'));
    const rbacFile = join(directory, 'rbac.yaml');
    await writeFile(
      rbacFile,
      'roleGrants:\n  viewer:\n    - clusterId: "*"\n      namespaces: ["*"]\n'
    );
    try {
      const runtime = await loadAuthRuntime(
        testConfig({
          authMode: 'oidc',
          oidc: { issuer: 'https://id.example.test', clientId: 'events', clientSecret: 'secret' },
          publicUrl: 'https://events.example.test',
          rbacFile,
          sessionSecret: Buffer.alloc(32, 1).toString('base64'),
        }),
        async () =>
          new Response(
            JSON.stringify({
              issuer: 'https://id.example.test',
              authorization_endpoint: 'https://id.example.test/auth',
              token_endpoint: 'https://id.example.test/token',
              jwks_uri: 'https://id.example.test/keys',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
      );
      expect(runtime?.oidc.publicUrl).toBe('https://events.example.test');
      expect(runtime?.policy.roleGrants.viewer).toBeDefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('starts and stops the listening server', async () => {
    const { registry } = makeRegistry([]);
    const instance = createApp({ config: testConfig(), logger, registry, auth: null });
    await instance.start();
    await instance.stop();
  });
});
