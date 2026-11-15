// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { createPublicKey, verify as verifySignature } from 'node:crypto';

export type Jwk = {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
};

export type Jwks = { keys: Jwk[] };

export type IdTokenClaims = {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat?: number;
  nonce?: string;
  name?: string;
  preferred_username?: string;
  [claim: string]: unknown;
};

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenError';
  }
}

function decodeSegment<T>(segment: string): T {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
  } catch {
    throw new TokenError('Token segment is not readable.');
  }
}

type JwtHeader = { alg?: string; kid?: string; typ?: string };

/** Verifies an OIDC ID token's signature and standard claims. */
export function verifyIdToken(
  token: string,
  options: {
    issuer: string;
    audience: string;
    jwks: Jwks;
    nonce?: string;
    now?: number;
    clockSkewSeconds?: number;
  }
): IdTokenClaims {
  const segments = token.split('.');
  if (segments.length !== 3) throw new TokenError('Token is not a signed JWT.');
  const [headerSegment, payloadSegment, signatureSegment] = segments as [string, string, string];
  const header = decodeSegment<JwtHeader>(headerSegment);
  const claims = decodeSegment<IdTokenClaims>(payloadSegment);
  const signature = Buffer.from(signatureSegment, 'base64url');

  if (header.alg !== 'RS256' && header.alg !== 'ES256') {
    throw new TokenError('Token signing algorithm is not supported.');
  }

  const candidateKeys = options.jwks.keys.filter((key) =>
    header.kid ? key.kid === header.kid : true
  );
  const verified = candidateKeys.some((jwk) => {
    try {
      const key = createPublicKey({
        key: jwk,
        format: 'jwk',
      } as unknown as Parameters<typeof createPublicKey>[0]);
      const data = Buffer.from(`${headerSegment}.${payloadSegment}`);
      return header.alg === 'RS256'
        ? verifySignature('RSA-SHA256', data, key, signature)
        : verifySignature('SHA256', data, { key, dsaEncoding: 'ieee-p1363' }, signature);
    } catch {
      return false;
    }
  });
  if (!verified) throw new TokenError('Token signature could not be verified.');

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const skew = options.clockSkewSeconds ?? 60;
  if (claims.iss !== options.issuer) throw new TokenError('Token issuer does not match.');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(options.audience)) throw new TokenError('Token audience does not match.');
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) {
    throw new TokenError('Token has expired.');
  }
  if (typeof claims.sub !== 'string' || claims.sub === '') {
    throw new TokenError('Token has no subject.');
  }
  if (options.nonce !== undefined && claims.nonce !== options.nonce) {
    throw new TokenError('Token nonce does not match.');
  }
  return claims;
}
