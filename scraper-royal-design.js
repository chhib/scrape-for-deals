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
        //await page.waitForSelector(".css-io41l7-Box-StyledProductListItem-ProductGridItem.e1ukcukj0", { timeout:3000 });
        
        // autoscroll to capture all images.
        const lastPosition = await scrollPageToBottom(page, {
            size: 500,
            delay: 250
        })

        // Extract the results from the page.
        productsOnPage = await page.evaluate(() => {
          return [...document.querySelectorAll(".css-io41l7-Box-StyledProductListItem-ProductGridItem.e1ukcukj0")].map(product => { 
            const prices = {},
                anchor = product.querySelector("a.css-5v1mrc-StyledLink"),
                img = product.querySelector("img"),
                title = [...product.querySelectorAll('.css-ak647j-Text-StyledHeading, .css-ijkekv-productNameStyle')].map(text => text.innerText).join(", ");
			product.querySelectorAll(".css-iu7r0d-Text, .sale.css-gkj6nt-Text").forEach((r, t) => {
                prices[t] = parseInt(r.innerText.replace("Rek. pris", "").replace(" kr", "").replaceAll(" ", ""), 10)
            })
            return {
                price: prices[0],
                img: img.src,
                link: anchor.href,
                reduction: Math.round(100 * (prices[0] / prices[1] - 1)),
                price_previous: prices[1],
                store: 'royal design #blackweek',
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
    
    const nextPageNumber = parseInt(url.match(/page=(\d+).*/)[1], 10) + 1;
    // Insert into BigQuery all items
    if (productsOnPage.length > 0) {
      await insertRowsAsStream(productsOnPage);
    }

    // Recursively scrape the next page
    if (productsOnPage.length < 1 || nextPageNumber >= 186) {
      // Terminate if no partners exist
      return productsOnPage
    } else {

     // Go fetch the next page ?page=X+1
      //const nextPageNumber = parseInt(url.match(/page=(\d+).+/)[1], 10) + 1;
       const nextUrl = `https://royaldesign.se/kampanjer/black-week-alla-erbjudanden?CategoryCode=WEBCAT_2_1&CategoryCode=WEBCAT_2_3&CategoryCode=WEBCAT_1_2&CategoryCode=WEBCAT_5_3&CategoryCode=WEBCAT_5_1&CategoryCode=WEBCAT_3_1&CategoryCode=WEBCAT_2_2&CategoryCode=WEBCAT_1_3&CategoryCode=WEBCAT_1_5&CategoryCode=WEBCAT_1_1&CategoryCode=WEBCAT_5_8&CategoryCode=WEBCAT_1_7&CategoryCode=WEBCAT_5_7&CategoryCode=WEBCAT_3_4&CategoryCode=WEBCAT_7_9&CategoryCode=WEBCAT_6_6&Price.max=107865&Price.min=700&sortBy=price_asc&page=${nextPageNumber}`;

      return productsOnPage.concat(await extractProducts(nextUrl))
    }
  };

  let products = [];

  const browser = await puppeteer.launch();


  const firstUrl = "https://royaldesign.se/kampanjer/black-week-alla-erbjudanden?CategoryCode=WEBCAT_2_1&CategoryCode=WEBCAT_2_3&CategoryCode=WEBCAT_1_2&CategoryCode=WEBCAT_5_3&CategoryCode=WEBCAT_5_1&CategoryCode=WEBCAT_3_1&CategoryCode=WEBCAT_2_2&CategoryCode=WEBCAT_1_3&CategoryCode=WEBCAT_1_5&CategoryCode=WEBCAT_1_1&CategoryCode=WEBCAT_5_8&CategoryCode=WEBCAT_1_7&CategoryCode=WEBCAT_5_7&CategoryCode=WEBCAT_3_4&CategoryCode=WEBCAT_7_9&CategoryCode=WEBCAT_6_6&Price.max=107865&Price.min=700&sortBy=price_asc&page=1";
  products = await extractProducts(firstUrl);

  
  const reductionLimit = -39
  const reducedProducts = products.filter(p => p.reduction < reductionLimit);
  console.log(`${reducedProducts.length} products found with ${reductionLimit}% discount.`);

  console.log(reducedProducts);

  await browser.close();
})();

