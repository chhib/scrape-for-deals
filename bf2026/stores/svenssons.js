// Svenssons i Lammhult: the /black-friday/ listing and each listed product's page (see initial-data.js).

import { createStore } from './initial-data.js';

export const { parseListingPage, parseProductPage, listProducts } = createStore({
  store: 'Svenssons',
  origin: 'https://www.svenssons.se',
  listingPath: '/black-friday/',
});
