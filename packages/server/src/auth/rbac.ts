// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { EventQuery } from '../query/queryService';

/** `*` in namespaces means every namespace in the cluster. */
export type Grant = { clusterId: string; namespaces: string[] };

export type RbacPolicy = {
  roleGrants: Record<string, Grant[]>;
  userRoles: Record<string, string[]>;
  groupRoles: Record<string, string[]>;
  /** Token claim carrying group membership. Defaults to `groups`. */
  groupsClaim: string;
};

export type AuthorizationScope = {
  userId: string;
  roles: string[];
  grants: Grant[];
};

export class RbacError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RbacError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readGrantList(value: unknown, role: string): Grant[] {
  if (!Array.isArray(value)) throw new RbacError(`Role "${role}" must list grants.`);
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry['clusterId'] !== 'string') {
      throw new RbacError(`Role "${role}" has a grant without a clusterId.`);
    }
    const namespaces = entry['namespaces'];
    if (!Array.isArray(namespaces) || namespaces.some((ns) => typeof ns !== 'string')) {
      throw new RbacError(`Role "${role}" has a grant without a namespaces list.`);
    }
    return { clusterId: entry['clusterId'], namespaces: namespaces as string[] };
  });
}

export function parseRbac(text: string): RbacPolicy {
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch {
    throw new RbacError('RBAC file is not valid YAML.');
  }
  if (!isRecord(document)) throw new RbacError('RBAC file is empty or malformed.');
  const rawRoles = document['roleGrants'];
  if (!isRecord(rawRoles)) throw new RbacError('RBAC file must define roleGrants.');
  const roleGrants: Record<string, Grant[]> = {};
  for (const [role, grants] of Object.entries(rawRoles)) {
    roleGrants[role] = readGrantList(grants, role);
  }
  const readRoleMap = (key: string): Record<string, string[]> => {
    const value = document[key];
    if (value === undefined) return {};
    if (!isRecord(value)) throw new RbacError(`RBAC file field ${key} must be a mapping.`);
    const map: Record<string, string[]> = {};
    for (const [identity, roles] of Object.entries(value)) {
      if (!Array.isArray(roles) || roles.some((role) => typeof role !== 'string')) {
        throw new RbacError(`RBAC file field ${key} must map identities to role names.`);
      }
      map[identity] = roles as string[];
    }
    return map;
  };
  const groupsClaim =
    typeof document['groupsClaim'] === 'string' ? (document['groupsClaim'] as string) : 'groups';
  return {
    roleGrants,
    userRoles: readRoleMap('userRoles'),
    groupRoles: readRoleMap('groupRoles'),
    groupsClaim,
  };
}

export function loadRbac(path: string, readFile: (path: string) => string = (p) => readFileSync(p, 'utf8')): RbacPolicy {
  let text: string;
  try {
    text = readFile(path);
  } catch {
    throw new RbacError(`RBAC file at ${path} could not be read.`);
  }
  return parseRbac(text);
}

export function scopeFor(
  policy: RbacPolicy,
  identity: { sub: string; username?: string | null; claims: Record<string, unknown> }
): AuthorizationScope {
  const roles = new Set<string>(policy.userRoles[identity.sub] ?? []);
  const usernameRoles = identity.username ? policy.userRoles[identity.username] : undefined;
  if (usernameRoles) {
    for (const role of usernameRoles) roles.add(role);
  }
  const groups = identity.claims[policy.groupsClaim];
  if (Array.isArray(groups)) {
    for (const group of groups) {
      if (typeof group !== 'string') continue;
      for (const role of policy.groupRoles[group] ?? []) roles.add(role);
    }
  }
  const grants: Grant[] = [];
  for (const role of roles) {
    for (const grant of policy.roleGrants[role] ?? []) grants.push(grant);
  }
  return { userId: identity.sub, roles: [...roles], grants };
}

export function grantsForRoles(policy: RbacPolicy, roles: string[]): Grant[] {
  const grants: Grant[] = [];
  for (const role of roles) {
    for (const grant of policy.roleGrants[role] ?? []) grants.push(grant);
  }
  return grants;
}

export function canReadCluster(scope: AuthorizationScope, clusterId: string): boolean {
  return scope.grants.some(
    (grant) => grant.clusterId === clusterId || grant.clusterId === '*'
  );
}

/** Namespaces this scope may read in a cluster; `null` means no access. */
export function readableNamespaces(
  scope: AuthorizationScope,
  clusterId: string
): string[] | 'all' | null {
  const matching = scope.grants.filter(
    (grant) => grant.clusterId === clusterId || grant.clusterId === '*'
  );
  if (matching.length === 0) return null;
  if (matching.some((grant) => grant.namespaces.includes('*'))) return 'all';
  const namespaces = new Set<string>();
  for (const grant of matching) {
    for (const namespace of grant.namespaces) namespaces.add(namespace);
  }
  return [...namespaces].sort();
}

export class ForbiddenError extends Error {
  readonly code = 'forbidden';
  readonly status = 403;
  constructor(message = 'This account may not read the requested records.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Restricts a query to what the caller may see. Cluster and namespace limits
 * are enforced here, before any record is read, and the result feeds every
 * endpoint including export and the stream.
 */
export function applyScope(query: EventQuery, scope: AuthorizationScope): EventQuery {
  const clusterIds =
    query.clusterIds.length > 0
      ? query.clusterIds
      : scope.grants.map((grant) => grant.clusterId).filter((id) => id !== '*');

  if (clusterIds.length === 0) throw new ForbiddenError();
  for (const id of clusterIds) {
    if (!canReadCluster(scope, id)) throw new ForbiddenError();
  }

  const requestedNamespaces = query.filters.namespaces;
  let namespaces = requestedNamespaces;
  for (const id of clusterIds) {
    const allowed = readableNamespaces(scope, id);
    if (allowed === null) throw new ForbiddenError();
    if (allowed === 'all') continue;
    if (namespaces.length === 0) {
      namespaces = allowed;
    } else {
      namespaces = namespaces.filter((namespace) => allowed.includes(namespace));
    }
  }
  if (requestedNamespaces.length > 0 && namespaces.length === 0) {
    // Every requested namespace is outside the grant. Do not fall back to an
    // empty filter, which would mean "all namespaces".
    throw new ForbiddenError();
  }

  return {
    ...query,
    clusterIds,
    filters: { ...query.filters, namespaces },
  };
}
