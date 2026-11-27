// Nordic Nest: the /black-friday/ listing and each listed product's page, on the same storefront as
// Svenssons (see initial-data.js). The listing (33 199 on 2026-11-27) is walked in price ranges, each
// well under the 10 000 the site serves of one order; the range filter includes both ends, so ranges
// start just above the one before. Split by instock instead, the in-stock part (19 741) came back short.

import { createStore } from './initial-data.js';

export const { parseListingPage, parseProductPage, listProducts, parts: PARTS } = createStore({
  store: 'Nordic Nest',
  origin: 'https://www.nordicnest.se',
  listingPath: '/black-friday/',
  parts: [[0, 200], [200.0001, 400], [400.0001, 800], [800.0001, 2000], [2000.0001, 6000], [6000.0001, 10000000]]
    .map(([min, max]) => ({ price: `${min},${max}` })),
});
