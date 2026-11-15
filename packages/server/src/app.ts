// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { ServerConfig } from './config';
import { createLogger, type Logger } from './logging';
import type { ClusterRegistry } from './clusters/types';
import { QueryService } from './query/queryService';
import { createApiHandler, type AuthRuntime } from './api/server';
import { loadRbac, type RbacPolicy } from './auth/rbac';
import { discover, type FetchLike } from './auth/oidc';
import {
  parseKubeconfig,
  resolveInClusterConnection,
  type ConnectionSpec,
} from './kube/kubeconfig';

export type App = {
  server: Server;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

/** Resolves the kubeconfig contexts or the in-cluster ServiceAccount. */
export function resolveConnections(config: ServerConfig): ConnectionSpec[] {
  if (config.mode === 'in-cluster') {
    return [resolveInClusterConnection()];
  }
  return parseKubeconfig({
    path: config.kubeconfigPath,
    contextNames: config.contexts ?? [],
  });
}

export async function loadAuthRuntime(
  config: ServerConfig,
  fetchImpl?: FetchLike
): Promise<AuthRuntime | null> {
  if (
    config.authMode !== 'oidc' ||
    !config.oidc ||
    !config.publicUrl ||
    !config.sessionSecret ||
    !config.rbacFile
  ) {
    return null;
  }
  const policy: RbacPolicy = loadRbac(config.rbacFile);
  const discovery = await discover(config.oidc.issuer, fetchImpl);
  return {
    policy,
    oidc: {
      config: config.oidc,
      discovery,
      publicUrl: config.publicUrl,
      sessionSecret: config.sessionSecret,
    },
  };
}

export type AppDependencies = {
  config: ServerConfig;
  logger: Logger;
  registry: ClusterRegistry;
  auth: AuthRuntime | null;
  staticDir?: string;
};

/**
 * Builds the HTTP server around the shared query service. Ingestion is started
 * by the caller so tests can supply a registry without a cluster.
 */
export function createApp(deps: AppDependencies): App {
  const { config, logger, registry, auth } = deps;
  const query = new QueryService(() => ({
    clusters: registry.list(),
    serverTime: new Date().toISOString(),
  }));
  const api = createApiHandler({
    config,
    logger,
    registry,
    query,
    auth,
    staticDir: deps.staticDir ?? config.staticDir,
  });

  const server = createServer((req, res) => {
    api.handle(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { code: 'internal_error', message: 'The request failed.' } }));
      } else {
        res.end();
      }
    });
  });
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 65_000;

  return {
    server,
    start: async () => {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen(config.port, config.bindHost, () => {
          server.off('error', onError);
          resolve();
        });
      });
      logger.info('server listening', {
        host: config.bindHost,
        port: config.port,
        mode: config.mode,
        auth: config.authMode,
      });
    },
    stop: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}

export function buildLogger(config: ServerConfig): Logger {
  return createLogger(config.logLevel);
}
