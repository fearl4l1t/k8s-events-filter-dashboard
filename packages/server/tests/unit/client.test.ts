// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { KubeApiError, KubeClient } from '../../src/kube/client';
import type { ConnectionSpec } from '../../src/kube/kubeconfig';

type Handler = (
  url: URL,
  response: import('node:http').ServerResponse,
  request: import('node:http').IncomingMessage
) => void;

let server: Server;
let port = 0;
let handler: Handler = () => undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    handler(new URL(req.url ?? '/', 'http://localhost'), res, req);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function client(token = 'test-token'): KubeClient {
  const connection: ConnectionSpec = {
    clusterId: 'ctx-a',
    clusterName: 'cluster-a',
    source: 'local',
    server: new URL(`http://127.0.0.1:${port}`),
    ca: null,
    clientCertificate: null,
    clientKey: null,
    token,
    credentialProvider: null,
  };
  return new KubeClient(connection, 5_000);
}

describe('KubeClient', () => {
  it('lists all pages and keeps the newest resource version', async () => {
    const seen: string[] = [];
    handler = (url, res) => {
      seen.push(url.search);
      const continued = url.searchParams.get('continue');
      if (!continued) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            items: [{ metadata: { uid: 'a' } }],
            metadata: { resourceVersion: '11', continue: 'next' },
          })
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          items: [{ metadata: { uid: 'b' } }],
          metadata: { resourceVersion: '12' },
        })
      );
    };
    const result = await client().listEvents();
    expect(result.items).toHaveLength(2);
    expect(result.resourceVersion).toBe('12');
    expect(seen[0]).toContain('limit=500');
  });

  it('sends the bearer token and requests a namespaced Event', async () => {
    let authorization = '';
    let path = '';
    handler = (url, res, request) => {
      authorization = String(request.headers.authorization ?? '');
      path = url.pathname;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    };
    const result = await client('secret-token').getEvent('default', 'web.1');
    expect(result).toEqual({ ok: true });
    expect(path).toBe('/api/v1/namespaces/default/events/web.1');
    expect(authorization).toBe('Bearer secret-token');
  });

  it('lists and watches one namespace when asked', async () => {
    const paths: string[] = [];
    handler = (url, res) => {
      paths.push(url.pathname);
      if (url.searchParams.get('watch') === '1') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"items":[],"metadata":{}}');
    };
    await client().listEvents(undefined, 'payments');
    await client().watchEvents('1', () => undefined, new AbortController().signal, 'payments');
    expect(paths).toEqual([
      '/api/v1/namespaces/payments/events',
      '/api/v1/namespaces/payments/events',
    ]);
  });

  it('uses a credential provider when no static token is present', async () => {
    let calls = 0;
    const connection: ConnectionSpec = {
      clusterId: 'ctx-a',
      clusterName: 'cluster-a',
      source: 'local',
      server: new URL(`http://127.0.0.1:${port}`),
      ca: null,
      clientCertificate: null,
      clientKey: null,
      token: null,
      credentialProvider: async () => {
        calls++;
        return { token: 'dynamic' };
      },
    };
    handler = (_url, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"items":[],"metadata":{}}');
    };
    const kube = new KubeClient(connection);
    await kube.listEvents();
    await kube.listEvents();
    expect(calls).toBe(1);
  });

  it('maps API failures to typed errors', async () => {
    handler = (_url, res) => {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end('{}');
    };
    const error = await client().listEvents().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KubeApiError);
    expect((error as KubeApiError).statusCode).toBe(403);
    expect((error as KubeApiError).authFailure).toBe(true);
    expect(KubeClient.describeError(error).code).toBe('cluster_forbidden');
  });

  it('describes each failure class', () => {
    expect(KubeClient.describeError(new KubeApiError(401, 'x')).code).toBe('cluster_auth_failed');
    expect(KubeClient.describeError(new KubeApiError(410, 'x')).code).toBe('watch_expired');
    expect(KubeClient.describeError(new KubeApiError(0, 'down')).code).toBe('cluster_unreachable');
    expect(KubeClient.describeError(new KubeApiError(500, 'boom')).code).toBe('cluster_error');
    expect(KubeClient.describeError(new Error('other')).code).toBe('cluster_unreachable');
  });

  it('rejects unreadable JSON and non-2xx responses', async () => {
    handler = (_url, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('not-json');
    };
    await expect(client().listEvents()).rejects.toThrow(/unreadable JSON/);
    handler = (_url, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{}');
    };
    await expect(client().listEvents()).rejects.toThrow(/status 500/);
  });

  it('reports an unreachable API', async () => {
    const connection: ConnectionSpec = {
      clusterId: 'ctx-a',
      clusterName: 'cluster-a',
      source: 'local',
      server: new URL('http://127.0.0.1:1'),
      ca: null,
      clientCertificate: null,
      clientKey: null,
      token: 'x',
      credentialProvider: null,
    };
    const error = await new KubeClient(connection, 500).listEvents().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KubeApiError);
    expect((error as KubeApiError).message).toMatch(/unreachable/);
  });

  it('reads watch messages line by line', async () => {
    const messages: string[] = [];
    handler = (_url, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write(`${JSON.stringify({ type: 'ADDED', object: { metadata: { uid: 'a' } } })}\n`);
      res.write('\n');
      res.write(`${JSON.stringify({ type: 'MODIFIED', object: { metadata: { uid: 'a' } } })}\n`);
      res.end();
    };
    await client().watchEvents('10', (message) => messages.push(message.type), new AbortController().signal);
    expect(messages).toEqual(['ADDED', 'MODIFIED']);
  });

  it('treats an expired watch as a resource version error', async () => {
    handler = (_url, res) => {
      res.writeHead(410);
      res.end();
    };
    const error = await client()
      .watchEvents('1', () => undefined, new AbortController().signal)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KubeApiError);
    expect((error as KubeApiError).statusCode).toBe(410);
  });

  it('rejects a watch that reports an error object', async () => {
    handler = (_url, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(`${JSON.stringify({ type: 'ERROR', object: { code: 410 } })}\n`);
    };
    await expect(
      client().watchEvents('1', () => undefined, new AbortController().signal)
    ).rejects.toThrow(/expired/);

    handler = (_url, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('garbage\n');
    };
    await client().watchEvents('1', () => undefined, new AbortController().signal);
  });

  it('rejects a watch that returns a non-2xx status', async () => {
    handler = (_url, res) => {
      res.writeHead(502);
      res.end();
    };
    await expect(
      client().watchEvents('1', () => undefined, new AbortController().signal)
    ).rejects.toThrow(/status 502/);
  });
});
