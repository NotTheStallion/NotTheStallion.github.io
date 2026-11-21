/*
 * workbench.js — the Workbench: project cards in the Tech scene (ticket 04).
 * Mount: <div id="workbench-root"> inside #tech. Styles: css/workbench.css.
 *
 * Cards are typed in below (no data file). Each card may name a public GitHub
 * repo under NotTheStallion; its live ★ count shows only when above 5 and is
 * silently hidden on any failure. Repo names stay in the source, never as links.
 *
 * The pure helpers (stars threshold, formatting, session cache, fetch) are
 * named exports so they can be tested with `node --test`.
 */
import { reveal, el } from './shared.js';

/* ---------- content ---------- */

export const CARDS = [
  {
    title: 'Qwen3 and RLHF, from scratch',
    idea: 'Rebuilt the model by hand, taking only the pretrained weights from Hugging Face: the full forward pass, a working backward pass, then DPO, PPO and GRPO on top.',
    tags: ['PyTorch', 'Qwen3', 'DPO', 'PPO', 'GRPO'],
    repo: null,
  },
  {
    title: 'Safetensors reshaper (CLI)',
    idea: 'My most-used tool: merges and splits model shards and writes a Hugging Face–ready index.',
    tags: ['Python', 'safetensors', 'Hugging Face'],
    repo: 'reshard-safetensors',
  },
  {
    title: 'RAG with automatic evaluation',
    idea: 'Compares chunking strategies with RAGAS, so retrieval choices come with numbers.',
    tags: ['RAGAS', 'ChromaDB', 'Ollama', 'FastAPI'],
    repo: null,
  },
];

/* ---------- pure logic ---------- */

export const GITHUB_USER = 'NotTheStallion';

/** Only notable repos get a badge: strictly more than this many stars. */
export const STAR_THRESHOLD = 5;

export function shouldShowStars(n) {
  return Number.isFinite(n) && n > STAR_THRESHOLD;
}

export function formatStars(n) {
  if (n < 1000) return `★ ${n}`;
  const k = n / 1000;
  return `★ ${k >= 10 ? Math.round(k) : Number(k.toFixed(1))}k`;
}

const cacheKey = (repo) => `workbench-stars:${repo}`;

/** Cached star count for a repo, or undefined on a miss or any storage trouble. */
export function readCache(storage, repo) {
  try {
    const raw = storage?.getItem(cacheKey(repo));
    if (raw == null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

export function writeCache(storage, repo, n) {
  try {
    storage?.setItem(cacheKey(repo), String(n));
  } catch {
    /* storage full or blocked: just skip caching */
  }
}

/**
 * Star count of NotTheStallion/<repo>, from the session cache or the public
 * GitHub API. Never rejects: any error, rate limit or timeout gives null.
 */
export async function fetchStars(repo, { fetch = globalThis.fetch, storage, timeoutMs = 5000 } = {}) {
  const cached = readCache(storage, repo);
  if (cached !== undefined) return cached;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${repo}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const n = (await res.json())?.stargazers_count;
    if (!Number.isFinite(n)) return null;
    writeCache(storage, repo, n);
    return n;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- page ---------- */

function sessionStore() {
  try { return window.sessionStorage; } catch { return undefined; }
}

function renderCard(card) {
  const article = el('article', 'wb-card');
  const head = el('div', 'wb-head');
  head.append(el('h3', 'wb-title', card.title));
  article.append(head, el('p', 'wb-idea', card.idea));
  const tags = el('ul', 'wb-tags');
  tags.setAttribute('aria-label', 'Tools');
  for (const t of card.tags) tags.append(el('li', null, t));
  article.append(tags);
  return { article, head };
}

async function addStars(card, head, storage) {
  const n = await fetchStars(card.repo, { storage });
  if (!shouldShowStars(n)) return;
  const badge = el('span', 'wb-stars', formatStars(n));
  badge.setAttribute('aria-label', `${n} stars on GitHub`);
  head.append(badge);
}

function mount(root) {
  const grid = el('div', 'wb-grid');
  const storage = sessionStore();
  const articles = CARDS.map((card) => {
    const { article, head } = renderCard(card);
    grid.append(article);
    if (card.repo) addStars(card, head, storage);
    return article;
  });
  root.append(grid);
  articles.forEach((a, i) => reveal(a, { delay: i * 0.1 }));
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('workbench-root');
  if (root) mount(root);
}
