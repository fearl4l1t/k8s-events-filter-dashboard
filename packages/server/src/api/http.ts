// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { createReadStream, promises as fs } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ErrorBody = { error: { code: string; message: string } };

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } } satisfies ErrorBody);
}

export function sendMethodNotAllowed(res: ServerResponse, allow: string): void {
  res.setHeader('allow', allow);
  sendError(res, 405, 'method_not_allowed', 'This endpoint accepts ' + allow + ' only.');
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Serves the built web assets. Unknown paths fall back to index.html so the
 * single-page shell loads on a direct navigation, but API paths never do.
 */
export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  staticDir: string,
  pathname: string
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const root = resolve(staticDir);
  const requested = pathname === '/' ? '/index.html' : pathname;
  const candidate = normalize(join(root, requested));
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    sendError(res, 400, 'invalid_path', 'The requested path is not valid.');
    return true;
  }
  let file = candidate;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    file = join(root, 'index.html');
    try {
      await fs.stat(file);
    } catch {
      return false;
    }
  }
  const extension = extname(file);
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'cache-control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  await new Promise<void>((resolveStream, reject) => {
    const stream = createReadStream(file);
    stream.on('error', reject);
    stream.on('end', resolveStream);
    stream.pipe(res);
  });
  return true;
}

export function requestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

export function requestUrl(req: IncomingMessage): URL {
  try {
    return new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return new URL('http://localhost/');
  }
}

export function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}
