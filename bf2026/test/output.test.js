import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, toHtml } from '../output.js';
import { rank } from '../rank.js';

const rows = rank([
  { store: 'S', productId: 'p1', variantId: '1', variantName: 'Ek', title: 'Bord "Stor", ek', brand: 'B', url: 'https://example.test/1', image: 'https://example.test/1.jpg', price: 2000, previousPrice: 15000, currency: 'SEK', inStock: true, scrapedAt: 't' },
  { store: 'S', productId: 'p2', variantId: '2', variantName: null, title: '</script><script>alert(1)</script>', brand: null, url: 'https://example.test/2', image: null, price: 10, previousPrice: null, currency: 'SEK', inStock: false, scrapedAt: 't' },
]);

test('output: csv quotes commas and quotes, one line per row plus header', () => {
  const lines = toCsv(rows).trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^store,productId,variantId,title,variantName,brand,url,image,price,previousPrice,discountPct,savingKr,/);
  assert.match(lines[1], /^S,p1,1,"Bord ""Stor"", ek",Ek,B,https:\/\/example\.test\/1,/);
});

test('output: html report embeds the rows without letting a title close the script', () => {
  const html = toHtml(rows, { generatedAt: 't', stores: [] });
  assert.equal(html.match(/<\/script>/g).length, 2); // the data block and the page script only
  assert.match(html, /Bord \\"Stor\\", ek/);
});
