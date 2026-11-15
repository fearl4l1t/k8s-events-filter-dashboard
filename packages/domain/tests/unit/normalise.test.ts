// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect } from 'vitest';
import { normaliseEvent } from '../../src/normalise';

const CONTEXT = { clusterId: 'kind-dev', clusterName: 'kind-dev', source: 'local' as const };

describe('normaliseEvent', () => {
  it('normalises events.k8s.io/v1 event correctly', () => {
    const raw = {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        uid: 'uid-12345',
        namespace: 'payments',
        creationTimestamp: '2026-11-14T10:00:00Z',
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'payment-service-abc',
        namespace: 'payments',
        uid: 'pod-123',
      },
      reason: 'BackOff',
      note: 'Back-off pulling image',
      type: 'Warning',
      reportingController: 'k8s.io/kubelet',
      action: 'Pulling',
      eventTime: '2026-11-14T10:00:00Z',
      series: {
        count: 5,
        lastObservedTime: '2026-11-14T10:05:00Z',
      },
    };

    const norm = normaliseEvent(raw, CONTEXT, 0);

    expect(norm.id).toBe('kind-dev/uid-12345');
    expect(norm.clusterId).toBe('kind-dev');
    expect(norm.clusterName).toBe('kind-dev');
    expect(norm.source).toBe('local');
    expect(norm.apiVersion).toBe('events.k8s.io/v1');
    expect(norm.namespace).toBe('payments');
    expect(norm.type).toBe('Warning');
    expect(norm.reason).toBe('BackOff');
    expect(norm.message).toBe('Back-off pulling image');
    expect(norm.object.kind).toBe('Pod');
    expect(norm.object.name).toBe('payment-service-abc');
    expect(norm.reporter).toBe('k8s.io/kubelet');
    expect(norm.firstObservedAt).toBe('2026-11-14T10:00:00.000Z');
    expect(norm.lastObservedAt).toBe('2026-11-14T10:05:00.000Z');
    expect(norm.occurrenceCount).toBe(5);
    expect(norm.occurrenceCountStatus).toBe('valid');
    expect(norm.timestampSource.first).toBe('eventTime');
    expect(norm.timestampSource.last).toBe('series');
    expect(norm.timestampValid).toBe(true);
    expect(norm.rawEvent).toBe(raw);
  });

  it('normalises core v1 event correctly', () => {
    const raw = {
      apiVersion: 'v1',
      kind: 'Event',
      metadata: {
        name: 'nginx-reload.123',
        namespace: 'default',
        creationTimestamp: '2026-11-14T11:00:00Z',
      },
      involvedObject: {
        kind: 'Deployment',
        name: 'nginx-web',
        namespace: 'default',
      },
      reason: 'ScalingReplicaSet',
      message: 'Scaled up replica set',
      type: 'Normal',
      source: {
        component: 'deployment-controller',
      },
      firstTimestamp: '2026-11-14T11:00:00Z',
      lastTimestamp: '2026-11-14T11:02:00Z',
      count: 2,
    };

    const norm = normaliseEvent(raw, CONTEXT, 3);

    expect(norm.id).toBe('kind-dev/default/Deployment/nginx-web/3');
    expect(norm.apiVersion).toBe('v1');
    expect(norm.type).toBe('Normal');
    expect(norm.message).toBe('Scaled up replica set');
    expect(norm.reporter).toBe('deployment-controller');
    expect(norm.firstObservedAt).toBe('2026-11-14T11:00:00.000Z');
    expect(norm.lastObservedAt).toBe('2026-11-14T11:02:00.000Z');
    expect(norm.timestampSource.first).toBe('firstTimestamp');
    expect(norm.timestampSource.last).toBe('lastTimestamp');
    expect(norm.occurrenceCount).toBe(2);
    expect(norm.occurrenceCountStatus).toBe('valid');
    expect(norm.timestampValid).toBe(true);
  });

  it('falls back to creationTimestamp when eventTime is absent', () => {
    const raw = {
      apiVersion: 'events.k8s.io/v1',
      metadata: {
        creationTimestamp: '2026-11-14T12:00:00Z',
      },
      reason: 'Created',
    };

    const norm = normaliseEvent(raw, CONTEXT);
    expect(norm.firstObservedAt).toBe('2026-11-14T12:00:00.000Z');
    expect(norm.lastObservedAt).toBe('2026-11-14T12:00:00.000Z');
    expect(norm.timestampSource.first).toBe('creationTimestamp');
    expect(norm.timestampSource.last).toBe('creationTimestamp');
    expect(norm.timestampValid).toBe(true);
  });

  it('marks timestamp as invalid when field is present but malformed, and does not fallback', () => {
    const raw = {
      apiVersion: 'events.k8s.io/v1',
      metadata: {
        creationTimestamp: '2026-11-14T12:00:00Z',
      },
      eventTime: 'MALFORMED_DATE_STRING',
      reason: 'Error',
    };

    const norm = normaliseEvent(raw, CONTEXT);
    expect(norm.firstObservedAt).toBeNull();
    expect(norm.lastObservedAt).toBeNull();
    expect(norm.timestampSource.first).toBe('eventTime');
    expect(norm.timestampSource.last).toBe('eventTime');
    expect(norm.timestampValid).toBe(false);
  });

  it('handles missing occurrence count as null with status missing without inferring 1', () => {
    const raw = {
      apiVersion: 'events.k8s.io/v1',
      metadata: { namespace: 'default' },
    };

    const norm = normaliseEvent(raw, CONTEXT);
    expect(norm.occurrenceCount).toBeNull();
    expect(norm.occurrenceCountStatus).toBe('missing');
  });

  it('handles invalid occurrence counts (negative, string, float)', () => {
    const rawNegative = {
      apiVersion: 'v1',
      count: -5,
    };
    const normNeg = normaliseEvent(rawNegative, CONTEXT);
    expect(normNeg.occurrenceCount).toBeNull();
    expect(normNeg.occurrenceCountStatus).toBe('invalid');

    const rawString = {
      apiVersion: 'v1',
      count: 'invalid',
    };
    const normStr = normaliseEvent(rawString, CONTEXT);
    expect(normStr.occurrenceCount).toBeNull();
    expect(normStr.occurrenceCountStatus).toBe('invalid');
  });

  it('handles non-object input defensively without throwing', () => {
    const normNull = normaliseEvent(null, CONTEXT, 1);
    expect(normNull.timestampValid).toBe(false);
    expect(normNull.id).toBe('kind-dev/unknown/unknown/unknown/1');
    expect(normNull.rawEvent).toBeNull();

    const normString = normaliseEvent('corrupted', CONTEXT, 2);
    expect(normString.timestampValid).toBe(false);
    expect(normString.id).toBe('kind-dev/unknown/unknown/unknown/2');
    expect(normString.validationIssues).toContain('Event record must be an object.');
  });

  it('retains and diagnoses malformed supplied fields without changing the raw record', () => {
    const raw = {
      apiVersion: 'events.k8s.io/v1',
      metadata: 'malformed',
      regarding: 'not-an-object',
      type: 'Critical',
      eventTime: 'not-a-timestamp',
      series: { count: -3 },
    };
    const normalized = normaliseEvent(raw, CONTEXT);
    expect(normalized.validationIssues).toEqual(expect.arrayContaining([
      'metadata is missing or malformed.',
      'Object reference is missing or malformed.',
      'type must be Normal or Warning when supplied.',
      'Occurrence count is invalid; it must be a positive integer.',
      'Last-observed timestamp from eventTime is invalid.',
    ]));
    expect(normalized.rawEvent).toBe(raw);
  });

  it('handles cross-version fallbacks for message, object, and reportingInstance', () => {
    // events.k8s.io/v1 with message instead of note, involvedObject instead of regarding, and reportingInstance
    const rawEventsV1 = {
      apiVersion: 'events.k8s.io/v1',
      message: 'fallback message in events v1',
      involvedObject: { kind: 'Node', name: 'worker-1' },
      reportingInstance: 'kubelet-worker-1',
    };
    const norm1 = normaliseEvent(rawEventsV1, CONTEXT);
    expect(norm1.message).toBe('fallback message in events v1');
    expect(norm1.object.kind).toBe('Node');
    expect(norm1.reporter).toBe('kubelet-worker-1');

    // core v1 with note instead of message and regarding instead of involvedObject
    const rawCoreV1 = {
      apiVersion: 'v1',
      note: 'fallback note in core v1',
      regarding: { kind: 'Service', name: 'api-svc' },
    };
    const norm2 = normaliseEvent(rawCoreV1, CONTEXT);
    expect(norm2.message).toBe('fallback note in core v1');
    expect(norm2.object.kind).toBe('Service');
  });
});
