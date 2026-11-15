// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect } from 'vitest';
import {
  ConfigError,
  DEFAULT_CACHE_MAX_PER_CLUSTER,
  DEFAULT_PORT,
  loadConfig,
} from '../../src/config';

function expectConfigError(env: Record<string, string | undefined>, fragment: string): void {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).message).toContain(fragment);
    return;
  }
  throw new Error(`Expected loadConfig to fail with "${fragment}".`);
}

describe('loadConfig', () => {
  it('applies local-mode defaults', () => {
    const config = loadConfig({});
    expect(config.mode).toBe('local');
    expect(config.bindHost).toBe('127.0.0.1');
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.cacheMaxPerCluster).toBe(DEFAULT_CACHE_MAX_PER_CLUSTER);
    expect(config.contexts).toBeNull();
    expect(config.authMode).toBe('none');
    expect(config.oidc).toBeNull();
    expect(config.logLevel).toBe('info');
    expect(config.kubeconfigPath.endsWith('/.kube/config')).toBe(true);
  });

  it('defaults in-cluster mode to all interfaces', () => {
    const config = loadConfig({ EVENTS_MODE: 'in-cluster' });
    expect(config.bindHost).toBe('0.0.0.0');
    expect(config.authMode).toBe('none');
  });

  it('reads explicit overrides', () => {
    const config = loadConfig({
      EVENTS_MODE: 'in-cluster',
      EVENTS_BIND_HOST: '10.0.0.5',
      EVENTS_PORT: '9000',
      EVENTS_CACHE_MAX_PER_CLUSTER: '250',
      EVENTS_CONTEXTS: 'kind-dev, staging ,kind-dev',
      EVENTS_KUBECONFIG: '/etc/kube/config',
      EVENTS_LOG_LEVEL: 'debug',
    });
    expect(config.bindHost).toBe('10.0.0.5');
    expect(config.port).toBe(9000);
    expect(config.cacheMaxPerCluster).toBe(250);
    expect(config.contexts).toEqual(['kind-dev', 'staging']);
    expect(config.kubeconfigPath).toBe('/etc/kube/config');
    expect(config.logLevel).toBe('debug');
  });

  it('treats a blank context list as the current context', () => {
    expect(loadConfig({ EVENTS_CONTEXTS: '   ' }).contexts).toBeNull();
  });

  it('rejects a context list with no names', () => {
    expectConfigError({ EVENTS_CONTEXTS: ' , , ' }, 'EVENTS_CONTEXTS must name at least one context');
  });

  it('rejects unknown modes, auth modes and log levels', () => {
    expectConfigError({ EVENTS_MODE: 'cluster' }, 'EVENTS_MODE must be one of');
    expectConfigError({ EVENTS_AUTH_MODE: 'basic' }, 'EVENTS_AUTH_MODE must be one of');
    expectConfigError({ EVENTS_LOG_LEVEL: 'verbose' }, 'EVENTS_LOG_LEVEL must be one of');
  });

  it('rejects out-of-range and non-numeric ports', () => {
    expectConfigError({ EVENTS_PORT: 'http' }, 'EVENTS_PORT must be a whole number');
    expectConfigError({ EVENTS_PORT: '0' }, 'EVENTS_PORT must be between 1 and 65535');
    expectConfigError({ EVENTS_PORT: '70000' }, 'EVENTS_PORT must be between 1 and 65535');
  });

  it('rejects a zero record cap', () => {
    expectConfigError(
      { EVENTS_CACHE_MAX_PER_CLUSTER: '0' },
      'EVENTS_CACHE_MAX_PER_CLUSTER must be between 1'
    );
  });

  it('refuses an unauthenticated non-loopback local bind', () => {
    expectConfigError({ EVENTS_BIND_HOST: '0.0.0.0' }, 'requires a loopback EVENTS_BIND_HOST');
    expectConfigError({ EVENTS_BIND_HOST: '192.168.1.10' }, 'requires a loopback EVENTS_BIND_HOST');
    expect(loadConfig({ EVENTS_BIND_HOST: 'localhost' }).bindHost).toBe('localhost');
    expect(loadConfig({ EVENTS_BIND_HOST: '::1' }).bindHost).toBe('::1');
    expect(loadConfig({ EVENTS_BIND_HOST: '127.0.0.2' }).bindHost).toBe('127.0.0.2');
  });

  it('allows a non-loopback bind in in-cluster mode', () => {
    expect(loadConfig({ EVENTS_MODE: 'in-cluster', EVENTS_BIND_HOST: '0.0.0.0' }).bindHost).toBe(
      '0.0.0.0'
    );
  });

  it('requires complete OIDC settings when OIDC auth is selected', () => {
    expectConfigError(
      { EVENTS_AUTH_MODE: 'oidc' },
      'EVENTS_OIDC_ISSUER is required when EVENTS_AUTH_MODE=oidc'
    );
    expectConfigError(
      { EVENTS_AUTH_MODE: 'oidc', EVENTS_OIDC_ISSUER: 'https://id.example.test' },
      'EVENTS_OIDC_CLIENT_ID is required'
    );
    expectConfigError(
      {
        EVENTS_AUTH_MODE: 'oidc',
        EVENTS_OIDC_ISSUER: 'https://id.example.test',
        EVENTS_OIDC_CLIENT_ID: 'events',
      },
      'EVENTS_OIDC_CLIENT_SECRET is required'
    );
  });

  it('rejects a non-URL issuer', () => {
    expectConfigError(
      {
        EVENTS_AUTH_MODE: 'oidc',
        EVENTS_OIDC_ISSUER: 'id.example.test',
        EVENTS_OIDC_CLIENT_ID: 'events',
        EVENTS_OIDC_CLIENT_SECRET: 'secret',
      },
      'EVENTS_OIDC_ISSUER must be an http(s) URL'
    );
  });

  it('builds OIDC settings when every value is present', () => {
    const config = loadConfig({
      EVENTS_AUTH_MODE: 'oidc',
      EVENTS_OIDC_ISSUER: 'https://id.example.test/realms/events',
      EVENTS_OIDC_CLIENT_ID: 'events-explorer',
      EVENTS_OIDC_CLIENT_SECRET: 'not-a-real-secret',
      EVENTS_PUBLIC_URL: 'https://events.example.test',
      EVENTS_SESSION_SECRET: Buffer.alloc(32, 7).toString('base64'),
      EVENTS_RBAC_FILE: '/etc/events/rbac.yaml',
      EVENTS_BIND_HOST: '0.0.0.0',
    });
    expect(config.oidc).toEqual({
      issuer: 'https://id.example.test/realms/events',
      clientId: 'events-explorer',
      clientSecret: 'not-a-real-secret',
    });
    expect(config.bindHost).toBe('0.0.0.0');
    expect(config.publicUrl).toBe('https://events.example.test');
    expect(config.rbacFile).toBe('/etc/events/rbac.yaml');
  });

  it('requires the redirect URL, session secret and RBAC file for team mode', () => {
    expectConfigError(
      {
        EVENTS_AUTH_MODE: 'oidc',
        EVENTS_OIDC_ISSUER: 'https://id.example.test',
        EVENTS_OIDC_CLIENT_ID: 'events',
        EVENTS_OIDC_CLIENT_SECRET: 'secret',
      },
      'EVENTS_PUBLIC_URL is required'
    );
    expectConfigError(
      {
        EVENTS_AUTH_MODE: 'oidc',
        EVENTS_OIDC_ISSUER: 'https://id.example.test',
        EVENTS_OIDC_CLIENT_ID: 'events',
        EVENTS_OIDC_CLIENT_SECRET: 'secret',
        EVENTS_PUBLIC_URL: 'https://events.example.test',
      },
      'EVENTS_SESSION_SECRET is required'
    );
  });

  it('rejects a weak session secret and an invalid public URL', () => {
    expectConfigError(
      { EVENTS_SESSION_SECRET: Buffer.alloc(8, 1).toString('base64') },
      'at least 32 bytes'
    );
    expectConfigError({ EVENTS_PUBLIC_URL: 'events.example.test' }, 'must be an http(s) URL');
  });

  it('parses watched namespaces and rejects invalid values', () => {
    expect(loadConfig({ EVENTS_WATCH_NAMESPACES: 'payments, checkout ,payments' }).watchNamespaces).toEqual([
      'payments',
      'checkout',
    ]);
    expect(loadConfig({}).watchNamespaces).toEqual([]);
    expectConfigError({ EVENTS_WATCH_NAMESPACES: ',,' }, 'must name at least one namespace');
    expectConfigError({ EVENTS_WATCH_NAMESPACES: 'Payments' }, 'invalid namespace');
  });

  it('reports every problem at once', () => {
    try {
      loadConfig({ EVENTS_PORT: 'x', EVENTS_BIND_HOST: '0.0.0.0', EVENTS_LOG_LEVEL: 'loud' });
      throw new Error('Expected loadConfig to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).problems).toHaveLength(3);
    }
  });
});
