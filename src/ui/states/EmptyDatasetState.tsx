// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React from 'react';

interface Props {
  onReset?: () => void;
}

export const EmptyDatasetState: React.FC<Props> = ({ onReset }) => {
  return (
    <div className="state-container panel-card" data-testid="empty-dataset-state" role="status">
      <h3 className="state-title">No events in dataset</h3>
      <p className="state-description">
        The active scenario does not contain any event records. Load a scenario or reset the simulator.
      </p>
      {onReset && (
        <button type="button" className="sim-btn sim-btn-primary" onClick={onReset}>
          Reset Scenario
        </button>
      )}
    </div>
  );
};
