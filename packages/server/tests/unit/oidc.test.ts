// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildAuthorizationUrl,
  createPkcePair,
  discover,
  exchangeCode,
  fetchJwks,
  OidcError,
} from '../../src/auth/oidc';

const DISCOVERY = {
  issuer: 'https://id.example.test',
  authorization_endpoint: 'https://id.example.test/auth',
  token_endpoint: 'https://id.example.test/token',
  jwks_uri: 'https://id.example.test/keys',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OIDC discovery', () => {
  it('reads the endpoints from the well-known document', async () => {
    let requested = '';
    const fetchImpl = async (input: string | URL) => {
      requested = input.toString();
      return jsonResponse(DISCOVERY);
    };
    const discovery = await discover('https://id.example.test', fetchImpl);
    expect(discovery).toEqual(DISCOVERY);
    expect(requested).toBe('https://id.example.test/.well-known/openid-configuration');
  });

  it('normalizes an issuer with a trailing slash', async () => {
    let requested = '';
    await discover('https://id.example.test/', async (input: string | URL) => {
      requested = input.toString();
      return jsonResponse(DISCOVERY);
    });
    expect(requested).toBe('https://id.example.test/.well-known/openid-configuration');
  });

  it('rejects an unavailable or incomplete discovery document', async () => {
    await expect(discover('https://id.example.test', async () => jsonResponse({}, 500))).rejects.toThrow(
      OidcError
    );
    await expect(
      discover('https://id.example.test', async () => jsonResponse({ issuer: 'not-a-url' }))
    ).rejects.toThrow(OidcError);
    await expect(
      discover('https://id.example.test', async () => jsonResponse({ issuer: DISCOVERY.issuer }))
    ).rejects.toThrow(/authorization endpoint/);
  });

  it('reads a key set and rejects a malformed one', async () => {
    expect(await fetchJwks(DISCOVERY.jwks_uri, async () => jsonResponse({ keys: [{ kty: 'RSA' }] }))).toEqual({
      keys: [{ kty: 'RSA' }],
    });
    await expect(fetchJwks(DISCOVERY.jwks_uri, async () => jsonResponse({ keys: 'none' }))).rejects.toThrow(
      OidcError
    );
    await expect(fetchJwks(DISCOVERY.jwks_uri, async () => jsonResponse({}, 502))).rejects.toThrow(
      OidcError
    );
  });
});

describe('PKCE and authorization URL', () => {
  it('derives the challenge from the verifier', () => {
    const { verifier, challenge } = createPkcePair();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(verifier.length).toBeGreaterThan(40);
  });

  it('includes the required parameters', () => {
    const url = new URL(
      buildAuthorizationUrl(DISCOVERY, {
        clientId: 'events',
        redirectUri: 'https://events.example.test/auth/callback',
        state: 'state-1',
        codeChallenge: 'challenge-1',
        nonce: 'nonce-1',
      })
    );
    expect(url.searchParams.get('nonce')).toBe('nonce-1');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('state')).toBe('state-1');
  });
});

describe('code exchange', () => {
  it('posts the verifier and returns the ID token', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      expect(body.get('code_verifier')).toBe('verifier-1');
      expect(body.get('grant_type')).toBe('authorization_code');
      return jsonResponse({ id_token: 'token-1' });
    });
    const result = await exchangeCode(DISCOVERY, {
      clientId: 'events',
      clientSecret: 'secret',
      redirectUri: 'https://events.example.test/auth/callback',
      code: 'code-1',
      verifier: 'verifier-1',
      fetchImpl,
    });
    expect(result.idToken).toBe('token-1');
  });

  it('rejects a refused or tokenless response', async () => {
    await expect(
      exchangeCode(DISCOVERY, {
        clientId: 'events',
        clientSecret: 'secret',
        redirectUri: 'https://events.example.test/auth/callback',
        code: 'code-1',
        verifier: 'verifier-1',
        fetchImpl: async () => jsonResponse({}, 400),
      })
    ).rejects.toThrow(OidcError);
    await expect(
      exchangeCode(DISCOVERY, {
        clientId: 'events',
        clientSecret: 'secret',
        redirectUri: 'https://events.example.test/auth/callback',
        code: 'code-1',
        verifier: 'verifier-1',
        fetchImpl: async () => jsonResponse({ access_token: 'x' }),
      })
    ).rejects.toThrow(/no ID token/);
  });
});
