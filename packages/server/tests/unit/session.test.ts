// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  decryptSession,
  encryptSession,
  newSession,
  parseCookies,
  serializeCookie,
  sessionCookie,
  SESSION_COOKIE,
} from '../../src/auth/session';

const SECRET = randomBytes(32).toString('base64');

describe('session cookies', () => {
  it('round-trips a session payload', () => {
    const session = newSession('user-1', 'Alice', ['viewer']);
    const encrypted = encryptSession(session, SECRET);
    expect(encrypted).not.toContain('user-1');
    expect(decryptSession(encrypted, SECRET)).toEqual(session);
  });

  it('rejects a tampered payload', () => {
    const encrypted = encryptSession(newSession('user-1', null, []), SECRET);
    const bytes = Buffer.from(encrypted, 'base64url');
    const last = bytes.at(-1);
    if (last === undefined) throw new Error('Expected a session payload.');
    bytes[bytes.length - 1] = last ^ 0xff;
    expect(decryptSession(bytes.toString('base64url'), SECRET)).toBeNull();
  });

  it('rejects a payload encrypted with another secret', () => {
    const encrypted = encryptSession(newSession('user-1', null, []), SECRET);
    expect(decryptSession(encrypted, randomBytes(32).toString('base64'))).toBeNull();
  });

  it('expires sessions in the past', () => {
    const session = newSession('user-1', null, [], 1000);
    const encrypted = encryptSession(session, SECRET);
    expect(decryptSession(encrypted, SECRET, 1000 + 8 * 60 * 60 + 1)).toBeNull();
  });

  it('rejects unreadable values and short secrets', () => {
    expect(decryptSession('%%%', SECRET)).toBeNull();
    expect(decryptSession('abc', SECRET)).toBeNull();
    expect(() => encryptSession(newSession('a', null, []), 'c2hvcnQ=')).toThrow();
  });

  it('serializes an HTTP-only, same-site cookie', () => {
    const cookie = sessionCookie(newSession('user-1', null, ['viewer']), SECRET, true);
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=');
  });

  it('parses cookie headers without a library', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('a=1; b=two%20words; broken')).toEqual({ a: '1', b: 'two words' });
    expect(serializeCookie('x', 'y', { maxAge: 0 })).toBe('x=y; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  });
});
