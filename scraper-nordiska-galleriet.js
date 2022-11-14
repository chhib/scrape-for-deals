import puppeteer from 'puppeteer';
import {BigQuery} from '@google-cloud/bigquery';
import { scrollPageToBottom } from 'puppeteer-autoscroll-down';
const bigquery = new BigQuery();

(async () => {

  const insertRowsAsStream = async rows => {
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
        await page.waitForSelector(".PT_Wrapper.col-xs-6.col-sm-4.col-md-4.col-lg-3.gutter-md-T", { timeout:3000 });
        
        // autoscroll to capture all images.
        const lastPosition = await scrollPageToBottom(page, {
        size: 500,
        delay: 150
        })

        // Extract the results from the page.
        productsOnPage = await page.evaluate(() => {
          return [...document.querySelectorAll(".PT_Wrapper.col-xs-6.col-sm-4.col-md-4.col-lg-3.gutter-md-T")].map(product => { 
        
            const prices = {},
                anchor = product.querySelector("a"),
                img = product.querySelector(".PT_Bildruta img:first-child"),
                title = product.querySelector('.PT_Faktaruta').innerText.replaceAll("\n", " ");
			product.querySelectorAll(".PT_PriceWrap span.PT_PrisKampanj.font-m.text-red, .PT_PriceWrap span.PT_PrisOrdinarie.font-m.lowlight").forEach(((r, t) => {
                prices[t] = parseInt(r.innerHTML.replace("rek.pris fr. ", "").replace("fr. ", "").replace(" kr", "").replace(" ", ""), 10)
            }))
            return {
                price: prices[0],
                img: img.src,
                link: anchor.href,
                reduction: Math.round(100 * (prices[0] / prices[1] - 1)),
                price_previous: prices[1],
                store: 'nordiska galleriet #2',
                title: title,
                date: new Date().toISOString().split('T')[0],
                scraped_from: document.URL
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
       const nextUrl = `https://www.nordiskagalleriet.se/kampanjartiklar?page=${nextPageNumber}#{}`;

      return productsOnPage.concat(await extractProducts(nextUrl))
    }
  };

  let products = [];

  const browser = await puppeteer.launch();


  const firstUrl = "https://www.nordiskagalleriet.se/kampanjartiklar?page=1#{}";
  products = await extractProducts(firstUrl);

  
  const reductionLimit = -39
  const reducedProducts = products.filter(p => p.reduction < reductionLimit);
  console.log(`${reducedProducts.length} products found with ${reductionLimit}% discount.`);

  console.log(reducedProducts);

  await browser.close();
})();