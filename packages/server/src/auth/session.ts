// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type SessionPayload = {
  sub: string;
  name: string | null;
  roles: string[];
  /** Session expiry, epoch seconds. */
  exp: number;
};

export const SESSION_COOKIE = 'k8s_events_session';
const MAX_SESSION_AGE_SECONDS = 8 * 60 * 60;

function keyFromSecret(secretBase64: string): Buffer {
  const decoded = Buffer.from(secretBase64, 'base64');
  if (decoded.length < 32) {
    throw new Error('Session secret must decode to at least 32 bytes.');
  }
  return createHash('sha256').update(decoded).digest();
}

/** Encrypts the session payload so its contents never travel in clear text. */
export function encryptSession(payload: SessionPayload, secretBase64: string): string {
  const key = keyFromSecret(secretBase64);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

export function decryptSession(
  value: string,
  secretBase64: string,
  now = Math.floor(Date.now() / 1000)
): SessionPayload | null {
  let raw: Buffer;
  try {
    raw = Buffer.from(value, 'base64url');
  } catch {
    return null;
  }
  if (raw.length <= 28) return null;
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secretBase64), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString('utf8')) as Partial<SessionPayload>;
    if (
      typeof parsed.sub !== 'string' ||
      !Array.isArray(parsed.roles) ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    if (parsed.exp <= now) return null;
    return {
      sub: parsed.sub,
      name: typeof parsed.name === 'string' ? parsed.name : null,
      roles: parsed.roles.filter((role): role is string => typeof role === 'string'),
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export function newSession(
  sub: string,
  name: string | null,
  roles: string[],
  now = Math.floor(Date.now() / 1000)
): SessionPayload {
  return { sub, name, roles, exp: now + MAX_SESSION_AGE_SECONDS };
}

/** Parses a Cookie header without a cookie library. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAge?: number; secure?: boolean; sameSite?: 'Lax' | 'Strict' } = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=' + (options.sameSite ?? 'Lax')];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function sessionCookie(
  payload: SessionPayload,
  secretBase64: string,
  secure: boolean
): string {
  return serializeCookie(SESSION_COOKIE, encryptSession(payload, secretBase64), {
    maxAge: Math.max(0, payload.exp - Math.floor(Date.now() / 1000)),
    secure,
  });
}
