// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MAX_GZIP_BYTES = 300 * 1024; // 300 KiB initial JavaScript graph
const MAX_JSON_BYTES = 10 * 1024;

function getManifestPath(distDir) {
  const candidates = [
    path.join(distDir, '.vite', 'manifest.json'),
    path.join(distDir, 'manifest.json'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function collectJsonFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsonFiles(fullPath, found);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      found.push(fullPath);
    }
  }
  return found;
}

function main() {
  const distDir = path.resolve(process.cwd(), 'packages/web/dist');
  if (!fs.existsSync(distDir)) {
    console.error('Error: packages/web/dist does not exist. Run "pnpm build" first.');
    process.exit(1);
  }

  const manifestPath = getManifestPath(distDir);
  if (!manifestPath) {
    console.error('Error: Vite manifest.json not found. Ensure build.manifest is enabled.');
    process.exit(1);
  }

  const oversizedJson = collectJsonFiles(distDir)
    .filter((file) => !file.endsWith('manifest.json'))
    .map((file) => ({ file, size: fs.statSync(file).size }))
    .filter((entry) => entry.size > MAX_JSON_BYTES);

  if (oversizedJson.length > 0) {
    for (const entry of oversizedJson) {
      console.error(
        `Error: ${path.relative(process.cwd(), entry.file)} is ${(entry.size / 1024).toFixed(2)} KiB and must not be bundled.`
      );
    }
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  let entryChunk = null;
  for (const item of Object.values(manifest)) {
    if (item.isEntry) {
      entryChunk = item;
      break;
    }
  }

  if (!entryChunk) {
    console.error('Error: Entry chunk with isEntry: true not found in manifest.');
    process.exit(1);
  }

  const jsFilesToMeasure = new Set();

  function collectImports(chunk) {
    if (!chunk || !chunk.file) return;
    if (chunk.file.endsWith('.js')) {
      jsFilesToMeasure.add(chunk.file);
    }
    if (Array.isArray(chunk.imports)) {
      for (const importedKey of chunk.imports) {
        const importedChunk = manifest[importedKey];
        if (importedChunk && !jsFilesToMeasure.has(importedChunk.file)) {
          collectImports(importedChunk);
        }
      }
    }
  }

  collectImports(entryChunk);

  let totalGzipBytes = 0;
  console.log('--- Initial JavaScript Entry Graph ---');

  for (const relativePath of jsFilesToMeasure) {
    const fullPath = path.join(distDir, relativePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`Error: file not found: ${fullPath}`);
      process.exit(1);
    }
    const gzipped = zlib.gzipSync(fs.readFileSync(fullPath));
    totalGzipBytes += gzipped.length;
    console.log(`  ${relativePath}: ${(gzipped.length / 1024).toFixed(2)} KiB (gzip)`);
  }

  const totalKiB = (totalGzipBytes / 1024).toFixed(2);
  const maxKiB = (MAX_GZIP_BYTES / 1024).toFixed(2);
  console.log(`\nTotal Entry JS Gzip Size: ${totalKiB} KiB / Limit: ${maxKiB} KiB`);

  if (totalGzipBytes > MAX_GZIP_BYTES) {
    console.error(`FAIL: Bundle size exceeds budget of ${maxKiB} KiB.`);
    process.exit(1);
  }

  console.log('PASS: Bundle size within budget.');
}

main();
