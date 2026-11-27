import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseListingPage as parseNordiskaGalleriet } from '../stores/nordiska-galleriet.js';
import { parseListingPage as parseLannaMobler } from '../stores/lanna-mobler.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const at = '2026-11-27T17:00:00.000Z';

test('nordiska galleriet: one row per variant of every listed product, siblings share productId', () => {
  const page = parseNordiskaGalleriet(fixture('nordiska-galleriet-landing-page.json'), at);

  assert.equal(page.totalHits, 3068);
  assert.deepEqual(page.hitKeys, ['10805424__P', '10750604__P', '10656491__P']);
  assert.equal(page.rows.length, 14);
  assert.deepEqual(page.rows.slice(0, 2).map((r) => [r.productId, r.variantId, r.price]), [
    ['10743224r_PG', '10805424', 4208],
    ['10743224r_PG', '10743225', 4888],
  ]);
  assert.deepEqual(page.rows[0], {
    store: 'Nordiska Galleriet',
    productId: '10743224r_PG',
    variantId: '10805424',
    title: 'Orkesterstolen',
    variantName: 'Orkesterstolen Vintage Brown',
    brand: 'NOGA',
    url: 'https://www.nordiskagalleriet.se/noga/orkesterstolen?variant=10805424',
    image: 'https://noga.cdn-norce.tech/946b3f8a-8226-45aa-a006-216f298558c3',
    price: 4208,
    previousPrice: 4950,
    currency: 'SEK',
    inStock: true,
    scrapedAt: at,
  });
});

test('länna möbler: one row per variant, with the listing total', () => {
  const page = parseLannaMobler(fixture('lanna-mobler-landing-page.json'), at);

  assert.equal(page.totalHits, 8460);
  assert.equal(page.rows.length, 5);
  assert.deepEqual(page.rows[0], {
    store: 'Länna Möbler',
    productId: '10592910r_PG',
    variantId: '10706041',
    title: 'DUX Inspiration sängben kubiska 12 cm 2-pack',
    variantName: 'DUX Kubiska 12 cm Ek / 2-pack',
    brand: 'DUX',
    url: 'https://www.lannamobler.com/dux/dux-inspiration-sangben-kubiska-12-cm-2-pack?variant=10706041',
    image: 'https://noga.cdn-norce.tech/99213b8a-318d-4024-9e5b-da629e53d9fb',
    price: 425,
    previousPrice: 2125,
    currency: 'SEK',
    inStock: true,
    scrapedAt: at,
  });
});

test('elevate stores: an unpublished listing is an error, not an empty page', () => {
  assert.throws(() => parseLannaMobler({ published: false, recommendationLists: [] }, at), /not published/);
});

test('nordiska galleriet: walks the brand listings of the campaign pages /black-month-40 leaves out', async () => {
  // reports/r3.md: on 2026-11-27 the campaign pages for DCWéditions, DUX and Ligne Roset held products
  // missing from the walked listings; their campaign listing itself cannot be read with a GET.
  const { LISTINGS } = await import('../stores/nordiska-galleriet.js');
  for (const brand of ['/BRANDS/dcweditions', '/BRANDS/dux', '/BRANDS/ligne-roset']) assert.ok(LISTINGS.includes(brand), brand);
});

test('länna möbler: walks the campaign listings that hold products /FLAGS/All-Campaign-Products leaves out', async () => {
  // reports/r3.md: on 2026-11-27 these three held sale products missing from the walked listing
  const { LISTINGS } = await import('../stores/lanna-mobler.js');
  for (const ref of ['/CAMPAIGN/Black-week-04', '/CAMPAIGN/10-extra', '/CAMPAIGN/Online-Outlet-SE']) assert.ok(LISTINGS.includes(ref), ref);
});
