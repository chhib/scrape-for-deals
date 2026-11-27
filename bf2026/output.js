// Writes products.csv, products.json and report.html for one run.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COLUMNS = [
  'store', 'productId', 'variantId', 'title', 'variantName', 'brand', 'url', 'image', 'price', 'previousPrice',
  'discountPct', 'savingKr', 'currency', 'inStock', 'siblingCount', 'siblingMedianPrice',
  'flagInverted', 'flagInvertedDearer', 'invertedGapKr', 'undercutsVariantId', 'undercutsVariantName', 'undercutsPrice', 'undercutsPreviousPrice',
  'flagCount', 'flagUnder25Pct', 'flagSavingOver5000', 'flagTypo', 'flagCheapVsSiblings', 'flagDiscountVsSiblings', 'scrapedAt',
];

const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function toCsv(rows) {
  return [COLUMNS.join(','), ...rows.map((row) => COLUMNS.map((c) => csvCell(row[c])).join(','))].join('\n') + '\n';
}

// report.html holds the top of the ranking; a page with every variant would be too heavy to open.
const REPORT_MAX_ROWS = 20000;

// JSON that is safe inside a <script> block: no "<" survives, so no title can close the tag.
const scriptJson = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');

export function toHtml(rankedRows, run) {
  const rows = rankedRows.slice(0, REPORT_MAX_ROWS);
  run = { ...run, totalRows: rankedRows.length };
  return `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Black Friday 2026 – fynd</title>
<style>
  body { font: 14px/1.4 -apple-system, system-ui, sans-serif; margin: 16px; color: #111; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  #meta { color: #555; margin-bottom: 12px; }
  #controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 12px; }
  #controls input[type=number] { width: 80px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: middle; }
  th { cursor: pointer; position: sticky; top: 0; background: #fff; white-space: nowrap; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  img { width: 64px; height: 64px; object-fit: contain; background: #f4f4f4; }
  tr.flagged { background: #fff6d6; }
  tr.inverted { background: #ffd9d2; }
  .flag { display: inline-block; padding: 1px 6px; margin: 1px; border-radius: 8px; background: #c0392b; color: #fff; font-size: 12px; white-space: nowrap; }
  .out { color: #888; }
  #more { margin: 16px 0; padding: 8px 16px; }
</style>
</head>
<body>
<h1>Black Friday 2026 – fynd</h1>
<div id="meta"></div>
<div id="controls">
  <label>Butik <select id="store"><option value="">Alla</option></select></label>
  <label><input type="checkbox" id="flagged"> Bara flaggade</label>
  <label><input type="checkbox" id="instock"> Bara i lager</label>
  <label>Lägsta ordinarie pris <input type="number" id="minprev" min="0" step="500" value="0"> kr</label>
  <label>Sök <input type="search" id="q"></label>
  <span id="count"></span>
</div>
<table>
  <thead><tr>
    <th>Bild</th><th data-key="title">Titel</th><th data-key="store">Butik</th>
    <th class="num" data-key="price">Pris</th><th class="num" data-key="previousPrice">Ord. pris</th>
    <th class="num" data-key="discountPct">Rabatt</th><th class="num" data-key="savingKr">Sparar</th>
    <th class="num" data-key="siblingMedianPrice" title="Medianpris för produktens andra varianter (antal)">Syskon median</th>
    <th data-key="invertedGapKr" title="Syskonvariant med lägre eller lika ordinarie pris som nu kostar mer">Underskrider</th>
    <th data-key="flagCount">Flaggor</th>
  </tr></thead>
  <tbody id="rows"></tbody>
</table>
<button id="more">Visa fler</button>
<script id="data" type="application/json">${scriptJson({ rows, run })}</script>
<script>
(() => {
  const { rows, run } = JSON.parse(document.getElementById('data').textContent);
  const PAGE = 300;
  const $ = (id) => document.getElementById(id);
  const kr = (n) => (n === null || n === undefined ? '' : n.toLocaleString('sv-SE') + ' kr');
  const state = { key: null, dir: -1, shown: PAGE };
  const el = (tag, props, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  $('meta').textContent = 'Visar ' + rows.length + ' av ' + run.totalRows + ' varianter (alla finns i products.csv), hämtade ' +
    (run.stores.some((s) => s.generatedAt) ? run.stores.map((s) => s.store + ' ' + s.generatedAt).join(', ') : run.generatedAt) + '. Inverterade rader först (dyrare variant som kostar mindre än ett nedsatt syskon), sedan flest flaggor; klicka på en rubrik för att sortera.' +
    run.stores.filter((s) => s.status !== 'complete').map((s) => ' OBS ' + s.store + ': ' + s.status + '.').join('');
  for (const store of [...new Set(rows.map((r) => r.store))]) $('store').append(el('option', { value: store }, store));

  const flags = (r) => [
    r.flagInvertedDearer ? 'dyrare variant billigare än syskon' : r.flagInverted && 'billigare än likvärdigt syskon',
    r.flagUnder25Pct && 'under 25 % av ord.',
    r.flagSavingOver5000 && 'sparar över 5 000 kr',
    r.flagTypo && 'ser ut som felskrivning',
    r.flagCheapVsSiblings && 'billig mot syskonvarianter',
    r.flagDiscountVsSiblings && 'rabatt avviker från syskon',
  ].filter(Boolean);

  function visible() {
    const store = $('store').value, q = $('q').value.trim().toLowerCase(), minPrev = Number($('minprev').value) || 0;
    let list = rows.filter((r) =>
      (!store || r.store === store) &&
      (!$('flagged').checked || r.flagCount > 0) &&
      (!$('instock').checked || r.inStock) &&
      (!minPrev || (r.previousPrice ?? 0) >= minPrev) &&
      (!q || (r.title + ' ' + (r.variantName ?? '') + ' ' + (r.brand ?? '')).toLowerCase().includes(q)));
    if (state.key) {
      const k = state.key, d = state.dir;
      list = [...list].sort((a, b) => {
        const x = a[k], y = b[k];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (typeof x === 'string' ? x.localeCompare(y, 'sv') : x - y) * d;
      });
    }
    return list;
  }

  function render() {
    const list = visible();
    $('count').textContent = list.length + ' rader';
    $('rows').replaceChildren(...list.slice(0, state.shown).map((r) => {
      const link = el('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.title);
      const title = el('td', {}, link,
        el('div', {}, r.variantName ?? ''),
        el('div', { className: 'out' }, [r.brand, r.inStock === false ? 'ej i lager' : ''].filter(Boolean).join(' · ')));
      const image = el('td', {});
      if (r.image) image.append(el('img', { src: r.image, loading: 'lazy', alt: '', referrerPolicy: 'no-referrer' }));
      return el('tr', { className: r.flagInverted ? 'inverted' : r.flagCount ? 'flagged' : '' },
        image, title, el('td', {}, r.store),
        el('td', { className: 'num' }, kr(r.price)), el('td', { className: 'num' }, kr(r.previousPrice)),
        el('td', { className: 'num' }, r.discountPct === null ? '' : '-' + r.discountPct + ' %'),
        el('td', { className: 'num' }, kr(r.savingKr)),
        el('td', { className: 'num' }, r.siblingCount ? kr(r.siblingMedianPrice) + ' (' + r.siblingCount + ')' : ''),
        el('td', {}, r.flagInverted ? r.undercutsVariantName + ': ' + kr(r.undercutsPrice) + ' (ord. ' + kr(r.undercutsPreviousPrice) + '), ' + kr(r.invertedGapKr) + ' dyrare' : ''),
        el('td', {}, ...flags(r).map((f) => el('span', { className: 'flag' }, f))));
    }));
    $('more').hidden = list.length <= state.shown;
  }

  for (const id of ['store', 'flagged', 'instock', 'minprev', 'q']) {
    $(id).addEventListener('input', () => { state.shown = PAGE; render(); });
  }
  for (const th of document.querySelectorAll('th[data-key]')) {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      state.dir = state.key === key ? -state.dir : (typeof rows[0]?.[key] === 'string' ? 1 : -1);
      state.key = key;
      state.shown = PAGE;
      render();
    });
  }
  $('more').addEventListener('click', () => { state.shown += PAGE; render(); });
  render();
})();
</script>
</body>
</html>
`;
}

export function writeOutputs(dir, rows, run) {
  mkdirSync(dir, { recursive: true });
  const files = {
    csv: join(dir, 'products.csv'),
    json: join(dir, 'products.json'),
    html: join(dir, 'report.html'),
    run: join(dir, 'run.json'),
  };
  writeFileSync(files.csv, toCsv(rows));
  writeFileSync(files.json, JSON.stringify(rows, null, 1) + '\n');
  writeFileSync(files.html, toHtml(rows, run));
  writeFileSync(files.run, JSON.stringify(run, null, 1) + '\n');
  return files;
}
