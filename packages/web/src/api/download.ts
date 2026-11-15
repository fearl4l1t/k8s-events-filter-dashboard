// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

/** Downloads a string payload as a client-side file and revokes the object URL. */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: 'text/csv;charset=utf-8;' | 'application/json;charset=utf-8;'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
