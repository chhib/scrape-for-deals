// Voyado Elevate storefront API (landing-page query), the listing backend of both
// Nordiska Galleriet and Länna Möbler. Read-only GET; notify=false keeps the run out of their statistics.

import { randomUUID } from 'node:crypto';
import { get, politeMap } from '../http.js';
import { untilComplete } from '../walk.js';

const API = 'https://wdfdc3287.api.esales.apptus.cloud/api/storefront/v3/queries/landing-page';
const PAGE_SIZE = 60; // as the sites' own pages; each hit carries its whole product group
const CAP = 10000; // the API refuses any request that reaches past product number 10 000

export function parseListingPage(json, { store, origin, scrapedAt }) {
  if (!json.primaryList) throw new Error(`${store}: listing is not published (no primaryList in the response)`);
  // Each hit is one product (a colour or material) shown with its whole product group: the siblings.
  // A product's variants (sizes) carry their own prices. One row per variant of every product in the group.
  const groups = json.primaryList.productGroups;
  const rows = groups.flatMap((group) =>
    group.products.flatMap((product) =>
      product.variants.map((variant) => ({
        store,
        productId: group.key,
        variantId: variant.key,
        title: product.title ?? product.name,
        variantName: product.name ?? null,
        brand: product.brand ?? null,
        url: origin + variant.link,
        image: product.imageInfo?.thumbnail ?? null,
        price: variant.sellingPrice,
        previousPrice: variant.listPrice ?? null,
        currency: 'SEK',
        inStock: variant.inStock ?? null,
        scrapedAt,
      })),
    ),
  );
  return { rows, totalHits: json.primaryList.totalHits, hitKeys: groups.map((g) => g.products[0]?.key) };
}

async function fetchJson(query) {
  return JSON.parse(await get(`${API}?${query}`, { accept: 'application/json' }));
}

const inTurn = async (items, fn) => {
  const results = [];
  for (const item of items) results.push(await fn(item));
  return results;
};

const SORTS = [undefined, 'PRICE_ASCENDING', 'PRICE_DESCENDING']; // undefined: the site's own order

// Walks one listing to its end. siteTotal counts hits (what the site shows as "N produkter").
// One pass reaches the first `cap` hits of its order. A listing over the cap, or one that shifted
// mid-walk, is completed by the passes in price order from both ends; past twice the cap `collected`
// stays short of `siteTotal` and the runner marks the store incomplete.
export async function walkListing({
  store, origin, market, priceId, pageReference, scrapedAt, sessionKeys, maxPages = Infinity,
  pageSize = PAGE_SIZE, cap = CAP, pause = true, fetchJson: fetchListing = fetchJson, onRows,
}) {
  const fetchPage = async ({ skip, sort }) => {
    const query = new URLSearchParams({
      market,
      customerKey: sessionKeys.customerKey,
      sessionKey: sessionKeys.sessionKey,
      locale: 'sv-SE',
      touchpoint: 'desktop',
      viewId: 'production',
      notify: 'false',
      priceId,
      pageReference,
      limit: String(Math.min(pageSize, cap - skip)),
      skip: String(skip),
    });
    if (sort) query.set('sort', sort);
    const page = parseListingPage(await fetchListing(query), { store, origin, scrapedAt });
    onRows?.(page.rows); // saved as soon as it is parsed
    return page;
  };
  const walkPass = async (sort) => {
    const first = await fetchPage({ skip: 0, sort });
    const rest = [];
    for (let skip = pageSize; skip < Math.min(first.totalHits, cap) && rest.length + 1 < maxPages; skip += pageSize) {
      rest.push({ skip, sort });
    }
    const pages = [first, ...(await (pause ? politeMap : inTurn)(rest, fetchPage))];
    return { total: first.totalHits, keys: pages.flatMap((p) => p.hitKeys), rows: pages.flatMap((p) => p.rows), pages: pages.length };
  };

  const result = await untilComplete(SORTS, walkPass, { firstPassOnly: Number.isFinite(maxPages) });
  return { listing: pageReference, counted: 'products', ...result };
}

export const newSessionKeys = () => ({ customerKey: randomUUID(), sessionKey: randomUUID() });
