// Used to test puppeteer setup
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch();
const url = 'https://www.lannamobler.se/aktuella-erbjudanden/?brands=&categories=&page=5&sort=price_ascending';

(async () => {
    const page = await browser.newPage();
    await page.goto(url);    
    await page.waitForSelector('.lm-productbox.lm-productbox--regular', {timeout:3000})
    const title = await page.evaluate(() => {
       // return [...document.querySelectorAll('.lm-productbox.lm-productbox--regular')].map(product => { return product.innerText})

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
                //date: bqDate
            };
          })
    });
    console.log(JSON.stringify(title, null, 2));
    await page.close();

    await browser.close();
})();
