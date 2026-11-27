// The run's checkpoint: every variant row is saved as soon as its page is parsed, so a stopped run loses
// nothing, a rerun skips the product pages it already read, and `export` can rank what is there at any time.
// Normalized columns only (no page HTML or JSON), so data/bf.db stays small enough to commit.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_DB = fileURLToPath(new URL('../data/bf.db', import.meta.url));
export const DEFAULT_MAX_AGE_HOURS = 12;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL            -- url and image paths that start with it are saved without it
);
CREATE TABLE IF NOT EXISTS variants (
  storeId INTEGER NOT NULL REFERENCES stores(id),
  variantId TEXT NOT NULL,
  productId TEXT NOT NULL,
  title TEXT,
  variantName TEXT,
  brand TEXT,
  url TEXT,
  image TEXT,
  price REAL,
  previousPrice REAL,
  currency TEXT,
  inStock INTEGER,
  source TEXT NOT NULL CHECK (source IN ('listing', 'product')),  -- a product page row is never replaced by a listing row
  scrapedAt TEXT NOT NULL,       -- an older row never replaces a newer one (an import of an earlier run)
  PRIMARY KEY (storeId, variantId)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS variants_product ON variants (storeId, productId);
CREATE TABLE IF NOT EXISTS product_pages (
  storeId INTEGER NOT NULL REFERENCES stores(id),
  productId TEXT NOT NULL,
  fetchedAt TEXT NOT NULL,
  variants INTEGER NOT NULL,
  PRIMARY KEY (storeId, productId)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS listings (
  storeId INTEGER NOT NULL REFERENCES stores(id),
  listing TEXT NOT NULL,
  counted TEXT,
  siteTotal INTEGER,
  collected INTEGER,
  pagesWalked INTEGER,
  variantsNotInListing INTEGER,
  resumed INTEGER,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (storeId, listing)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS deals (
  section TEXT NOT NULL CHECK (section IN ('inverted', 'deep')),
  rank INTEGER NOT NULL,
  store TEXT NOT NULL,
  variantId TEXT NOT NULL,
  productId TEXT,
  title TEXT,
  brand TEXT,
  variantName TEXT,
  price REAL,
  previousPrice REAL,
  discountPct REAL,
  savingKr REAL,
  url TEXT,
  image TEXT,
  invertedGapKr REAL,
  undercutsVariantName TEXT,
  undercutsPrice REAL,
  undercutsPreviousPrice REAL,
  more INTEGER,                   -- other rows with the same title that were left out
  exportedAt TEXT NOT NULL,
  PRIMARY KEY (section, rank)
) WITHOUT ROWID;
`;

const VARIANT_COLUMNS = [
  'storeId', 'variantId', 'productId', 'title', 'variantName', 'brand', 'url', 'image',
  'price', 'previousPrice', 'currency', 'inStock', 'source', 'scrapedAt',
];
export const DEAL_COLUMNS = [
  'section', 'rank', 'store', 'variantId', 'productId', 'title', 'brand', 'variantName', 'price', 'previousPrice',
  'discountPct', 'savingKr', 'url', 'image', 'invertedGapKr', 'undercutsVariantName', 'undercutsPrice',
  'undercutsPreviousPrice', 'more', 'exportedAt',
];

const placeholders = (n) => Array(n).fill('?').join(', ');
const shorten = (value, origin) => (typeof value === 'string' && value.startsWith(origin + '/') ? value.slice(origin.length) : value ?? null);
const lengthen = (value, origin) => (typeof value === 'string' && value.startsWith('/') ? origin + value : value);
const bool = (v) => (v === null || v === undefined ? null : v ? 1 : 0);

export function openDb(path = DEFAULT_DB) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 30000; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);

  const storeCache = new Map();
  const storeOf = (name, sampleUrl) => {
    let store = storeCache.get(name) ?? db.prepare('SELECT id, name, origin FROM stores WHERE name = ?').get(name);
    if (store && !store.origin && sampleUrl) {
      // first seen without a URL (a listing's totals); rows saved so far kept their full URLs
      store = { ...store, origin: new URL(sampleUrl).origin };
      db.prepare('UPDATE stores SET origin = ? WHERE id = ?').run(store.origin, store.id);
    } else if (!store) {
      const origin = sampleUrl ? new URL(sampleUrl).origin : '';
      const { lastInsertRowid } = db.prepare('INSERT INTO stores (name, origin) VALUES (?, ?)').run(name, origin);
      store = { id: Number(lastInsertRowid), name, origin };
    }
    storeCache.set(name, store);
    return store;
  };

  const upsert = (source) =>
    db.prepare(
      `INSERT INTO variants (${VARIANT_COLUMNS.join(', ')}) VALUES (${placeholders(VARIANT_COLUMNS.length)})
       ON CONFLICT (storeId, variantId) DO UPDATE SET
         ${VARIANT_COLUMNS.slice(2).map((c) => `${c} = excluded.${c}`).join(', ')}
       WHERE ${source === 'listing'
         ? "variants.source = 'listing' AND excluded.scrapedAt >= variants.scrapedAt"
         : "variants.source = 'listing' OR excluded.scrapedAt >= variants.scrapedAt"}`,
    );
  const upsertListing = upsert('listing');
  const upsertProduct = upsert('product');

  const inTransaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  const writeRows = (statement, rows, source) => {
    for (const r of rows) {
      const store = storeOf(r.store, r.url);
      statement.run(
        store.id, String(r.variantId), String(r.productId), r.title ?? null, r.variantName ?? null, r.brand ?? null,
        shorten(r.url, store.origin), shorten(r.image, store.origin), r.price ?? null, r.previousPrice ?? null,
        r.currency ?? null, bool(r.inStock), source, r.scrapedAt,
      );
    }
  };

  const toRow = (v, store) => ({
    store: store.name,
    productId: v.productId,
    variantId: v.variantId,
    title: v.title,
    variantName: v.variantName,
    brand: v.brand,
    url: lengthen(v.url, store.origin),
    image: lengthen(v.image, store.origin),
    price: v.price,
    previousPrice: v.previousPrice,
    currency: v.currency,
    inStock: v.inStock === null ? null : v.inStock === 1,
    scrapedAt: v.scrapedAt,
  });

  return {
    raw: db,

    // Rows of one parsed listing page. A variant a product page already gave is left as that page gave it.
    saveListingRows(rows) {
      if (rows.length) inTransaction(() => writeRows(upsertListing, rows, 'listing'));
    },

    // Every variant of one product page, and the page itself as read at `fetchedAt`.
    saveProductPage(storeName, productId, rows, fetchedAt = new Date().toISOString()) {
      inTransaction(() => {
        writeRows(upsertProduct, rows, 'product');
        const store = storeOf(storeName, rows[0]?.url);
        db.prepare(
          `INSERT INTO product_pages (storeId, productId, fetchedAt, variants) VALUES (?, ?, ?, ?)
           ON CONFLICT (storeId, productId) DO UPDATE SET fetchedAt = excluded.fetchedAt, variants = excluded.variants
           WHERE excluded.fetchedAt >= product_pages.fetchedAt`,
        ).run(store.id, String(productId), fetchedAt, rows.length);
      });
    },

    // The variants of a product whose page was read within maxAgeMs of `now`; null when it must be read again.
    freshProductRows(storeName, productId, maxAgeMs, now = Date.now()) {
      const store = db.prepare('SELECT id, name, origin FROM stores WHERE name = ?').get(storeName);
      if (!store) return null;
      const page = db.prepare('SELECT fetchedAt FROM product_pages WHERE storeId = ? AND productId = ?').get(store.id, String(productId));
      if (!page || now - Date.parse(page.fetchedAt) > maxAgeMs) return null;
      return db
        .prepare("SELECT * FROM variants WHERE storeId = ? AND productId = ? AND source = 'product' ORDER BY variantId")
        .all(store.id, String(productId))
        .map((v) => toRow(v, store));
    },

    saveListing(storeName, stats, updatedAt = new Date().toISOString()) {
      const store = storeOf(storeName);
      db.prepare(
        `INSERT INTO listings (storeId, listing, counted, siteTotal, collected, pagesWalked, variantsNotInListing, resumed, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (storeId, listing) DO UPDATE SET counted = excluded.counted, siteTotal = excluded.siteTotal,
           collected = excluded.collected, pagesWalked = excluded.pagesWalked,
           variantsNotInListing = excluded.variantsNotInListing, resumed = excluded.resumed, updatedAt = excluded.updatedAt
         WHERE excluded.updatedAt >= listings.updatedAt`,
      ).run(
        store.id, stats.listing, stats.counted ?? null, stats.siteTotal ?? null, stats.collected ?? null,
        stats.pagesWalked ?? null, stats.variantsNotInListing ?? null, stats.resumed ?? null, updatedAt,
      );
    },

    storeNames() {
      return db.prepare('SELECT name FROM stores ORDER BY id').all().map((s) => s.name);
    },

    // Every saved variant of the stores named (all when none): product page rows where a page was read,
    // listing rows for the rest.
    rows(storeNames = this.storeNames()) {
      return storeNames.flatMap((name) => {
        const store = db.prepare('SELECT id, name, origin FROM stores WHERE name = ?').get(name);
        if (!store) return [];
        return db.prepare('SELECT * FROM variants WHERE storeId = ? ORDER BY productId, variantId').all(store.id).map((v) => toRow(v, store));
      });
    },

    // Per store: what was listed and how much of it has its product page read.
    summary(storeName) {
      const store = db.prepare('SELECT id, name FROM stores WHERE name = ?').get(storeName);
      if (!store) return null;
      const one = (sql) => Object.values(db.prepare(sql).get(store.id))[0];
      return {
        store: store.name,
        variants: one('SELECT count(*) FROM variants WHERE storeId = ?'),
        variantsFromListing: one("SELECT count(*) FROM variants WHERE storeId = ? AND source = 'listing'"),
        variantsFromProductPages: one("SELECT count(*) FROM variants WHERE storeId = ? AND source = 'product'"),
        // a bundle (productId = variantId) has no product page of its own
        productsListed: one('SELECT count(DISTINCT productId) FROM variants WHERE storeId = ? AND productId <> variantId'),
        productsWithVariantsFetched: one('SELECT count(*) FROM product_pages WHERE storeId = ?'),
        oldestScrapedAt: one('SELECT min(scrapedAt) FROM variants WHERE storeId = ?'),
        newestScrapedAt: one('SELECT max(scrapedAt) FROM variants WHERE storeId = ?'),
        listings: db
          .prepare('SELECT listing, counted, siteTotal, collected, pagesWalked, variantsNotInListing, resumed, updatedAt FROM listings WHERE storeId = ? ORDER BY updatedAt')
          .all(store.id)
          .map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== null))),
      };
    },

    saveDeals(deals) {
      inTransaction(() => {
        db.exec('DELETE FROM deals');
        const insert = db.prepare(`INSERT INTO deals (${DEAL_COLUMNS.join(', ')}) VALUES (${placeholders(DEAL_COLUMNS.length)})`);
        for (const d of deals) insert.run(...DEAL_COLUMNS.map((c) => d[c] ?? null));
      });
    },

    deals() {
      return db.prepare("SELECT * FROM deals ORDER BY section = 'deep', rank").all();
    },

    // Folds the write-ahead log into the file and rewrites it without free pages: run before a commit.
    compact() {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
    },

    close() {
      db.close();
    },
  };
}
