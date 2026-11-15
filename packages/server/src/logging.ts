// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

/** Structured logging with credential redaction. */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACTED = '[redacted]';

/** Field names whose values must never reach a log line. */
const SENSITIVE_KEY = /(token|authorization|password|secret|clientkey|client-key|clientcertificate|certificate|apikey|api_key|cookie)/i;

export type LogFields = Record<string, unknown>;

export type Logger = {
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
  child: (fields: LogFields) => Logger;
};

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') {
    // Kubernetes bearer tokens and PEM blocks can appear inside messages.
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, `Bearer ${REDACTED}`)
      .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, REDACTED);
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(inner, depth + 1);
    }
    return output;
  }
  return value;
}

export function createLogger(
  level: LogLevel,
  base: LogFields = {},
  sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`)
): Logger {
  const threshold = LEVELS[level];
  const write = (entryLevel: LogLevel, message: string, fields?: LogFields) => {
    if (LEVELS[entryLevel] < threshold) return;
    const entry = redact({
      time: new Date().toISOString(),
      level: entryLevel,
      message,
      ...base,
      ...fields,
    }) as Record<string, unknown>;
    sink(JSON.stringify(entry));
  };
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (fields) => createLogger(level, { ...base, ...fields }, sink),
  };
}
