// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type EventsMode = 'local' | 'in-cluster';
export type AuthMode = 'none' | 'oidc';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
};

export type ServerConfig = {
  mode: EventsMode;
  kubeconfigPath: string;
  /** null means "use the kubeconfig's current context". */
  contexts: string[] | null;
  bindHost: string;
  port: number;
  cacheMaxPerCluster: number;
  authMode: AuthMode;
  oidc: OidcConfig | null;
  logLevel: LogLevel;
  /** Directory of built web assets served by this process. */
  staticDir: string;
  /** Public base URL, required for the OIDC redirect. */
  publicUrl: string | null;
  /** File mapping roles to cluster and namespace grants. */
  rbacFile: string | null;
  /** Secret used to protect the session cookie; required in team mode. */
  sessionSecret: string | null;
  /** Namespaces to list and watch; empty means every namespace the identity can read. */
  watchNamespaces: string[];
};

export const DEFAULT_PORT = 8080;
export const DEFAULT_CACHE_MAX_PER_CLUSTER = 100_000;
export const DEFAULT_STATIC_DIR = 'packages/web/dist';
export const DEFAULT_KUBECONFIG_PATH = join(homedir(), '.kube', 'config');

const EVENTS_MODES: readonly EventsMode[] = ['local', 'in-cluster'];
const AUTH_MODES: readonly AuthMode[] = ['none', 'oidc'];
const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

function readString(env: Record<string, string | undefined>, key: string): string | null {
  const raw = env[key];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function readEnum<T extends string>(
  env: Record<string, string | undefined>,
  key: string,
  allowed: readonly T[],
  fallback: T,
  problems: string[]
): T {
  const raw = readString(env, key);
  if (raw === null) return fallback;
  if (!allowed.includes(raw as T)) {
    problems.push(`${key} must be one of: ${allowed.join(', ')}. Received "${raw}".`);
    return fallback;
  }
  return raw as T;
}

function readInteger(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
  min: number,
  max: number,
  problems: string[]
): number {
  const raw = readString(env, key);
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) {
    problems.push(`${key} must be a whole number. Received "${raw}".`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    problems.push(`${key} must be between ${min} and ${max}. Received "${raw}".`);
    return fallback;
  }
  return value;
}

function parseContexts(env: Record<string, string | undefined>, problems: string[]): string[] | null {
  const raw = readString(env, 'EVENTS_CONTEXTS');
  if (raw === null) return null;
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (name !== '') seen.add(name);
  }
  if (seen.size === 0) {
    problems.push('EVENTS_CONTEXTS must name at least one context when it is set.');
    return null;
  }
  return [...seen];
}

function parseWatchNamespaces(
  env: Record<string, string | undefined>,
  problems: string[]
): string[] {
  const raw = readString(env, 'EVENTS_WATCH_NAMESPACES');
  if (raw === null) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const namespace = part.trim();
    if (namespace === '') continue;
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(namespace) || namespace.length > 63) {
      problems.push(`EVENTS_WATCH_NAMESPACES contains an invalid namespace: "${namespace}".`);
      continue;
    }
    seen.add(namespace);
  }
  if (seen.size === 0) {
    problems.push('EVENTS_WATCH_NAMESPACES must name at least one namespace when it is set.');
  }
  return [...seen];
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Loads configuration from environment variables. Throws ConfigError listing
 * every problem when the combination is unusable, so startup can fail fast.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const problems: string[] = [];

  const mode = readEnum(env, 'EVENTS_MODE', EVENTS_MODES, 'local', problems);
  const defaultBindHost = mode === 'in-cluster' ? '0.0.0.0' : '127.0.0.1';
  const bindHost = readString(env, 'EVENTS_BIND_HOST') ?? defaultBindHost;
  const port = readInteger(env, 'EVENTS_PORT', DEFAULT_PORT, 1, 65_535, problems);
  const cacheMaxPerCluster = readInteger(
    env,
    'EVENTS_CACHE_MAX_PER_CLUSTER',
    DEFAULT_CACHE_MAX_PER_CLUSTER,
    1,
    Number.MAX_SAFE_INTEGER,
    problems
  );
  const contexts = parseContexts(env, problems);
  const watchNamespaces = parseWatchNamespaces(env, problems);
  const authMode = readEnum(env, 'EVENTS_AUTH_MODE', AUTH_MODES, 'none', problems);
  const logLevel = readEnum(env, 'EVENTS_LOG_LEVEL', LOG_LEVELS, 'info', problems);
  const kubeconfigPath = readString(env, 'EVENTS_KUBECONFIG') ?? DEFAULT_KUBECONFIG_PATH;

  const staticDir = resolve(readString(env, 'EVENTS_STATIC_DIR') ?? DEFAULT_STATIC_DIR);
  const publicUrlRaw = readString(env, 'EVENTS_PUBLIC_URL');
  const rbacFile = readString(env, 'EVENTS_RBAC_FILE');
  const sessionSecret = readString(env, 'EVENTS_SESSION_SECRET');

  if (publicUrlRaw !== null && !isHttpUrl(publicUrlRaw)) {
    problems.push('EVENTS_PUBLIC_URL must be an http(s) URL.');
  }
  if (sessionSecret !== null && Buffer.from(sessionSecret, 'base64').length < 32) {
    problems.push('EVENTS_SESSION_SECRET must be at least 32 bytes of base64-encoded data.');
  }

  let oidc: OidcConfig | null = null;
  if (authMode === 'oidc') {
    const issuer = readString(env, 'EVENTS_OIDC_ISSUER');
    const clientId = readString(env, 'EVENTS_OIDC_CLIENT_ID');
    const clientSecret = readString(env, 'EVENTS_OIDC_CLIENT_SECRET');
    if (issuer === null) problems.push('EVENTS_OIDC_ISSUER is required when EVENTS_AUTH_MODE=oidc.');
    if (clientId === null) problems.push('EVENTS_OIDC_CLIENT_ID is required when EVENTS_AUTH_MODE=oidc.');
    if (clientSecret === null) problems.push('EVENTS_OIDC_CLIENT_SECRET is required when EVENTS_AUTH_MODE=oidc.');
    if (issuer !== null && !isHttpUrl(issuer)) {
      problems.push('EVENTS_OIDC_ISSUER must be an http(s) URL.');
    }
    if (issuer !== null && clientId !== null && clientSecret !== null) {
      oidc = { issuer, clientId, clientSecret };
    }
    if (publicUrlRaw === null) {
      problems.push('EVENTS_PUBLIC_URL is required when EVENTS_AUTH_MODE=oidc.');
    }
    if (sessionSecret === null) {
      problems.push('EVENTS_SESSION_SECRET is required when EVENTS_AUTH_MODE=oidc.');
    }
    if (rbacFile === null) {
      problems.push('EVENTS_RBAC_FILE is required when EVENTS_AUTH_MODE=oidc.');
    }
  }

  if (authMode === 'none' && mode === 'local' && !isLoopbackHost(bindHost)) {
    problems.push(
      `EVENTS_AUTH_MODE=none in local mode requires a loopback EVENTS_BIND_HOST. Received "${bindHost}".`
    );
  }

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return {
    mode,
    kubeconfigPath,
    contexts,
    bindHost,
    port,
    cacheMaxPerCluster,
    authMode,
    oidc,
    logLevel,
    staticDir,
    publicUrl: publicUrlRaw,
    rbacFile,
    sessionSecret,
    watchNamespaces,
  };
}
