// A live listing shifts while it is walked (stock and popularity change), so one pass can miss a few
// products and show others twice. Walk it again in another order until nothing is missing.

// walkPass(pass) -> { total, keys, rows, pages }: the site's total, one key per listed entry, the rows.
export async function untilComplete(passes, walkPass, { firstPassOnly = false } = {}) {
  const keys = new Set();
  const rows = [];
  let siteTotal = 0;
  let pagesWalked = 0;
  for (const pass of firstPassOnly ? passes.slice(0, 1) : passes) {
    const result = await walkPass(pass);
    siteTotal = result.total;
    pagesWalked += result.pages;
    for (const key of result.keys) keys.add(key);
    rows.push(...result.rows);
    if (keys.size >= siteTotal) break;
  }
  return { siteTotal, collected: keys.size, pagesWalked, rows };
}
