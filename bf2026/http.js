// Polite GET client: per-store concurrency cap, a small delay, retry with backoff on 429/5xx.

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_ATTEMPTS = 5;
const TIMEOUT_MS = 60_000;

export const CONCURRENCY_PER_STORE = 2;
export const DELAY_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function get(url, { accept = '*/*' } = {}) {
  for (let attempt = 1; ; attempt++) {
    let failure;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'sv-SE,sv;q=0.9' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return await res.text();
      failure = new Error(`GET ${url} -> HTTP ${res.status}`);
      if (res.status !== 429 && res.status < 500) throw Object.assign(failure, { final: true });
    } catch (err) {
      if (err.final) throw err;
      failure = failure ?? new Error(`GET ${url} -> ${err.message}`);
    }
    if (attempt >= MAX_ATTEMPTS) throw failure;
    await sleep(1000 * 2 ** (attempt - 1));
  }
}

// Runs fn over items with at most CONCURRENCY_PER_STORE in flight, DELAY_MS after each; keeps input order.
export async function politeMap(items, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      await sleep(DELAY_MS);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY_PER_STORE, items.length) }, worker));
  return results;
}
