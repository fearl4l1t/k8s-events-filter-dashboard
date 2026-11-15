// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect } from 'vitest';
import { DEFAULT_FILTERS, DEFAULT_SORT } from '@k8s-events/domain';
import {
  applyScope,
  canReadCluster,
  ForbiddenError,
  grantsForRoles,
  parseRbac,
  readableNamespaces,
  scopeFor,
} from '../../src/auth/rbac';
import type { EventQuery } from '../../src/query/queryService';

const POLICY = `roleGrants:
  viewer:
    - clusterId: ctx-a
      namespaces: ["default"]
  admin:
    - clusterId: "*"
      namespaces: ["*"]
userRoles:
  alice:
    - viewer
groupRoles:
  sre:
    - admin
`;

function query(overrides: Partial<EventQuery> = {}): EventQuery {
  return {
    clusterIds: [],
    filters: { ...DEFAULT_FILTERS },
    sort: DEFAULT_SORT,
    page: 1,
    pageSize: 50,
    ...overrides,
  };
}

describe('parseRbac', () => {
  it('reads role grants and identity mappings', () => {
    const policy = parseRbac(POLICY);
    expect(policy.roleGrants['viewer']).toEqual([{ clusterId: 'ctx-a', namespaces: ['default'] }]);
    expect(policy.userRoles['alice']).toEqual(['viewer']);
    expect(policy.groupRoles['sre']).toEqual(['admin']);
    expect(policy.groupsClaim).toBe('groups');
  });

  it('rejects malformed documents', () => {
    expect(() => parseRbac('just-a-string')).toThrow();
    expect(() => parseRbac('roleGrants:\n  viewer:\n    - namespaces: ["*"]')).toThrow();
    expect(() => parseRbac('roleGrants:\n  viewer:\n    - clusterId: a\n      namespaces: all')).toThrow();
    expect(() => parseRbac('roleGrants: []')).toThrow();
  });
});

describe('scopeFor', () => {
  it('merges user and group roles into grants', () => {
    const policy = parseRbac(POLICY);
    const scope = scopeFor(policy, {
      sub: 'alice',
      username: null,
      claims: { groups: ['sre'] },
    });
    expect(scope.roles.sort()).toEqual(['admin', 'viewer']);
    expect(canReadCluster(scope, 'ctx-b')).toBe(true);
  });

  it('does not grant access without a role', () => {
    const policy = parseRbac(POLICY);
    const scope = scopeFor(policy, { sub: 'mallory', username: null, claims: {} });
    expect(scope.grants).toEqual([]);
    expect(canReadCluster(scope, 'ctx-a')).toBe(false);
  });
});

describe('visible namespaces', () => {
  it('reports a single namespace, several, all, or none', () => {
    expect(readableNamespaces({ userId: 'a', roles: [], grants: [{ clusterId: 'c', namespaces: ['x'] }] }, 'c')).toEqual(['x']);
    expect(readableNamespaces({ userId: 'a', roles: [], grants: [{ clusterId: 'c', namespaces: ['*'] }] }, 'c')).toBe('all');
    expect(readableNamespaces({ userId: 'a', roles: [], grants: [] }, 'c')).toBeNull();
  });
});

describe('applyScope', () => {
  it('defaults to every permitted cluster and forces the allowed namespace', () => {
    const policy = parseRbac(POLICY);
    const scope = scopeFor(policy, { sub: 'alice', username: null, claims: {} });
    const scoped = applyScope(query(), scope);
    expect(scoped.clusterIds).toEqual(['ctx-a']);
    expect(scoped.filters.namespaces).toEqual(['default']);
  });

  it('rejects a cluster outside the grant', () => {
    const policy = parseRbac(POLICY);
    const scope = scopeFor(policy, { sub: 'alice', username: null, claims: {} });
    expect(() => applyScope(query({ clusterIds: ['ctx-b'] }), scope)).toThrow(ForbiddenError);
  });

  it('rejects namespace filters outside the grant instead of widening them', () => {
    const policy = parseRbac(POLICY);
    const scope = scopeFor(policy, { sub: 'alice', username: null, claims: {} });
    expect(() =>
      applyScope(
        query({ filters: { ...DEFAULT_FILTERS, namespaces: ['kube-system'] } }),
        scope
      )
    ).toThrow(ForbiddenError);
  });

  it('intersects a partly allowed namespace selection', () => {
    const policy = parseRbac(POLICY);
    const scope = scopeFor(policy, { sub: 'alice', username: null, claims: {} });
    const scoped = applyScope(
      query({ filters: { ...DEFAULT_FILTERS, namespaces: ['default', 'payments'] } }),
      scope
    );
    expect(scoped.filters.namespaces).toEqual(['default']);
  });

  it('refuses an empty scope', () => {
    expect(() => applyScope(query(), { userId: 'nobody', roles: [], grants: [] })).toThrow(
      ForbiddenError
    );
  });

  it('resolves grants from roles', () => {
    const policy = parseRbac(POLICY);
    expect(grantsForRoles(policy, ['sre'])).toEqual([]);
    expect(grantsForRoles(policy, ['admin'])).toEqual([{ clusterId: '*', namespaces: ['*'] }]);
  });
});
