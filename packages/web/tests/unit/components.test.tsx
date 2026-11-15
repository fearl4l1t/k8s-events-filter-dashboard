// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NormalisedEvent } from '@k8s-events/domain';
import { DEFAULT_SORT } from '@k8s-events/domain';
import { ObservationBanner } from '../../src/ui/ObservationBanner';
import { ClusterSelector } from '../../src/ui/ClusterSelector';
import { EventTable } from '../../src/ui/Explorer/EventTable';
import { DetailPanel } from '../../src/ui/DetailPanel/DetailPanel';
import { LoadingState } from '../../src/ui/states/LoadingState';
import { EmptyDatasetState } from '../../src/ui/states/EmptyDatasetState';
import type { ClusterSummary } from '../../src/api/client';

const CLUSTER: ClusterSummary = {
  id: 'ctx-a',
  name: 'kind-events',
  source: 'local',
  status: 'live',
  observationStartedAt: '2026-11-14T09:00:00.000Z',
  lastEventAt: '2026-11-14T10:05:00.000Z',
  recordCount: 12,
  evictedCount: 0,
  error: null,
};

function event(overrides: Partial<NormalisedEvent> = {}): NormalisedEvent {
  return {
    id: 'ctx-a/uid-1',
    clusterId: 'ctx-a',
    clusterName: 'kind-events',
    source: 'local',
    apiVersion: 'events.k8s.io/v1',
    uid: 'uid-1',
    namespace: 'default',
    type: 'Warning',
    reason: 'BackOff',
    message: 'Back-off restarting failed container',
    action: 'Restart',
    object: {
      apiVersion: 'v1',
      kind: 'Pod',
      name: 'web-1',
      namespace: 'default',
      uid: 'pod-1',
    },
    reporter: 'kubelet',
    firstObservedAt: '2026-11-14T10:00:00.000Z',
    lastObservedAt: '2026-11-14T10:05:00.000Z',
    occurrenceCount: 3,
    occurrenceCountStatus: 'valid',
    createdAt: '2026-11-14T09:59:00.000Z',
    timestampSource: { first: 'eventTime', last: 'series' },
    timestampValid: true,
    validationIssues: [],
    rawEvent: { kind: 'Event', metadata: { uid: 'uid-1' } },
    ...overrides,
  };
}

describe('ObservationBanner', () => {
  it('names the cluster, its source and the observation start', () => {
    const html = renderToStaticMarkup(
      <ObservationBanner
        clusters={[CLUSTER]}
        serverTime="2026-11-14T10:06:00.000Z"
        streamState="open"
        partial={false}
      />
    );
    expect(html).toContain('kind-events');
    expect(html).toContain('local kubeconfig');
    expect(html).toContain('observing since');
    expect(html).toContain('partial observation rather than a complete history');
  });

  it('states that results are partial when a cluster is not live', () => {
    const html = renderToStaticMarkup(
      <ObservationBanner
        clusters={[{ ...CLUSTER, status: 'unreachable' }]}
        serverTime={null}
        streamState="closed"
        partial
      />
    );
    expect(html).toContain('not streaming live');
    expect(html).toContain('Not supplied');
  });

  it('renders a neutral state with no cluster selected', () => {
    const html = renderToStaticMarkup(
      <ObservationBanner clusters={[]} serverTime={null} streamState="connecting" partial={false} />
    );
    expect(html).toContain('No cluster selected');
  });
});

describe('ClusterSelector', () => {
  it('lists clusters with a text status, not colour alone', () => {
    const html = renderToStaticMarkup(
      <ClusterSelector
        clusters={[CLUSTER, { ...CLUSTER, id: 'ctx-b', name: 'in-cluster', source: 'in-cluster', error: { code: 'cluster_forbidden', message: 'The credentials may not list Events.' } }]}
        selectedIds={['ctx-a']}
        onToggle={() => undefined}
        onSelectAll={() => undefined}
      />
    );
    expect(html).toContain('checked');
    expect(html).toContain('live · local');
    expect(html).toContain('live · in-cluster');
    expect(html).toContain('The credentials may not list Events.');
    expect(html).toContain('All clusters');
  });
});

describe('EventTable', () => {
  it('renders a row with Not supplied for a missing count', () => {
    const html = renderToStaticMarkup(
      <EventTable
        events={[event({ occurrenceCount: null, occurrenceCountStatus: 'missing', reason: null })]}
        selectedEventId={null}
        sortConfig={DEFAULT_SORT}
        onSelectEvent={() => undefined}
        onSortChange={() => undefined}
      />
    );
    expect(html).toContain('Not supplied');
    expect(html).toContain('Back-off restarting failed container');
    expect(html).toContain('Pod/web-1');
  });

  it('marks an invalid count and an invalid timestamp', () => {
    const html = renderToStaticMarkup(
      <EventTable
        events={[
          event({
            occurrenceCount: null,
            occurrenceCountStatus: 'invalid',
            lastObservedAt: null,
            timestampValid: false,
            validationIssues: ['Invalid last-observed timestamp'],
          }),
        ]}
        selectedEventId={null}
        sortConfig={DEFAULT_SORT}
        onSelectEvent={() => undefined}
        onSortChange={() => undefined}
      />
    );
    expect(html).toContain('Invalid value');
    expect(html).toContain('Invalid record');
    expect(html).toContain('[inv]');
  });

  it('renders an empty body when no rows match', () => {
    const html = renderToStaticMarkup(
      <EventTable
        events={[]}
        selectedEventId={null}
        sortConfig={DEFAULT_SORT}
        onSelectEvent={() => undefined}
        onSortChange={() => undefined}
      />
    );
    expect(html).toContain('No events match the current filters.');
  });
});

describe('DetailPanel', () => {
  it('shows the untouched source and the observation provenance', () => {
    const html = renderToStaticMarkup(
      <DetailPanel
        event={event({ lastObservedAt: null, timestampValid: false, timestampSource: { first: 'eventTime', last: 'series' } })}
        observationStartedAt="2026-11-14T09:00:00.000Z"
        onClose={() => undefined}
      />
    );
    expect(html).toContain('Invalid timestamp');
    expect(html).toContain('observed from kind-events'.replace('observed', 'Observed'));
    expect(html).toContain('&quot;kind&quot;');
    expect(html).toContain('untouched source record');
  });

  it('shows Not supplied for a missing count and reason', () => {
    const html = renderToStaticMarkup(
      <DetailPanel
        event={event({ occurrenceCount: null, occurrenceCountStatus: 'missing', reason: null, reporter: null })}
        observationStartedAt={null}
        onClose={() => undefined}
      />
    );
    expect(html).toContain('Not supplied');
  });
});

describe('dataset states', () => {
  it('describes loading without implying a live connection', () => {
    const html = renderToStaticMarkup(<LoadingState />);
    expect(html).toContain('Requesting recent Events');
    expect(html).not.toMatch(/connect(ed|ing) to (the )?cluster/i);
  });

  it('explains that no Events were observed', () => {
    const html = renderToStaticMarkup(<EmptyDatasetState />);
    expect(html).toContain('No Events observed yet');
    expect(html).toContain('about one hour');
  });
});
