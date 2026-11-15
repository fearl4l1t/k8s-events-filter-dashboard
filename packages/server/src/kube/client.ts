// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest, type AgentOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { ConnectionSpec } from './kubeconfig';

export class KubeApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'KubeApiError';
  }

  get authFailure(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

export type KubeListResult = {
  items: unknown[];
  resourceVersion: string | null;
};

export type WatchMessage = {
  type: 'ADDED' | 'MODIFIED' | 'DELETED' | 'BOOKMARK' | 'ERROR';
  object: unknown;
};

const LIST_LIMIT = 500;
const REQUEST_TIMEOUT_MS = 30_000;

function readBody(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    response.on('error', reject);
  });
}

/**
 * Read-only Kubernetes API client for Events.
 *
 * Only GET requests are issued. There is no code path that sends a write verb.
 */
export class KubeClient {
  private readonly agentOptions: AgentOptions;
  private readonly httpsAgent: HttpsAgent;
  private cachedToken: { value: string | null; expiresAt: number } | null = null;

  constructor(
    private readonly connection: ConnectionSpec,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS
  ) {
    this.agentOptions = {
      keepAlive: true,
      ca: connection.ca ?? undefined,
      cert: connection.clientCertificate ?? undefined,
      key: connection.clientKey ?? undefined,
      // TLS verification is mandatory. The kubeconfig loader rejects insecure configs.
      rejectUnauthorized: true,
    };
    this.httpsAgent = new HttpsAgent(this.agentOptions);
  }

  private async token(): Promise<string | null> {
    if (this.connection.credentialProvider) {
      if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) return this.cachedToken.value;
      const { token } = await this.connection.credentialProvider();
      this.cachedToken = { value: token, expiresAt: Date.now() + 60_000 };
      return token;
    }
    return this.connection.token;
  }

  private async open(
    path: string,
    query: Record<string, string>,
    signal?: AbortSignal
  ): Promise<IncomingMessage> {
    const url = new URL(path, this.connection.server);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const token = await this.token();
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': 'k8s-events-explorer/0.2.0',
    };
    if (token) headers['authorization'] = `Bearer ${token}`;

    const isHttps = url.protocol === 'https:';
    const send = isHttps ? httpsRequest : httpRequest;
    const requestOptions = {
      method: 'GET',
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers,
      signal,
      ...(isHttps ? { agent: this.httpsAgent } : {}),
    };

    return new Promise<IncomingMessage>((resolve, reject) => {
      const req = send(requestOptions, resolve);
      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new KubeApiError(0, 'The Kubernetes API did not respond in time.'));
      });
      req.on('error', (error) => {
        if (error instanceof KubeApiError) reject(error);
        else reject(new KubeApiError(0, 'The Kubernetes API is unreachable.'));
      });
      req.end();
    });
  }

  private async getJson(path: string, query: Record<string, string>): Promise<unknown> {
    const response = await this.open(path, query);
    const status = response.statusCode ?? 0;
    const body = await readBody(response);
    if (status < 200 || status >= 300) {
      throw new KubeApiError(status, status === 403 ? 'Access to Events was denied.' : `The Kubernetes API returned status ${status}.`);
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new KubeApiError(status, 'The Kubernetes API returned unreadable JSON.');
    }
  }

  /**
   * Lists one page of Events. Without a namespace the request covers every
   * namespace the identity may read, which needs cluster-wide list permission.
   */
  async listEvents(continueToken?: string, namespace?: string): Promise<KubeListResult> {
    const query: Record<string, string> = { limit: String(LIST_LIMIT) };
    if (continueToken) query['continue'] = continueToken;
    const path = namespace
      ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/events`
      : '/api/v1/events';
    const body = (await this.getJson(path, query)) as {
      items?: unknown;
      metadata?: { resourceVersion?: unknown; continue?: unknown };
    };
    const items = Array.isArray(body.items) ? body.items : [];
    const resourceVersion =
      typeof body.metadata?.resourceVersion === 'string' ? body.metadata.resourceVersion : null;
    const next = typeof body.metadata?.continue === 'string' ? body.metadata.continue : null;
    if (next) {
      const rest = await this.listEvents(next, namespace);
      return { items: [...items, ...rest.items], resourceVersion: rest.resourceVersion ?? resourceVersion };
    }
    return { items, resourceVersion };
  }

  async getEvent(namespace: string, name: string): Promise<unknown> {
    return this.getJson(
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/events/${encodeURIComponent(name)}`,
      {}
    );
  }

  /**
   * Opens a watch stream and invokes `onMessage` for each record. Resolves when
   * the stream closes; the caller decides whether to re-list or reconnect.
   */
  async watchEvents(
    resourceVersion: string,
    onMessage: (message: WatchMessage) => void,
    signal: AbortSignal,
    namespace?: string
  ): Promise<void> {
    const response = await this.open(
      namespace ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/events` : '/api/v1/events',
      {
        watch: '1',
        allowWatchBookmarks: 'true',
        resourceVersion,
        timeoutSeconds: '300',
      },
      signal
    );
    const status = response.statusCode ?? 0;
    if (status === 410) {
      response.resume();
      throw new KubeApiError(410, 'The watch resource version expired.');
    }
    if (status < 200 || status >= 300) {
      response.resume();
      throw new KubeApiError(status, `The Kubernetes watch failed with status ${status}.`);
    }

    let buffer = '';
    for await (const chunk of response) {
      buffer += (chunk as Buffer).toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line) continue;
        let message: WatchMessage;
        try {
          message = JSON.parse(line) as WatchMessage;
        } catch {
          continue;
        }
        if (message.type === 'ERROR') {
          const code = (message.object as { code?: unknown } | null)?.code;
          if (code === 410) throw new KubeApiError(410, 'The watch resource version expired.');
          throw new KubeApiError(0, 'The Kubernetes watch reported an error.');
        }
        onMessage(message);
      }
    }
  }

  static describeError(error: unknown): { code: string; message: string } {
    if (error instanceof KubeApiError) {
      if (error.statusCode === 401) {
        return { code: 'cluster_auth_failed', message: 'The cluster rejected the credentials.' };
      }
      if (error.statusCode === 403) {
        return {
          code: 'cluster_forbidden',
          message: 'The credentials may not list Events in this cluster.',
        };
      }
      if (error.statusCode === 410) {
        return { code: 'watch_expired', message: 'The watch position expired; records are re-listed.' };
      }
      if (error.statusCode === 0) {
        return { code: 'cluster_unreachable', message: error.message };
      }
      return { code: 'cluster_error', message: error.message };
    }
    return { code: 'cluster_unreachable', message: 'The cluster could not be reached.' };
  }
}
