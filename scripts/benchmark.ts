// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hostname, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  computeOverviewMetrics,
  exportEventsToCsv,
  filterEvents,
  normaliseEvent,
  sortEvents,
  DEFAULT_SORT,
} from '../packages/domain/src/index';
import type { EventFilters, NormalisedEvent } from '../packages/domain/src/index';

const RECORD_COUNT = 100_000;
const SAMPLES = 15;
const TARGET_P95_MS = 250;

const NAMESPACES = ['payments', 'checkout', 'search', 'platform', 'observability', 'batch', 'edge', 'identity'];
const KINDS = ['Pod', 'Deployment', 'Node', 'ReplicaSet', 'Job', 'StatefulSet'];
const REASONS = [
  'Scheduled',
  'Pulled',
  'Created',
  'Started',
  'BackOff',
  'Failed',
  'Unhealthy',
  'FailedMount',
  'Evicted',
  'NodeNotReady',
  'ScalingReplicaSet',
  'SuccessfulCreate',
];
const BASE_TIME = Date.parse('2026-11-14T12:00:00.000Z');

/** Deterministic 32-bit linear congruential generator; never uses Math.random. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function makeRawEvent(index: number, next: () => number): unknown {
  const namespace = NAMESPACES[Math.floor(next() * NAMESPACES.length)] ?? 'payments';
  const kind = KINDS[Math.floor(next() * KINDS.length)] ?? 'Pod';
  const reason = REASONS[Math.floor(next() * REASONS.length)] ?? 'Scheduled';
  const type = index % 3 === 0 ? 'Warning' : 'Normal';
  const objectName = `${kind.toLowerCase()}-${index % 500}`;
  const lastObserved = new Date(BASE_TIME - index * 60_000).toISOString();
  const firstObserved = new Date(BASE_TIME - index * 60_000 - 300_000).toISOString();
  const count = (index % 12) + 1;

  if (index % 2 === 0) {
    return {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        uid: `bench-${index}`,
        namespace,
        creationTimestamp: firstObserved,
      },
      regarding: { kind, name: objectName, namespace, apiVersion: 'v1' },
      reason,
      note: `${reason} for ${kind}/${objectName} in ${namespace}`,
      type,
      action: 'Benchmark',
      reportingController: 'kubelet',
      eventTime: firstObserved,
      series: { count, lastObservedTime: lastObserved },
    };
  }

  return {
    apiVersion: 'v1',
    kind: 'Event',
    metadata: {
      uid: `bench-${index}`,
      namespace,
      creationTimestamp: firstObserved,
    },
    involvedObject: { kind, name: objectName, namespace, apiVersion: 'v1' },
    reason,
    message: `${reason} for ${kind}/${objectName} in ${namespace}`,
    type,
    count,
    source: { component: 'kubelet' },
    firstTimestamp: firstObserved,
    lastTimestamp: lastObserved,
  };
}

const CONTEXT = { clusterId: 'benchmark', clusterName: 'benchmark', source: 'local' as const };

function buildRecords(): NormalisedEvent[] {
  const next = makeRandom(0x5eed_1234);
  const records: NormalisedEvent[] = [];
  for (let index = 0; index < RECORD_COUNT; index++) {
    records.push(normaliseEvent(makeRawEvent(index, next), CONTEXT, index));
  }
  return records;
}

function percentile(sorted: number[], fraction: number): number {
  const position = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[position] ?? 0;
}

function measure(operation: () => void): { p50: number; p95: number; max: number } {
  for (let i = 0; i < 3; i++) operation();
  const durations: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const started = performance.now();
    operation();
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  return {
    p50: Number(percentile(durations, 0.5).toFixed(2)),
    p95: Number(percentile(durations, 0.95).toFixed(2)),
    max: Number((durations[durations.length - 1] ?? 0).toFixed(2)),
  };
}

const records = buildRecords();
const anchorTime = new Date(BASE_TIME).toISOString();

const namespaceAndTypeFilters: EventFilters = {
  namespaces: ['payments', 'checkout'],
  types: ['Warning'],
  reasons: [],
  resourceKind: null,
  resourceName: '',
  reporter: null,
  searchKeyword: '',
  timeRange: { preset: 'all', customStart: null, customEnd: null },
};

const keywordFilters: EventFilters = {
  ...namespaceAndTypeFilters,
  namespaces: [],
  types: [],
  searchKeyword: 'BackOff',
};

const timeRangeFilters: EventFilters = {
  ...namespaceAndTypeFilters,
  namespaces: [],
  types: [],
  timeRange: { preset: '1h', customStart: null, customEnd: null },
};

const filteredByNamespaceAndType = filterEvents(records, namespaceAndTypeFilters, anchorTime);

const results = {
  scope: 'domain' as const,
  datasetSize: RECORD_COUNT,
  samples: SAMPLES,
  targetP95Ms: TARGET_P95_MS,
  machine: hostname(),
  os: `${platform()} ${release()}`,
  node: process.version,
  generatedAt: new Date().toISOString(),
  operations: {
    namespaceAndTypeFilter: measure(() => {
      filterEvents(records, namespaceAndTypeFilters, anchorTime);
    }),
    keywordSearch: measure(() => {
      filterEvents(records, keywordFilters, anchorTime);
    }),
    boundedTimeRange: measure(() => {
      filterEvents(records, timeRangeFilters, anchorTime);
    }),
    sort: measure(() => {
      sortEvents(filteredByNamespaceAndType, DEFAULT_SORT);
    }),
    summary: measure(() => {
      computeOverviewMetrics(
        filterEvents(records, namespaceAndTypeFilters, anchorTime)
      );
    }),
    exportCsv: measure(() => {
      exportEventsToCsv(filteredByNamespaceAndType);
    }),
  },
};

const targetOperations = [
  'namespaceAndTypeFilter',
  'keywordSearch',
  'boundedTimeRange',
  'summary',
] as const;
const failures = targetOperations.filter(
  (name) => results.operations[name].p95 > TARGET_P95_MS
);

const outputPath = resolve(process.cwd(), 'bench/results.json');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({ ...results, passed: failures.length === 0 }, null, 2)}\n`);

console.log('--- Domain benchmark (100,000 deterministic Event records) ---');
console.log(`${results.machine} | ${results.os} | Node ${results.node}`);
for (const [name, value] of Object.entries(results.operations)) {
  console.log(`${name.padEnd(24)} p50 ${String(value.p50).padStart(8)} ms   p95 ${String(value.p95).padStart(8)} ms   max ${String(value.max).padStart(8)} ms`);
}
console.log(`\nResults written to ${outputPath}`);

if (failures.length > 0) {
  console.error(`FAIL: p95 exceeded ${TARGET_P95_MS} ms for: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`PASS: p95 under ${TARGET_P95_MS} ms for filter, search, time range and summary.`);
