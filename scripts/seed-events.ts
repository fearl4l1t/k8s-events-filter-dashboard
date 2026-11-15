// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

/**
 * Creates deterministic Kubernetes Events in the disposable kind cluster so
 * the integration and browser gates have real API data to read.
 *
 * This script is test tooling, not product code: the server only ever lists
 * and watches. It writes through kubectl, so the API server validates every
 * object exactly as it would in a real cluster.
 */
import { execFileSync } from 'node:child_process';

const CONTEXT = process.env['EVENTS_E2E_CONTEXT'] ?? 'kind-k8s-events';
const NAMESPACE_PREFIX = process.env['EVENTS_E2E_NAMESPACE_PREFIX'] ?? 'events-e2e';
const SEED_LABEL = 'app.kubernetes.io/managed-by=events-explorer-seed';

type SeedEvent = {
  namespace: string;
  name: string;
  type: 'Normal' | 'Warning';
  reason: string;
  message: string;
  kind: 'Pod' | 'Deployment' | 'Node';
  objectName: string;
  count?: number;
  /** Minutes before "now"; the API server rejects invalid timestamps, so the
   * seeds use valid ones and the invalid-record state stays a unit concern. */
  minutesAgo: number;
  apiVersion?: 'v1' | 'events.k8s.io/v1';
};

const SHOP = `${NAMESPACE_PREFIX}-shop`;
const PLATFORM = `${NAMESPACE_PREFIX}-platform`;
const OPS = `${NAMESPACE_PREFIX}-ops`;
const NAMESPACES = [SHOP, PLATFORM, OPS];

const NOW = Date.now();

const EVENTS: SeedEvent[] = [
  {
    namespace: SHOP,
    name: 'seed-rollout-ok',
    type: 'Normal',
    reason: 'ScalingReplicaSet',
    message: 'Scaled up replica set seed-web to 3',
    kind: 'Deployment',
    objectName: 'seed-web',
    minutesAgo: 45,
  },
  {
    namespace: SHOP,
    name: 'seed-backoff',
    type: 'Warning',
    reason: 'BackOff',
    message: 'Back-off restarting failed container seed-web in pod seed-web-1',
    kind: 'Pod',
    objectName: 'seed-web-1',
    count: 6,
    minutesAgo: 30,
  },
  {
    namespace: SHOP,
    name: 'seed-pull-failure',
    type: 'Warning',
    reason: 'Failed',
    message: 'Failed to pull image "registry.example.test/checkout:seed"',
    kind: 'Pod',
    objectName: 'seed-checkout-1',
    minutesAgo: 20,
  },
  {
    namespace: PLATFORM,
    name: 'seed-scheduled',
    type: 'Normal',
    reason: 'Scheduled',
    message: 'Successfully assigned platform/seed-api-1 to kind-worker',
    kind: 'Pod',
    objectName: 'seed-api-1',
    minutesAgo: 18,
  },
  {
    namespace: PLATFORM,
    name: 'seed-unhealthy',
    type: 'Warning',
    reason: 'Unhealthy',
    message: 'Readiness probe failed: connection refused',
    kind: 'Pod',
    objectName: 'seed-api-1',
    count: 3,
    minutesAgo: 12,
  },
  {
    namespace: OPS,
    name: 'seed-node-pressure',
    type: 'Warning',
    reason: 'EvictionThresholdMet',
    message: 'Attempting to reclaim memory on node kind-worker',
    kind: 'Node',
    objectName: 'kind-worker',
    minutesAgo: 8,
  },
  {
    namespace: OPS,
    name: 'seed-node-ready',
    type: 'Normal',
    reason: 'NodeReady',
    message: 'Node kind-worker status is now: NodeReady',
    kind: 'Node',
    objectName: 'kind-worker',
    minutesAgo: 5,
  },
  {
    namespace: OPS,
    name: 'seed-events-v1',
    type: 'Normal',
    reason: 'Pulled',
    message: 'Successfully pulled image "registry.example.test/worker:seed"',
    kind: 'Pod',
    objectName: 'seed-worker-1',
    count: 2,
    minutesAgo: 3,
    apiVersion: 'events.k8s.io/v1',
  },
];

function timestamp(minutesAgo: number): string {
  // Kubernetes Event timestamps are MicroTime: exactly six fractional digits.
  return new Date(NOW - minutesAgo * 60_000)
    .toISOString()
    .replace(/\.(\d{3})Z$/, '.$1000Z');
}

function coreManifest(event: SeedEvent): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind: 'Event',
    metadata: {
      name: event.name,
      namespace: event.namespace,
      labels: { 'app.kubernetes.io/managed-by': 'events-explorer-seed' },
    },
    involvedObject: {
      apiVersion: 'v1',
      kind: event.kind,
      name: event.objectName,
      namespace: event.namespace,
    },
    type: event.type,
    reason: event.reason,
    message: event.message,
    source: { component: 'events-explorer-seed' },
    firstTimestamp: timestamp(event.minutesAgo + 5),
    lastTimestamp: timestamp(event.minutesAgo),
    count: event.count ?? 1,
  };
}

function eventsV1Manifest(event: SeedEvent): Record<string, unknown> {
  return {
    apiVersion: 'events.k8s.io/v1',
    kind: 'Event',
    metadata: {
      name: event.name,
      namespace: event.namespace,
      labels: { 'app.kubernetes.io/managed-by': 'events-explorer-seed' },
    },
    eventTime: timestamp(event.minutesAgo + 2),
    action: 'Observe',
    reason: event.reason,
    note: event.message,
    type: event.type,
    reportingController: 'events-explorer-seed',
    reportingInstance: 'seed-1',
    regarding: {
      apiVersion: 'v1',
      kind: event.kind,
      name: event.objectName,
      namespace: event.namespace,
    },
    series: { count: event.count ?? 1, lastObservedTime: timestamp(event.minutesAgo) },
  };
}

function kubectl(args: string[], input?: string): string {
  return execFileSync('kubectl', ['--context', CONTEXT, ...args], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function main(): void {
  const clean = process.argv.includes('--clean');
  if (clean) {
    for (const namespace of NAMESPACES) {
      kubectl(['delete', 'events', '--namespace', namespace, '--selector', SEED_LABEL, '--ignore-not-found']);
    }
  }

  for (const namespace of NAMESPACES) {
    kubectl(['apply', '-f', '-'], namespaceManifest(namespace));
  }

  for (const event of EVENTS) {
    const manifest = event.apiVersion === 'events.k8s.io/v1' ? eventsV1Manifest(event) : coreManifest(event);
    kubectl(['apply', '-f', '-'], JSON.stringify(manifest));
  }

  const summary = {
    context: CONTEXT,
    namespaces: NAMESPACES,
    created: EVENTS.length,
    byType: {
      Warning: EVENTS.filter((event) => event.type === 'Warning').length,
      Normal: EVENTS.filter((event) => event.type === 'Normal').length,
    },
    reasons: [...new Set(EVENTS.map((event) => event.reason))],
    apiVersions: [...new Set(EVENTS.map((event) => event.apiVersion ?? 'v1'))],
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function namespaceManifest(namespace: string): string {
  return JSON.stringify({
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: { name: namespace, labels: { 'app.kubernetes.io/managed-by': 'events-explorer-seed' } },
  });
}

main();
