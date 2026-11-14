// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import * as fs from 'node:fs';
import * as path from 'node:path';
import { normaliseEvent } from '../src/domain/normalise';
import { filterEvents } from '../src/domain/filters';
import type { NormalisedEvent, EventFilters } from '../src/domain/types';

const TARGET_RECORDS = 2500;
const MAX_ALLOWED_MS = 250;
const ITERATIONS = 10;
const WARMUP = 10;

function createDeterministicDataset(count: number): NormalisedEvent[] {
  const events: NormalisedEvent[] = [];
  const baseTime = new Date('2026-11-14T00:00:00.000Z').getTime();
  const namespaces = ['default', 'kube-system', 'monitoring', 'payments', 'database'];
  const types = ['Normal', 'Warning'] as const;
  const reasons = ['Scheduled', 'Pulling', 'BackOff', 'FailedScheduling', 'Unhealthy', 'NodeNotReady'];

  for (let i = 0; i < count; i++) {
    const ns = namespaces[i % namespaces.length] ?? 'default';
    const type = types[i % types.length] ?? 'Normal';
    const reason = reasons[i % reasons.length] ?? 'Scheduled';
    const timestamp = new Date(baseTime + i * 10000).toISOString();

    const raw = {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: `bench-event-${i}`,
        namespace: ns,
        uid: `bench-uid-${String(i).padStart(5, '0')}`,
        creationTimestamp: timestamp,
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: `bench-pod-${i % 50}`,
        namespace: ns,
        uid: `pod-uid-${i % 50}`,
      },
      reason,
      note: `Benchmark event ${i} for simulated cluster testing with message contents`,
      type,
      reportingController: 'k8s.io/kubelet',
      eventTime: timestamp,
      series: {
        count: (i % 5) + 1,
        lastObservedTime: timestamp,
      },
    };

    events.push(normaliseEvent(raw, i, 'bench'));
  }

  return events;
}

function measure(fn: () => void, name: string): { name: string; median: number; min: number; max: number; passed: boolean } {
  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    fn();
  }

  // Measurement
  const times: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    times.push(end - start);
  }

  times.sort((a, b) => a - b);
  const min = times[0] ?? 0;
  const max = times[times.length - 1] ?? 0;
  const median = times[Math.floor(times.length / 2)] ?? 0;
  const passed = median <= MAX_ALLOWED_MS;

  console.log(`[${name}] median: ${median.toFixed(3)} ms (min: ${min.toFixed(3)} ms, max: ${max.toFixed(3)} ms) -> ${passed ? 'PASS' : 'FAIL'}`);

  return { name, median, min, max, passed };
}

function main(): void {
  const isReportOnly = process.argv.includes('--report-only');
  console.log(`Generating deterministic dataset of ${TARGET_RECORDS} records...`);
  const dataset = createDeterministicDataset(TARGET_RECORDS);
  const scenarioClock = dataset[dataset.length - 1]?.lastObservedAt ?? null;

  console.log(`Running benchmark on Node ${process.version}...`);

  // Operation 1: Namespace & Type filter
  const filter1: EventFilters = {
    namespaces: ['payments'],
    types: ['Warning'],
    reasons: [],
    resourceKind: null,
    resourceName: '',
    reporter: null,
    searchKeyword: '',
    timeRange: { preset: 'all' },
  };
  const op1 = measure(() => {
    filterEvents(dataset, filter1, scenarioClock);
  }, 'Namespace & Type Filter');

  // Operation 2: Keyword search
  const filter2: EventFilters = {
    namespaces: [],
    types: [],
    reasons: [],
    resourceKind: null,
    resourceName: '',
    reporter: null,
    searchKeyword: 'simulated cluster',
    timeRange: { preset: 'all' },
  };
  const op2 = measure(() => {
    filterEvents(dataset, filter2, scenarioClock);
  }, 'Keyword Search');

  // Operation 3: Bounded time-range change (last 1 hour)
  const filter3: EventFilters = {
    namespaces: [],
    types: [],
    reasons: [],
    resourceKind: null,
    resourceName: '',
    reporter: null,
    searchKeyword: '',
    timeRange: { preset: '1h' },
  };
  const op3 = measure(() => {
    filterEvents(dataset, filter3, scenarioClock);
  }, 'Bounded Time Range (1h)');

  const operations = [op1, op2, op3];
  const allPassed = operations.every((op) => op.passed);

  const results = {
    datasetSize: TARGET_RECORDS,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    timestamp: new Date().toISOString(),
    targetMs: MAX_ALLOWED_MS,
    operations,
    allPassed,
  };

  const benchDir = path.resolve(process.cwd(), 'bench');
  if (!fs.existsSync(benchDir)) {
    fs.mkdirSync(benchDir, { recursive: true });
  }

  const outputPath = path.join(benchDir, 'results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Benchmark results saved to ${outputPath}`);

  if (!allPassed && !isReportOnly) {
    console.error('Benchmark failed: one or more operations exceeded target of 250 ms.');
    process.exit(1);
  }
}

main();
