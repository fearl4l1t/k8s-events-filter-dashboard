// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React from 'react';
import type { NormalisedEvent, SortConfig, SortField } from '../../domain/types';
import { formatCompactTimestamp } from '../../domain/timestamps';
import { NOT_SUPPLIED } from '../../domain/constants';

interface EventTableProps {
  events: NormalisedEvent[];
  selectedEventId: string | null;
  sortConfig: SortConfig;
  onSelectEvent: (id: string, origin: HTMLElement) => void;
  onSortChange: (field: SortField) => void;
}

const COLUMNS: { field: SortField | null; label: string; testid?: string }[] = [
  { field: 'lastObservedAt', label: 'Timestamp' },
  { field: 'namespace', label: 'Namespace' },
  { field: 'type', label: 'Type' },
  { field: 'reason', label: 'Reason' },
  { field: 'objectName', label: 'Object' },
  { field: 'occurrenceCount', label: 'Count' },
  { field: null, label: 'Message' },
];

function SortIndicator({ field, sortConfig }: { field: SortField | null; sortConfig: SortConfig }) {
  if (!field || sortConfig.field !== field) {
    return <span style={{ marginLeft: '0.25rem', opacity: 0.3 }} aria-hidden="true">▲</span>;
  }
  return (
    <span style={{ marginLeft: '0.25rem' }} aria-hidden="true">
      {sortConfig.direction === 'asc' ? '▲' : '▼'}
    </span>
  );
}

export const EventTable: React.FC<EventTableProps> = ({
  events,
  selectedEventId,
  sortConfig,
  onSelectEvent,
  onSortChange,
}) => {
  const actionRefs = React.useRef<Map<string, HTMLButtonElement>>(new Map());

  return (
    <div
      className="table-wrapper"
      data-testid="event-table"
      // Make the overflow region keyboard-scrollable on narrow screens.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      role="region"
      aria-label="Scrollable Kubernetes events table"
    >
      <table className="events-table" aria-label="Kubernetes events">
        <caption className="visually-hidden">Kubernetes events. Select a row to inspect its details.</caption>
        <thead>
          <tr>
            {COLUMNS.map(({ field, label }) => (
              <th
                key={label}
                className={field ? 'sortable' : ''}
                aria-sort={
                  field && sortConfig.field === field
                    ? sortConfig.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
                scope="col"
              >
                {field ? (
                  <button
                    type="button"
                    className="table-sort-button"
                    onClick={() => onSortChange(field)}
                    aria-label={`Sort by ${label}`}
                  >
                    {label}
                    <SortIndicator field={field} sortConfig={sortConfig} />
                  </button>
                ) : label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.length === 0 ? (
            <tr>
              <td
                colSpan={COLUMNS.length}
                style={{
                  textAlign: 'center',
                  padding: '2rem',
                  color: 'var(--color-text-secondary)',
                }}
              >
                No events match the current filters.
              </td>
            </tr>
          ) : (
            events.map((event) => {
              const isSelected = event.id === selectedEventId;
              return (
                <tr
                  key={event.id}
                  className={isSelected ? 'selected' : ''}
                  onClick={() => {
                    const action = actionRefs.current.get(event.id);
                    if (action) onSelectEvent(event.id, action);
                  }}
                  data-event-id={event.id}
                  data-testid="event-row"
                >
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-secondary)', fontSize: '0.75rem' }}>
                    {formatCompactTimestamp(event.lastObservedAt)}
                    <button
                      type="button"
                      className="event-row-action"
                      ref={(element) => {
                        if (element) actionRefs.current.set(event.id, element);
                        else actionRefs.current.delete(event.id);
                      }}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        onSelectEvent(event.id, clickEvent.currentTarget);
                      }}
                      aria-label={`View details for ${event.reason ?? 'event'}`}
                    >
                      View
                    </button>
                    {event.validationIssues.length > 0 && (
                      <span className="badge badge-warning" style={{ marginLeft: '0.25rem' }}>
                        Invalid record
                      </span>
                    )}
                    {!event.timestampValid && (
                      <span
                        style={{ marginLeft: '0.25rem', color: 'var(--color-warning)', fontSize: '0.7rem' }}
                        title="Invalid or missing timestamp"
                      >
                        [inv]
                      </span>
                    )}
                  </td>
                  <td style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {event.namespace ?? NOT_SUPPLIED}
                  </td>
                  <td>
                    {event.type ? (
                      <span
                        className={`badge badge-${event.type.toLowerCase()}`}
                      >
                        {event.type}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)' }}>{NOT_SUPPLIED}</span>
                    )}
                  </td>
                  <td style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {event.reason ?? NOT_SUPPLIED}
                  </td>
                  <td style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {event.object.kind && event.object.name
                      ? `${event.object.kind}/${event.object.name}`
                      : event.object.name ?? event.object.kind ?? NOT_SUPPLIED}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {event.occurrenceCountStatus === 'valid' && event.occurrenceCount !== null
                      ? event.occurrenceCount
                      : event.occurrenceCountStatus === 'invalid'
                      ? 'Invalid value'
                      : NOT_SUPPLIED}
                  </td>
                  <td
                    style={{
                      maxWidth: '280px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {event.message ?? NOT_SUPPLIED}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
