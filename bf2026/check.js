// Did a store's run deliver what it should? Filled rows always; on a full run also every listing's site total.

const isPrice = (n) => Number.isFinite(n) && n > 0;

export function fieldCheck(rows) {
  const perProduct = new Map();
  for (const r of rows) perProduct.set(r.productId, (perProduct.get(r.productId) ?? 0) + 1);
  return {
    rows: rows.length,
    products: perProduct.size,
    withSiblings: rows.filter((r) => perProduct.get(r.productId) > 1).length,
    lackingFields: rows.filter((r) => !r.title || !isPrice(r.price) || !r.variantId || !r.productId).length,
    noPreviousPrice: rows.filter((r) => !isPrice(r.previousPrice)).length,
    discounted: rows.filter((r) => isPrice(r.previousPrice) && r.previousPrice > r.price).length,
  };
}

// status: 'failed' (unusable rows), 'incomplete' (a listing came back short), 'complete', or 'sample'.
export function storeStatus(rows, listings, { sample }) {
  const { lackingFields } = fieldCheck(rows);
  if (!rows.length) return { status: 'failed', problems: ['no rows'] };
  if (lackingFields) {
    return { status: 'failed', problems: [`${lackingFields} rows lack a title, price, variantId or productId; fix the parser`] };
  }
  if (sample) return { status: 'sample', problems: [] };
  const problems = listings
    .filter((l) => l.collected < l.siteTotal)
    .map((l) => `${l.listing}: collected ${l.collected} of ${l.siteTotal} ${l.counted}`);
  return { status: problems.length ? 'incomplete' : 'complete', problems };
}
