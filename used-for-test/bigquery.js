// Used to test bigquery connection with gcloud auth
import {BigQuery} from '@google-cloud/bigquery'
// Decided to not use service account
// const options = {
//   //keyFilename: '/Users/ksu541/Code/scrape-for-deals/keys.json',
//   projectId: 'scrape-for-deals',
// };
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

  insertRowsAsStream([
    {
      price: 129,
      img: 'img.src',
      link: 'anchor.href',
      reduction: Math.round(100 * (129 / 356 - 1)),
      price_previous: 356,
      store: 'länna möbler',
      title: 'första',
      date: new Date().toISOString().split('T')[0]
  }
  ]).then(res => {
    console.log('res')
    console.log(res)

    }
    )
  .catch((reason, errors) => { 
    console.log('catch')
    console.log(reason)
  })
})();