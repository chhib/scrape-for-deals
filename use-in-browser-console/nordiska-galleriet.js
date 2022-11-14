// get all prices and list them in console.table
var reduction_limit = -39;

var products = [];
for (product of document.getElementsByClassName("PT_Wrapper col-xs-6 col-sm-4 col-md-4 col-lg-3 gutter-md-T ")) {

    const comparison = {},
        link = product.querySelector("a"),
        img = product.querySelector("a > img");
    product.querySelectorAll(".PT_PriceWrap span.PT_PrisKampanj.font-m.text-red, .PT_PriceWrap span.PT_PrisOrdinarie.font-m.lowlight").forEach(((r, t) => {
        comparison[t] = parseInt(r.innerHTML.replace("rek.pris fr. ", "").replace("fr. ", "").replace(" kr", "").replace(" ", ""), 10)
    })), products.push({
        price: comparison[0],
        img: img.src,
        href: link.href,
        reduction: Math.round(100 * (comparison[0] / comparison[1] - 1)),
        pricePrevious: comparison[1]
    })
}

products.sort(((e, r) => e.reduction > r.reduction)), console.table(products.filter((e => e.reduction < reduction_limit)));

// get next page
var prevNext = document.querySelector(".pagination a.next"),
    link = prevNext.href;


// use this to go to next page:
window.open(link,"_self")