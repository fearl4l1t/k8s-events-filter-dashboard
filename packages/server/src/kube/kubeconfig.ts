// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { EventSource } from '@k8s-events/domain';

/** A resolved, secret-bearing connection description. Never serialize this. */
export type ConnectionSpec = {
  clusterId: string;
  clusterName: string;
  source: EventSource;
  server: URL;
  ca: string | null;
  clientCertificate: string | null;
  clientKey: string | null;
  token: string | null;
  /** Refreshes short-lived credentials such as exec plugin tokens. */
  credentialProvider: (() => Promise<{ token: string | null }>) | null;
};

export class KubeconfigError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'KubeconfigError';
  }
}

type KubeconfigDocument = {
  'current-context'?: string;
  clusters?: { name: string; cluster: Record<string, unknown> }[];
  users?: { name: string; user: Record<string, unknown> }[];
  contexts?: {
    name: string;
    context: { cluster?: string; user?: string; namespace?: string };
  }[];
};

export type LoadOptions = {
  path: string;
  /** Contexts to observe. Empty means the current context. */
  contextNames: string[];
  readFile?: (path: string) => string;
  /** Directory used to resolve relative certificate paths. Defaults to the kubeconfig directory. */
  baseDir?: string;
};

function requireString(value: unknown, field: string, contextName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new KubeconfigError(
      'invalid_kubeconfig',
      `Kubeconfig context "${contextName}" has no usable ${field}.`
    );
  }
  return value;
}

function decodeBase64(value: string, field: string, contextName: string): string {
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    throw new KubeconfigError(
      'invalid_kubeconfig',
      `Kubeconfig context "${contextName}" has an unreadable ${field}.`
    );
  }
}

function readDataOrFile(
  data: unknown,
  file: unknown,
  field: string,
  contextName: string,
  baseDir: string,
  readFile: (path: string) => string
): string | null {
  if (typeof data === 'string' && data.trim() !== '') {
    return decodeBase64(data, field, contextName);
  }
  if (typeof file === 'string' && file.trim() !== '') {
    const resolved = isAbsolute(file) ? file : join(baseDir, file);
    try {
      return readFile(resolved);
    } catch {
      throw new KubeconfigError(
        'unreadable_credential_file',
        `Kubeconfig context "${contextName}" references an unreadable ${field} file.`
      );
    }
  }
  return null;
}

type ExecCredential = {
  status?: { token?: string; expirationTimestamp?: string; clientCertificateData?: string; clientKeyData?: string };
};

function makeExecProvider(
  exec: Record<string, unknown>,
  contextName: string
): () => Promise<{ token: string | null }> {
  const command = requireString(exec['command'], 'exec command', contextName);
  const args = Array.isArray(exec['args']) ? exec['args'].filter((a): a is string => typeof a === 'string') : [];
  const envList = Array.isArray(exec['env'])
    ? exec['env']
        .map((entry) =>
          entry && typeof entry === 'object'
            ? {
                name: String((entry as Record<string, unknown>)['name'] ?? ''),
                value: String((entry as Record<string, unknown>)['value'] ?? ''),
              }
            : null
        )
        .filter((entry): entry is { name: string; value: string } => entry !== null)
    : [];
  let cached: { token: string; expiresAt: number } | null = null;

  return async () => {
    if (cached && cached.expiresAt > Date.now() + 30_000) return { token: cached.token };
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        command,
        args,
        {
          timeout: 20_000,
          env: { ...process.env, ...Object.fromEntries(envList.map((e) => [e.name, e.value])) },
          maxBuffer: 1024 * 1024,
        },
        (error, out) => (error ? reject(new KubeconfigError('exec_credential_failed', `Kubeconfig context "${contextName}" could not obtain credentials.`)) : resolve(out))
      );
    });
    let parsed: ExecCredential;
    try {
      parsed = JSON.parse(stdout) as ExecCredential;
    } catch {
      throw new KubeconfigError(
        'exec_credential_failed',
        `Kubeconfig context "${contextName}" returned unreadable credential output.`
      );
    }
    const token = typeof parsed.status?.token === 'string' ? parsed.status.token : null;
    if (!token) {
      throw new KubeconfigError(
        'exec_credential_failed',
        `Kubeconfig context "${contextName}" did not return a token.`
      );
    }
    const expiration = parsed.status?.expirationTimestamp
      ? Date.parse(parsed.status.expirationTimestamp)
      : NaN;
    cached = { token, expiresAt: Number.isNaN(expiration) ? Date.now() + 5 * 60_000 : expiration };
    return { token };
  };
}

export function parseKubeconfig(options: LoadOptions): ConnectionSpec[] {
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  let text: string;
  try {
    text = readFile(options.path);
  } catch {
    throw new KubeconfigError(
      'kubeconfig_unreadable',
      `Kubeconfig at ${options.path} could not be read.`
    );
  }

  let document: KubeconfigDocument;
  try {
    document = parseYaml(text) as KubeconfigDocument;
  } catch {
    throw new KubeconfigError('invalid_kubeconfig', 'Kubeconfig is not valid YAML.');
  }
  if (!document || typeof document !== 'object') {
    throw new KubeconfigError('invalid_kubeconfig', 'Kubeconfig is empty or malformed.');
  }

  const contexts = document.contexts ?? [];
  const requested =
    options.contextNames.length > 0
      ? options.contextNames
      : document['current-context']
        ? [document['current-context']]
        : [];
  if (requested.length === 0) {
    throw new KubeconfigError(
      'no_context',
      'No kubeconfig context was selected and the file has no current context.'
    );
  }

  const baseDir = options.baseDir ?? join(options.path, '..');

  return requested.map((contextName) => {
    const entry = contexts.find((context) => context.name === contextName);
    if (!entry) {
      throw new KubeconfigError('unknown_context', `Kubeconfig has no context named "${contextName}".`);
    }
    const clusterName = requireString(entry.context.cluster, 'cluster', contextName);
    const userName = entry.context.user;
    const clusterEntry = (document.clusters ?? []).find((cluster) => cluster.name === clusterName);
    if (!clusterEntry) {
      throw new KubeconfigError(
        'unknown_cluster',
        `Kubeconfig context "${contextName}" references an unknown cluster.`
      );
    }
    const cluster = clusterEntry.cluster;
    if (cluster['insecure-skip-tls-verify'] === true) {
      throw new KubeconfigError(
        'tls_verification_disabled',
        `Kubeconfig context "${contextName}" disables TLS verification, which this server does not allow.`
      );
    }
    const serverValue = requireString(cluster['server'], 'server URL', contextName);
    let server: URL;
    try {
      server = new URL(serverValue);
    } catch {
      throw new KubeconfigError(
        'invalid_kubeconfig',
        `Kubeconfig context "${contextName}" has an unreadable server URL.`
      );
    }
    if (server.protocol !== 'https:' && server.protocol !== 'http:') {
      throw new KubeconfigError(
        'invalid_kubeconfig',
        `Kubeconfig context "${contextName}" uses an unsupported protocol.`
      );
    }

    const ca = readDataOrFile(
      cluster['certificate-authority-data'],
      cluster['certificate-authority'],
      'certificate authority',
      contextName,
      baseDir,
      readFile
    );

    const userEntry = userName
      ? (document.users ?? []).find((user) => user.name === userName)
      : undefined;
    const user = userEntry?.user ?? {};

    const clientCertificate = readDataOrFile(
      user['client-certificate-data'],
      user['client-certificate'],
      'client certificate',
      contextName,
      baseDir,
      readFile
    );
    const clientKey = readDataOrFile(
      user['client-key-data'],
      user['client-key'],
      'client key',
      contextName,
      baseDir,
      readFile
    );

    let token: string | null = null;
    if (typeof user['token'] === 'string' && user['token'].trim()) {
      token = user['token'].trim();
    } else if (typeof user['tokenFile'] === 'string') {
      const tokenPath = isAbsolute(user['tokenFile'])
        ? user['tokenFile']
        : join(baseDir, user['tokenFile']);
      try {
        token = readFile(tokenPath).trim();
      } catch {
        throw new KubeconfigError(
          'unreadable_credential_file',
          `Kubeconfig context "${contextName}" references an unreadable token file.`
        );
      }
    }

    let credentialProvider: ConnectionSpec['credentialProvider'] = null;
    if (!token && user['exec'] && typeof user['exec'] === 'object') {
      credentialProvider = makeExecProvider(user['exec'] as Record<string, unknown>, contextName);
    }

    return {
      clusterId: contextName,
      clusterName,
      source: 'local',
      server,
      ca,
      clientCertificate,
      clientKey,
      token,
      credentialProvider,
    };
  });
}

export type InClusterOptions = {
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
};

const SERVICE_ACCOUNT_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';

export function resolveInClusterConnection(options: InClusterOptions = {}): ConnectionSpec {
  const env = options.env ?? process.env;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const host = env['KUBERNETES_SERVICE_HOST'];
  const port = env['KUBERNETES_SERVICE_PORT'] ?? '443';
  if (!host) {
    throw new KubeconfigError(
      'not_in_cluster',
      'In-cluster mode requires KUBERNETES_SERVICE_HOST, which is not set.'
    );
  }
  const root = env['EVENTS_SERVICE_ACCOUNT_DIR'] ?? SERVICE_ACCOUNT_DIR;
  let token: string;
  let ca: string | null;
  try {
    token = readFile(join(root, 'token')).trim();
  } catch {
    throw new KubeconfigError(
      'service_account_unreadable',
      'The ServiceAccount token is not readable; this process is not running in a cluster pod.'
    );
  }
  try {
    ca = readFile(join(root, 'ca.crt'));
  } catch {
    ca = null;
  }
  const hostForUrl = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return {
    clusterId: 'in-cluster',
    clusterName: env['EVENTS_CLUSTER_NAME'] ?? 'in-cluster',
    source: 'in-cluster',
    server: new URL(`https://${hostForUrl}:${port}`),
    ca,
    clientCertificate: null,
    clientKey: null,
    token,
    credentialProvider: null,
  };
}

export function defaultKubeconfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['EVENTS_KUBECONFIG'];
  if (configured && configured.trim()) return configured;
  return join(homedir(), '.kube', 'config');
}
