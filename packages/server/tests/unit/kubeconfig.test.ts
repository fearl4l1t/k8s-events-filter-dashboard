// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import { describe, it, expect } from 'vitest';
import {
  defaultKubeconfigPath,
  KubeconfigError,
  parseKubeconfig,
  resolveInClusterConnection,
} from '../../src/kube/kubeconfig';

const CA = Buffer.from('ca-pem').toString('base64');
const CERT = Buffer.from('cert-pem').toString('base64');
const KEY = Buffer.from('key-pem').toString('base64');

const KUBECONFIG = `
apiVersion: v1
kind: Config
current-context: kind-events
clusters:
  - name: kind-events
    cluster:
      server: https://127.0.0.1:6443
      certificate-authority-data: ${CA}
  - name: remote
    cluster:
      server: https://remote.example.test
      certificate-authority-data: ${CA}
  - name: insecure
    cluster:
      server: https://insecure.example.test
      insecure-skip-tls-verify: true
users:
  - name: kind-admin
    user:
      client-certificate-data: ${CERT}
      client-key-data: ${KEY}
  - name: remote-user
    user:
      token: remote-token
contexts:
  - name: kind-events
    context:
      cluster: kind-events
      user: kind-admin
      namespace: default
  - name: remote
    context:
      cluster: remote
      user: remote-user
  - name: insecure
    context:
      cluster: insecure
      user: remote-user
  - name: broken
    context:
      cluster: missing
      user: remote-user
`;

function load(contexts: string[] = [], text = KUBECONFIG) {
  return parseKubeconfig({
    path: '/home/tester/.kube/config',
    contextNames: contexts,
    readFile: (path) => {
      if (path === '/home/tester/.kube/config') return text;
      throw new Error('missing');
    },
  });
}

describe('parseKubeconfig', () => {
  it('resolves the current context with TLS material', () => {
    const [connection] = load();
    expect(connection?.clusterId).toBe('kind-events');
    expect(connection?.clusterName).toBe('kind-events');
    expect(connection?.server.toString()).toBe('https://127.0.0.1:6443/');
    expect(connection?.ca).toBe('ca-pem');
    expect(connection?.clientCertificate).toBe('cert-pem');
    expect(connection?.clientKey).toBe('key-pem');
    expect(connection?.token).toBeNull();
    expect(connection?.source).toBe('local');
  });

  it('resolves several requested contexts', () => {
    const connections = load(['kind-events', 'remote']);
    expect(connections.map((c) => c.clusterId)).toEqual(['kind-events', 'remote']);
  });

  it('reads a bearer token user', () => {
    const [, remote] = load(['kind-events', 'remote']);
    expect(remote?.token).toBe('remote-token');
    expect(remote?.server.toString()).toBe('https://remote.example.test/');
  });

  it('refuses a context that disables TLS verification', () => {
    expect(() => load(['insecure'])).toThrow(KubeconfigError);
    try {
      load(['insecure']);
    } catch (error) {
      expect((error as KubeconfigError).code).toBe('tls_verification_disabled');
    }
  });

  it('rejects unknown contexts and unknown clusters', () => {
    expect(() => load(['nope'])).toThrow(/no context named/);
    expect(() => load(['broken'])).toThrow(/unknown cluster/);
  });

  it('rejects an unreadable or empty kubeconfig', () => {
    expect(() =>
      parseKubeconfig({ path: '/missing', contextNames: [], readFile: () => {
        throw new Error('nope');
      } })
    ).toThrow(KubeconfigError);
    expect(() => load([], '')).toThrow(/empty or malformed/);
    expect(() => load([], 'current-context: x\n')).toThrow(/no context named/);
  });

  it('reads a token file relative to the kubeconfig', () => {
    const text = `
current-context: c
clusters:
  - name: cluster
    cluster: { server: "https://api.example.test" }
users:
  - name: user
    user: { tokenFile: token.txt }
contexts:
  - name: c
    context: { cluster: cluster, user: user }
`;
    const [connection] = parseKubeconfig({
      path: '/home/tester/.kube/config',
      contextNames: [],
      readFile: (path) => {
        if (path === '/home/tester/.kube/config') return text;
        if (path === '/home/tester/.kube/token.txt') return 'file-token\n';
        throw new Error('missing');
      },
    });
    expect(connection?.token).toBe('file-token');
  });

  it('creates an exec credential provider without running it', () => {
    const text = `
current-context: c
clusters:
  - name: cluster
    cluster: { server: "https://api.example.test" }
users:
  - name: user
    user:
      exec:
        command: aws
        args: ["eks", "get-token"]
contexts:
  - name: c
    context: { cluster: cluster, user: user }
`;
    const [connection] = parseKubeconfig({
      path: '/config',
      contextNames: [],
      readFile: () => text,
    });
    expect(typeof connection?.credentialProvider).toBe('function');
    expect(connection?.token).toBeNull();
  });
});

describe('resolveInClusterConnection', () => {
  it('reads the ServiceAccount token and CA', () => {
    const connection = resolveInClusterConnection({
      env: { KUBERNETES_SERVICE_HOST: '10.0.0.1', KUBERNETES_SERVICE_PORT: '443' },
      readFile: (path) => {
        if (path.endsWith('token')) return 'sa-token';
        if (path.endsWith('ca.crt')) return 'sa-ca';
        throw new Error('missing');
      },
    });
    expect(connection.source).toBe('in-cluster');
    expect(connection.token).toBe('sa-token');
    expect(connection.ca).toBe('sa-ca');
    expect(connection.server.toString()).toBe('https://10.0.0.1/');
    expect(connection.server.port).toBe('');
  });

  it('reports a missing in-cluster environment', () => {
    expect(() => resolveInClusterConnection({ env: {} })).toThrow(KubeconfigError);
    expect(() =>
      resolveInClusterConnection({
        env: { KUBERNETES_SERVICE_HOST: '10.0.0.1' },
        readFile: () => {
          throw new Error('missing');
        },
      })
    ).toThrow(/ServiceAccount token/);
  });
});

describe('credential file handling', () => {
  it('reports a token file that cannot be read', () => {
    const text = `
current-context: c
clusters:
  - name: cluster
    cluster: { server: "https://api.example.test" }
users:
  - name: user
    user: { tokenFile: missing.txt }
contexts:
  - name: c
    context: { cluster: cluster, user: user }
`;
    try {
      parseKubeconfig({
        path: '/config',
        contextNames: [],
        readFile: (path) => {
          if (path === '/config') return text;
          throw new Error('missing');
        },
      });
      throw new Error('expected a failure');
    } catch (error) {
      expect((error as KubeconfigError).code).toBe('unreadable_credential_file');
    }
  });

  it('reports an unreadable certificate authority file and accepts an absent one', () => {
    const withFile = `
current-context: c
clusters:
  - name: cluster
    cluster: { server: "https://api.example.test", certificate-authority: ca.crt }
contexts:
  - name: c
    context: { cluster: cluster, user: user }
`;
    expect(() =>
      parseKubeconfig({
        path: '/config',
        contextNames: [],
        readFile: (path) => {
          if (path === '/config') return withFile;
          throw new Error('missing');
        },
      })
    ).toThrow(/unreadable certificate authority/);

    const withoutCa = `
current-context: c
clusters:
  - name: cluster
    cluster: { server: "https://api.example.test" }
contexts:
  - name: c
    context: { cluster: cluster, user: user }
`;
    const [connection] = parseKubeconfig({
      path: '/config',
      contextNames: [],
      readFile: () => withoutCa,
    });
    expect(connection?.ca).toBeNull();
    expect(connection?.token).toBeNull();
    expect(connection?.clientCertificate).toBeNull();
  });

  it('rejects a server URL with an unsupported protocol or no server', () => {
    const make = (serverLine: string) => `
current-context: c
clusters:
  - name: cluster
    cluster: ${serverLine}
contexts:
  - name: c
    context: { cluster: cluster, user: user }
`;
    const loadWith = (serverLine: string) =>
      parseKubeconfig({ path: '/config', contextNames: [], readFile: () => make(serverLine) });
    expect(() => loadWith('{ server: "ftp://api.example.test" }')).toThrow(/unsupported protocol/);
    expect(() => loadWith('{ notServer: true }')).toThrow(/server URL/);
  });

  it('runs an exec credential command and caches its token', async () => {
    const text = `
current-context: c
clusters:
  - name: cluster
    cluster: { server: "https://api.example.test" }
users:
  - name: user
    user:
      exec:
        command: ${JSON.stringify(process.execPath)}
        args:
          - "-e"
          - "console.log(JSON.stringify({status:{token:'exec-token',expirationTimestamp:'2099-01-01T00:00:00Z'}}))"
contexts:
  - name: c
    context: { cluster: cluster, user: user }
`;
    const [connection] = parseKubeconfig({ path: '/config', contextNames: [], readFile: () => text });
    const provider = connection?.credentialProvider;
    expect(provider).not.toBeNull();
    expect(await provider?.()).toEqual({ token: 'exec-token' });
    expect(await provider?.()).toEqual({ token: 'exec-token' });
  });

  it('reports a failed or tokenless exec credential command', async () => {
    const make = (script: string) => `
current-context: c
clusters:
  - name: cluster
    cluster: { server: "https://api.example.test" }
users:
  - name: user
    user:
      exec:
        command: ${JSON.stringify(process.execPath)}
        args: ["-e", ${JSON.stringify(script)}]
contexts:
  - name: c
    context: { cluster: cluster, user: user }
`;
    const providerFor = (script: string) =>
      parseKubeconfig({ path: '/config', contextNames: [], readFile: () => make(script) })
        .at(0)
        ?.credentialProvider?.();

    await expect(providerFor('process.exit(1)')).rejects.toThrow(/could not obtain credentials/);
    await expect(providerFor('console.log("not json")')).rejects.toThrow(/unreadable credential output/);
    await expect(providerFor('console.log(JSON.stringify({ status: {} }))')).rejects.toThrow(
      /did not return a token/
    );
  });

  it('requires an exec command', () => {
    const text = `
current-context: c
clusters:
  - name: cluster
    cluster: { server: "https://api.example.test" }
users:
  - name: user
    user: { exec: { args: ["get-token"] } }
contexts:
  - name: c
    context: { cluster: cluster, user: user }
`;
    expect(() =>
      parseKubeconfig({ path: '/config', contextNames: [], readFile: () => text })
    ).toThrow(/exec command/);
  });
});

describe('in-cluster environment and defaults', () => {
  it('supports a custom ServiceAccount directory, cluster name and IPv6 host', () => {
    const connection = resolveInClusterConnection({
      env: {
        KUBERNETES_SERVICE_HOST: 'fd00::1',
        KUBERNETES_SERVICE_PORT: '6443',
        EVENTS_SERVICE_ACCOUNT_DIR: '/var/run/secrets/test',
        EVENTS_CLUSTER_NAME: 'production',
      },
      readFile: (path) => {
        if (path.endsWith('token')) return 'sa-token';
        throw new Error('missing');
      },
    });
    expect(connection.clusterName).toBe('production');
    expect(connection.server.toString()).toBe('https://[fd00::1]:6443/');
    expect(connection.ca).toBeNull();
  });

  it('uses the configured kubeconfig path or the home default', () => {
    expect(defaultKubeconfigPath({ EVENTS_KUBECONFIG: '/custom/config' })).toBe('/custom/config');
    expect(defaultKubeconfigPath({ EVENTS_KUBECONFIG: '  ' })).toMatch(/\.kube\/config$/);
  });
});
