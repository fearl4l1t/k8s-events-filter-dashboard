// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import * as fs from 'node:fs';
import * as path from 'node:path';

interface FixtureFormat {
  scenarioId: string;
  name: string;
  description: string;
  seedEvents: Record<string, unknown>[];
  steps: {
    delayMs: number;
    event: Record<string, unknown>;
    isSeriesUpdate?: boolean;
  }[];
}

const BASE_TIME = new Date('2026-11-14T10:00:00.000Z').getTime();

const NAMESPACES = ['default', 'kube-system', 'monitoring', 'payments', 'ingress-nginx', 'database'];
const KINDS = ['Pod', 'Deployment', 'ReplicaSet', 'Service', 'Node', 'PersistentVolumeClaim'];

function makeIso(offsetSeconds: number): string {
  return new Date(BASE_TIME + offsetSeconds * 1000).toISOString();
}

function generateDeterministicRoutineEvents(
  count: number,
  scenarioPrefix: string,
  startOffset: number
): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  const reasons = [
    { reason: 'Scheduled', type: 'Normal', note: 'Successfully assigned pod to node-worker-1' },
    { reason: 'Pulling', type: 'Normal', note: 'Pulling image "registry.k8s.io/pause:3.9"' },
    { reason: 'Pulled', type: 'Normal', note: 'Successfully pulled image in 1.42s' },
    { reason: 'Created', type: 'Normal', note: 'Created container pause' },
    { reason: 'Started', type: 'Normal', note: 'Started container pause' },
    { reason: 'SuccessfulCreate', type: 'Normal', note: 'Created pod: worker-rs-992' },
    { reason: 'ScalingReplicaSet', type: 'Normal', note: 'Scaled up replica set frontend-6f97d5' },
    { reason: 'NodeReady', type: 'Normal', note: 'Node node-worker-2 status is now: NodeReady' },
    { reason: 'ProbeWarning', type: 'Warning', note: 'Readiness probe returned HTTP 503' },
    { reason: 'Unhealthy', type: 'Warning', note: 'Liveness probe failed: connection refused' },
  ];

  for (let i = 0; i < count; i++) {
    const ns = NAMESPACES[i % NAMESPACES.length] as string;
    const kind = KINDS[i % KINDS.length] as string;
    const item = reasons[i % reasons.length] as (typeof reasons)[0];
    const offset = startOffset + i * 20; // 20 seconds apart
    const eventTime = makeIso(offset);
    const uid = `uid-${scenarioPrefix}-routine-${String(i + 1).padStart(4, '0')}`;
    const name = `${kind.toLowerCase()}-${scenarioPrefix}-${(i % 15) + 1}`;

    const isCoreV1 = i % 10 === 0;

    if (isCoreV1) {
      events.push({
        apiVersion: 'v1',
        kind: 'Event',
        metadata: {
          name: `${name}.${i + 1000}`,
          namespace: ns,
          uid,
          creationTimestamp: eventTime,
        },
        involvedObject: {
          apiVersion: 'v1',
          kind,
          name,
          namespace: ns,
          uid: `obj-${uid}`,
        },
        reason: item.reason,
        message: item.note,
        source: {
          component: i % 2 === 0 ? 'kubelet' : 'kube-scheduler',
        },
        firstTimestamp: eventTime,
        lastTimestamp: eventTime,
        count: 1,
        type: item.type,
        eventTime: null,
      });
    } else {
      events.push({
        apiVersion: 'events.k8s.io/v1',
        kind: 'Event',
        metadata: {
          name: `${name}.${i + 1000}`,
          namespace: ns,
          uid,
          creationTimestamp: eventTime,
        },
        regarding: {
          apiVersion: 'v1',
          kind,
          name,
          namespace: ns,
          uid: `obj-${uid}`,
        },
        reason: item.reason,
        note: item.note,
        type: item.type,
        reportingController: i % 2 === 0 ? 'k8s.io/kubelet' : 'k8s.io/kube-scheduler',
        reportingInstance: 'node-worker-1',
        action: 'Binding',
        eventTime,
        series: {
          count: 1,
          lastObservedTime: eventTime,
        },
      });
    }
  }

  return events;
}

function buildScenario(
  scenarioId: string,
  name: string,
  description: string,
  customSeed: Record<string, unknown>[],
  steps: FixtureFormat['steps'],
  routineCount = 350
): FixtureFormat {
  const routine = generateDeterministicRoutineEvents(routineCount, scenarioId, 0);

  // Add edge cases
  const edgeCases: Record<string, unknown>[] = [
    // 1. Missing optional fields
    {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: `edge-missing-optional.${scenarioId}`,
        namespace: 'default',
        uid: `uid-${scenarioId}-edge-missing`,
        creationTimestamp: makeIso(100),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'pod-with-missing-fields',
        namespace: 'default',
        uid: 'obj-pod-missing',
      },
      reason: 'MissingFieldsEvent',
      note: null,
      type: 'Normal',
      reportingController: null,
      eventTime: makeIso(100),
    },
    // 2. Fallback to creationTimestamp (eventTime absent)
    {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: `edge-fallback-creation.${scenarioId}`,
        namespace: 'kube-system',
        uid: `uid-${scenarioId}-edge-fallback`,
        creationTimestamp: makeIso(200),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Node',
        name: 'node-worker-fallback',
        namespace: null,
        uid: 'obj-node-fallback',
      },
      reason: 'NodeSynced',
      note: 'Node state synced using creation fallback timestamp',
      type: 'Normal',
      reportingController: 'k8s.io/kubelet',
      eventTime: null,
    },
    // 3. Invalid timestamp
    {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: `edge-invalid-ts.${scenarioId}`,
        namespace: 'database',
        uid: `uid-${scenarioId}-edge-invalid-ts`,
        creationTimestamp: 'INVALID_TIMESTAMP_STRING',
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'db-replica-invalid-ts',
        namespace: 'database',
        uid: 'obj-db-invalid-ts',
      },
      reason: 'CorruptTimestamp',
      note: 'Simulated corrupt timestamp for boundary testing',
      type: 'Warning',
      reportingController: 'k8s.io/custom-controller',
      eventTime: '2026-99-99T99:99:99Z',
    },
    // 4. Malformed occurrence count
    {
      apiVersion: 'v1',
      kind: 'Event',
      metadata: {
        name: `edge-malformed-count.${scenarioId}`,
        namespace: 'monitoring',
        uid: `uid-${scenarioId}-edge-malformed-count`,
        creationTimestamp: makeIso(300),
      },
      involvedObject: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'prometheus-collector-edge',
        namespace: 'monitoring',
        uid: 'obj-prom-edge',
      },
      reason: 'MetricsCollectionWarning',
      message: 'Scrape failed with negative count test',
      type: 'Warning',
      source: { component: 'prometheus' },
      firstTimestamp: makeIso(300),
      lastTimestamp: makeIso(300),
      count: -5,
    },
  ];

  const seedEvents = [...customSeed, ...edgeCases, ...routine];

  return {
    scenarioId,
    name,
    description,
    seedEvents,
    steps,
  };
}

// 1. normal-rollout
const normalRolloutCustom: Record<string, unknown>[] = [
  {
    apiVersion: 'events.k8s.io/v1',
    kind: 'Event',
    metadata: {
      name: 'payment-deploy-created.1',
      namespace: 'payments',
      uid: 'uid-rollout-001',
      creationTimestamp: makeIso(7200),
    },
    regarding: {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      name: 'payment-service',
      namespace: 'payments',
      uid: 'obj-deploy-payments',
    },
    reason: 'ScalingReplicaSet',
    note: 'Scaled up replica set payment-service-78f99',
    type: 'Normal',
    reportingController: 'k8s.io/deployment-controller',
    eventTime: makeIso(7200),
  },
  {
    apiVersion: 'events.k8s.io/v1',
    kind: 'Event',
    metadata: {
      name: 'payment-rs-created.1',
      namespace: 'payments',
      uid: 'uid-rollout-002',
      creationTimestamp: makeIso(7205),
    },
    regarding: {
      apiVersion: 'apps/v1',
      kind: 'ReplicaSet',
      name: 'payment-service-78f99',
      namespace: 'payments',
      uid: 'obj-rs-payments',
    },
    reason: 'SuccessfulCreate',
    note: 'Created pod: payment-service-78f99-abc12',
    type: 'Normal',
    reportingController: 'k8s.io/replicaset-controller',
    eventTime: makeIso(7205),
  },
  {
    apiVersion: 'events.k8s.io/v1',
    kind: 'Event',
    metadata: {
      name: 'payment-pod-scheduled.1',
      namespace: 'payments',
      uid: 'uid-rollout-003',
      creationTimestamp: makeIso(7210),
    },
    regarding: {
      apiVersion: 'v1',
      kind: 'Pod',
      name: 'payment-service-78f99-abc12',
      namespace: 'payments',
      uid: 'obj-pod-payments-abc12',
    },
    reason: 'Scheduled',
    note: 'Successfully assigned payments/payment-service-78f99-abc12 to node-worker-1',
    type: 'Normal',
    reportingController: 'k8s.io/kube-scheduler',
    eventTime: makeIso(7210),
  },
];

const normalRolloutSteps = [
  {
    delayMs: 1000,
    event: {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: 'payment-pod-pulling.1',
        namespace: 'payments',
        uid: 'uid-rollout-step-001',
        creationTimestamp: makeIso(7215),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'payment-service-78f99-abc12',
        namespace: 'payments',
        uid: 'obj-pod-payments-abc12',
      },
      reason: 'Pulling',
      note: 'Pulling image "payments-api:v2.1.0"',
      type: 'Normal',
      reportingController: 'k8s.io/kubelet',
      eventTime: makeIso(7215),
    },
  },
  {
    delayMs: 1200,
    event: {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: 'payment-pod-pulled.1',
        namespace: 'payments',
        uid: 'uid-rollout-step-002',
        creationTimestamp: makeIso(7220),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'payment-service-78f99-abc12',
        namespace: 'payments',
        uid: 'obj-pod-payments-abc12',
      },
      reason: 'Pulled',
      note: 'Successfully pulled image "payments-api:v2.1.0" in 2.31s',
      type: 'Normal',
      reportingController: 'k8s.io/kubelet',
      eventTime: makeIso(7220),
    },
  },
  {
    delayMs: 1000,
    event: {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: 'payment-pod-created.1',
        namespace: 'payments',
        uid: 'uid-rollout-step-003',
        creationTimestamp: makeIso(7222),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'payment-service-78f99-abc12',
        namespace: 'payments',
        uid: 'obj-pod-payments-abc12',
      },
      reason: 'Created',
      note: 'Created container payment-api',
      type: 'Normal',
      reportingController: 'k8s.io/kubelet',
      eventTime: makeIso(7222),
    },
  },
  {
    delayMs: 800,
    event: {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: 'payment-pod-started.1',
        namespace: 'payments',
        uid: 'uid-rollout-step-004',
        creationTimestamp: makeIso(7225),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'payment-service-78f99-abc12',
        namespace: 'payments',
        uid: 'obj-pod-payments-abc12',
      },
      reason: 'Started',
      note: 'Started container payment-api',
      type: 'Normal',
      reportingController: 'k8s.io/kubelet',
      eventTime: makeIso(7225),
    },
  },
];

// 2. image-pull-failure
const imagePullFailureCustom: Record<string, unknown>[] = [
  {
    apiVersion: 'events.k8s.io/v1',
    kind: 'Event',
    metadata: {
      name: 'auth-pod-pulling.1',
      namespace: 'payments',
      uid: 'uid-imgpull-001',
      creationTimestamp: makeIso(7300),
    },
    regarding: {
      apiVersion: 'v1',
      kind: 'Pod',
      name: 'auth-validator-901a',
      namespace: 'payments',
      uid: 'obj-pod-auth-val',
    },
    reason: 'Pulling',
    note: 'Pulling image "private.registry.internal/auth:v9.9.9-nonexistent"',
    type: 'Normal',
    reportingController: 'k8s.io/kubelet',
    eventTime: makeIso(7300),
  },
  {
    apiVersion: 'events.k8s.io/v1',
    kind: 'Event',
    metadata: {
      name: 'auth-pod-failed.1',
      namespace: 'payments',
      uid: 'uid-imgpull-002',
      creationTimestamp: makeIso(7310),
    },
    regarding: {
      apiVersion: 'v1',
      kind: 'Pod',
      name: 'auth-validator-901a',
      namespace: 'payments',
      uid: 'obj-pod-auth-val',
    },
    reason: 'Failed',
    note: 'Failed to pull image "private.registry.internal/auth:v9.9.9-nonexistent": rpc error: code = NotFound desc = failed to pull and unpack image: not found',
    type: 'Warning',
    reportingController: 'k8s.io/kubelet',
    eventTime: makeIso(7310),
  },
  {
    apiVersion: 'events.k8s.io/v1',
    kind: 'Event',
    metadata: {
      name: 'auth-pod-backoff.1',
      namespace: 'payments',
      uid: 'uid-imgpull-series-001',
      creationTimestamp: makeIso(7320),
    },
    regarding: {
      apiVersion: 'v1',
      kind: 'Pod',
      name: 'auth-validator-901a',
      namespace: 'payments',
      uid: 'obj-pod-auth-val',
    },
    reason: 'BackOff',
    note: 'Back-off pulling image "private.registry.internal/auth:v9.9.9-nonexistent"',
    type: 'Warning',
    reportingController: 'k8s.io/kubelet',
    eventTime: makeIso(7320),
    series: {
      count: 2,
      lastObservedTime: makeIso(7340),
    },
  },
];

const imagePullFailureSteps = [
  {
    delayMs: 1500,
    isSeriesUpdate: true,
    event: {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: 'auth-pod-backoff.1',
        namespace: 'payments',
        uid: 'uid-imgpull-series-001',
        creationTimestamp: makeIso(7320),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'auth-validator-901a',
        namespace: 'payments',
        uid: 'obj-pod-auth-val',
      },
      reason: 'BackOff',
      note: 'Back-off pulling image "private.registry.internal/auth:v9.9.9-nonexistent"',
      type: 'Warning',
      reportingController: 'k8s.io/kubelet',
      eventTime: makeIso(7320),
      series: {
        count: 5,
        lastObservedTime: makeIso(7400),
      },
    },
  },
  {
    delayMs: 1500,
    event: {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: 'auth-pod-errimagepull.1',
        namespace: 'payments',
        uid: 'uid-imgpull-step-002',
        creationTimestamp: makeIso(7420),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'auth-validator-901a',
        namespace: 'payments',
        uid: 'obj-pod-auth-val',
      },
      reason: 'ErrImagePull',
      note: 'Container image "private.registry.internal/auth:v9.9.9-nonexistent" is not present with pull policy of IfNotPresent and cannot be pulled',
      type: 'Warning',
      reportingController: 'k8s.io/kubelet',
      eventTime: makeIso(7420),
    },
  },
  {
    delayMs: 1500,
    isSeriesUpdate: true,
    event: {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: 'auth-pod-backoff.1',
        namespace: 'payments',
        uid: 'uid-imgpull-series-001',
        creationTimestamp: makeIso(7320),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'auth-validator-901a',
        namespace: 'payments',
        uid: 'obj-pod-auth-val',
      },
      reason: 'BackOff',
      note: 'Back-off pulling image "private.registry.internal/auth:v9.9.9-nonexistent"',
      type: 'Warning',
      reportingController: 'k8s.io/kubelet',
      eventTime: makeIso(7320),
      series: {
        count: 12,
        lastObservedTime: makeIso(7500),
      },
    },
  },
];

// 3. scheduling-pressure
const schedulingPressureCustom: Record<string, unknown>[] = [
  {
    apiVersion: 'events.k8s.io/v1',
    kind: 'Event',
    metadata: {
      name: 'heavy-ml-pod-failed-scheduling.1',
      namespace: 'default',
      uid: 'uid-sched-001',
      creationTimestamp: makeIso(7100),
    },
    regarding: {
      apiVersion: 'v1',
      kind: 'Pod',
      name: 'ml-training-job-gpu-x8',
      namespace: 'default',
      uid: 'obj-pod-ml-gpu',
    },
    reason: 'FailedScheduling',
    note: '0/8 nodes are available: 8 Insufficient nvidia.com/gpu, 3 node(s) had untolerated taint',
    type: 'Warning',
    reportingController: 'k8s.io/kube-scheduler',
    eventTime: makeIso(7100),
    series: {
      count: 4,
      lastObservedTime: makeIso(7180),
    },
  },
];

const schedulingPressureSteps = [
  {
    delayMs: 1200,
    isSeriesUpdate: true,
    event: {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: 'heavy-ml-pod-failed-scheduling.1',
        namespace: 'default',
        uid: 'uid-sched-001',
        creationTimestamp: makeIso(7100),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'ml-training-job-gpu-x8',
        namespace: 'default',
        uid: 'obj-pod-ml-gpu',
      },
      reason: 'FailedScheduling',
      note: '0/8 nodes are available: 8 Insufficient nvidia.com/gpu, 3 node(s) had untolerated taint',
      type: 'Warning',
      reportingController: 'k8s.io/kube-scheduler',
      eventTime: makeIso(7100),
      series: {
        count: 8,
        lastObservedTime: makeIso(7250),
      },
    },
  },
  {
    delayMs: 1800,
    event: {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: 'heavy-ml-pod-scheduled.1',
        namespace: 'default',
        uid: 'uid-sched-step-002',
        creationTimestamp: makeIso(7300),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'ml-training-job-gpu-x8',
        namespace: 'default',
        uid: 'obj-pod-ml-gpu',
      },
      reason: 'Scheduled',
      note: 'Successfully assigned default/ml-training-job-gpu-x8 to node-gpu-accelerator-4',
      type: 'Normal',
      reportingController: 'k8s.io/kube-scheduler',
      eventTime: makeIso(7300),
    },
  },
];

// 4. container-health
const containerHealthCustom: Record<string, unknown>[] = [
  {
    apiVersion: 'events.k8s.io/v1',
    kind: 'Event',
    metadata: {
      name: 'cache-probe-unhealthy.1',
      namespace: 'database',
      uid: 'uid-health-series-001',
      creationTimestamp: makeIso(7000),
    },
    regarding: {
      apiVersion: 'v1',
      kind: 'Pod',
      name: 'redis-cache-cluster-0',
      namespace: 'database',
      uid: 'obj-pod-redis-0',
    },
    reason: 'Unhealthy',
    note: 'Liveness probe failed: HTTP probe failed with statuscode: 500',
    type: 'Warning',
    reportingController: 'k8s.io/kubelet',
    eventTime: makeIso(7000),
    series: {
      count: 3,
      lastObservedTime: makeIso(7060),
    },
  },
];

const containerHealthSteps = [
  {
    delayMs: 1000,
    isSeriesUpdate: true,
    event: {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: 'cache-probe-unhealthy.1',
        namespace: 'database',
        uid: 'uid-health-series-001',
        creationTimestamp: makeIso(7000),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'redis-cache-cluster-0',
        namespace: 'database',
        uid: 'obj-pod-redis-0',
      },
      reason: 'Unhealthy',
      note: 'Liveness probe failed: HTTP probe failed with statuscode: 500',
      type: 'Warning',
      reportingController: 'k8s.io/kubelet',
      eventTime: makeIso(7000),
      series: {
        count: 7,
        lastObservedTime: makeIso(7120),
      },
    },
  },
  {
    delayMs: 1200,
    event: {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: 'cache-container-killing.1',
        namespace: 'database',
        uid: 'uid-health-step-002',
        creationTimestamp: makeIso(7130),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'redis-cache-cluster-0',
        namespace: 'database',
        uid: 'obj-pod-redis-0',
      },
      reason: 'Killing',
      note: 'Container redis-server failed liveness probe, will be restarted',
      type: 'Normal',
      reportingController: 'k8s.io/kubelet',
      eventTime: makeIso(7130),
    },
  },
  {
    delayMs: 1400,
    event: {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: 'cache-container-started.1',
        namespace: 'database',
        uid: 'uid-health-step-003',
        creationTimestamp: makeIso(7140),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Pod',
        name: 'redis-cache-cluster-0',
        namespace: 'database',
        uid: 'obj-pod-redis-0',
      },
      reason: 'Started',
      note: 'Started container redis-server after failure restart',
      type: 'Normal',
      reportingController: 'k8s.io/kubelet',
      eventTime: makeIso(7140),
    },
  },
];

// 5. node-condition
const nodeConditionCustom: Record<string, unknown>[] = [
  {
    apiVersion: 'events.k8s.io/v1',
    kind: 'Event',
    metadata: {
      name: 'node-worker-3-pressure.1',
      namespace: 'kube-system',
      uid: 'uid-nodecond-001',
      creationTimestamp: makeIso(6900),
    },
    regarding: {
      apiVersion: 'v1',
      kind: 'Node',
      name: 'node-worker-3',
      namespace: null,
      uid: 'obj-node-worker-3',
    },
    reason: 'NodeNotReady',
    note: 'Node node-worker-3 status is now: NodeNotReady (Kubelet stopped posting node status)',
    type: 'Warning',
    reportingController: 'k8s.io/node-lifecycle-controller',
    eventTime: makeIso(6900),
  },
];

const nodeConditionSteps = [
  {
    delayMs: 1500,
    event: {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: 'node-worker-3-diskpressure.1',
        namespace: 'kube-system',
        uid: 'uid-nodecond-step-002',
        creationTimestamp: makeIso(7000),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Node',
        name: 'node-worker-3',
        namespace: null,
        uid: 'obj-node-worker-3',
      },
      reason: 'DiskPressure',
      note: 'Free disk space on volume /var/lib/kubelet dropped below 5% threshold',
      type: 'Warning',
      reportingController: 'k8s.io/kubelet',
      eventTime: makeIso(7000),
    },
  },
  {
    delayMs: 1800,
    event: {
      apiVersion: 'events.k8s.io/v1',
      kind: 'Event',
      metadata: {
        name: 'node-worker-3-ready.1',
        namespace: 'kube-system',
        uid: 'uid-nodecond-step-003',
        creationTimestamp: makeIso(7100),
      },
      regarding: {
        apiVersion: 'v1',
        kind: 'Node',
        name: 'node-worker-3',
        namespace: null,
        uid: 'obj-node-worker-3',
      },
      reason: 'NodeReady',
      note: 'Node node-worker-3 status is now: NodeReady after garbage collection',
      type: 'Normal',
      reportingController: 'k8s.io/kubelet',
      eventTime: makeIso(7100),
    },
  },
];

// 6. core-v1-compat
const coreV1CompatCustom: Record<string, unknown>[] = [
  {
    apiVersion: 'v1',
    kind: 'Event',
    metadata: {
      name: 'core-compat-nginx.1',
      namespace: 'ingress-nginx',
      uid: 'uid-core-compat-001',
      creationTimestamp: makeIso(6800),
    },
    involvedObject: {
      apiVersion: 'v1',
      kind: 'Pod',
      name: 'ingress-nginx-controller-v1',
      namespace: 'ingress-nginx',
      uid: 'obj-nginx-compat',
    },
    reason: 'RELOAD',
    message: 'NGINX configuration reload successful',
    type: 'Normal',
    source: {
      component: 'nginx-ingress-controller',
    },
    firstTimestamp: makeIso(6800),
    lastTimestamp: makeIso(6800),
    count: 1,
  },
];

const fixturesDir = path.resolve(process.cwd(), 'fixtures');
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

const scenarios: [string, FixtureFormat][] = [
  [
    'normal-rollout.json',
    buildScenario(
      'normal-rollout',
      'Normal rollout',
      'Normal flow across a Deployment, ReplicaSet and Pods',
      normalRolloutCustom,
      normalRolloutSteps,
      1500
    ),
  ],
  [
    'image-pull-failure.json',
    buildScenario(
      'image-pull-failure',
      'Image pull failure',
      'Warnings repeated against a workload and container',
      imagePullFailureCustom,
      imagePullFailureSteps,
      1500
    ),
  ],
  [
    'scheduling-pressure.json',
    buildScenario(
      'scheduling-pressure',
      'Scheduling pressure',
      'Time ordering and a change in a Pod scheduling state',
      schedulingPressureCustom,
      schedulingPressureSteps,
      1500
    ),
  ],
  [
    'container-health.json',
    buildScenario(
      'container-health',
      'Container health',
      'Repeated observations and occurrence counts',
      containerHealthCustom,
      containerHealthSteps,
      1500
    ),
  ],
  [
    'node-condition.json',
    buildScenario(
      'node-condition',
      'Node condition',
      'Cluster-scoped records and filtering by object kind',
      nodeConditionCustom,
      nodeConditionSteps,
      1500
    ),
  ],
  [
    'core-v1-compat.json',
    buildScenario(
      'core-v1-compat',
      'Core v1 Compatibility',
      'Compatibility fixture using legacy core/v1 event schema',
      coreV1CompatCustom,
      [],
      100
    ),
  ],
];

for (const [filename, data] of scenarios) {
  const filePath = path.join(fixturesDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`Generated ${filename} with ${data.seedEvents.length} seed events and ${data.steps.length} steps.`);
}
