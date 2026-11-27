#!/usr/bin/env node
// Rank the saved rows of earlier runs again with the current rank.js, without walking the stores.
//   node bf2026/rerank.js out/<YYYY-MM-DD> [out/<other run> ...]
// Rewrites products.csv, products.json, report.html and run.json in the first folder. Rows and run
// summaries of the other folders (say, a run of one store added later) are merged into it; a store that
// a later folder holds replaces that store's rows and summary from the earlier ones.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rank } from './rank.js';
import { writeOutputs } from './output.js';

const readJson = (dir, file) => JSON.parse(readFileSync(join(dir, file), 'utf8'));

export function rerank([dir, ...others], rerankedAt = new Date().toISOString()) {
  const runs = [dir, ...others].map((d) => readJson(d, 'run.json'));
  const rowsByStore = new Map();
  const summaries = new Map();
  [dir, ...others].forEach((d, i) => {
    const byStore = new Map();
    for (const row of readJson(d, 'products.json')) {
      if (!byStore.has(row.store)) byStore.set(row.store, []);
      byStore.get(row.store).push(row);
    }
    for (const [store, rows] of byStore) rowsByStore.set(store, rows);
    for (const summary of runs[i].stores) summaries.set(summary.store, { ...summary, generatedAt: runs[i].generatedAt });
  });
  const rows = [...rowsByStore.values()].flat();
  const run = {
    ...runs[0],
    stores: [...summaries.values()],
    failed: runs.flatMap((r) => r.failed ?? []),
    ...(others.length ? { mergedFrom: others.map((d, i) => ({ dir: d, generatedAt: runs[i + 1].generatedAt })) } : {}),
    rerankedAt,
  };
  const ranked = rank(rows);
  return { rows: ranked, files: writeOutputs(dir, ranked, run) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) {
    console.error('Usage: node bf2026/rerank.js out/<YYYY-MM-DD> [out/<other run> ...]');
    process.exitCode = 1;
  } else {
    const { rows, files } = rerank(dirs);
    console.log(`${rows.length} rows, ${rows.filter((r) => r.flagInverted).length} inverted, ${rows.filter((r) => r.flagCount).length} flagged`);
    console.log(`Report: ${files.html}`);
  }
}
