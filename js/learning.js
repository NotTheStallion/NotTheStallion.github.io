/*
 * learning.js — Currently learning section (ticket 03).
 *
 * Renders learning.json into #learning-root:
 *   - Learning topic cards (name, why, status label, Resources)
 *   - "On the radar" strip (Radar items: topic, hook, 1–3 links)
 *   - a collapsed "Learned" list, left out when empty
 * and a faint background of drifting KaTeX formulas behind the scene.
 *
 * The top of the file is pure logic (no DOM at import time), tested in
 * tests/learning.test.mjs. Rendering starts at the bottom, in the browser only.
 */
import { reveal, prefs, el, loadKatex, loadBooks, loadNotesIndex, notesIdForTopic, noteUrl } from './shared.js';

/* ---------- pure logic ---------- */

const STATUS_LABELS = { started: 'just started', deep: 'deep in it', 'wrapping-up': 'wrapping up' };

/** Human label for a Learning topic status. */
export function statusLabel(status) {
  return STATUS_LABELS[status];
}

/** True for absolute http(s) URLs, the only links the section renders. */
function isWebUrl(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Turn a Resource into what a topic card shows.
 * A book is referred to by ISBN and its title/author come from books.json;
 * a course or paper has a name and a public URL.
 * @returns {{kind:'book', title, author, isbn} | {kind:'link', title, url} | null}
 */
export function resolveResource(resource, books) {
  if (resource.isbn) {
    const book = books.find((b) => b.isbn === resource.isbn);
    return book ? { kind: 'book', title: book.title, author: book.author, isbn: book.isbn } : null;
  }
  if (!resource.name || !isWebUrl(resource.url)) return null;
  return { kind: 'link', title: resource.name, url: resource.url };
}

/** Short label for a link: "owner/repo" on GitHub, otherwise the site name. */
export function linkLabel(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return String(url);
  }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'github.com') {
    const parts = u.pathname.split('/').filter(Boolean).slice(0, 2);
    if (parts.length) return parts.join('/');
  }
  return host;
}

/**
 * Shape learning.json (+ books.json) into what the section renders.
 * A topic whose status is "learned" joins the Learned list.
 * With the notes index, a topic whose Resource (book ISBN or course `id`)
 * has notes gets `notes: <resource id>` for its ✎ Notes badge.
 */
export function shapeLearning(data, books, notesIndex) {
  const topics = [];
  const learned = (data.learned || []).map(({ name, why }) => ({ name, why }));
  for (const t of data.topics || []) {
    if (t.status === 'learned') {
      learned.push({ name: t.name, why: t.why });
      continue;
    }
    const topic = {
      name: t.name,
      why: t.why,
      status: t.status,
      label: statusLabel(t.status),
      resources: (t.resources || []).map((r) => resolveResource(r, books)).filter(Boolean),
    };
    const notes = notesIdForTopic(notesIndex, t.resources);
    if (notes) topic.notes = notes;
    topics.push(topic);
  }
  const radar = (data.radar || []).map(({ topic, hook, links = [] }) => ({
    topic,
    hook,
    links: links.filter(isWebUrl).slice(0, 3).map((url) => ({ url, label: linkLabel(url) })),
  }));
  return { topics, learned, radar };
}

/**
 * Background formulas, picked to echo the topics: ML maths plus the
 * performance laws behind GPU clusters, storage and collectives.
 */
export const FORMULAS = [
  String.raw`\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\!\left(\frac{QK^{\top}}{\sqrt{d_k}}\right)V`,
  String.raw`B_{\mathrm{bus}} = B_{\mathrm{alg}}\cdot\frac{2(n-1)}{n}`,
  String.raw`P = \min\left(\pi,\ \beta\cdot I\right)`,
  String.raw`\theta_{t+1}=\theta_t-\eta\,\nabla_{\theta}\mathcal{L}(\theta_t)`,
  String.raw`P(A\mid B)=\frac{P(B\mid A)\,P(A)}{P(B)}`,
  String.raw`\mathrm{softmax}(z)_i=\frac{e^{z_i}}{\sum_j e^{z_j}}`,
  String.raw`D_{\mathrm{KL}}(P\,\|\,Q)=\sum_x P(x)\log\frac{P(x)}{Q(x)}`,
  String.raw`S(n)=\frac{1}{(1-p)+p/n}`,
  String.raw`L=\lambda W`,
  String.raw`H(p,q)=-\sum_x p(x)\log q(x)`,
];

/* ---------- rendering ---------- */

function outLink(url, text, className) {
  const a = el('a', className, text);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function renderResource(r) {
  const li = el('li', `lrn-res lrn-res--${r.kind}`);
  if (r.kind === 'book') {
    li.append(el('span', 'lrn-res-kind', 'Book'), el('cite', 'lrn-res-title', r.title));
    if (r.author) li.append(el('span', 'lrn-res-by', ` — ${r.author}`));
  } else {
    const a = outLink(r.url, r.title, 'lrn-res-title');
    a.append(el('span', 'lrn-arrow', ' ↗'));
    li.append(a);
  }
  return li;
}

function renderTopic(t) {
  const card = el('article', 'lrn-card');
  card.dataset.topic = t.name;
  if (t.status) card.dataset.status = t.status;
  // Header row: name + status, then a ✎ Notes badge when a Resource has notes.
  const head = el('header', 'lrn-card-head');
  head.append(el('h3', 'lrn-name', t.name));
  if (t.label) head.append(el('span', 'lrn-status', t.label));
  if (t.notes) {
    const badge = el('a', 'notes-badge', '✎ Notes');
    badge.href = noteUrl(t.notes);
    badge.setAttribute('aria-label', `Notes for ${t.name}`);
    head.append(badge);
  }
  card.append(head);
  if (t.why) card.append(el('p', 'lrn-why', t.why));
  if (t.resources.length) {
    const ul = el('ul', 'lrn-resources');
    ul.setAttribute('aria-label', 'Resources');
    t.resources.forEach((r) => ul.append(renderResource(r)));
    card.append(ul);
  }
  return card;
}

function renderRadar(items) {
  const wrap = el('section', 'lrn-radar');
  wrap.setAttribute('aria-labelledby', 'lrn-radar-title');
  const h = el('h3', 'lrn-sub', 'On the radar');
  h.id = 'lrn-radar-title';
  const list = el('ul', 'lrn-radar-list');
  for (const item of items) {
    const li = el('li', 'lrn-radar-item');
    li.append(el('h4', 'lrn-radar-topic', item.topic));
    if (item.hook) li.append(el('p', 'lrn-radar-hook', item.hook));
    if (item.links.length) {
      const links = el('div', 'lrn-radar-links');
      item.links.forEach((l) => links.append(outLink(l.url, `${l.label} ↗`, 'lrn-radar-link')));
      li.append(links);
    }
    list.append(li);
  }
  wrap.append(h, list);
  return wrap;
}

function renderLearned(items) {
  const details = el('details', 'lrn-learned');
  details.append(el('summary', 'lrn-sub', `Learned (${items.length})`));
  const ul = el('ul', 'lrn-learned-list');
  for (const t of items) {
    const li = el('li');
    li.append(el('strong', null, t.name));
    if (t.why) li.append(el('span', 'lrn-learned-why', ` — ${t.why}`));
    ul.append(li);
  }
  details.append(ul);
  return details;
}

function render(root, { topics, radar, learned }) {
  if (topics.length) {
    const grid = el('div', 'lrn-grid');
    topics.forEach((t) => grid.append(renderTopic(t)));
    root.append(grid);
    [...grid.children].forEach((c, i) => reveal(c, { delay: (i % 3) * 0.08 }));
  }
  if (radar.length) {
    const r = renderRadar(radar);
    root.append(r);
    reveal(r);
  }
  if (learned.length) {
    const l = renderLearned(learned);
    root.append(l);
    reveal(l);
  }
}

/* ---------- drifting formulas ---------- */

// Where each formula sits (% of the scene) and how it drifts (px).
const SPOTS = [
  { x: 4, y: 6, dx: 40, dy: 18, gold: true },
  { x: 58, y: 4, dx: -36, dy: 22 },
  { x: 70, y: 22, dx: -28, dy: -20, gold: true },
  { x: 8, y: 30, dx: 34, dy: -16 },
  { x: 46, y: 40, dx: -30, dy: 24 },
  { x: 74, y: 56, dx: 26, dy: -22, gold: true },
  { x: 6, y: 58, dx: 30, dy: 20, gold: true },
  { x: 38, y: 72, dx: -34, dy: -18 },
  { x: 80, y: 82, dx: -24, dy: 16 },
  { x: 14, y: 88, dx: 28, dy: -14, gold: true },
];

async function startFormulas(scene) {
  const { reducedMotion, touch } = prefs();
  const phone = touch || window.innerWidth <= 600;
  const sky = el('div', 'lrn-sky');
  sky.setAttribute('aria-hidden', 'true');
  let katex;
  try {
    katex = await loadKatex();
  } catch {
    return; // no formulas rather than raw LaTeX
  }
  const count = phone ? 6 : FORMULAS.length;
  for (let i = 0; i < count; i++) {
    const spot = SPOTS[i];
    const f = el('div', `lrn-f${spot.gold ? ' lrn-f--gold' : ''}`);
    f.style.left = `${phone ? Math.min(spot.x, 40) : spot.x}%`;
    f.style.top = `${spot.y}%`;
    f.style.setProperty('--dx', `${spot.dx}px`);
    f.style.setProperty('--dy', `${spot.dy}px`);
    f.style.setProperty('--dur', `${38 + (i % 4) * 9}s`);
    f.style.setProperty('--delay', `${-i * 5}s`);
    try {
      katex.render(FORMULAS[i], f, { throwOnError: false, displayMode: false, output: 'html' });
    } catch {
      continue;
    }
    sky.append(f);
  }
  scene.prepend(sky);
  if (reducedMotion) return; // CSS also keeps it still
  sky.classList.add('lrn-sky--moving');
  // Only animate while the scene is on screen.
  new IntersectionObserver(([e]) => {
    sky.classList.toggle('lrn-sky--paused', !e.isIntersecting);
  }).observe(scene);
}

/* ---------- boot ---------- */

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function init() {
  const root = document.getElementById('learning-root');
  if (!root) return;
  const scene = root.closest('.scene') || root.parentElement;
  // Save-Data: no KaTeX download for a decorative background (same as videos).
  if (!prefs().saveData) startFormulas(scene);
  let data;
  try {
    data = await getJson('learning.json');
  } catch (err) {
    console.warn('Currently learning: could not load learning.json', err);
    return;
  }
  const [books, notesIndex] = await Promise.all([
    loadBooks().catch(() => []),
    loadNotesIndex(),
  ]);
  try {
    render(root, shapeLearning(data, Array.isArray(books) ? books : [], notesIndex));
  } catch (err) {
    root.replaceChildren(el('p', 'lrn-error', 'This section could not be shown right now.'));
    console.warn('Currently learning: could not render', err);
  }
}

if (typeof document !== 'undefined') init();
