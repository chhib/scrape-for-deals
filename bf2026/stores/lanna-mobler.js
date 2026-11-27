// Länna Möbler: /aktuella-erbjudanden, which the site fills from the listing "/FLAGS/All-Campaign-Products".

import { parseListingPage as parseElevatePage, walkListing, newSessionKeys } from './elevate.js';

const STORE = { store: 'Länna Möbler', origin: 'https://www.lannamobler.com', market: 'LM_LM_SE_sv', priceId: 'LM_se_best' };
// /aktuella-erbjudanden is the whole sale; Black Week 04, the 10 % extra campaign and the online outlet each
// held sale products it left out (2026-11-27), so they are walked too. Each page names its listing in its
// elevateReferenceId.
export const LISTINGS = ['/FLAGS/All-Campaign-Products', '/CAMPAIGN/Black-week-04', '/CAMPAIGN/10-extra', '/CAMPAIGN/Online-Outlet-SE'];

export const parseListingPage = (json, scrapedAt) => parseElevatePage(json, { ...STORE, scrapedAt });

export async function listProducts({ scrapedAt, onListing, onRows, maxPages }) {
  const sessionKeys = newSessionKeys();
  const rows = [];
  for (const pageReference of LISTINGS) {
    const { rows: listingRows, ...stats } = await walkListing({ ...STORE, pageReference, scrapedAt, sessionKeys, maxPages, onRows });
    onListing(stats);
    rows.push(...listingRows);
  }
  return rows;
}
