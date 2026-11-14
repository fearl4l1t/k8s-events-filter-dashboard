// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React, { useState, useEffect, useRef } from 'react';
import type { ScenarioId, SimulatorSpeed, SimulatorStatus } from '../domain/types';
import { AVAILABLE_SPEEDS } from '../domain/constants';

type Tab = 'overview' | 'explorer' | 'analytics';

interface HeaderProps {
  explorerTabRef?: React.RefObject<HTMLButtonElement | null>;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  simulatorStatus: SimulatorStatus;
  scenarioName: string;
  activeScenarioId: ScenarioId;
  speed: SimulatorSpeed;
  currentStepIndex: number;
  totalSteps: number;
  availableScenarios: readonly { id: ScenarioId; name: string; description: string }[];
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onSelectScenario: (id: ScenarioId) => void;
  onSetSpeed: (speed: SimulatorSpeed) => void;
}

function StatusBadge({ status }: { status: SimulatorStatus }) {
  const classMap: Record<SimulatorStatus, string> = {
    running: 'status-running',
    paused: 'status-paused',
    idle: 'status-idle',
    completed: 'status-completed',
    'limit-reached': 'status-limit',
  };
  const labelMap: Record<SimulatorStatus, string> = {
    running: 'Running',
    paused: 'Paused',
    idle: 'Idle',
    completed: 'Completed',
    'limit-reached': 'Limit Reached',
  };
  return (
    <span
      className={`sim-status-badge ${classMap[status]}`}
      role="status"
      aria-live="polite"
      data-testid="sim-status"
    >
      {labelMap[status]}
    </span>
  );
}

export const Header: React.FC<HeaderProps> = ({
  explorerTabRef,
  activeTab,
  onTabChange,
  simulatorStatus,
  scenarioName,
  activeScenarioId,
  speed,
  currentStepIndex,
  totalSteps,
  availableScenarios,
  onPlay,
  onPause,
  onReset,
  onSelectScenario,
  onSetSpeed,
}) => {
  const [showResetModal, setShowResetModal] = useState(false);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const cancelResetRef = useRef<HTMLButtonElement>(null);
  const resetDialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showResetModal) return;
    cancelResetRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowResetModal(false);
        resetButtonRef.current?.focus();
        return;
      }
      if (event.key === 'Tab') {
        const dialog = resetDialogRef.current;
        if (!dialog) return;
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !dialog.contains(active))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showResetModal]);

  const isRunning = simulatorStatus === 'running';
  const isCompleted = simulatorStatus === 'completed' || simulatorStatus === 'limit-reached';

  function handleResetRequest() {
    setShowResetModal(true);
  }

  function handleResetConfirm() {
    setShowResetModal(false);
    onReset();
    resetButtonRef.current?.focus();
  }

  function handleResetCancel() {
    setShowResetModal(false);
    resetButtonRef.current?.focus();
  }

  function handleScenarioChange(e: React.ChangeEvent<HTMLSelectElement>) {
    onSelectScenario(e.target.value as ScenarioId);
  }

  function handleSpeedChange(e: React.ChangeEvent<HTMLSelectElement>) {
    onSetSpeed(parseFloat(e.target.value) as SimulatorSpeed);
  }

  return (
    <>
      <header className="app-header" role="banner">
        {/* Brand */}
        <div className="brand-section">
          <svg
            className="brand-logo"
            viewBox="0 0 28 28"
            fill="none"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="14" cy="14" r="13" stroke="#326ce5" strokeWidth="2" />
            <path
              d="M14 6l2.5 5.5h5.5l-4.5 3.5 1.75 5.5L14 17.5l-5.25 3 1.75-5.5L6 11.5h5.5L14 6z"
              fill="#326ce5"
            />
          </svg>
          <span className="brand-title">K8s Events</span>
        </div>

        {/* Nav tabs */}
        <nav className="nav-tabs" role="navigation" aria-label="Main sections">
          {(['overview', 'explorer', 'analytics'] as Tab[]).map((tab) => (
            <button
              key={tab}
              ref={tab === 'explorer' ? explorerTabRef : undefined}
              type="button"
              className={`nav-tab-btn${activeTab === tab ? ' active' : ''}`}
              onClick={() => onTabChange(tab)}
              aria-current={activeTab === tab ? 'page' : undefined}
              data-testid={`nav-tab-${tab}`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>

        {/* Simulator controls */}
        <div className="simulator-controls" aria-label="Simulator controls">
          <select
            className="sim-select"
            value={activeScenarioId}
            onChange={handleScenarioChange}
            aria-label="Select scenario"
            data-testid="scenario-select"
          >
            {availableScenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <StatusBadge status={simulatorStatus} />

          {isRunning ? (
            <button
              type="button"
              className="sim-btn"
              onClick={onPause}
              aria-label="Pause simulation"
              data-testid="sim-play-pause-btn"
            >
              Pause
            </button>
          ) : (
            <button
              type="button"
              className="sim-btn sim-btn-primary"
              onClick={onPlay}
              disabled={isCompleted}
              aria-label="Play simulation"
              data-testid="sim-play-pause-btn"
            >
              Play
            </button>
          )}

          <label htmlFor="speed-select" className="filter-label">
            Speed
          </label>
          <select
            id="speed-select"
            className="sim-select"
            value={speed}
            onChange={handleSpeedChange}
            aria-label="Simulation speed"
            data-testid="sim-speed-select"
          >
            {AVAILABLE_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>

          <span
            style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}
            aria-label={`Step ${currentStepIndex} of ${totalSteps}`}
          >
            {currentStepIndex}/{totalSteps}
          </span>

          <button
            type="button"
            ref={resetButtonRef}
            className="sim-btn"
            onClick={handleResetRequest}
            aria-label={`Reset scenario ${scenarioName}`}
            data-testid="sim-reset-btn"
          >
            Reset
          </button>
        </div>
      </header>

      {/* Reset confirmation modal */}
      {showResetModal && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-modal-title"
          aria-describedby="reset-modal-desc"
        >
          <div className="modal-content" ref={resetDialogRef}>
            <h2 id="reset-modal-title" style={{ fontSize: '1rem', fontWeight: 700 }}>
              Reset Scenario
            </h2>
            <p id="reset-modal-desc" style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
              Resetting will restore the initial fixture for "{scenarioName}" and remove all
              simulated arrivals. The simulator will return to the idle state. Active filters are
              preserved.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                ref={cancelResetRef}
                className="sim-btn"
                onClick={handleResetCancel}
                data-testid="cancel-reset-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                className="sim-btn"
                style={{
                  backgroundColor: 'var(--color-danger)',
                  borderColor: 'var(--color-danger)',
                  color: '#fff',
                }}
                onClick={handleResetConfirm}
                data-testid="confirm-reset-btn"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
