// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Lalit Krishna and contributors

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MAX_GZIP_BYTES = 500 * 1024; // 500 KiB

function getManifestPath(distDir) {
  const p1 = path.join(distDir, '.vite', 'manifest.json');
  if (fs.existsSync(p1)) return p1;
  const p2 = path.join(distDir, 'manifest.json');
  if (fs.existsSync(p2)) return p2;
  return null;
}

function main() {
  const distDir = path.resolve(process.cwd(), 'dist');
  if (!fs.existsSync(distDir)) {
    console.error('Error: dist directory does not exist. Run "npm run build" first.');
    process.exit(1);
  }

  const manifestPath = getManifestPath(distDir);
  if (!manifestPath) {
    console.error('Error: Vite manifest.json not found in dist/.vite/ or dist/. Ensure build.manifest is enabled.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // Find entry chunk
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

  // Traverse imports recursively
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
      console.warn(`Warning: file not found: ${fullPath}`);
      continue;
    }

    const content = fs.readFileSync(fullPath);
    const gzipped = zlib.gzipSync(content);
    totalGzipBytes += gzipped.length;

    console.log(`  ${relativePath}: ${(gzipped.length / 1024).toFixed(2)} KiB (gzip)`);
  }

  const totalKiB = (totalGzipBytes / 1024).toFixed(2);
  const maxKiB = (MAX_GZIP_BYTES / 1024).toFixed(2);
  console.log(`\nTotal Entry JS Gzip Size: ${totalKiB} KiB / Limit: ${maxKiB} KiB`);

  if (totalGzipBytes > MAX_GZIP_BYTES) {
    console.error(`FAIL: Bundle size exceeds budget of ${maxKiB} KiB!`);
    process.exit(1);
  }

  console.log('PASS: Bundle size within budget.');
}

main();
