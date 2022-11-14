// get all prices and list them in console.table
var reduction_limit = -29;
var products = [];
for (product of document.getElementsByClassName("lm-productbox lm-productbox--regular")) {
    const e = {},
        r = product.querySelector("a"),
        t = product.querySelector("img[itemprop=image]");
    product.querySelectorAll("span[itemprop=price]").forEach(((r, t) => {
        e[t] = parseInt(r.innerHTML.replace(".", "").replace(":-", ""), 10)
    })), products.push({
        price: e[0],
        img: t.src,
        href: r.href,
        reduction: Math.round(100 * (e[0] / e[1] - 1)),
        pricePrevious: e[1]
    })
}
products.sort(((e, r) => e.reduction > r.reduction)), console.table(products.filter((e => e.reduction < reduction_limit)));
var prevNext = document.querySelectorAll("li.lm-productlist__paging__item a.lm-productlist__paging__item--prev"),
    link = prevNext[prevNext.length - 1].href;

// use this to go to next:
window.open(link,"_self")