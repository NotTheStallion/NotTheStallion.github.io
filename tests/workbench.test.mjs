import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowStars, formatStars, readCache, writeCache, fetchStars } from '../js/workbench.js';

test('more than 5 stars shows the badge', () => {
  assert.equal(shouldShowStars(6), true);
  assert.equal(shouldShowStars(32), true);
});

test('5 stars or fewer, or no count, hides the badge', () => {
  assert.equal(shouldShowStars(5), false);
  assert.equal(shouldShowStars(0), false);
  assert.equal(shouldShowStars(null), false);
  assert.equal(shouldShowStars(NaN), false);
});

test('star count reads "★ N", with thousands shortened', () => {
  assert.equal(formatStars(32), '★ 32');
  assert.equal(formatStars(999), '★ 999');
  assert.equal(formatStars(1200), '★ 1.2k');
  assert.equal(formatStars(15000), '★ 15k');
});

/** In-memory stand-in for sessionStorage. */
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

const brokenStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

test('a written star count is read back for the same repo only', () => {
  const s = memoryStorage();
  writeCache(s, 'reshard-safetensors', 32);
  assert.equal(readCache(s, 'reshard-safetensors'), 32);
  assert.equal(readCache(s, 'other-repo'), undefined);
});

test('missing, garbled or blocked storage reads as a cache miss and never throws', () => {
  const s = memoryStorage();
  s.setItem('workbench-stars:x', 'not a number');
  assert.equal(readCache(s, 'x'), undefined);
  assert.equal(readCache(undefined, 'x'), undefined);
  assert.equal(readCache(brokenStorage, 'x'), undefined);
  assert.doesNotThrow(() => writeCache(brokenStorage, 'x', 3));
  assert.doesNotThrow(() => writeCache(undefined, 'x', 3));
});

/** Fake fetch that records the URLs it was asked for. */
function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, opts) => { calls.push(url); return respond(url, opts); };
  fn.calls = calls;
  return fn;
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('fetches the star count from the public GitHub API and caches it', async () => {
  const storage = memoryStorage();
  const fetch = fakeFetch(() => ok({ stargazers_count: 32 }));
  assert.equal(await fetchStars('reshard-safetensors', { fetch, storage }), 32);
  assert.deepEqual(fetch.calls, ['https://api.github.com/repos/NotTheStallion/reshard-safetensors']);
  assert.equal(readCache(storage, 'reshard-safetensors'), 32);
});

test('a cache hit answers without touching the network', async () => {
  const storage = memoryStorage();
  writeCache(storage, 'reshard-safetensors', 40);
  const fetch = fakeFetch(() => { throw new Error('should not fetch'); });
  assert.equal(await fetchStars('reshard-safetensors', { fetch, storage }), 40);
  assert.equal(fetch.calls.length, 0);
});

test('rate limit, network error, bad body or timeout all give null, and nothing is cached', async () => {
  const storage = memoryStorage();
  const cases = {
    rateLimited: fakeFetch(() => ({ ok: false, status: 403, json: async () => ({ message: 'API rate limit exceeded' }) })),
    offline: fakeFetch(() => { throw new TypeError('Failed to fetch'); }),
    badBody: fakeFetch(() => ok({ message: 'Not Found' })),
    hangs: fakeFetch((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })),
  };
  for (const [name, fetch] of Object.entries(cases)) {
    assert.equal(await fetchStars('other-repo', { fetch, storage, timeoutMs: 20 }), null, name);
  }
  assert.equal(readCache(storage, 'other-repo'), undefined);
});
