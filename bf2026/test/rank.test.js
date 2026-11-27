import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank } from '../rank.js';

const row = (id, price, previousPrice, productId = id) => ({ store: 'S', productId, variantId: id, title: id, price, previousPrice });
const ids = (rows) => rows.map((r) => r.variantId);

test('rank: 2 000 kr with previous 15 000 kr is flagged and sorts above a 50 % row', () => {
  const ranked = rank([row('half', 5000, 10000), row('gross', 2000, 15000)]);

  assert.deepEqual(ids(ranked), ['gross', 'half']);
  const gross = ranked[0];
  assert.equal(gross.discountPct, 87);
  assert.equal(gross.savingKr, 13000);
  assert.equal(gross.flagUnder25Pct, true);
  assert.equal(gross.flagSavingOver5000, true);
  assert.equal(gross.flagTypo, true); // round low price on an item over 10 000 kr
  assert.equal(gross.flagCount, 3);
  assert.equal(ranked[1].discountPct, 50);
  assert.equal(ranked[1].flagCount, 0);
});

test('rank: a row without previous price gets no discount and no crash', () => {
  const ranked = rank([row('none', 500, null), row('same', 500, 500), row('sale', 400, 500)]);

  assert.deepEqual(ids(ranked), ['sale', 'none', 'same']);
  for (const r of ranked.slice(1)) {
    assert.equal(r.discountPct, null);
    assert.equal(r.savingKr, null);
    assert.equal(r.flagCount, 0);
  }
});

test('rank: a previous/price ratio near 10x is a typo flag', () => {
  const [r] = rank([row('tenth', 1299, 12990)]);
  assert.equal(r.flagTypo, true);
  const [ordinary] = rank([row('ordinary', 1299, 2598)]);
  assert.equal(ordinary.flagTypo, false);
});

test('rank: flagged rows come before unflagged rows with a higher discount', () => {
  const ranked = rank([row('candle', 20, 100), row('sofa', 14000, 20000)]);
  // candle: 80 % and under 25 % of previous (1 flag); sofa: 30 %, saves 6 000 (1 flag)
  assert.deepEqual(ids(ranked), ['candle', 'sofa']);
  const more = rank([row('cheap70', 30, 100), row('sofa', 14000, 20000)]);
  assert.deepEqual(ids(more), ['sofa', 'cheap70']);
});

test('rank: a variant far below its siblings, though ordinarily the dearer one, is flagged and ranks first', () => {
  // the lamp: metal shades correctly discounted, the opal glass shade several thousand kr too cheap
  const ranked = rank([
    row('brass', 4000, 5000, 'lamp'),
    row('black', 4000, 5000, 'lamp'),
    row('white', 4100, 5000, 'lamp'),
    row('opal', 1500, 5500, 'lamp'),
    row('other', 5000, 10000),
  ]);

  assert.equal(ranked[0].variantId, 'opal');
  assert.equal(ranked[0].flagInverted, true);
  assert.equal(ranked[0].flagCheapVsSiblings, true);
  assert.equal(ranked[0].flagDiscountVsSiblings, true);
  assert.equal(ranked[0].siblingCount, 3);
  assert.equal(ranked[0].siblingMedianPrice, 4000);
  for (const r of ranked.filter((x) => x.productId === 'lamp' && x.variantId !== 'opal')) {
    assert.equal(r.flagCheapVsSiblings, false);
    assert.equal(r.flagDiscountVsSiblings, false);
  }
});

test('rank: a smaller size that is ordinarily cheaper than its siblings is not cheapVsSiblings', () => {
  const ranked = rank([row('small', 500, 1000, 'star'), row('large', 1000, 2000, 'star'), row('xl', 1200, 2400, 'star')]);
  assert.deepEqual(ranked.map((r) => r.flagCheapVsSiblings), [false, false, false]);
});

test('rank: several thousand kr below siblings at the same previous price is cheapVsSiblings', () => {
  const ranked = rank([row('a', 20000, 30000, 'sofa'), row('b', 20000, 30000, 'sofa'), row('c', 16000, 30000, 'sofa')]);
  assert.deepEqual(ranked.filter((r) => r.flagCheapVsSiblings).map((r) => r.variantId), ['c']);
});

test('rank: a product with one variant gets no sibling flags', () => {
  const [r] = rank([row('solo', 100, 1000)]);
  assert.equal(r.flagCheapVsSiblings, false);
  assert.equal(r.flagDiscountVsSiblings, false);
  assert.equal(r.flagInverted, false);
  assert.equal(r.invertedGapKr, null);
  assert.equal(r.siblingCount, 0);
  assert.equal(r.siblingMedianPrice, null);
});

test('rank: siblings are only compared within one store', () => {
  const rows = [row('a', 1000, 5000, 'p'), { ...row('b', 4000, 5000, 'p'), store: 'T' }];
  assert.deepEqual(rank(rows).map((r) => r.siblingCount), [0, 0]);
});

// Decision 7, the cases in reviews/r1.md. Metal shades: ordinarily 4 000, now 3 000.
const metals = () => [row('brass', 3000, 4000, 'lamp'), row('black', 3000, 4000, 'lamp'), row('steel', 3000, 4000, 'lamp')];
const oneColourOnSale = () => [
  row('clay', 24563, 40938, 'cabinet'),
  row('iris', 40938, 40938, 'cabinet'),
  row('mint', 40938, 40938, 'cabinet'),
  row('rosa', 40938, null, 'cabinet'),
];

test('rank: case D, a dearer variant priced just below its cheaper discounted siblings is inverted', () => {
  const ranked = rank([...metals(), row('opal', 2900, 5000, 'lamp')]);
  const opal = ranked.find((r) => r.variantId === 'opal');

  assert.equal(opal.flagInverted, true);
  assert.equal(opal.invertedGapKr, 100);
  assert.equal(opal.undercutsVariantId, 'brass');
  assert.equal(opal.undercutsPrice, 3000);
  assert.equal(ranked[0].variantId, 'opal');
  assert.deepEqual(ranked.filter((r) => r.flagInverted).map((r) => r.variantId), ['opal']);
});

test('rank: case E, a much dearer variant below its discounted siblings is inverted', () => {
  const ranked = rank([...metals(), row('opal', 2950, 9000, 'lamp')]);
  assert.equal(ranked[0].variantId, 'opal');
  assert.equal(ranked[0].flagInverted, true);
  assert.equal(ranked[0].invertedGapKr, 50);
});

test('rank: case F, one colour on sale among full-price siblings gets no sibling flag', () => {
  const clay = rank(oneColourOnSale()).find((r) => r.variantId === 'clay');
  assert.equal(clay.flagInverted, false);
  assert.equal(clay.flagCheapVsSiblings, false);
  assert.equal(clay.flagDiscountVsSiblings, false);
  assert.equal(clay.invertedGapKr, null);
  assert.equal(clay.flagSavingOver5000, true);
});

test('rank: an inverted row ranks above one colour on sale and above rows with more flags', () => {
  const gross = row('gross', 2000, 15000); // three flags, no siblings
  const ranked = rank([...oneColourOnSale(), gross, ...metals(), row('opal', 2900, 5000, 'lamp')]);
  assert.deepEqual(ids(ranked).slice(0, 3), ['opal', 'gross', 'clay']);
});

test('rank: inverted rows sort by the kronor gap to the sibling they undercut', () => {
  const ranked = rank([
    ...metals(), row('opal', 2900, 5000, 'lamp'),
    row('rug-small', 6524, 8699, 'rug'), row('rug-large', 4800, 11999, 'rug'), // Svenssons Furrow ullmatta, 2026-11-27
  ]);
  assert.deepEqual(ids(ranked).slice(0, 2), ['rug-large', 'opal']);
  assert.equal(ranked[0].invertedGapKr, 1724);
  assert.equal(ranked[0].undercutsVariantId, 'rug-small');
});

test('rank: a cheaper variant below its dearer siblings is not inverted, nor is undercutting a full-price sibling', () => {
  const sizes = rank([row('small', 500, 1000, 'star'), row('large', 1000, 2000, 'star')]);
  assert.deepEqual(sizes.map((r) => r.flagInverted), [false, false]);
  const fullPrice = rank([row('sale', 800, 1000, 'vase'), row('full', 1000, 1000, 'vase')]);
  assert.deepEqual(fullPrice.map((r) => r.flagInverted), [false, false]);
});

test('rank: 3 000 kr below discounted siblings on a 40 000 kr item is not cheapVsSiblings', () => {
  const ranked = rank([row('a', 40000, 50000, 'sofa'), row('b', 40000, 50000, 'sofa'), row('c', 37000, 50000, 'sofa')]);
  assert.deepEqual(ranked.map((r) => r.flagCheapVsSiblings), [false, false, false]);
  // decision 9: against equal ordinary prices a gap of 3 000 kr (7.5 % of 40 000) is too small to be inverted
  assert.equal(ranked.find((r) => r.variantId === 'c').flagInverted, false);
});

test('rank: undercutting a sibling that is ordinarily cheaper ranks above undercutting an equal one by more kronor', () => {
  const ranked = rank([
    ...metals(), row('opal', 2900, 5000, 'lamp'),
    row('clay', 24563, 40938, 'cabinet'), row('graphic', 36844, 40938, 'cabinet'), // one colour on a deeper sale
  ]);
  assert.deepEqual(ids(ranked).slice(0, 2), ['opal', 'clay']);
  assert.equal(ranked[0].flagInvertedDearer, true);
  assert.equal(ranked[1].flagInverted, true);
  assert.equal(ranked[1].flagInvertedDearer, false);
  assert.equal(ranked[1].invertedGapKr, 12281);
});

test('rank: the sibling named is the ordinarily cheaper one when there is one', () => {
  const [opal] = rank([row('opal', 2900, 5000, 'lamp'), row('twin', 4500, 5000, 'lamp'), row('brass', 3000, 4000, 'lamp')]);
  assert.equal(opal.undercutsVariantId, 'brass');
  assert.equal(opal.invertedGapKr, 100);
});

// Decision 9: against a sibling with the same ordinary price, the gap must be at least 25 % of that
// sibling's price and at least 1 000 kr. Against an ordinarily cheaper sibling there is no minimum.

test('rank: decision 9, equal ordinary price and a gap of at least 25 % and 1 000 kr is inverted', () => {
  const ranked = rank([
    row('x', 10000, 12000, 'chair'), row('y', 9500, 12000, 'chair'), row('z', 7400, 12000, 'chair'),
    row('a', 4000, 6000, 'edge'), row('b', 3000, 6000, 'edge'), // exactly 25 % and exactly 1 000 kr
  ]);
  assert.deepEqual(ranked.filter((r) => r.flagInverted).map((r) => r.variantId).sort(), ['b', 'z']);
  const z = ranked.find((r) => r.variantId === 'z');
  assert.equal(z.undercutsVariantId, 'x');
  assert.equal(z.invertedGapKr, 2600);
  assert.equal(z.flagInvertedDearer, false);
});

test('rank: decision 9, equal ordinary price, gap of 25 % or more but under 1 000 kr is not inverted', () => {
  const ranked = rank([row('a', 1000, 1500, 'vase'), row('b', 700, 1500, 'vase')]);
  assert.deepEqual(ranked.map((r) => r.flagInverted), [false, false]);
  assert.equal(ranked.find((r) => r.variantId === 'b').invertedGapKr, null);
});

test('rank: decision 9, equal ordinary price, gap of 1 000 kr or more but under 25 % is not inverted', () => {
  const ranked = rank([row('a', 12000, 16000, 'sofa'), row('b', 9500, 16000, 'sofa')]); // 2 500 kr, 20.8 %
  assert.deepEqual(ranked.map((r) => r.flagInverted), [false, false]);
});

test('rank: decision 9, a sibling ordinarily only slightly cheaper keeps the inversion with no minimum gap', () => {
  // ordinary 4 100 against 4 000 (2.5 % dearer), now 100 kr below
  const opal = rank([...metals(), row('opal', 2900, 4100, 'lamp')]).find((r) => r.variantId === 'opal');
  assert.equal(opal.flagInverted, true);
  assert.equal(opal.flagInvertedDearer, true);
  assert.equal(opal.invertedGapKr, 100);
});

test('rank: decision 9, an equal sibling below the minimum does not hide a qualifying one', () => {
  // y undercuts x (12 000) by 2 000 kr, 16.7 %: too small; it undercuts w (14 000) by 4 000 kr, 28.6 %: inverted
  const ranked = rank([row('w', 14000, 20000, 'bed'), row('x', 12000, 20000, 'bed'), row('y', 10000, 20000, 'bed')]);
  const y = ranked.find((r) => r.variantId === 'y');
  assert.equal(y.flagInverted, true);
  assert.equal(y.undercutsVariantId, 'w');
  assert.equal(y.invertedGapKr, 4000);
  assert.deepEqual(ranked.filter((r) => r.flagInverted).map((r) => r.variantId), ['y']);
});
