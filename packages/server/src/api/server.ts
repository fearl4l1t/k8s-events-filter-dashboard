// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  CSV_HEADERS,
  eventToCsvRow,
  matchesFilters,
} from '@k8s-events/domain';
import type { EventQuery, QueryService } from '../query/queryService';
import { QueryError } from '../query/queryService';
import type { ClusterInfo, ClusterRegistry } from '../clusters/types';
import type { Logger } from '../logging';
import type { ServerConfig } from '../config';
import {
  applyScope,
  canReadCluster,
  ForbiddenError,
  grantsForRoles,
  readableNamespaces,
  type AuthorizationScope,
  type RbacPolicy,
} from '../auth/rbac';
import {
  decryptSession,
  newSession,
  parseCookies,
  SESSION_COOKIE,
  sessionCookie,
  serializeCookie,
} from '../auth/session';
import {
  buildAuthorizationUrl,
  createPkcePair,
  exchangeCode,
  fetchJwks,
  type FetchLike,
  type OidcDiscovery,
} from '../auth/oidc';
import { TokenError, verifyIdToken } from '../auth/jwt';
import { parseEventQuery } from './params';
import { ApiError, sendError, sendJson, sendMethodNotAllowed, serveStatic } from './http';

export const MAX_EXPORT_RECORDS = 1_000_000;
export const MAX_STREAMS_PER_USER = 50;
export const MAX_STREAMS_TOTAL = 500;
export const MAX_RETAINED_MESSAGES = 1_000;
const MAX_URL_LENGTH = 8_192;
const SUMMARY_TICK_MS = 5_000;
const SUMMARY_TICK_LIMIT = 300;

export type AuthRuntime = {
  policy: RbacPolicy;
  oidc: {
    config: NonNullable<ServerConfig['oidc']>;
    discovery: OidcDiscovery;
    publicUrl: string;
    sessionSecret: string;
  };
};

export type ApiDeps = {
  config: ServerConfig;
  logger: Logger;
  registry: ClusterRegistry;
  query: QueryService;
  auth: AuthRuntime | null;
  staticDir: string;
  now?: () => number;
  fetchImpl?: FetchLike;
};

type LoginState = { verifier: string; nonce: string; expiresAt: number };

export type ApiHandler = {
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  activeStreams: () => number;
};

function localScope(registry: ClusterRegistry): AuthorizationScope {
  return {
    userId: 'local',
    roles: ['local'],
    grants: registry.list().map((cluster) => ({ clusterId: cluster.info.id, namespaces: ['*'] })),
  };
}

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

/**
 * Builds the request handler. Every endpoint that returns Event data resolves
 * the caller's scope first, then calls the single query service.
 */
export function createApiHandler(deps: ApiDeps): ApiHandler {
  const now = deps.now ?? Date.now;
  const serverTime = () => new Date(now()).toISOString();
  const loginStates = new Map<string, LoginState>();
  const streamCounts = new Map<string, number>();
  let totalStreams = 0;

  function scopeForRequest(req: IncomingMessage): AuthorizationScope {
    if (!deps.auth) return localScope(deps.registry);
    const cookies = parseCookies(req.headers.cookie);
    const value = cookies[SESSION_COOKIE];
    if (!value) throw new ApiError('unauthenticated', 'Sign in to read Events.', 401);
    const session = decryptSession(value, deps.auth.oidc.sessionSecret);
    if (!session) throw new ApiError('unauthenticated', 'Sign in to read Events.', 401);
    return {
      userId: session.sub,
      roles: session.roles,
      grants: grantsForRoles(deps.auth.policy, session.roles),
    };
  }

  function visibleClusters(scope: AuthorizationScope): ClusterInfo[] {
    return deps.registry
      .list()
      .map((cluster) => cluster.info)
      .filter((info) => canReadCluster(scope, info.id));
  }

  function parseQuery(url: URL): EventQuery {
    return parseEventQuery(url.searchParams);
  }

  async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    path: string
  ): Promise<void> {
    if (req.method !== 'GET') {
      sendMethodNotAllowed(res, 'GET');
      return;
    }
    if (path === '/api/clusters') {
      const scope = scopeForRequest(req);
      const clusters = visibleClusters(scope);
      sendJson(res, 200, {
        clusters,
        serverTime: serverTime(),
        partial: clusters.some((cluster) => cluster.status !== 'live'),
      });
      return;
    }

    if (path === '/api/me') {
      if (!deps.auth) {
        sendJson(res, 200, {
          mode: 'none',
          authenticated: true,
          user: { id: 'local', name: 'Local operator' },
          roles: ['local'],
          grants: localScope(deps.registry).grants,
        });
        return;
      }
      const scope = scopeForRequest(req);
      const cookies = parseCookies(req.headers.cookie);
      const session = decryptSession(cookies[SESSION_COOKIE] ?? '', deps.auth.oidc.sessionSecret);
      sendJson(res, 200, {
        mode: 'oidc',
        authenticated: true,
        user: { id: scope.userId, name: session?.name ?? null },
        roles: scope.roles,
        grants: scope.grants,
      });
      return;
    }

    const scope = scopeForRequest(req);

    if (path === '/api/events') {
      const query = applyScope(parseQuery(url), scope);
      const result = deps.query.queryEvents(query);
      sendJson(res, 200, result);
      return;
    }

    if (path.startsWith('/api/events/')) {
      const raw = decodeURIComponent(path.slice('/api/events/'.length));
      if (!raw) throw new ApiError('invalid_record_id', 'A record ID is required.');
      const record = deps.query.find(raw);
      if (!record) throw new ApiError('record_not_found', 'That record is no longer available.', 404);
      const clusterId = record.clusterId;
      if (!canReadCluster(scope, clusterId)) throw new ForbiddenError();
      const allowed = readableNamespaces(scope, clusterId);
      if (allowed !== 'all' && (!record.namespace || !allowed?.includes(record.namespace))) {
        throw new ForbiddenError();
      }
      const cluster = deps.registry.get(clusterId)?.info ?? null;
      sendJson(res, 200, { event: record, cluster, serverTime: serverTime() });
      return;
    }

    if (path === '/api/options') {
      const query = applyScope(parseQuery(url), scope);
      sendJson(res, 200, { options: deps.query.options(query.clusterIds), serverTime: serverTime() });
      return;
    }

    if (path === '/api/summary') {
      const query = applyScope(parseQuery(url), scope);
      const summary = deps.query.summary(query);
      sendJson(res, 200, {
        totalEvents: summary.metrics.totalEvents,
        warningCount: summary.metrics.warningCount,
        normalCount: summary.metrics.normalCount,
        namespaceCount: summary.metrics.namespaceCount,
        recentWarnings: summary.metrics.recentWarnings,
        commonReasons: summary.metrics.commonReasons,
        volumeBuckets: summary.metrics.volumeBuckets,
        invalidTimestampCount: summary.metrics.invalidTimestampCount,
        totalOccurrences: summary.analytics.totalOccurrences,
        recordsWithKnownOccurrenceCount: summary.analytics.recordsWithKnownOccurrenceCount,
        typeBreakdown: summary.analytics.typeBreakdown,
        reasonBreakdown: summary.analytics.reasonBreakdown,
        namespaceBreakdown: summary.analytics.namespaceBreakdown,
        invalidTimestampExcluded: summary.invalidTimestampExcluded,
        serverTime: summary.serverTime,
        partial: summary.partial,
        clusters: summary.clusters,
      });
      return;
    }

    if (path === '/api/export') {
      const query = applyScope(parseQuery(url), scope);
      await streamExport(res, query, url.searchParams.get('format') === 'json' ? 'json' : 'csv');
      return;
    }

    if (path === '/api/stream') {
      const query = applyScope(parseQuery(url), scope);
      await streamUpdates(req, res, query, scope);
      return;
    }

    throw new ApiError('not_found', 'No such API endpoint.', 404);
  }

  async function streamExport(
    res: ServerResponse,
    query: EventQuery,
    format: 'csv' | 'json'
  ): Promise<void> {
    const records = deps.query.exportRecords(query);
    if (records.length > MAX_EXPORT_RECORDS) {
      sendError(
        res,
        413,
        'export_too_large',
        `This export would contain ${records.length} records; narrow the filters to ${MAX_EXPORT_RECORDS} or fewer.`
      );
      return;
    }
    res.writeHead(200, {
      'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="events-${serverTime().replace(/[:.]/g, '-')}.${format}"`,
      'x-snapshot-at': serverTime(),
      'cache-control': 'no-store',
    });
    if (format === 'csv') {
      res.write(`${CSV_HEADERS.join(',')}\r\n`);
      for (let index = 0; index < records.length; index += 500) {
        const chunk = records.slice(index, index + 500);
        res.write(chunk.map(eventToCsvRow).join('\r\n') + (index + 500 < records.length ? '\r\n' : ''));
      }
      res.end();
      return;
    }
    // JSON preserves the untouched source record for every filtered Event.
    res.write('[');
    for (let index = 0; index < records.length; index += 500) {
      const chunk = records.slice(index, index + 500);
      const serialized = chunk.map((record) => JSON.stringify(record.rawEvent) ?? 'null').join(',');
      res.write((index === 0 ? '' : ',') + serialized);
    }
    res.write(']');
    res.end();
  }

  async function streamUpdates(
    req: IncomingMessage,
    res: ServerResponse,
    query: EventQuery,
    scope: AuthorizationScope
  ): Promise<void> {
    const userId = scope.userId;
    const currentForUser = streamCounts.get(userId) ?? 0;
    if (currentForUser >= MAX_STREAMS_PER_USER || totalStreams >= MAX_STREAMS_TOTAL) {
      sendError(res, 429, 'stream_limit', 'Too many open update streams. Close another tab and retry.');
      return;
    }
    streamCounts.set(userId, currentForUser + 1);
    totalStreams++;

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');

    let nextId = 1;
    const retained: number[] = [];
    const lastEventId = Number(req.headers['last-event-id'] ?? '');
    if (Number.isFinite(lastEventId) && lastEventId > 0) {
      // Only the most recent messages of a live stream are retained. A resume on
      // a new connection therefore always asks the client to re-query.
      res.write('event: resync\ndata: {}\n\n');
    }

    const writeEvent = (event: string, data: unknown): void => {
      const id = nextId++;
      retained.push(id);
      if (retained.length > MAX_RETAINED_MESSAGES) retained.shift();
      res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const allClusters = deps.registry.list();
    const clusters =
      query.clusterIds.length === 0
        ? allClusters
        : allClusters.filter((cluster) => query.clusterIds.includes(cluster.info.id));
    const unsubscribes = clusters.map((cluster) =>
      cluster.store.subscribe((records) => {
        const matching = records.filter((record) =>
          matchesFilters(record, query.filters, serverTime())
        );
        if (matching.length > 0) writeEvent('update', { records: matching });
      })
    );

    let ticks = 0;
    const tick = setInterval(() => {
      ticks++;
      // A cheap signal: the client re-queries the summary and its page so all
      // counts still come from the single query path rather than from the stream.
      writeEvent('summary-tick', {
        serverTime: serverTime(),
        partial: clusters.some((cluster) => cluster.info.status !== 'live'),
      });
      if (ticks >= SUMMARY_TICK_LIMIT) cleanup();
    }, SUMMARY_TICK_MS);

    const heartbeat = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 15_000);

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(tick);
      clearInterval(heartbeat);
      for (const unsubscribe of unsubscribes) unsubscribe();
      const remaining = (streamCounts.get(userId) ?? 1) - 1;
      if (remaining <= 0) streamCounts.delete(userId);
      else streamCounts.set(userId, remaining);
      totalStreams = Math.max(0, totalStreams - 1);
    };

    res.on('close', cleanup);
    req.on('close', cleanup);
  }

  async function handleAuth(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    path: string
  ): Promise<void> {
    if (!deps.auth) {
      sendError(res, 404, 'auth_disabled', 'Sign-in is not enabled on this server.');
      return;
    }
    const { oidc } = deps.auth;
    const secure = oidc.publicUrl.startsWith('https://');
    const redirectUri = new URL('/auth/callback', oidc.publicUrl).toString();

    if (path === '/auth/login') {
      const { verifier, challenge } = createPkcePair();
      const state = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
      const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
      loginStates.set(state, { verifier, nonce, expiresAt: now() + 10 * 60_000 });
      res.writeHead(302, {
        location: buildAuthorizationUrl(oidc.discovery, {
          clientId: oidc.config.clientId,
          redirectUri,
          state,
          codeChallenge: challenge,
          nonce,
        }),
      });
      res.end();
      return;
    }

    if (path === '/auth/callback') {
      const state = url.searchParams.get('state') ?? '';
      const code = url.searchParams.get('code');
      const pending = loginStates.get(state);
      loginStates.delete(state);
      if (!pending || pending.expiresAt < now() || !code) {
        sendError(res, 400, 'login_failed', 'The sign-in attempt expired or was not recognized.');
        return;
      }
      try {
        const { idToken } = await exchangeCode(oidc.discovery, {
          clientId: oidc.config.clientId,
          clientSecret: oidc.config.clientSecret,
          redirectUri,
          code,
          verifier: pending.verifier,
          fetchImpl: deps.fetchImpl,
        });
        const jwks = await fetchJwks(oidc.discovery.jwks_uri, deps.fetchImpl);
        const claims = verifyIdToken(idToken, {
          issuer: oidc.config.issuer,
          audience: oidc.config.clientId,
          jwks,
          nonce: pending.nonce,
        });
        const policy = deps.auth.policy;
        const identity = {
          sub: claims.sub,
          username: typeof claims.preferred_username === 'string' ? claims.preferred_username : null,
          claims,
        };
        const roles = new Set<string>(policy.userRoles[claims.sub] ?? []);
        const usernameRoles = identity.username
          ? policy.userRoles[identity.username]
          : undefined;
        if (usernameRoles) {
          for (const role of usernameRoles) roles.add(role);
        }
        const groups = claims[policy.groupsClaim];
        if (Array.isArray(groups)) {
          for (const group of groups) {
            if (typeof group !== 'string') continue;
            for (const role of policy.groupRoles[group] ?? []) roles.add(role);
          }
        }
        const session = newSession(
          claims.sub,
          typeof claims.name === 'string' ? claims.name : identity.username,
          [...roles],
          Math.floor(now() / 1000)
        );
        res.writeHead(302, {
          location: '/',
          'set-cookie': sessionCookie(session, oidc.sessionSecret, secure),
        });
        res.end();
      } catch (error) {
        const message =
          error instanceof TokenError ? 'The identity provider response was rejected.' : 'Sign-in failed.';
        deps.logger.warn('oidc sign-in failed', {
          reason: error instanceof Error ? error.name : 'unknown',
        });
        sendError(res, 401, 'login_failed', message);
      }
      return;
    }

    if (path === '/auth/logout') {
      res.writeHead(302, {
        location: '/',
        'set-cookie': serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure }),
      });
      res.end();
      return;
    }

    throw new ApiError('not_found', 'No such sign-in endpoint.', 404);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = Date.now();
    const rawUrl = req.url ?? '/';
    if (rawUrl.length > MAX_URL_LENGTH) {
      sendError(res, 414, 'uri_too_long', 'The request URL is too long.');
      return;
    }
    let url: URL;
    try {
      url = new URL(rawUrl, 'http://localhost');
    } catch {
      sendError(res, 400, 'invalid_request', 'The request URL is not valid.');
      return;
    }
    const path = url.pathname;

    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");

    try {
      if (path === '/healthz') {
        sendJson(res, 200, { status: 'ok' });
        return;
      }
      if (path === '/readyz') {
        const clusters = deps.registry.list();
        const live = clusters.filter((cluster) => cluster.info.status === 'live');
        const ready = live.length > 0;
        sendJson(res, ready ? 200 : 503, {
          ready,
          clusters: clusters.map((cluster) => ({
            id: cluster.info.id,
            status: cluster.info.status,
          })),
        });
        return;
      }
      if (path.startsWith('/auth/')) {
        await handleAuth(req, res, url, path);
        return;
      }
      if (isApiPath(path)) {
        await handleApi(req, res, url, path);
        return;
      }
      const served = await serveStatic(req, res, deps.staticDir, path);
      if (!served) {
        sendError(res, 404, 'not_found', 'The requested resource does not exist.');
      }
    } catch (error) {
      handleError(res, error);
    } finally {
      if (path !== '/api/stream') {
        deps.logger.debug('request', {
          method: req.method,
          path,
          status: res.statusCode,
          durationMs: Date.now() - started,
        });
      }
    }
  }

  function handleError(res: ServerResponse, error: unknown): void {
    if (error instanceof ForbiddenError) {
      sendError(res, 403, error.code, error.message);
      return;
    }
    if (error instanceof QueryError) {
      sendError(res, error.status, error.code, error.message);
      return;
    }
    if (error instanceof ApiError) {
      sendError(res, error.status, error.code, error.message);
      return;
    }
    deps.logger.error('unhandled API error', {
      reason: error instanceof Error ? error.name : 'unknown',
    });
    sendError(res, 500, 'internal_error', 'The server could not complete the request.');
  }

  return {
    handle: async (req, res) => {
      await handle(req, res);
    },
    activeStreams: () => totalStreams,
  };
}
