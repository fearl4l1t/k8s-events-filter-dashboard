// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import * as fs from 'node:fs';
import * as path from 'node:path';

interface MetricTotals {
  total: number;
  covered: number;
  pct: number;
}

interface FileCoverage {
  path: string;
  statementMap: Record<string, unknown>;
  s: Record<string, number>;
  fnMap: Record<string, unknown>;
  f: Record<string, number>;
  branchMap: Record<string, { locations?: unknown[] }>;
  b: Record<string, number[]>;
}

type CoverageJson = Record<string, FileCoverage>;

interface LayerConfig {
  name: string;
  pattern: RegExp;
  minLines: number;
  minBranches: number;
}

const LAYERS: LayerConfig[] = [
  {
    name: 'src/domain/**',
    pattern: /src\/domain\//,
    minLines: 95,
    minBranches: 90,
  },
  {
    name: 'src/store/**',
    pattern: /src\/store\//,
    minLines: 85,
    minBranches: 80,
  },
  {
    name: 'src/ui/**',
    pattern: /src\/ui\//,
    minLines: 60,
    minBranches: 50,
  },
];

function calculateLayerMetrics(files: FileCoverage[]): { lines: MetricTotals; branches: MetricTotals } {
  let totalStatements = 0;
  let coveredStatements = 0;
  let totalBranches = 0;
  let coveredBranches = 0;

  for (const file of files) {
    for (const count of Object.values(file.s)) {
      totalStatements++;
      if (count > 0) coveredStatements++;
    }

    for (const counts of Object.values(file.b)) {
      for (const count of counts) {
        totalBranches++;
        if (count > 0) coveredBranches++;
      }
    }
  }

  const linesPct = totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0;
  const branchesPct = totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0;

  return {
    lines: { total: totalStatements, covered: coveredStatements, pct: linesPct },
    branches: { total: totalBranches, covered: coveredBranches, pct: branchesPct },
  };
}

function main(): void {
  const reportPath = path.resolve(process.cwd(), 'coverage/coverage-final.json');

  if (!fs.existsSync(reportPath)) {
    console.error(`Coverage check failed: ${reportPath} does not exist. Run tests with coverage first.`);
    process.exit(1);
  }

  let coverageData: CoverageJson;
  try {
    coverageData = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  } catch (err) {
    console.error(`Coverage check failed: unable to parse JSON at ${reportPath}:`, err);
    process.exit(1);
  }

  const allFiles = Object.values(coverageData);
  let failed = false;

  console.log('--- Layer Coverage Validation ---');

  for (const layer of LAYERS) {
    const layerFiles = allFiles.filter((f) => layer.pattern.test(f.path.replace(/\\/g, '/')));

    if (layerFiles.length === 0) {
      console.error(`FAIL: No coverage entries found for layer ${layer.name}`);
      failed = true;
      continue;
    }

    const { lines, branches } = calculateLayerMetrics(layerFiles);

    const linesPass = lines.pct >= layer.minLines;
    const branchesPass = branches.pct >= layer.minBranches;

    console.log(
      `${layer.name}:` +
        `\n  Lines:    ${lines.pct.toFixed(2)}% (required >= ${layer.minLines}%) [${lines.covered}/${lines.total}] -> ${linesPass ? 'PASS' : 'FAIL'}` +
        `\n  Branches: ${branches.pct.toFixed(2)}% (required >= ${layer.minBranches}%) [${branches.covered}/${branches.total}] -> ${branchesPass ? 'PASS' : 'FAIL'}`
    );

    if (!linesPass || !branchesPass) {
      failed = true;
    }
  }

  if (failed) {
    console.error('\nCoverage check FAILED: One or more layers fell below required thresholds.');
    process.exit(1);
  }

  console.log('\nCoverage check PASSED: All layers meet or exceed required coverage thresholds.');
}

main();
