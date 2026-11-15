// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect } from 'vitest';
import {
  parseIsoTimestamp,
  formatDisplayTimestamp,
  formatCompactTimestamp,
  isWithinTimeRange,
  parseUtcDateTimeLocal,
  parseCustomTimeBound,
  utcTimestampToDateTimeLocal,
  timeBucketToUtcRange,
} from '../../src/timestamps';
import { NOT_SUPPLIED } from '../../src/constants';
import type { TimeRangePreset } from '../../src/types';

describe('timestamps', () => {
  describe('parseIsoTimestamp', () => {
    it('parses valid ISO timestamps to UTC ISO string', () => {
      expect(parseIsoTimestamp('2026-11-14T10:00:00Z')).toBe('2026-11-14T10:00:00.000Z');
      expect(parseIsoTimestamp('2026-11-14T15:30:00+05:30')).toBe('2026-11-14T10:00:00.000Z');
    });

    it('returns null for invalid inputs', () => {
      expect(parseIsoTimestamp(null)).toBeNull();
      expect(parseIsoTimestamp(undefined)).toBeNull();
      expect(parseIsoTimestamp('')).toBeNull();
      expect(parseIsoTimestamp('   ')).toBeNull();
      expect(parseIsoTimestamp('invalid date')).toBeNull();
      expect(parseIsoTimestamp(12345678)).toBeNull();
      expect(parseIsoTimestamp({})).toBeNull();
    });
  });

  describe('formatDisplayTimestamp & formatCompactTimestamp', () => {
    it('formats null or invalid date to NOT_SUPPLIED', () => {
      expect(formatDisplayTimestamp(null)).toBe(NOT_SUPPLIED);
      expect(formatDisplayTimestamp('invalid')).toBe(NOT_SUPPLIED);
      expect(formatCompactTimestamp(null)).toBe(NOT_SUPPLIED);
      expect(formatCompactTimestamp('invalid')).toBe(NOT_SUPPLIED);
    });

    it('formats valid ISO strings nicely', () => {
      const valid = '2026-11-14T10:00:00.000Z';
      const display = formatDisplayTimestamp(valid);
      expect(display).not.toBe(NOT_SUPPLIED);
      expect(display.length).toBeGreaterThan(5);

      const compact = formatCompactTimestamp(valid);
      expect(compact).not.toBe(NOT_SUPPLIED);
    });
  });

  describe('UTC datetime-local bounds', () => {
    it('parses zone-less input as UTC regardless of the machine timezone', () => {
      expect(parseUtcDateTimeLocal('2026-11-14T10:30')).toBe(Date.UTC(2026, 10, 14, 10, 30));
      expect(parseUtcDateTimeLocal('2026-02-30T10:30')).toBeNull();
      expect(parseCustomTimeBound('2026-11-14T10:30:00.000Z')).toBe(Date.UTC(2026, 10, 14, 10, 30));
      expect(utcTimestampToDateTimeLocal('2026-11-14T10:30:00.000Z')).toBe('2026-11-14T10:30:00.000');
    });

    it('creates non-overlapping inclusive ranges from chart buckets', () => {
      expect(timeBucketToUtcRange(
        '2026-11-14T10:00:00.000Z',
        '2026-11-14T10:10:00.000Z',
        false
      )).toEqual({
        preset: 'custom',
        customStart: '2026-11-14T10:00:00.000Z',
        customEnd: '2026-11-14T10:09:59.999Z',
      });
      expect(timeBucketToUtcRange(
        '2026-11-14T10:10:00.000Z',
        '2026-11-14T10:20:00.000Z',
        true
      ).customStart).toBe('2026-11-14T10:10:00.000Z');
    });
  });

  describe('isWithinTimeRange', () => {
    const clock = '2026-11-14T12:00:00.000Z';

    it('returns true for preset "all" regardless of validity', () => {
      expect(isWithinTimeRange(null, false, { preset: 'all' }, clock)).toBe(true);
      expect(isWithinTimeRange('invalid', false, { preset: 'all' }, clock)).toBe(true);
      expect(isWithinTimeRange('2026-11-14T10:00:00.000Z', true, { preset: 'all' }, clock)).toBe(true);
    });

    it('excludes records with invalid or null timestamps in bounded ranges', () => {
      expect(isWithinTimeRange(null, false, { preset: '1h' }, clock)).toBe(false);
      expect(isWithinTimeRange('2026-11-14T11:30:00.000Z', false, { preset: '1h' }, clock)).toBe(false);
      expect(isWithinTimeRange('invalid-date', true, { preset: '1h' }, clock)).toBe(false);
    });

    it('correctly filters for relative presets (15m, 1h, 6h, 24h)', () => {
      const t10mAgo = '2026-11-14T11:50:00.000Z';
      const t30mAgo = '2026-11-14T11:30:00.000Z';
      const t2hAgo = '2026-11-14T10:00:00.000Z';
      const t10hAgo = '2026-11-14T02:00:00.000Z';
      const t30hAgo = '2026-11-13T00:00:00.000Z';

      // 15m
      expect(isWithinTimeRange(t10mAgo, true, { preset: '15m' }, clock)).toBe(true);
      expect(isWithinTimeRange(t30mAgo, true, { preset: '15m' }, clock)).toBe(false);

      // 1h
      expect(isWithinTimeRange(t30mAgo, true, { preset: '1h' }, clock)).toBe(true);
      expect(isWithinTimeRange(t2hAgo, true, { preset: '1h' }, clock)).toBe(false);

      // 6h
      expect(isWithinTimeRange(t2hAgo, true, { preset: '6h' }, clock)).toBe(true);
      expect(isWithinTimeRange(t10hAgo, true, { preset: '6h' }, clock)).toBe(false);

      // 24h
      expect(isWithinTimeRange(t10hAgo, true, { preset: '24h' }, clock)).toBe(true);
      expect(isWithinTimeRange(t30hAgo, true, { preset: '24h' }, clock)).toBe(false);
    });

    it('excludes relative ranges when the server anchor is missing or invalid', () => {
      const t10mAgo = '2026-11-14T11:50:00.000Z';
      expect(isWithinTimeRange(t10mAgo, true, { preset: '15m' }, null)).toBe(false);
      expect(isWithinTimeRange(t10mAgo, true, { preset: '1h' }, 'not-a-date')).toBe(false);
    });

    it('correctly filters custom inclusive ranges and handles invalid custom bounds', () => {
      const customRange = {
        preset: 'custom' as const,
        customStart: '2026-11-14T10:00:00.000Z',
        customEnd: '2026-11-14T11:00:00.000Z',
      };

      expect(isWithinTimeRange('2026-11-14T10:00:00.000Z', true, customRange, clock)).toBe(true);
      expect(isWithinTimeRange('2026-11-14T10:30:00.000Z', true, customRange, clock)).toBe(true);
      expect(isWithinTimeRange('2026-11-14T11:00:00.000Z', true, customRange, clock)).toBe(true);
      expect(isWithinTimeRange('2026-11-14T09:59:59.000Z', true, customRange, clock)).toBe(false);
      expect(isWithinTimeRange('2026-11-14T11:00:01.000Z', true, customRange, clock)).toBe(false);

      // Custom start only
      expect(
        isWithinTimeRange(
          '2026-11-14T12:00:00.000Z',
          true,
          { preset: 'custom', customStart: '2026-11-14T10:00:00.000Z', customEnd: null },
          clock
        )
      ).toBe(true);

      // Custom end only
      expect(
        isWithinTimeRange(
          '2026-11-14T08:00:00.000Z',
          true,
          { preset: 'custom', customStart: null, customEnd: '2026-11-14T10:00:00.000Z' },
          clock
        )
      ).toBe(true);

      // Invalid custom bounds
      expect(
        isWithinTimeRange(
          '2026-11-14T10:00:00.000Z',
          true,
          { preset: 'custom', customStart: 'invalid', customEnd: '2026-11-14T11:00:00.000Z' },
          clock
        )
      ).toBe(false);

      // Invalid anchor clock
      expect(isWithinTimeRange('2026-11-14T10:00:00.000Z', true, { preset: '1h' }, 'invalid-clock')).toBe(false);
    });
  });

  describe('input guards', () => {
    it('rejects non-ISO and impossible timestamp strings', () => {
      expect(parseIsoTimestamp('2026-11-14')).toBeNull();
      expect(parseIsoTimestamp('2026-13-45T99:99:00Z')).toBeNull();
      expect(parseIsoTimestamp(12345)).toBeNull();
      expect(parseIsoTimestamp('   ')).toBeNull();
    });

    it('treats an unknown preset as unbounded', () => {
      const clock = '2026-11-14T12:00:00.000Z';
      const preset = 'bogus' as unknown as TimeRangePreset;
      expect(isWithinTimeRange('2026-11-14T11:50:00.000Z', true, { preset }, clock)).toBe(true);
    });
  });

});
