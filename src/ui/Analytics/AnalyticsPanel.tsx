// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React, { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import type { NormalisedEvent, EventFilters } from '../../domain/types';
import { computeAnalyticsData } from '../../domain/aggregate';
import { formatDisplayTimestamp } from '../../domain/timestamps';

interface AnalyticsPanelProps {
  events: NormalisedEvent[];
  onApplyFilter: (partialFilter: Partial<EventFilters>) => void;
}

const TYPE_COLORS: Record<string, string> = {
  Normal: '#10b981',
  Warning: '#f59e0b',
  Other: '#64748b',
};

const PALETTE = [
  '#326ce5',
  '#3b82f6',
  '#60a5fa',
  '#93c5fd',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#6366f1',
];

export const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({ events, onApplyFilter }) => {
  const [metricUnit, setMetricUnit] = useState<'events' | 'occurrences'>('events');
  const analytics = computeAnalyticsData(events);

  return (
    <div data-testid="analytics-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Unit switch header */}
      <div className="panel-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>Analytics & Distributions</h2>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.8125rem' }}>
            Interactive event breakdown. Use the summary tables to review values or apply filters with a keyboard.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>Metric Unit:</span>
          <button
            type="button"
            className={`sim-btn ${metricUnit === 'events' ? 'sim-btn-primary' : ''}`}
            onClick={() => setMetricUnit('events')}
            aria-pressed={metricUnit === 'events'}
          >
            Event Records ({analytics.totalEvents})
          </button>
          <button
            type="button"
            className={`sim-btn ${metricUnit === 'occurrences' ? 'sim-btn-primary' : ''}`}
            onClick={() => setMetricUnit('occurrences')}
            aria-pressed={metricUnit === 'occurrences'}
          >
            Recorded Occurrences ({analytics.totalOccurrences})
          </button>
        </div>
        {metricUnit === 'occurrences' && (
          <p role="note" style={{ width: '100%', color: 'var(--color-text-secondary)', fontSize: '0.75rem', margin: 0 }}>
            Sum of source-provided counts; {analytics.recordsWithKnownOccurrenceCount} of {analytics.totalEvents} Event records have a valid count.
          </p>
        )}
      </div>

      {/* Volume over time */}
      <section className="panel-card" aria-label="Event volume by time bucket">
        <div className="card-title">
          <span>Event Volume by Time Bucket</span>
          {analytics.invalidTimestampCount > 0 && (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              ({analytics.invalidTimestampCount} record{analytics.invalidTimestampCount !== 1 ? 's' : ''} with missing or invalid timestamps excluded)
            </span>
          )}
        </div>
        {analytics.volumeBuckets.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
            No valid time data available.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={analytics.volumeBuckets}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                }}
              />
              <Bar
                dataKey={metricUnit === 'events' ? 'normalCount' : 'normalOccurrenceCount'}
                name="Normal"
                stackId="v"
                fill="var(--color-normal)"
              />
              <Bar
                dataKey={metricUnit === 'events' ? 'warningCount' : 'warningOccurrenceCount'}
                name="Warning"
                stackId="v"
                fill="var(--color-warning)"
              />
            </BarChart>
          </ResponsiveContainer>
        )}
        <table className="chart-summary-table" aria-label="Event volume by time interval data">
          <caption>
            Event volume by time interval. Values are {metricUnit === 'events' ? 'Event objects' : 'source-recorded occurrences'}.
          </caption>
          <thead><tr><th scope="col">Time interval</th><th scope="col">Normal</th><th scope="col">Warning</th></tr></thead>
          <tbody>
            {analytics.volumeBuckets.map((bucket) => (
              <tr key={bucket.start}>
                <th scope="row">{formatDisplayTimestamp(bucket.start)} – {formatDisplayTimestamp(bucket.end)}</th>
                <td>{metricUnit === 'events' ? bucket.normalCount : bucket.normalOccurrenceCount}</td>
                <td>{metricUnit === 'events' ? bucket.warningCount : bucket.warningOccurrenceCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {analytics.invalidTimestampCount > 0 && (
          <p role="note">{analytics.invalidTimestampCount} records with missing or invalid effective last-observed timestamps are excluded from time buckets.</p>
        )}
      </section>

      {/* Charts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem' }}>
        {/* Type Distribution */}
        <section className="panel-card" aria-label="Event type breakdown">
          <div className="card-title">Type Breakdown</div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={analytics.typeBreakdown}
                  dataKey={metricUnit === 'events' ? 'count' : 'occurrenceCount'}
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={(entry: { name: string; count: number }) => `${entry.name} (${entry.count})`}
                  style={{ cursor: 'pointer' }}
                  onClick={(entry: { name?: string }) => {
                    if (entry?.name === 'Normal' || entry?.name === 'Warning') {
                      onApplyFilter({ types: [entry.name] });
                    }
                  }}
                >
                  {analytics.typeBreakdown.map((entry) => (
                    <Cell key={entry.name} fill={TYPE_COLORS[entry.name] ?? '#64748b'} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <table className="chart-summary-table" aria-label="Event type distribution data">
            <caption>Type totals by {metricUnit === 'events' ? 'Event objects' : 'source-recorded occurrences'}.</caption>
            <thead><tr><th scope="col">Type</th><th scope="col">{metricUnit === 'events' ? 'Event objects' : 'Recorded occurrences'}</th><th scope="col">Action</th></tr></thead>
            <tbody>{analytics.typeBreakdown.map((entry) => (
              <tr key={entry.name}>
                <th scope="row">{entry.name}</th>
                <td>{metricUnit === 'events' ? entry.count : entry.occurrenceCount}</td>
                <td>{entry.name === 'Normal' || entry.name === 'Warning' ? (
                  <button type="button" className="table-action-button" onClick={() => onApplyFilter({ types: [entry.name as 'Normal' | 'Warning'] })}>
                    Filter Explorer to {entry.name}
                  </button>
                ) : 'No type filter available'}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>

        {/* Top Reasons */}
        <section className="panel-card" aria-label="Top event reasons">
          <div className="card-title">Top Reasons</div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analytics.reasonBreakdown.slice(0, 8)}
                layout="vertical"
                margin={{ left: 30, right: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis type="number" tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} />
                <YAxis
                  dataKey="reason"
                  type="category"
                  tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                  width={90}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                />
                <Bar
                  dataKey={metricUnit === 'events' ? 'count' : 'occurrenceCount'}
                  fill="#326ce5"
                  style={{ cursor: 'pointer' }}
                  onClick={(entry: { reason?: string }) => {
                    if (entry?.reason) {
                      onApplyFilter({ reasons: [entry.reason] });
                    }
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="chart-summary-table" aria-label="Top Event reasons data">
            <caption>Top reasons by {metricUnit === 'events' ? 'Event objects' : 'source-recorded occurrences'}.</caption>
            <thead><tr><th scope="col">Reason</th><th scope="col">{metricUnit === 'events' ? 'Event objects' : 'Recorded occurrences'}</th><th scope="col">Action</th></tr></thead>
            <tbody>{analytics.reasonBreakdown.slice(0, 8).map((entry) => (
              <tr key={entry.reason}>
                <th scope="row">{entry.reason}</th>
                <td>{metricUnit === 'events' ? entry.count : entry.occurrenceCount}</td>
                <td><button type="button" className="table-action-button" onClick={() => onApplyFilter({ reasons: [entry.reason] })}>
                  Filter Explorer to reason {entry.reason}
                </button></td>
              </tr>
            ))}</tbody>
          </table>
        </section>

        {/* Namespace Distribution */}
        <section className="panel-card" aria-label="Events by namespace" style={{ gridColumn: '1 / -1' }}>
          <div className="card-title">Namespace Distribution</div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.namespaceBreakdown.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="namespace" tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                />
                <Bar
                  dataKey={metricUnit === 'events' ? 'count' : 'occurrenceCount'}
                  style={{ cursor: 'pointer' }}
                  onClick={(entry: { namespace?: string }) => {
                    if (entry?.namespace) {
                      onApplyFilter({ namespaces: [entry.namespace] });
                    }
                  }}
                >
                  {analytics.namespaceBreakdown.slice(0, 10).map((_, index) => (
                    <Cell key={`cell-${index}`} fill={PALETTE[index % PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="chart-summary-table" aria-label="Namespace distribution data">
            <caption>Namespace totals by {metricUnit === 'events' ? 'Event objects' : 'source-recorded occurrences'}.</caption>
            <thead><tr><th scope="col">Namespace</th><th scope="col">{metricUnit === 'events' ? 'Event objects' : 'Recorded occurrences'}</th><th scope="col">Action</th></tr></thead>
            <tbody>{analytics.namespaceBreakdown.slice(0, 10).map((entry) => (
              <tr key={entry.namespace}>
                <th scope="row">{entry.namespace}</th>
                <td>{metricUnit === 'events' ? entry.count : entry.occurrenceCount}</td>
                <td><button type="button" className="table-action-button" onClick={() => onApplyFilter({ namespaces: [entry.namespace] })}>
                  Filter Explorer to namespace {entry.namespace}
                </button></td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      </div>
    </div>
  );
};
