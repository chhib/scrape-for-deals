// Nordiska Galleriet: the Black Friday listings linked from /black-week and /kampanjer.
// /black-month-40 is the big one; super deals and the online archive are separate listings. The brand
// campaign pages (/black-month-<brand>) filter by a rule the API takes only in a POST, so the brands
// whose campaign products were missing from these listings are walked through their brand listing.

import { parseListingPage as parseElevatePage, walkListing, newSessionKeys } from './elevate.js';

const STORE = { store: 'Nordiska Galleriet', origin: 'https://www.nordiskagalleriet.se', market: 'NG_NG_SE_sv', priceId: 'NG_se_best' };
export const LISTINGS = [
  '/CAMPAIGNS/black-month-40', '/CAMPAIGNS/black-month-super-deals', '/online-archive-all',
  '/BRANDS/dcweditions', '/BRANDS/dux', '/BRANDS/ligne-roset',
];

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
