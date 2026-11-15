// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect, beforeAll } from 'vitest';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { TokenError, verifyIdToken } from '../../src/auth/jwt';
import type { Jwks } from '../../src/auth/jwt';

const ISSUER = 'https://id.example.test/realms/events';
const AUDIENCE = 'events-explorer';
let privateKey: KeyObject;
let jwks: Jwks;

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(claims: Record<string, unknown>, kid = 'key-1'): string {
  const header = base64url({ alg: 'RS256', typ: 'JWT', kid });
  const payload = base64url(claims);
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

beforeAll(() => {
  const { privateKey: priv, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = priv;
  const exported = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  jwks = { keys: [{ ...exported, kid: 'key-1' } as Jwks['keys'][number]] };
});

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 'user-1',
    exp: Math.floor(Date.now() / 1000) + 300,
    nonce: 'nonce-1',
    ...overrides,
  };
}

describe('verifyIdToken', () => {
  it('accepts a correctly signed token from the issuer', () => {
    const claims = verifyIdToken(sign(validClaims()), {
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks,
      nonce: 'nonce-1',
    });
    expect(claims.sub).toBe('user-1');
  });

  it('accepts an audience array containing the client', () => {
    expect(() =>
      verifyIdToken(sign(validClaims({ aud: ['other', AUDIENCE] })), {
        issuer: ISSUER,
        audience: AUDIENCE,
        jwks,
      })
    ).not.toThrow();
  });

  it('rejects a token with the wrong issuer or audience', () => {
    expect(() =>
      verifyIdToken(sign(validClaims({ iss: 'https://evil.test' })), {
        issuer: ISSUER,
        audience: AUDIENCE,
        jwks,
      })
    ).toThrow(TokenError);
    expect(() =>
      verifyIdToken(sign(validClaims({ aud: 'another-client' })), {
        issuer: ISSUER,
        audience: AUDIENCE,
        jwks,
      })
    ).toThrow(TokenError);
  });

  it('rejects an expired token beyond the clock skew', () => {
    expect(() =>
      verifyIdToken(sign(validClaims({ exp: Math.floor(Date.now() / 1000) - 120 })), {
        issuer: ISSUER,
        audience: AUDIENCE,
        jwks,
      })
    ).toThrow(TokenError);
  });

  it('rejects a mismatched nonce', () => {
    expect(() =>
      verifyIdToken(sign(validClaims()), {
        issuer: ISSUER,
        audience: AUDIENCE,
        jwks,
        nonce: 'other',
      })
    ).toThrow(TokenError);
  });

  it('rejects a tampered payload', () => {
    const [header, , signature] = sign(validClaims()).split('.') as [string, string, string];
    const forged = base64url(validClaims({ sub: 'admin' }));
    expect(() =>
      verifyIdToken(`${header}.${forged}.${signature}`, {
        issuer: ISSUER,
        audience: AUDIENCE,
        jwks,
      })
    ).toThrow(TokenError);
  });

  it('rejects unsupported algorithms and malformed tokens', () => {
    const unsigned = `${base64url({ alg: 'none' })}.${base64url(validClaims())}.`;
    expect(() =>
      verifyIdToken(unsigned, { issuer: ISSUER, audience: AUDIENCE, jwks })
    ).toThrow(TokenError);
    expect(() => verifyIdToken('not-a-token', { issuer: ISSUER, audience: AUDIENCE, jwks })).toThrow(
      TokenError
    );
  });

  it('rejects a token signed by a key outside the key set', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const header = base64url({ alg: 'RS256', typ: 'JWT', kid: 'missing' });
    const payload = base64url(validClaims());
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const signature = signer.sign(other.privateKey).toString('base64url');
    expect(() =>
      verifyIdToken(`${header}.${payload}.${signature}`, {
        issuer: ISSUER,
        audience: AUDIENCE,
        jwks,
      })
    ).toThrow(TokenError);
  });
});
