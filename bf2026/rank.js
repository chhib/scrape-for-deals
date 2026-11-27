// Discount, saving and mispricing flags for normalized rows; one place for every threshold.

const UNDER_SHARE_OF_PREVIOUS = 0.25; // price under 25 % of previous price
const SAVING_OVER_KR = 5000;
const TYPO_RATIOS = [10, 100]; // a dropped digit: previous/price near 10x or 100x
const TYPO_RATIO_TOLERANCE = 0.1;
const ROUND_LOW_PRICE_MAX_KR = 3000; // "a round low number" ...
const ROUND_LOW_PRICE_STEP_KR = 100;
const ROUND_LOW_PREVIOUS_OVER_KR = 10000; // ... on an item whose previous price is over 10 000 kr

// Siblings are the other variants of the same product in the same store. A variant is only measured
// against siblings that are discounted themselves: one colour on sale among full-price siblings is a
// campaign, not a pricing error.
const CHEAP_SHARE_OF_SIBLING_MEDIAN = 0.6; // price under 60 % of the discounted siblings' median, or ...
const CHEAP_KR_BELOW_SIBLING_MEDIAN = 3000; // ... several thousand kr below it
const CHEAP_KR_MAX_SHARE_OF_MEDIAN = 0.85; // which must also be at least 15 % below it
const ORDINARILY_AS_DEAR_SHARE = 0.9; // only when its ordinary price is about the siblings' or higher
// Against a sibling with the same ordinary price, an inversion needs a gap of at least this share of
// that sibling's price and at least this many kr (decision 9); against an ordinarily cheaper one, none.
const EQUAL_ORDINARY_MIN_GAP_SHARE = 0.25;
const EQUAL_ORDINARY_MIN_GAP_KR = 1000;
const DISCOUNT_POINTS_ABOVE_SIBLINGS = 20; // discount % this many points above the discounted siblings' median

const isPrice = (n) => Number.isFinite(n) && n > 0;

function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function looksLikeTypo(price, previousPrice) {
  const ratio = previousPrice / price;
  const nearDroppedDigit = TYPO_RATIOS.some((r) => Math.abs(ratio / r - 1) <= TYPO_RATIO_TOLERANCE);
  const roundLow =
    previousPrice > ROUND_LOW_PREVIOUS_OVER_KR &&
    price <= ROUND_LOW_PRICE_MAX_KR &&
    price % ROUND_LOW_PRICE_STEP_KR === 0;
  return nearDroppedDigit || roundLow;
}

// What one variant costs on its own terms.
function own(row) {
  const { price, previousPrice } = row;
  const discounted = isPrice(price) && isPrice(previousPrice) && previousPrice > price;
  return {
    row,
    price: isPrice(price) ? price : null,
    ordinaryPrice: isPrice(previousPrice) ? previousPrice : isPrice(price) ? price : null,
    discountPct: discounted ? (1 - price / previousPrice) * 100 : null,
    savingKr: discounted ? previousPrice - price : null,
    discounted,
  };
}

// The inversion: ordinarily at least as dear as a sibling, now cheaper than that sibling's sale price.
// Returns the sibling it undercuts by the most kronor, an ordinarily cheaper sibling before an equal one.
function undercutSibling(self, discountedSiblings) {
  let worst = null;
  for (const sibling of discountedSiblings) {
    if (!(self.ordinaryPrice >= sibling.ordinaryPrice && self.price < sibling.price)) continue;
    const dearer = self.ordinaryPrice > sibling.ordinaryPrice;
    const gap = sibling.price - self.price;
    if (!dearer && (gap < sibling.price * EQUAL_ORDINARY_MIN_GAP_SHARE || gap < EQUAL_ORDINARY_MIN_GAP_KR)) continue;
    const candidate = { sibling, dearer };
    if (!worst || candidate.dearer > worst.dearer || (candidate.dearer === worst.dearer && sibling.price > worst.sibling.price)) {
      worst = candidate;
    }
  }
  return worst;
}

function assess(self, siblings) {
  const { row } = self;
  const priced = siblings.filter((s) => s.price !== null);
  const discountedSiblings = priced.filter((s) => s.discounted);
  const medianPrice = median(discountedSiblings.map((s) => s.price));
  const medianOrdinary = median(discountedSiblings.map((s) => s.ordinaryPrice));
  const medianDiscount = median(discountedSiblings.map((s) => s.discountPct));

  const comparable = self.discounted && discountedSiblings.length > 0;
  const undercut = comparable ? undercutSibling(self, discountedSiblings) : null;
  const farBelow =
    comparable &&
    (self.price < medianPrice * CHEAP_SHARE_OF_SIBLING_MEDIAN ||
      (medianPrice - self.price >= CHEAP_KR_BELOW_SIBLING_MEDIAN &&
        self.price <= medianPrice * CHEAP_KR_MAX_SHARE_OF_MEDIAN));

  const flagInverted = undercut !== null;
  const flagInvertedDearer = flagInverted && undercut.dearer;
  const flagUnder25Pct = self.discounted && row.price < row.previousPrice * UNDER_SHARE_OF_PREVIOUS;
  const flagSavingOver5000 = self.discounted && self.savingKr > SAVING_OVER_KR;
  const flagTypo = self.discounted && looksLikeTypo(row.price, row.previousPrice);
  const flagCheapVsSiblings = farBelow && self.ordinaryPrice >= medianOrdinary * ORDINARILY_AS_DEAR_SHARE;
  const flagDiscountVsSiblings = comparable && self.discountPct - medianDiscount >= DISCOUNT_POINTS_ABOVE_SIBLINGS;

  return {
    ...row,
    discountPct: self.discounted ? Math.round(self.discountPct) : null,
    savingKr: self.discounted ? Math.round(self.savingKr) : null,
    siblingCount: priced.length,
    siblingMedianPrice: priced.length ? Math.round(median(priced.map((s) => s.price))) : null,
    flagInverted,
    flagInvertedDearer,
    invertedGapKr: undercut ? Math.round(undercut.sibling.price - self.price) : null,
    undercutsVariantId: undercut?.sibling.row.variantId ?? null,
    undercutsVariantName: undercut ? (undercut.sibling.row.variantName ?? undercut.sibling.row.title ?? null) : null,
    undercutsPrice: undercut?.sibling.price ?? null,
    undercutsPreviousPrice: undercut?.sibling.ordinaryPrice ?? null,
    flagUnder25Pct,
    flagSavingOver5000,
    flagTypo,
    flagCheapVsSiblings,
    flagDiscountVsSiblings,
    flagCount: flagInverted + flagInvertedDearer + flagUnder25Pct + flagSavingOver5000 + flagTypo + flagCheapVsSiblings + flagDiscountVsSiblings,
  };
}

// Inverted rows first: those that undercut an ordinarily cheaper sibling, then those that undercut an
// equal one, each by the kronor gap. Then most flags, highest discount, largest saving.
export function rank(rows) {
  const products = new Map();
  const entries = rows.map((row) => {
    const self = own(row);
    const key = JSON.stringify([row.store, row.productId]);
    if (!products.has(key)) products.set(key, []);
    products.get(key).push(self);
    return { self, key };
  });
  return entries
    .map(({ self, key }) => assess(self, products.get(key).filter((other) => other !== self)))
    .sort(
      (a, b) =>
        b.flagInvertedDearer - a.flagInvertedDearer ||
        b.flagInverted - a.flagInverted ||
        (b.invertedGapKr ?? 0) - (a.invertedGapKr ?? 0) ||
        b.flagCount - a.flagCount ||
        (b.discountPct ?? -1) - (a.discountPct ?? -1) ||
        (b.savingKr ?? -1) - (a.savingKr ?? -1),
    );
}
