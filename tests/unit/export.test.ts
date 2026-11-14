// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect, vi } from 'vitest';
import { sanitizeCsvCell, exportEventsToCsv, exportEventsToJson, downloadFile } from '../../src/domain/export';
import { NOT_SUPPLIED } from '../../src/domain/constants';
import type { NormalisedEvent } from '../../src/domain/types';

describe('export', () => {
  describe('sanitizeCsvCell', () => {
    it('returns NOT_SUPPLIED for null or undefined', () => {
      expect(sanitizeCsvCell(null)).toBe(NOT_SUPPLIED);
      expect(sanitizeCsvCell(undefined)).toBe(NOT_SUPPLIED);
    });

    it('mitigates spreadsheet formula injection by prepending single quote', () => {
      expect(sanitizeCsvCell('=1+1')).toBe("'=1+1");
      expect(sanitizeCsvCell('+cmd|')).toBe("'+cmd|");
      expect(sanitizeCsvCell('-SUM(A1:A10)')).toBe("'-SUM(A1:A10)");
      expect(sanitizeCsvCell('@calc')).toBe("'@calc");
      expect(sanitizeCsvCell('\ttext')).toBe("'\ttext");
      expect(sanitizeCsvCell('\rtext')).toBe('"\'\rtext"');
    });

    it('quotes strings containing commas or double quotes and escapes quotes', () => {
      expect(sanitizeCsvCell('Hello, world')).toBe('"Hello, world"');
      expect(sanitizeCsvCell('Error "500" occurred')).toBe('"Error ""500"" occurred"');
    });
  });

  describe('exportEventsToCsv', () => {
    it('generates valid CSV with headers and sanitized rows', () => {
      const mockEvent: NormalisedEvent = {
        id: 'e1',
        apiVersion: 'events.k8s.io/v1',
        uid: 'uid-1',
        namespace: 'payments',
        type: 'Warning',
        reason: 'BackOff',
        message: 'Back-off pulling image, retry later',
        action: null,
        object: { apiVersion: 'v1', kind: 'Pod', name: 'payment-api', namespace: 'payments', uid: '1' },
        reporter: 'k8s.io/kubelet',
        firstObservedAt: '2026-11-14T10:00:00.000Z',
        lastObservedAt: '2026-11-14T10:05:00.000Z',
        occurrenceCount: 5,
        occurrenceCountStatus: 'valid',
        createdAt: '2026-11-14T10:00:00.000Z',
        timestampSource: { first: 'eventTime', last: 'series' },
        timestampValid: true,
        validationIssues: [],
        rawEvent: { test: 123 },
      };

      const csv = exportEventsToCsv([mockEvent]);
      const lines = csv.split('\r\n');

      expect(lines.length).toBe(2);
      expect(lines[0]).toContain('Last Observed (UTC),First Observed (UTC),Namespace,Type');
      expect(lines[1]).toContain('payments,Warning,BackOff,Pod,payment-api,5,"Back-off pulling image, retry later"');
    });
  });

  describe('exportEventsToJson', () => {
    it('preserves untouched original rawEvent shapes', () => {
      const raw = {
        apiVersion: 'events.k8s.io/v1',
        customClusterField: 'unmodified-value',
        metadata: { uid: 'raw-1' },
      };
      const mockEvent = {
        id: 'e1',
        rawEvent: raw,
      } as unknown as NormalisedEvent;

      const jsonStr = exportEventsToJson([mockEvent]);
      const parsed = JSON.parse(jsonStr);

      expect(parsed).toEqual([raw]);
      expect(parsed[0].customClusterField).toBe('unmodified-value');
    });
  });

  describe('downloadFile', () => {
    it('creates anchor and triggers click for file download', async () => {
      const createElementSpy = vi.spyOn(document, 'createElement');
      const appendSpy = vi.spyOn(document.body, 'appendChild');
      const removeSpy = vi.spyOn(document.body, 'removeChild');

      window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      window.URL.revokeObjectURL = vi.fn();

      downloadFile('test content', 'test.csv', 'text/csv;charset=utf-8;');

      expect(createElementSpy).toHaveBeenCalledWith('a');
      expect(appendSpy).toHaveBeenCalled();
      expect(removeSpy).toHaveBeenCalled();
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });
  });
});
