// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

/**
 * Clones one kubeconfig context under a "-b" name so the team-mode gate can
 * grant two different identities two different clusters. Both contexts point at
 * the same disposable kind cluster; only the logical cluster IDs differ.
 *
 * Usage: tsx scripts/team/clone-context.ts <context> <output-path>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';

type Kubeconfig = {
  'current-context'?: string;
  contexts?: { name: string; context: Record<string, unknown> }[];
  clusters?: { name: string; cluster: Record<string, unknown> }[];
  users?: { name: string; user: Record<string, unknown> }[];
};

const contextName = process.argv[2];
const outputPath = process.argv[3];
if (!contextName || !outputPath) {
  process.stderr.write('Usage: clone-context.ts <context> <output-path>\n');
  process.exit(1);
}

const sourcePath = process.env['KUBECONFIG'] ?? join(homedir(), '.kube', 'config');
const document = parse(readFileSync(sourcePath, 'utf8')) as Kubeconfig;

const context = document.contexts?.find((entry) => entry.name === contextName);
if (!context) throw new Error(`Kubeconfig has no context named ${contextName}.`);

const clusterName = String(context.context['cluster']);
const userName = String(context.context['user']);
const cluster = document.clusters?.find((entry) => entry.name === clusterName);
if (!cluster) throw new Error(`Kubeconfig has no cluster named ${clusterName}.`);

const cloneName = `${contextName}-b`;
document.contexts = [
  ...(document.contexts ?? []),
  { name: cloneName, context: { ...context.context, cluster: `${clusterName}-b`, user: `${userName}-b` } },
];
document.clusters = [...(document.clusters ?? []), { name: `${clusterName}-b`, cluster: { ...cluster.cluster } }];
document.users = [...(document.users ?? []), { name: `${userName}-b`, user: { ...(document.users?.find((entry) => entry.name === userName)?.user ?? {}) } }];
document['current-context'] = contextName;

writeFileSync(outputPath, stringify(document), { mode: 0o600 });
process.stdout.write(`${cloneName} cloned from ${contextName} into ${outputPath}\n`);
