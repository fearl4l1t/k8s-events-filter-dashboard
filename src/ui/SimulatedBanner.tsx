// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React from 'react';
import { SIMULATED_DATA_BANNER, SIMULATED_DATA_LABEL } from '../domain/constants';

export const SimulatedBanner: React.FC = () => {
  return (
    <aside
      className="simulated-banner"
      data-testid="simulated-data-banner"
      aria-label="Simulated environment disclosure"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span className="sim-tag" data-testid="simulated-data-label">
          {SIMULATED_DATA_LABEL}
        </span>
        <span>{SIMULATED_DATA_BANNER}</span>
      </div>
      <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
        No cluster contacted &bull; In-browser simulation
      </div>
    </aside>
  );
};
