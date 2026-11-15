// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import type { EventFilters, TimeBucket } from '@k8s-events/domain';
import { formatCompactTimestamp, timeBucketToUtcRange } from '@k8s-events/domain';
import type { SummaryResponse } from '../../api/client';
import { NOT_SUPPLIED } from '@k8s-events/domain';
import { formatDisplayTimestamp } from '@k8s-events/domain';

interface OverviewPanelProps {
  summary: SummaryResponse | null;
  onSelectEvent: (id: string, origin: HTMLElement) => void;
  onApplyFilter: (partialFilter: Partial<EventFilters>) => void;
}

/**
 * Overview totals come from the server summary built from the same query as
 * the table, so the numbers on this screen cannot diverge from the Explorer.
 */
export const OverviewPanel: React.FC<OverviewPanelProps> = ({ summary, onSelectEvent, onApplyFilter }) => {
  const metrics = {
    totalEvents: summary?.totalEvents ?? 0,
    warningCount: summary?.warningCount ?? 0,
    normalCount: summary?.normalCount ?? 0,
    namespaceCount: summary?.namespaceCount ?? 0,
    volumeBuckets: summary?.volumeBuckets ?? [],
    commonReasons: summary?.commonReasons ?? [],
    recentWarnings: summary?.recentWarnings ?? [],
    invalidTimestampCount: summary?.invalidTimestampCount ?? 0,
  };
  const applyBucket = (bucket: TimeBucket, index: number, type: 'Normal' | 'Warning') => {
    onApplyFilter({
      types: [type],
      timeRange: timeBucketToUtcRange(bucket.start, bucket.end, index === metrics.volumeBuckets.length - 1),
    });
  };

  return (
    <div data-testid="overview-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <h2 className="visually-hidden">Overview</h2>
      {/* Stats grid */}
      <div className="stats-grid">
        <div className="stat-box" data-testid="stat-total">
          <span className="stat-label">Total Events</span>
          <span className="stat-value">{metrics.totalEvents.toLocaleString()}</span>
        </div>
        <div className="stat-box" data-testid="stat-warnings">
          <span className="stat-label">Warnings</span>
          <span className="stat-value" style={{ color: 'var(--color-warning)' }}>
            {metrics.warningCount.toLocaleString()}
          </span>
        </div>
        <div className="stat-box" data-testid="stat-normal">
          <span className="stat-label">Normal</span>
          <span className="stat-value" style={{ color: 'var(--color-normal)' }}>
            {metrics.normalCount.toLocaleString()}
          </span>
        </div>
        <div className="stat-box" data-testid="stat-namespaces">
          <span className="stat-label">Namespaces</span>
          <span className="stat-value">{metrics.namespaceCount.toLocaleString()}</span>
        </div>
      </div>

      {/* Volume chart */}
      <section className="panel-card" aria-label="Event volume over time chart">
        <h2 className="card-title">Event Volume Over Time</h2>
        {metrics.invalidTimestampCount > 0 && (
          <p
            style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}
            role="note"
          >
            {metrics.invalidTimestampCount} record
            {metrics.invalidTimestampCount !== 1 ? 's' : ''} with missing or invalid timestamps excluded
            from chart
          </p>
        )}
        {metrics.volumeBuckets.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
            No time-bucketed data available. Records may have missing or invalid timestamps.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={metrics.volumeBuckets}
              aria-label="Event volume bar chart showing normal and warning events over time"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="label"
                tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--color-border)' }}
              />
              <YAxis
                tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--color-border)' }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8125rem',
                }}
              />
              <Bar
                dataKey="normalCount"
                name="Normal"
                stackId="a"
                fill="var(--color-normal)"
                onClick={(entry: TimeBucket, index: number) => applyBucket(entry, index, 'Normal')}
                style={{ cursor: 'pointer' }}
              />
              <Bar
                dataKey="warningCount"
                name="Warning"
                stackId="a"
                fill="var(--color-warning)"
                onClick={(entry: TimeBucket, index: number) => applyBucket(entry, index, 'Warning')}
                style={{ cursor: 'pointer' }}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
        <table className="chart-summary-table" aria-label="Overview event volume data">
          <caption>Event objects by time interval; records with invalid effective timestamps are excluded.</caption>
          <thead><tr><th scope="col">Time interval</th><th scope="col">Normal Event objects</th><th scope="col">Warning Event objects</th></tr></thead>
          <tbody>{metrics.volumeBuckets.map((bucket, index) => (
            <tr key={bucket.start}>
              <th scope="row">{formatDisplayTimestamp(bucket.start)} – {formatDisplayTimestamp(bucket.end)}</th>
              <td>{bucket.normalCount} <button type="button" className="table-action-button" onClick={() => applyBucket(bucket, index, 'Normal')}>Filter to this interval and Normal</button></td>
              <td>{bucket.warningCount} <button type="button" className="table-action-button" onClick={() => applyBucket(bucket, index, 'Warning')}>Filter to this interval and Warning</button></td>
            </tr>
          ))}</tbody>
        </table>
      </section>

      {/* Bottom row: common reasons + recent warnings */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        {/* Common reasons */}
        <section className="panel-card" aria-label="Most common event reasons">
          <h2 className="card-title">Common Reasons</h2>
          {metrics.commonReasons.length === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
              {NOT_SUPPLIED}
            </p>
          ) : (
            <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {metrics.commonReasons.map(({ reason, count }) => (
                <li
                  key={reason}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.875rem',
                    padding: '0.375rem 0',
                    borderBottom: '1px solid var(--color-border-subtle)',
                  }}
                >
                  <span style={{ color: 'var(--color-text-primary)' }}>{reason}</span>
                  <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                    {count}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Recent warnings */}
        <section className="panel-card" aria-label="Recent warning events">
          <h2 className="card-title">Recent Warnings</h2>
          {metrics.recentWarnings.length === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
              No recent warnings in the current time range.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {metrics.recentWarnings.map((event) => (
                <li key={event.id}>
                  <button
                    onClick={(e) => onSelectEvent(event.id, e.currentTarget)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: 'var(--radius-sm)',
                      borderBottom: '1px solid var(--color-border-subtle)',
                    }}
                    aria-label={`View warning: ${event.reason ?? NOT_SUPPLIED}`}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '0.25rem',
                      }}
                    >
                      <span
                        style={{ color: 'var(--color-warning)', fontSize: '0.8125rem', fontWeight: 600 }}
                      >
                        {event.reason ?? NOT_SUPPLIED}
                      </span>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                        {formatCompactTimestamp(event.lastObservedAt)}
                      </span>
                    </div>
                    <div
                      style={{
                        color: 'var(--color-text-secondary)',
                        fontSize: '0.75rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '100%',
                      }}
                    >
                      {event.message ?? NOT_SUPPLIED}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};
