# scrape-for-deals

- auth with gcloud to get access to your bigquery

Currently version handles different websites in each `scraper-{store}.js`.

Saves into a BiqQuery table

## Black Friday 2026

`bf2026/` walks the whole sale listing of four stores, collects every variant with its own price and
ranks the likely mispricings first. No BigQuery, no browser, no dependencies beyond Node 20+.

```bash
npm ci        # `npm install` also works, but npm 7+ then rewrites the old package-lock.json
npm test
npm start                                  # all four stores, full run
npm start -- svenssons                     # one store: svenssons, nordiska-galleriet, lanna-mobler, nordic-nest
npm start -- --max-pages 2 --max-products 25   # sample run first: check that rows have title and prices
npm run rerank -- out/2026-11-27           # rank a saved run again after a change to rank.js; no requests
npm run rerank -- out/2026-11-27 out/2026-11-27-nordic-nest   # merge a later run of some stores into it
```

### The db: saved as it goes, resumable, exportable at any time

Every run writes to `data/bf.db` (SQLite through Node's built-in `node:sqlite`, Node 22.5+; another file with
`--db PATH`) while it walks: each listing page's rows as soon as the page is parsed, and each product page's
variants as soon as that page is read. A stopped run loses nothing.

```bash
npm start -- nordic-nest                   # rerun after a stop: product pages read in the last 12 h come from the db
npm start -- nordic-nest --max-age-hours 2 # read pages older than 2 h again (0: read every page again)
npm run export                             # rank all the db holds now, also mid-run, into out/<YYYY-MM-DD>-db/
npm run export -- nordic-nest svenssons    # some stores, into out/<YYYY-MM-DD>-db-<store+store>/
node bf2026/index.js import out/2026-11-27 # put a run saved before the db into it (older rows never replace newer)
npm run db:compact                         # fold the log into data/bf.db and VACUUM; run before a commit
```

A rerun walks the listings again (they change), and reads only the product pages the db lacks or holds older
than `--max-age-hours`. In the db (`variants`, one row per store and `variantId`), a product page's rows
replace the listing's headline row of the same variant and add the variants the listing left out; products
whose page is not read yet keep their listing row. `export` writes the same files as a run, plus:

- `run.json`: per store, `productsWithVariantsFetched` against `productsListed` (Svenssons and Nordic Nest;
  the Elevate stores list every variant), rows from listings and from product pages, oldest and newest row.
- `deals.json`, and the db table `deals`: the top 100 for Hemma /deals. In-stock rows only. `inverted`: rows
  that undercut an ordinarily cheaper sibling, or one with the same ordinary price by at least 1 000 kr and
  25 %, the largest gap per title, at most 40. `deep`: at least 40 % and 2 000 kr off, titles not already in
  `inverted`, the largest saving per title, filling up to 100 (`bf2026/deals.js`).

`data/bf.db` is committed. It holds normalized columns only (no pages), URLs without the store's origin;
its `-wal`/`-shm` files are not committed, so run `npm run db:compact` first.

Output lands in `out/<YYYY-MM-DD>/` (a sample run in `out/<YYYY-MM-DD>-sample/`; a run of some stores in
`out/<YYYY-MM-DD>-<store+store>/`, so it never overwrites a run of all four; `rerank` merges it in, and a
store in the later folder replaces that store's rows):

- `report.html`: open in a browser. Flagged rows first, sortable, filter by store, stock and ordinary price.
  Holds the top 20 000 rows of the ranking.
- `products.csv`, `products.json`: every variant.
- `run.json`: per store and listing, the site's own total against what was collected.

What is read (GET only, at most 2 requests at a time per store):

| Store | Listing | Variants |
| --- | --- | --- |
| Svenssons | `https://www.svenssons.se/black-friday/?page=N`, in two parts (`instock=true`, `instock=false`), each from both ends of the price order because the site serves at most 277 pages of one order | each listed product's own page (`page.variants`) |
| Nordic Nest | `https://www.nordicnest.se/black-friday/`, the same storefront and walk as Svenssons | each listed product's own page |
| Nordiska Galleriet | the listing API behind `/black-month-40`, `/black-month-super-deals` and `/online-archive-all`, plus the brand listings of DCWéditions, DUX and Ligne Roset, whose campaign pages held products the others leave out | each hit comes with its whole product group |
| Länna Möbler | the listing API behind `/aktuella-erbjudanden`, `/black-week-04`, the 10 % extra campaign and `/online-outlet-all` | each hit comes with its whole product group |

Flags (thresholds in `bf2026/rank.js`):

- `flagInverted`: the variant's ordinary price is at least a sibling's, yet it now costs less than that
  sibling's sale price (the opal shade cheaper than the metal shades). Against a sibling with the same
  ordinary price the gap must be at least 25 % of that sibling's price and at least 1 000 kr; against an
  ordinarily cheaper sibling (`flagInvertedDearer`) any gap counts. `undercuts*` columns name the sibling,
  `invertedGapKr` is the gap. These rows come first, `flagInvertedDearer` ones first, largest gap first.
- price under 25 % of the previous price; saving over 5 000 kr; looks like a typo (previous/price near 10x
  or 100x, or a round low price on an item over 10 000 kr).
- `flagCheapVsSiblings`, `flagDiscountVsSiblings`: far below, or discounted far more than, the siblings that
  are discounted themselves. One colour on sale among full-price siblings gets neither.

After the inverted rows, rows sort by number of flags, then discount %, then saving.

A full run checks itself: each listing's own total must equal what was collected, and every Svenssons
product page must have been read. A store that falls short is marked `incomplete` in `run.json` and in the
log, and the exit code is 1. A store with empty rows, or rows without title or price, fails.
