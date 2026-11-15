// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import React from 'react';

export const EmptyDatasetState: React.FC = () => {
  return (
    <div className="state-container panel-card" data-testid="empty-dataset-state" role="status">
      <h2 className="state-title">No Events observed yet</h2>
      <p className="state-description">
        This view has started observing the selected clusters but has not received any Events.
        Kubernetes keeps Events for about one hour, so quiet clusters can show few or no records.
      </p>
    </div>
  );
};
