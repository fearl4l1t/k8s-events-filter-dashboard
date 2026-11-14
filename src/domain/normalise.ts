// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { parseIsoTimestamp } from './timestamps';
import type {
  NormalisedEvent,
  EventApiVersion,
  TimestampSource,
  OccurrenceCountStatus,
  NormalisedObjectRef,
} from './types';

interface CandidateField {
  source: TimestampSource;
  value: unknown;
}

function resolveTimestamp(candidates: CandidateField[]): {
  timestamp: string | null;
  source: TimestampSource;
} {
  for (const candidate of candidates) {
    if (candidate.value !== undefined && candidate.value !== null) {
      const parsed = parseIsoTimestamp(candidate.value);
      if (parsed) {
        return { timestamp: parsed, source: candidate.source };
      }
      // Field is present but invalid: do not fallback to lower-priority fields
      return { timestamp: null, source: candidate.source };
    }
  }
  return { timestamp: null, source: 'none' };
}

function resolveOccurrenceCount(rawCount: unknown): {
  count: number | null;
  status: OccurrenceCountStatus;
} {
  if (rawCount === undefined || rawCount === null) {
    return { count: null, status: 'missing' };
  }
  if (typeof rawCount === 'number' && Number.isInteger(rawCount) && rawCount > 0) {
    return { count: rawCount, status: 'valid' };
  }
  return { count: null, status: 'invalid' };
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null;
}

/**
 * Normalizes any Kubernetes Event record (events.k8s.io/v1 or core/v1)
 * into a standard NormalisedEvent structure.
 */
export function normaliseEvent(
  raw: unknown,
  index = 0,
  fallbackPrefix = 'event'
): NormalisedEvent {
  if (!isRecord(raw)) {
    return {
      id: `${fallbackPrefix}-${index}`,
      apiVersion: 'events.k8s.io/v1',
      uid: null,
      namespace: null,
      type: null,
      reason: null,
      message: null,
      action: null,
      object: {
        apiVersion: null,
        kind: null,
        name: null,
        namespace: null,
        uid: null,
      },
      reporter: null,
      firstObservedAt: null,
      lastObservedAt: null,
      occurrenceCount: null,
      occurrenceCountStatus: 'invalid',
      createdAt: null,
      timestampSource: {
        first: 'none',
        last: 'none',
      },
      timestampValid: false,
      validationIssues: ['Event record must be an object.'],
      rawEvent: raw,
    };
  }

  const validationIssues: string[] = [];
  const addMalformedField = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      validationIssues.push(`${key} must be a string when supplied.`);
    }
  };

  const metadata = isRecord(raw['metadata']) ? raw['metadata'] : null;
  if (!metadata) validationIssues.push('metadata is missing or malformed.');
  const suppliedApiVersion = raw['apiVersion'];
  if (suppliedApiVersion !== 'events.k8s.io/v1' && suppliedApiVersion !== 'v1') {
    validationIssues.push('apiVersion is missing or unsupported.');
  }
  if (metadata) {
    addMalformedField('metadata.uid', metadata['uid']);
    addMalformedField('metadata.namespace', metadata['namespace']);
  }
  const uid = typeof metadata?.['uid'] === 'string' && metadata['uid'].trim() ? metadata['uid'].trim() : null;
  const id = uid ?? `${fallbackPrefix}-${index}`;

  const rawApiVersion = typeof raw['apiVersion'] === 'string' ? raw['apiVersion'].trim() : '';
  const apiVersion: EventApiVersion = rawApiVersion === 'v1' ? 'v1' : 'events.k8s.io/v1';

  const namespace = typeof metadata?.['namespace'] === 'string' ? metadata['namespace'] : null;

  let type: 'Normal' | 'Warning' | null = null;
  if (raw['type'] === 'Normal' || raw['type'] === 'Warning') {
    type = raw['type'];
  } else if (raw['type'] !== undefined && raw['type'] !== null) {
    validationIssues.push('type must be Normal or Warning when supplied.');
  }

  addMalformedField('reason', raw['reason']);
  addMalformedField('action', raw['action']);
  const reason = typeof raw['reason'] === 'string' ? raw['reason'] : null;
  const action = typeof raw['action'] === 'string' ? raw['action'] : null;

  // Message / Note
  let message: string | null = null;
  if (apiVersion === 'events.k8s.io/v1') {
    if (typeof raw['note'] === 'string') {
      message = raw['note'];
    } else if (typeof raw['message'] === 'string') {
      message = raw['message'];
    }
  } else {
    if (typeof raw['message'] === 'string') {
      message = raw['message'];
    } else if (typeof raw['note'] === 'string') {
      message = raw['note'];
    }
  }
  addMalformedField(apiVersion === 'events.k8s.io/v1' ? 'note' : 'message',
    apiVersion === 'events.k8s.io/v1' ? raw['note'] : raw['message']);

  // Object reference
  const rawObj = apiVersion === 'events.k8s.io/v1' ? raw['regarding'] ?? raw['involvedObject'] : raw['involvedObject'] ?? raw['regarding'];
  if (!isRecord(rawObj)) validationIssues.push('Object reference is missing or malformed.');
  const objectRef: NormalisedObjectRef = {
    apiVersion: isRecord(rawObj) && typeof rawObj['apiVersion'] === 'string' ? rawObj['apiVersion'] : null,
    kind: isRecord(rawObj) && typeof rawObj['kind'] === 'string' ? rawObj['kind'] : null,
    name: isRecord(rawObj) && typeof rawObj['name'] === 'string' ? rawObj['name'] : null,
    namespace: isRecord(rawObj) && typeof rawObj['namespace'] === 'string' ? rawObj['namespace'] : null,
    uid: isRecord(rawObj) && typeof rawObj['uid'] === 'string' ? rawObj['uid'] : null,
  };

  // Reporter
  let reporter: string | null = null;
  if (typeof raw['reportingController'] === 'string' && raw['reportingController'].trim()) {
    reporter = raw['reportingController'].trim();
  } else if (typeof raw['reportingInstance'] === 'string' && raw['reportingInstance'].trim()) {
    reporter = raw['reportingInstance'].trim();
  } else if (isRecord(raw['source']) && typeof raw['source']['component'] === 'string' && raw['source']['component'].trim()) {
    reporter = raw['source']['component'].trim();
  }

  // Occurrence count
  const series = isRecord(raw['series']) ? raw['series'] : null;
  const rawCount = series ? series['count'] : raw['count'];
  const { count: occurrenceCount, status: occurrenceCountStatus } = resolveOccurrenceCount(rawCount);
  if (occurrenceCountStatus === 'invalid') {
    validationIssues.push('Occurrence count is invalid; it must be a positive integer.');
  }

  // Creation timestamp
  const createdAt = metadata?.['creationTimestamp'] ? parseIsoTimestamp(metadata['creationTimestamp']) : null;

  // First observed timestamp candidates
  let firstCandidates: CandidateField[];
  if (apiVersion === 'events.k8s.io/v1') {
    firstCandidates = [
      { source: 'eventTime', value: raw['eventTime'] },
      { source: 'creationTimestamp', value: metadata?.['creationTimestamp'] },
    ];
  } else {
    firstCandidates = [
      { source: 'eventTime', value: raw['eventTime'] },
      { source: 'firstTimestamp', value: raw['firstTimestamp'] },
      { source: 'creationTimestamp', value: metadata?.['creationTimestamp'] },
    ];
  }
  const firstResolved = resolveTimestamp(firstCandidates);

  // Last observed timestamp candidates
  let lastCandidates: CandidateField[];
  if (apiVersion === 'events.k8s.io/v1') {
    lastCandidates = [
      { source: 'series', value: series ? series['lastObservedTime'] : undefined },
      { source: 'eventTime', value: raw['eventTime'] },
      { source: 'creationTimestamp', value: metadata?.['creationTimestamp'] },
    ];
  } else {
    lastCandidates = [
      { source: 'series', value: series ? series['lastObservedTime'] : undefined },
      { source: 'lastTimestamp', value: raw['lastTimestamp'] },
      { source: 'eventTime', value: raw['eventTime'] },
      { source: 'firstTimestamp', value: raw['firstTimestamp'] },
      { source: 'creationTimestamp', value: metadata?.['creationTimestamp'] },
    ];
  }
  const lastResolved = resolveTimestamp(lastCandidates);

  const timestampValid = lastResolved.timestamp !== null;
  if (lastResolved.source !== 'none' && !timestampValid) {
    validationIssues.push(`Last-observed timestamp from ${lastResolved.source} is invalid.`);
  }
  if (firstResolved.source !== 'none' && firstResolved.timestamp === null) {
    validationIssues.push(`First-observed timestamp from ${firstResolved.source} is invalid.`);
  }

  return {
    id,
    apiVersion,
    uid,
    namespace,
    type,
    reason,
    message,
    action,
    object: objectRef,
    reporter,
    firstObservedAt: firstResolved.timestamp,
    lastObservedAt: lastResolved.timestamp,
    occurrenceCount,
    occurrenceCountStatus,
    createdAt,
    timestampSource: {
      first: firstResolved.source,
      last: lastResolved.source,
    },
    timestampValid,
    validationIssues,
    rawEvent: raw,
  };
}
