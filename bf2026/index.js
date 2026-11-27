#!/usr/bin/env node
// Black Friday 2026: walk the sale listings of the stores, rank likely mispricings first.
//   node bf2026/index.js [store ...] [--max-pages N] [--max-products N] [--db PATH] [--max-age-hours N]
//   node bf2026/index.js export [store ...] [--db PATH]   rank what the db holds now into out/<YYYY-MM-DD>-db/
//   node bf2026/index.js import out/<run> [...] [--db PATH]   put a run saved before the db into it
//   node bf2026/index.js compact [--db PATH]               fold the log into the file and VACUUM, before a commit
// A sample run, to check the parsers before a full run:
//   --max-pages N     walk at most N pages per listing
//   --max-products N  fetch at most N product pages per store (Svenssons reads variants from product pages)
// Every row is saved to the db (default data/bf.db) as its page is parsed. A rerun takes product pages read
// within --max-age-hours (default 12) from the db instead of reading them again.

import { join } from 'node:path';
import { openDb, DEFAULT_DB, DEFAULT_MAX_AGE_HOURS } from './db.js';
import { exportDb, importRun, STORE_NAMES } from './export.js';
import { rank } from './rank.js';
import { writeOutputs } from './output.js';
import { fieldCheck, storeStatus } from './check.js';
import * as svenssons from './stores/svenssons.js';
import * as nordiskaGalleriet from './stores/nordiska-galleriet.js';
import * as lannaMobler from './stores/lanna-mobler.js';
import * as nordicNest from './stores/nordic-nest.js';

const STORES = { svenssons, 'nordiska-galleriet': nordiskaGalleriet, 'lanna-mobler': lannaMobler, 'nordic-nest': nordicNest };

const COMMANDS = ['export', 'import', 'compact'];

function parseArgs(argv) {
  const names = [];
  const dirs = [];
  const command = COMMANDS.includes(argv[0]) ? argv.shift() : 'run';
  let db = DEFAULT_DB;
  let maxAgeHours = DEFAULT_MAX_AGE_HOURS;
  const limits = { '--max-pages': Infinity, '--max-products': Infinity };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') {
      db = argv[++i];
    } else if (argv[i] === '--max-age-hours') {
      maxAgeHours = Number(argv[++i]);
      if (!(maxAgeHours >= 0)) throw new Error('--max-age-hours needs a number of at least 0');
    } else if (command === 'import') {
      dirs.push(argv[i]);
    } else if (argv[i] in limits) {
      const n = Number(argv[i + 1]);
      if (!Number.isInteger(n) || n < 1) throw new Error(`${argv[i]} needs a whole number of at least 1`);
      limits[argv[i++]] = n;
    } else if (STORES[argv[i]]) {
      names.push(argv[i]);
    } else {
      throw new Error(`Unknown argument "${argv[i]}". Stores: ${Object.keys(STORES).join(', ')}`);
    }
  }
  return {
    command, db, dirs, maxAgeHours, given: names,
    names: names.length ? names : Object.keys(STORES), maxPages: limits['--max-pages'], maxProducts: limits['--max-products'],
  };
}

// The same variant comes back many times: once per listed sibling, and again from overlapping listings.
function uniqueVariants(rows) {
  const seen = new Map();
  for (const row of rows) if (!seen.has(row.variantId)) seen.set(row.variantId, row);
  return [...seen.values()];
}

async function runStore(name, { scrapedAt, maxPages, maxProducts, sample, db, maxAgeHours }) {
  const listings = [];
  const started = Date.now();
  const storeName = STORE_NAMES[name];
  const onListing = (stats) => {
    listings.push(stats);
    if (!sample) db.saveListing(storeName, stats); // a sample's totals would hide the last full walk's
    console.log(`  ${name} ${stats.listing}: site total ${stats.siteTotal} ${stats.counted}, collected ${stats.collected}, pages walked ${stats.pagesWalked}${'variantsNotInListing' in stats ? `, variants not in the listing ${stats.variantsNotInListing}` : ''}`);
  };
  const rows = uniqueVariants(await STORES[name].listProducts({
    scrapedAt, onListing, maxPages, maxProducts,
    onRows: (pageRows) => db.saveListingRows(pageRows),
    onProduct: (productId, variants) => db.saveProductPage(storeName, productId, variants),
    resumeProduct: (productId) => db.freshProductRows(storeName, productId, maxAgeHours * 3600_000),
  }));
  const check = fieldCheck(rows);
  const { status, problems } = storeStatus(rows, listings, { sample });
  console.log(`  ${name}: ${status.toUpperCase()} ${JSON.stringify(check)} in ${Math.round((Date.now() - started) / 1000)} s`);
  for (const problem of problems) console.error(`  ${name}: ${status.toUpperCase()}, ${problem}`);
  if (status === 'failed') throw new Error(`${name}: ${problems.join('; ')}`);
  return { rows, summary: { store: name, status, problems, ...check, listings } };
}

const today = () => new Date().toLocaleDateString('sv-SE'); // local YYYY-MM-DD

function dbCommand({ command, db: path, dirs, given }) {
  const db = openDb(path);
  try {
    if (command === 'compact') {
      db.compact();
      console.log(`Compacted ${path}`);
    } else if (command === 'import') {
      if (!dirs.length) throw new Error('Usage: node bf2026/index.js import out/<run> [...]');
      for (const dir of dirs) console.log(`${dir}: ${JSON.stringify(importRun(db, dir))}`);
    } else {
      const dir = join('out', [today(), 'db', given.length ? given.join('+') : null].filter(Boolean).join('-'));
      const { rows, run, deals, files } = exportDb(db, dir, { stores: given });
      for (const s of run.stores) {
        const read = s.variantsFrom === 'product pages' ? `product pages read ${s.productsWithVariantsFetched} of ${s.productsListed} listed products` : 'every variant from the listing';
        console.log(`  ${s.store}: ${s.variants} variants, ${read}, newest row ${s.newestScrapedAt}`);
      }
      console.log(`${rows.length} rows, ${rows.filter((r) => r.flagInverted).length} inverted, ${rows.filter((r) => r.flagCount).length} flagged, ${deals.length} deals`);
      console.log(`Report: ${files.html}`);
      console.log(`Deals: ${files.deals}`);
    }
  } finally {
    db.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command !== 'run') return dbCommand(args);
  const { names, maxPages, maxProducts, maxAgeHours } = args;
  const db = openDb(args.db);
  const scrapedAt = new Date().toISOString();
  const sample = Number.isFinite(maxPages) || Number.isFinite(maxProducts);
  console.log(`${sample ? `Sample run (at most ${maxPages} pages per listing, ${maxProducts} product pages per store)` : 'Full run'}: ${names.join(', ')}`);

  // Stores run side by side; the concurrency cap is per store.
  const results = await Promise.allSettled(names.map((name) => runStore(name, { scrapedAt, maxPages, maxProducts, sample, db, maxAgeHours })));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [{ store: names[i], error: r.reason.message }] : []));
  for (const f of failed) console.error(`FAILED ${f.store}: ${f.error}`);

  const rows = rank(ok.flatMap((r) => r.rows));
  const run = { generatedAt: scrapedAt, sample, maxPages: Number.isFinite(maxPages) ? maxPages : null, maxProducts: Number.isFinite(maxProducts) ? maxProducts : null, stores: ok.map((r) => r.summary), failed };
  const day = today();
  // A run of some stores only gets its own folder, so it never overwrites a run of all of them.
  const some = names.length < Object.keys(STORES).length ? names.join('+') : null;
  const files = writeOutputs(join('out', [day, some, sample && 'sample'].filter(Boolean).join('-')), rows, run);

  const incomplete = ok.filter((r) => r.summary.status === 'incomplete').map((r) => r.summary.store);
  if (incomplete.length) console.error(`INCOMPLETE: ${incomplete.join(', ')} (collected differs from the site total; see run.json)`);
  console.log(`${rows.length} rows, ${rows.filter((r) => r.flagInverted).length} inverted, ${rows.filter((r) => r.flagCount).length} flagged`);
  console.log(`Report: ${files.html}`);
  console.log(`Saved to ${args.db}; \`node bf2026/index.js export\` ranks everything it holds`);
  db.close();
  if (failed.length || incomplete.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
