// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React, { useEffect, useRef, useCallback } from 'react';
import { SimulatedBanner } from '../SimulatedBanner';
import { NOT_SUPPLIED } from '../../domain/constants';
import { formatDisplayTimestamp } from '../../domain/timestamps';
import type { NormalisedEvent } from '../../domain/types';

interface DetailPanelProps {
  event: NormalisedEvent;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  fallbackRef?: React.RefObject<HTMLElement | null>;
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <span className="detail-key">{label}</span>
      <span className="detail-val">{value ?? NOT_SUPPLIED}</span>
    </>
  );
}

function TimestampSourceLabel({ source }: { source: string }) {
  if (source === 'creationTimestamp') {
    return (
      <span style={{ color: '#fbbf24', fontSize: '0.7rem', marginLeft: '0.25rem' }}>
        [fallback: creationTimestamp]
      </span>
    );
  }
  if (source === 'none') {
    return null;
  }
  return (
    <span style={{ color: '#94a3b8', fontSize: '0.7rem', marginLeft: '0.25rem' }}>
      [from: {source}]
    </span>
  );
}

export const DetailPanel: React.FC<DetailPanelProps> = ({ event, onClose, triggerRef, fallbackRef }) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    onClose();
    const origin = triggerRef?.current;
    if (origin?.isConnected) origin.focus();
    else fallbackRef?.current?.focus();
  }, [onClose, triggerRef, fallbackRef]);

  useEffect(() => {
    // Focus close button on open
    closeButtonRef.current?.focus();
  }, [event.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleClose]);

  const countDisplay = () => {
    if (event.occurrenceCountStatus === 'valid') {
      return String(event.occurrenceCount);
    }
    if (event.occurrenceCountStatus === 'missing') {
      return NOT_SUPPLIED;
    }
    return 'Invalid value';
  };

  const rawJsonStr = (() => {
    try {
      return JSON.stringify(event.rawEvent, null, 2);
    } catch {
      return '(Could not serialize raw event)';
    }
  })();

  return (
    <div
      className="detail-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      data-testid="detail-panel-overlay"
      role="presentation"
    >
      <div
        className="detail-panel"
        ref={panelRef}
        data-testid="detail-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Event detail: ${event.reason ?? 'Unknown event'}`}
      >
        <div className="detail-header">
          <div>
            <h2 style={{ fontSize: '1.0625rem', fontWeight: '700', marginBottom: '0.25rem' }}>
              Event Detail
            </h2>
            {event.type && (
              <span className={`badge badge-${event.type.toLowerCase()}`}>{event.type}</span>
            )}
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            className="sim-btn"
            onClick={handleClose}
            aria-label="Close event detail panel"
            data-testid="detail-close-btn"
          >
            Close
          </button>
        </div>

        <SimulatedBanner />

        <div className="detail-body">
          {event.validationIssues.length > 0 && (
            <section className="detail-section" aria-label="Record validation issues">
              <h3 className="section-label">Data quality issues</h3>
              <p role="alert" data-testid="invalid-record-notice">
                This record has missing or malformed required data, or an invalid supplied value.
                Its original source is preserved below,
                and other Events remain available.
              </p>
              <ul>
                {event.validationIssues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            </section>
          )}

          {/* Core fields */}
          <div className="detail-section">
            <span className="section-label">Event</span>
            <div className="detail-grid">
              <FieldRow label="Reason" value={event.reason} />
              <FieldRow label="Message" value={event.message} />
              <FieldRow label="Action" value={event.action} />
              <FieldRow label="Namespace" value={event.namespace} />
              <FieldRow label="API Version" value={event.apiVersion} />
            </div>
          </div>

          {/* Object reference */}
          <div className="detail-section">
            <span className="section-label">Referenced Object</span>
            <div className="detail-grid">
              <FieldRow label="Kind" value={event.object.kind} />
              <FieldRow label="Name" value={event.object.name} />
              <FieldRow label="Namespace" value={event.object.namespace} />
              <FieldRow label="API Version" value={event.object.apiVersion} />
              <FieldRow label="UID" value={event.object.uid} />
            </div>
          </div>

          {/* Timestamps */}
          <div className="detail-section">
            <span className="section-label">Timestamps</span>
            <div className="detail-grid">
              <FieldRow
                label="First observed"
                value={
                  <span>
                    {event.firstObservedAt
                      ? formatDisplayTimestamp(event.firstObservedAt)
                      : NOT_SUPPLIED}
                    <TimestampSourceLabel source={event.timestampSource.first} />
                  </span>
                }
              />
              <FieldRow
                label="Last observed"
                value={
                  <span>
                    {event.lastObservedAt
                      ? formatDisplayTimestamp(event.lastObservedAt)
                      : (
                        <span style={{ color: '#f87171' }}>
                          {event.timestampSource.last !== 'none'
                            ? 'Invalid timestamp'
                            : NOT_SUPPLIED}
                        </span>
                      )}
                    <TimestampSourceLabel source={event.timestampSource.last} />
                    {!event.timestampValid && event.timestampSource.last !== 'none' && (
                      <span style={{ color: '#f87171', fontSize: '0.7rem', marginLeft: '0.25rem' }}>
                        [invalid - excluded from time filters]
                      </span>
                    )}
                  </span>
                }
              />
              <FieldRow
                label="Created at"
                value={event.createdAt ? formatDisplayTimestamp(event.createdAt) : NOT_SUPPLIED}
              />
              <FieldRow
                label="Timestamp valid"
                value={
                  <span style={{ color: event.timestampValid ? 'var(--color-normal)' : 'var(--color-danger)' }}>
                    {event.timestampValid ? 'Yes' : 'No (excluded from bounded time filters)'}
                  </span>
                }
              />
            </div>
          </div>

          {/* Occurrences */}
          <div className="detail-section">
            <span className="section-label">Occurrences</span>
            <div className="detail-grid">
              <FieldRow
                label="Occurrence count"
                value={
                  <span data-testid="occurrence-count-display">
                    {countDisplay()}
                    {event.occurrenceCountStatus !== 'valid' && (
                      <span style={{ color: '#94a3b8', fontSize: '0.7rem', marginLeft: '0.25rem' }}>
                        [{event.occurrenceCountStatus}]
                      </span>
                    )}
                  </span>
                }
              />
              <FieldRow label="Reporter" value={event.reporter} />
            </div>
          </div>

          {/* Raw JSON */}
          <div className="detail-section">
            <span className="section-label">Raw JSON (untouched source record)</span>
            <pre
              className="raw-json-box"
              aria-label="Raw event JSON"
              data-testid="raw-json-display"
            >
              {rawJsonStr}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
