// The storefront Svenssons and Nordic Nest share: server-rendered pages carrying window.INITIAL_DATA.
// A listing is walked in parts given by filters that together are the whole listing (Svenssons: instock
// true and false). Each part is walked in price order from both ends, as the site serves at most PAGE_CAP
// pages of one order; further orders fill what a page boundary between equal prices dropped. Every
// listed product's own page gives the variants the listing leaves out.

import { get, politeMap } from '../http.js';
import { untilComplete } from '../walk.js';

const INSTOCK_PARTS = [{ instock: 'true' }, { instock: 'false' }];
const SORTS = ['price', 'priceDesc', 'discount', 'new']; // the last two only fill what shifted mid-walk
const PAGE_CAP = 277; // 36 per page; the site answers any later page with page 277
const MARKER = "window.INITIAL_DATA = JSON.parse('";
const SIMPLE_ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
const IN_STOCK = new Set(['inStock', 'lowStock']);

function readJsStringLiteral(source, start, store) {
  let out = '';
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === "'") {
      const next = /^\s*\+\s*'/.exec(source.slice(i + 1, i + 20)); // 'a' + 'b' continues the string
      if (!next) return out;
      i += next[0].length;
      continue;
    }
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = source[++i];
    if (e === 'u') {
      out += String.fromCharCode(parseInt(source.slice(i + 1, i + 5), 16));
      i += 4;
    } else if (e === 'x') {
      out += String.fromCharCode(parseInt(source.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out += SIMPLE_ESCAPES[e] ?? e;
    }
  }
  throw new Error(`${store}: unterminated INITIAL_DATA string`);
}

function initialPage(html, store) {
  const at = html.indexOf(MARKER);
  if (at === -1) throw new Error(`${store}: no INITIAL_DATA in the page (blocked, or the site changed)`);
  return JSON.parse(readJsStringLiteral(html, at + MARKER.length, store)).page;
}

// store: the name in every row; origin: https://host; listingPath: the sale listing, e.g. /black-friday/;
// parts: filters whose listings together are the whole listing, each best under the cap.
// fetchText: the GET client (a stand-in in tests).
export function createStore({ store, origin, listingPath, parts = INSTOCK_PARTS, fetchText = get }) {
  function parseListingPage(html, scrapedAt) {
    const page = initialPage(html, store);
    const rows = page.products.map((p) => ({
      store,
      productId: p.productId ?? p.sku, // a bundle has no productId
      variantId: p.sku,
      title: p.productName ?? p.displayName,
      variantName: p.variantName ?? null,
      brand: p.brand ?? null,
      url: origin + p.url,
      image: p.images?.[0] ? origin + p.images[0].url : null,
      price: p.price.current.inclVat,
      previousPrice: p.price.regular?.inclVat ?? null,
      currency: 'SEK',
      inStock: IN_STOCK.has(p.stockStatus),
      scrapedAt,
    }));
    return { rows, pagination: page.pagination };
  }

  function parseProductPage(html, scrapedAt) {
    const page = initialPage(html, store);
    return (page.variants ?? []).map((v) => ({
      store,
      productId: page.productId,
      variantId: v.articleNumber,
      title: page.productName ?? page.displayName,
      variantName: v.name ?? null,
      brand: page.brand ?? null,
      url: origin + v.url,
      image: v.image?.url ? origin + v.image.url : null,
      price: v.price.inclVat,
      previousPrice: v.regularPrice?.inclVat ?? null,
      currency: 'SEK',
      inStock: IN_STOCK.has(v.stockStatus),
      scrapedAt,
    }));
  }

  // resumeProduct(productId) gives the saved variants of a product page read recently, or null to read it;
  // onProduct(productId, rows) is called as soon as a page is read.
  async function fetchVariants(listedRows, scrapedAt, maxProducts, { resumeProduct, onProduct }) {
    const firstRowOfProduct = new Map();
    for (const row of listedRows) {
      const isBundle = row.productId === row.variantId;
      if (!isBundle && !firstRowOfProduct.has(row.productId)) firstRowOfProduct.set(row.productId, row);
    }
    const products = [...firstRowOfProduct.values()].slice(0, maxProducts);
    const listed = new Set(listedRows.map((r) => r.variantId));
    const resumed = [];
    const toRead = [];
    for (const row of products) {
      const saved = resumeProduct?.(row.productId);
      if (saved) resumed.push(saved);
      else toRead.push(row);
    }
    if (resumed.length) console.log(`  ${store}: ${resumed.length} product pages read recently are taken from the db, ${toRead.length} to read`);
    let failed = 0;
    const pages = await politeMap(toRead, async (row) => {
      try {
        const variants = parseProductPage(await fetchText(row.url, { accept: 'text/html' }), scrapedAt)
          .filter((v) => v.productId === row.productId);
        onProduct?.(row.productId, variants);
        return variants;
      } catch (err) {
        failed++;
        console.error(`  ${store}: product page skipped, ${err.message}`);
        return [];
      }
    });
    const rows = [...resumed, ...pages].flat();
    return {
      stats: {
        listing: 'product pages (all variants of each listed product)',
        siteTotal: firstRowOfProduct.size,
        pagesWalked: toRead.length,
        collected: products.length - failed,
        resumed: resumed.length,
        counted: 'products',
        variantsNotInListing: new Set(rows.filter((r) => !listed.has(r.variantId)).map((r) => r.variantId)).size,
      },
      rows,
    };
  }

  async function fetchPage(params, scrapedAt, onRows) {
    const html = await fetchText(`${origin}${listingPath}?${new URLSearchParams(params)}`, { accept: 'text/html' });
    const page = parseListingPage(html, scrapedAt);
    onRows?.(page.rows);
    return page;
  }

  async function walkPart(filter, scrapedAt, maxPages, onRows) {
    const label = `${listingPath}?${new URLSearchParams(filter)}`;
    const walkPass = async (sortBy) => {
      const params = (page) => ({ ...filter, sortBy, page: String(page) });
      const first = await fetchPage(params(1), scrapedAt, onRows);
      const { total, pageCount } = first.pagination;
      const pageNumbers = Array.from({ length: Math.min(pageCount, PAGE_CAP, maxPages) - 1 }, (_, i) => i + 2);
      const rest = await politeMap(pageNumbers, async (n) => {
        const page = await fetchPage(params(n), scrapedAt, onRows);
        if (page.pagination.currentPage !== n) {
          throw new Error(`${store}: asked for page ${n} of ${label}, got page ${page.pagination.currentPage}`);
        }
        return page;
      });
      const rows = [first, ...rest].flatMap((p) => p.rows);
      return { total, keys: rows.map((r) => r.variantId), rows, pages: 1 + rest.length };
    };
    const { rows, ...stats } = await untilComplete(SORTS, walkPass, { firstPassOnly: Number.isFinite(maxPages) });
    return { stats: { listing: label, counted: 'products', ...stats }, rows };
  }

  // onRows(rows): each listing page's rows as soon as it is parsed; resumeProduct, onProduct: see fetchVariants.
  async function listProducts({ scrapedAt, onListing, onRows, resumeProduct, onProduct, maxPages = Infinity, maxProducts = Infinity }) {
    const rows = [];
    for (const filter of parts) {
      const part = await walkPart(filter, scrapedAt, maxPages, onRows);
      onListing(part.stats);
      rows.push(...part.rows);
    }
    const whole = await fetchPage({ page: '1' }, scrapedAt);
    onListing({
      listing: `${listingPath} (whole listing, all parts)`,
      siteTotal: whole.pagination.total,
      pagesWalked: 1,
      collected: new Set(rows.map((r) => r.variantId)).size,
      counted: 'products',
    });
    const variants = await fetchVariants(rows, scrapedAt, maxProducts, { resumeProduct, onProduct });
    onListing(variants.stats);
    return [...rows, ...variants.rows]; // the runner keeps the first row of each variantId
  }

  return { parseListingPage, parseProductPage, listProducts, parts };
}
