// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { ConfigError, loadConfig } from './config';
import { createLogger } from './logging';
import { ClusterManager } from './clusters/manager';
import { KubeconfigError } from './kube/kubeconfig';
import { RbacError } from './auth/rbac';
import { OidcError } from './auth/oidc';
import { buildLogger, createApp, loadAuthRuntime, resolveConnections } from './app';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    const problems = error instanceof ConfigError ? error.problems : [String(error)];
    for (const problem of problems) process.stderr.write(`configuration error: ${problem}\n`);
    process.exitCode = 1;
    return;
  }

  const logger = buildLogger(config);

  let registry: ClusterManager;
  let auth;
  try {
    const connections = resolveConnections(config);
    registry = new ClusterManager({
      connections,
      capPerCluster: config.cacheMaxPerCluster,
      namespaces: config.watchNamespaces,
      logger,
    });
    auth = await loadAuthRuntime(config);
  } catch (error) {
    if (error instanceof KubeconfigError || error instanceof RbacError || error instanceof OidcError) {
      logger.error('startup failed', { code: error.name, message: error.message });
    } else {
      logger.error('startup failed', { message: error instanceof Error ? error.message : 'unknown' });
    }
    process.exitCode = 1;
    return;
  }

  const app = createApp({ config, logger, registry, auth });
  registry.start();
  await app.start();

  const shutdown = async (signal: string) => {
    logger.info('shutting down', { signal });
    setTimeout(() => process.exit(1), 10_000).unref();
    await registry.stop();
    await app.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((error: unknown) => {
  createLogger('error').error('fatal', {
    message: error instanceof Error ? error.message : 'unknown',
  });
  process.exit(1);
});
