// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import * as fs from 'node:fs';
import * as path from 'node:path';

interface FixtureRoot {
  scenarioId: string;
  name: string;
  description: string;
  seedEvents: Record<string, unknown>[];
  steps: {
    delayMs: number;
    event: Record<string, unknown>;
    isSeriesUpdate?: boolean;
  }[];
}

const REQUIRED_SCENARIOS = [
  'normal-rollout',
  'image-pull-failure',
  'scheduling-pressure',
  'container-health',
  'node-condition',
  'core-v1-compat',
];

const FIXTURES_DIR = path.resolve(process.cwd(), 'fixtures');

function fail(message: string): never {
  console.error(`Validation Error: ${message}`);
  process.exit(1);
}

function validateEventRecord(
  event: Record<string, unknown>,
  context: string,
  seenUids: Set<string>,
  allowDuplicateUid = false
): void {
  if (typeof event !== 'object' || event === null) {
    fail(`${context}: event record is not an object`);
  }

  const apiVersion = event['apiVersion'];
  if (apiVersion !== 'events.k8s.io/v1' && apiVersion !== 'v1') {
    fail(`${context}: unsupported apiVersion "${apiVersion}"`);
  }

  const metadata = event['metadata'];
  if (typeof metadata !== 'object' || metadata === null) {
    fail(`${context}: metadata is missing or not an object`);
  }

  const metaRecord = metadata as Record<string, unknown>;
  const uid = metaRecord['uid'];
  if (typeof uid === 'string' && uid.trim()) {
    if (!allowDuplicateUid) {
      if (seenUids.has(uid)) {
        fail(`${context}: duplicate UID found "${uid}"`);
      }
      seenUids.add(uid);
    }
  }

  // Ensure no secrets or real cluster credentials in data
  const rawString = JSON.stringify(event);
  if (
    rawString.includes('bearer') ||
    rawString.includes('BEGIN RSA PRIVATE KEY') ||
    rawString.includes('BEGIN CERTIFICATE') ||
    rawString.includes('client-certificate-data')
  ) {
    fail(`${context}: fixture contains forbidden credential-like strings`);
  }

  // Check object reference
  const objRef = apiVersion === 'events.k8s.io/v1' ? event['regarding'] : event['involvedObject'];
  if (objRef !== undefined && objRef !== null && typeof objRef !== 'object') {
    fail(`${context}: object reference is malformed`);
  }
}

function validateFixtureFile(filename: string): void {
  const filePath = path.join(FIXTURES_DIR, filename);
  if (!fs.existsSync(filePath)) {
    fail(`Missing required fixture file: ${filename}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  let data: FixtureRoot;
  try {
    data = JSON.parse(content);
  } catch (err) {
    fail(`Invalid JSON in ${filename}: ${(err as Error).message}`);
  }

  if (!data.scenarioId || !data.name || !Array.isArray(data.seedEvents) || !Array.isArray(data.steps)) {
    fail(`${filename}: missing scenarioId, name, seedEvents array, or steps array`);
  }

  const seenUids = new Set<string>();

  data.seedEvents.forEach((event, idx) => {
    validateEventRecord(event, `${filename} seed[${idx}]`, seenUids);
  });

  data.steps.forEach((step, idx) => {
    if (typeof step.delayMs !== 'number' || step.delayMs < 0) {
      fail(`${filename} step[${idx}]: invalid delayMs`);
    }
    // Series updates intentionally reference existing series UIDs
    validateEventRecord(step.event, `${filename} step[${idx}]`, seenUids, Boolean(step.isSeriesUpdate));
  });

  console.log(`Validated ${filename} successfully (${data.seedEvents.length} seeds, ${data.steps.length} steps).`);
}

function main(): void {
  console.log('Validating fixtures against requirements...');

  if (!fs.existsSync(FIXTURES_DIR)) {
    fail(`Fixtures directory does not exist at ${FIXTURES_DIR}`);
  }

  for (const scenarioId of REQUIRED_SCENARIOS) {
    validateFixtureFile(`${scenarioId}.json`);
  }

  console.log('All fixtures validated successfully.');
}

main();
