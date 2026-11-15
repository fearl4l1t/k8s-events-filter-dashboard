// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect } from 'vitest';
import { createLogger } from '../../src/logging';

function capture(level: 'debug' | 'info' | 'warn' | 'error') {
  const lines: string[] = [];
  const logger = createLogger(level, { service: 'test' }, (line) => lines.push(line));
  return { logger, lines };
}

describe('logger', () => {
  it('writes structured JSON entries and respects the level', () => {
    const { logger, lines } = capture('warn');
    logger.debug('hidden');
    logger.info('hidden too');
    logger.warn('visible', { attempt: 2 });
    expect(lines).toHaveLength(1);
    const line = lines.at(0);
    if (line === undefined) throw new Error('Expected one log line.');
    const entry = JSON.parse(line) as Record<string, unknown>;
    expect(entry['level']).toBe('warn');
    expect(entry['message']).toBe('visible');
    expect(entry['attempt']).toBe(2);
    expect(entry['service']).toBe('test');
    expect(typeof entry['time']).toBe('string');
  });

  it('redacts credential fields and bearer tokens', () => {
    const { logger, lines } = capture('info');
    logger.info('connect', {
      token: 'abc',
      clientKey: 'key-material',
      authorization: 'Bearer super-secret',
      nested: { password: 'hunter2', note: 'Bearer abc.def.ghi' },
      message2: '-----BEGIN PRIVATE KEY-----\nxyz\n-----END PRIVATE KEY-----',
    });
    const serialized = lines[0] ?? '';
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('key-material');
    expect(serialized).not.toContain('xyz');
    expect(serialized).toContain('[redacted]');
  });

  it('merges child fields without leaking the parent', () => {
    const { logger, lines } = capture('info');
    logger.child({ cluster: 'ctx-a' }).info('live');
    const line = lines.at(0);
    if (line === undefined) throw new Error('Expected one log line.');
    const entry = JSON.parse(line) as Record<string, unknown>;
    expect(entry['cluster']).toBe('ctx-a');
  });

  it('bounds deeply nested structures', () => {
    const { logger, lines } = capture('info');
    let deep: Record<string, unknown> = { value: 'bottom' };
    for (let index = 0; index < 10; index++) deep = { nested: deep };
    logger.info('deep', deep);
    expect(lines[0]).toContain('[depth]');
  });
});
