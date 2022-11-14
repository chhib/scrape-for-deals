import puppeteer from 'puppeteer';
import {BigQuery} from '@google-cloud/bigquery'
const bigquery = new BigQuery();

(async () => {

  const insertRowsAsStream = async rows => {
    console.log('insertRowsAsStream', rows.length);
    const datasetId = 'products';
    const tableId = 'blackweek2022';
    const options = {
      location: 'EU',
    };
    // Insert data into a table
    await bigquery
      .dataset(datasetId)
      .table(tableId)
      .insert(rows, options);
    console.log(`Inserted ${rows.length} rows`);
  }


  const extractProducts = async url => {
    // Scrape the data we want

    const page = await browser.newPage();
    await page.goto(url);    
    
    let productsOnPage = [];
    try {
        await page.waitForSelector('.lm-productbox.lm-productbox--regular', { timeout:3000 });
        
        // Extract the results from the page.
        productsOnPage = await page.evaluate(() => {
          return [...document.querySelectorAll('.lm-productbox.lm-productbox--regular')].map(product => { 
        
            const prices = {},
                anchor = product.querySelector("a"),
                img = product.querySelector("img[itemprop=image]");
                title = [...product.querySelectorAll('[itemprop=brand],[itemprop=name],[itemprop=description]')].map(e => e.innerText).join(", ")

            product.querySelectorAll("span[itemprop=price]").forEach(((r, t) => {
              prices[t] = parseInt(r.innerHTML.replace(".", "").replace(":-", ""), 10)
            }))
            return {
                price: prices[0],
                img: img.src,
                link: anchor.href,
                reduction: Math.round(100 * (prices[0] / prices[1] - 1)),
                price_previous: prices[1],
                store: 'länna möbler',
                title: title,
                date: new Date().toISOString().split('T')[0]
            };
          })
        });
    } catch (e) {
        // Do nothing if doesn't find anything
        console.log(e);
    }
    await page.close();

    console.log(`${productsOnPage.length} products found on ${url}`);
    
    // Insert into BigQuery all items
    if (productsOnPage.length > 0) {
      await insertRowsAsStream(productsOnPage);
    }

    // Recursively scrape the next page
    if (productsOnPage.length < 1) {
      // Terminate if no partners exist
      return productsOnPage
    } else {

     // Go fetch the next page ?page=X+1
      const nextPageNumber = parseInt(url.match(/page=(\d+).+/)[1], 10) + 1;
       const nextUrl = `https://www.lannamobler.se/aktuella-erbjudanden/?brands=&categories=&page=${nextPageNumber}&sort=price_ascending`;

      return productsOnPage.concat(await extractProducts(nextUrl))
    }
  };

  let products = [];

  const browser = await puppeteer.launch();


  const firstUrl = "https://www.lannamobler.se/aktuella-erbjudanden/?brands=&categories=&page=1&sort=price_ascending";
  products = await extractProducts(firstUrl);

  
  const reductionLimit = -39
  const reducedProducts = products.filter(p => p.reduction < reductionLimit);
  console.log(`${reducedProducts.length} products found with ${reductionLimit}% discount.`);

  console.log(reducedProducts);

  await browser.close();
})();