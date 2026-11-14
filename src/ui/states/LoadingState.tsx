// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React from 'react';

export const LoadingState: React.FC = () => {
  return (
    <div className="state-container" data-testid="loading-state" role="status" aria-live="polite">
      <div className="state-title">Loading local sample fixtures...</div>
      <p className="state-description">Preparing synthetic Event records and scenario playback.</p>
    </div>
  );
};
