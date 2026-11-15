// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { createHash, randomBytes } from 'node:crypto';
import type { Jwks } from './jwt';

export type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class OidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcError';
  }
}

function requireUrl(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new OidcError(`OIDC discovery has no ${field}.`);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new OidcError(`OIDC ${field} must be an http(s) URL.`);
    }
    return value;
  } catch {
    throw new OidcError(`OIDC ${field} is not a URL.`);
  }
}

export async function discover(issuer: string, fetchImpl: FetchLike = fetch): Promise<OidcDiscovery> {
  const url = new URL('.well-known/openid-configuration', issuer.endsWith('/') ? issuer : `${issuer}/`);
  const response = await fetchImpl(url);
  if (!response.ok) throw new OidcError('OIDC discovery endpoint is unavailable.');
  const body = (await response.json()) as Record<string, unknown>;
  return {
    issuer: requireUrl(body['issuer'], 'issuer'),
    authorization_endpoint: requireUrl(body['authorization_endpoint'], 'authorization endpoint'),
    token_endpoint: requireUrl(body['token_endpoint'], 'token endpoint'),
    jwks_uri: requireUrl(body['jwks_uri'], 'JWKS URI'),
  };
}

export async function fetchJwks(uri: string, fetchImpl: FetchLike = fetch): Promise<Jwks> {
  const response = await fetchImpl(uri);
  if (!response.ok) throw new OidcError('OIDC key set is unavailable.');
  const body = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(body.keys)) throw new OidcError('OIDC key set is malformed.');
  return { keys: body.keys as Jwks['keys'] };
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizationUrl(
  discovery: OidcDiscovery,
  options: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    nonce?: string;
    scope?: string;
  }
): string {
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('scope', options.scope ?? 'openid profile email');
  url.searchParams.set('state', options.state);
  url.searchParams.set('code_challenge', options.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (options.nonce) url.searchParams.set('nonce', options.nonce);
  return url.toString();
}

export async function exchangeCode(
  discovery: OidcDiscovery,
  options: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
    verifier: string;
    fetchImpl?: FetchLike;
  }
): Promise<{ idToken: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: options.code,
    redirect_uri: options.redirectUri,
    client_id: options.clientId,
    client_secret: options.clientSecret,
    code_verifier: options.verifier,
  });
  const response = await fetchImpl(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new OidcError('The identity provider rejected the sign-in.');
  const payload = (await response.json()) as { id_token?: unknown };
  if (typeof payload.id_token !== 'string') {
    throw new OidcError('The identity provider returned no ID token.');
  }
  return { idToken: payload.id_token };
}
