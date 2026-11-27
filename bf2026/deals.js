// The top-100 shown on Hemma /deals: in-stock rows only, one row per title.
// "inverted": flagInverted rows that undercut an ordinarily cheaper sibling, or a sibling with the same
// ordinary price by at least 1 000 kr and 25 % of its price (decision 9); the largest gap per title; at most 40.
// "deep": at least 40 % off and 2 000 kr saved, titles not already in "inverted"; the largest saving per
// title; fills the list up to 100.

export const DEALS_TOTAL = 100;
export const INVERTED_MAX = 40;

const SLIM = [
  'store', 'variantId', 'productId', 'title', 'brand', 'variantName', 'price', 'previousPrice', 'discountPct', 'savingKr',
  'url', 'image', 'invertedGapKr', 'undercutsVariantName', 'undercutsPrice', 'undercutsPreviousPrice',
];
const slim = (row) => Object.fromEntries(SLIM.map((k) => [k, row[k] ?? null]));

const isDealInverted = (r) =>
  r.flagInverted &&
  (r.undercutsPreviousPrice < r.previousPrice || (r.invertedGapKr >= 1000 && r.invertedGapKr >= 0.25 * r.undercutsPrice));

// The best row of each title by `better`, with how many rows of that title were left out; groups in title order
// so that ties keep a stable order.
function bestPerTitle(rows, better) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.title)) groups.set(r.title, []);
    groups.get(r.title).push(r);
  }
  return [...groups.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((title) => {
      const group = groups.get(title);
      return { row: [...group].sort(better)[0], more: group.length - 1 };
    });
}

export function selectDeals(rows) {
  const inStock = rows.filter((r) => r.inStock);
  const inverted = bestPerTitle(inStock.filter(isDealInverted), (a, b) => b.invertedGapKr - a.invertedGapKr || a.price - b.price)
    .sort((a, b) => b.row.invertedGapKr - a.row.invertedGapKr)
    .slice(0, INVERTED_MAX);
  const invertedTitles = new Set(inverted.map((d) => d.row.title));
  const deep = bestPerTitle(
    inStock.filter((r) => r.discountPct >= 40 && r.savingKr >= 2000 && !invertedTitles.has(r.title)),
    (a, b) => b.savingKr - a.savingKr,
  )
    .sort((a, b) => b.row.savingKr - a.row.savingKr)
    .slice(0, DEALS_TOTAL - inverted.length);
  const section = (name, list) => list.map((d, i) => ({ section: name, rank: i + 1, ...slim(d.row), more: d.more }));
  return [...section('inverted', inverted), ...section('deep', deep)];
}
