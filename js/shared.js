/*
 * shared.js — small helpers every section module can import.
 *
 *   import { reveal, playWhenVisible, onFrame, prefs } from './shared.js';
 *
 * The same API is also exposed as `window.Stallion` (set by main.js) for
 * quick use from the console or non-module scripts.
 *
 * The first part of this file is pure logic (no DOM access at import time),
 * so it can be tested with `node --test`.
 */

/* ---------- pure logic ---------- */

/** Viewports at or below this width (CSS px) get the phone video rendition. */
export const PHONE_MAX_WIDTH = 900;

/**
 * Decide which video rendition and which poster a background video uses.
 * @param {{width:number, coarse?:boolean, reducedMotion?:boolean, saveData?:boolean, reducedData?:boolean}} env
 * @returns {{video: 'desktop'|'phone'|null, poster: 'desktop'|'phone'}}
 *   video null means "show the poster only, never load the video".
 */
export function pickRendition({ width, coarse = false, reducedMotion = false, saveData = false, reducedData = false }) {
  const small = width <= PHONE_MAX_WIDTH || coarse;
  const size = small ? 'phone' : 'desktop';
  const posterOnly = reducedMotion || saveData || reducedData;
  return { video: posterOnly ? null : size, poster: size };
}

/** File URLs for a clip name (e.g. "gpu-3") under assets/video/. */
export function videoUrls(name, size, dir = 'assets/video') {
  return {
    src: `${dir}/${name}-${size}.mp4`,
    poster: size === 'phone' ? `${dir}/${name}-phone.jpg` : `${dir}/${name}.jpg`,
  };
}

/** Split text into word and whitespace tokens, keeping every character. */
export function splitWords(text) {
  return text.split(/(\s+)/).filter(Boolean);
}

/**
 * How many of `count` words are lit, given how far a block has scrolled into view.
 * top/height: the block's bounding rect; vh: viewport height.
 */
export function litWordCount({ top, height, vh, count }) {
  const p = (vh * 0.85 - top) / (height + vh * 0.35);
  return Math.round(Math.min(Math.max(p, 0), 1) * count);
}

/* ---------- notes index (notes/index.json, ticket 05) ----------
 *
 * { "resources": { "<id>": { "kind": "book"|"course", "title"?, "author"?,
 *                            "chapters": [{ "n": "02", "slug": "…", "title": "…" }] } } }
 * A book's id is its ISBN from books.json; a course's is a short id ("cs229").
 */

/** The index entry for a Resource, or null when it has no notes. */
export function notesFor(index, id) {
  const resources = index && index.resources;
  if (!resources || !id || !Object.hasOwn(resources, id)) return null;
  const entry = resources[id];
  return entry && Array.isArray(entry.chapters) && entry.chapters.length ? entry : null;
}

/** Id of the first of a learning topic's Resources (ISBN or course id) that has notes, or null. */
export function notesIdForTopic(index, resources) {
  for (const r of resources || []) {
    const id = r && (r.isbn || r.id);
    if (notesFor(index, id)) return id;
  }
  return null;
}

/** Reader URL for a Resource's notes, or for one chapter (`n` like "02"). */
export function noteUrl(id, n) {
  const q = new URLSearchParams({ r: id });
  if (n) q.set('c', n);
  return `notes.html?${q}`;
}

/** A Resource as the reader shows it; a book's title and author come from books.json. */
export function resolveNoteResource(id, entry, books = []) {
  const book = entry.kind === 'book' ? books.find((b) => b.isbn === id) : null;
  return {
    id,
    kind: entry.kind,
    title: (book && book.title) || entry.title || id,
    author: (book && book.author) || entry.author || '',
    chapters: entry.chapters || [],
  };
}

/* ---------- browser helpers ---------- */

let notesIndexPromise;

/** notes/index.json, fetched once and shared. Resolves to an empty index if it can't load. */
export function loadNotesIndex() {
  if (!notesIndexPromise) {
    notesIndexPromise = fetch('notes/index.json', { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(`notes/index.json: ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        console.warn('Notes: could not load the index', err);
        return { resources: {} };
      });
  }
  return notesIndexPromise;
}

let booksPromise;

/**
 * books.json, fetched once and shared by every section.
 * Rejects when it can't load; callers pick their own fallback.
 */
export function loadBooks() {
  if (!booksPromise) {
    booksPromise = fetch('books.json', { cache: 'no-cache' }).then((res) => {
      if (!res.ok) throw new Error(`books.json: ${res.status}`);
      return res.json();
    });
  }
  return booksPromise;
}

/** createElement with an optional class and text (null/undefined/'' mean none). */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null && text !== '') node.textContent = text;
  return node;
}

const loading = new Map();

/** Load a pinned CDN script with SRI, once. Resolves when it has run. */
export function loadScript(src, integrity) {
  if (loading.has(src)) return loading.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    Object.assign(s, { src, integrity, async: true, crossOrigin: 'anonymous', referrerPolicy: 'no-referrer' });
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`${src} failed to load`));
    document.head.append(s);
  });
  loading.set(src, p);
  return p;
}

/** Add a pinned CDN stylesheet with SRI, once. */
export function loadStyle(href, integrity) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link');
  Object.assign(l, { rel: 'stylesheet', href, integrity, crossOrigin: 'anonymous', referrerPolicy: 'no-referrer' });
  document.head.append(l);
}

/* KaTeX 0.19.1 on cdnjs. Bump the version and both hashes together. */
const KATEX = {
  css: 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.19.1/katex.min.css',
  cssSri: 'sha512-cY01S0EQUwBvX+qFNs77UQcmePAaTnsTKoipGYgOQUXwCdqtQcW+bnxg5r9iFnFgMUEoGapXXOWUw8WlSoIdZw==',
  js: 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.19.1/katex.min.js',
  jsSri: 'sha512-qce0j+v3Ze4WEtoxsx79Qa+yFoD/F9LWbkwpyTTl2+vdCcCX18J3yozpT++S5PzN7fhUUxZje+Qk+u1LRT8RYA==',
};

/** Load KaTeX (pinned, SRI) once. Resolves to window.katex. */
export async function loadKatex() {
  if (window.katex) return window.katex;
  loadStyle(KATEX.css, KATEX.cssSri);
  await loadScript(KATEX.js, KATEX.jsSri);
  if (!window.katex) throw new Error('KaTeX missing');
  return window.katex;
}

let cachedPrefs;

/**
 * Visitor preferences, read once.
 *   reducedMotion — prefers-reduced-motion: reduce. All motion is off.
 *   saveData      — Save-Data header / prefers-reduced-data. Posters only.
 *   touch         — coarse pointer or no hover. No parallax, grain, tilt or dots.
 */
export function prefs() {
  if (cachedPrefs) return cachedPrefs;
  const mq = (q) => window.matchMedia(q).matches;
  const conn = navigator.connection || {};
  cachedPrefs = {
    reducedMotion: mq('(prefers-reduced-motion: reduce)'),
    saveData: conn.saveData === true || mq('(prefers-reduced-data: reduce)'),
    touch: mq('(pointer: coarse)') || mq('(hover: none)'),
  };
  return cachedPrefs;
}

let revealObserver;

/**
 * Fade an element (or every element of a list / selector) in when it scrolls into view.
 * Adds the `.rv` class if missing; `delay` (seconds) staggers it.
 * Under reduced motion the element is simply shown.
 */
export function reveal(target, { delay } = {}) {
  const els = typeof target === 'string' ? document.querySelectorAll(target)
    : target instanceof Element ? [target] : target;
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        revealObserver.unobserve(e.target);
      }
    }, { threshold: 0, rootMargin: '0px 0px -12% 0px' });
  }
  for (const el of els) {
    el.classList.add('rv');
    if (delay != null) el.style.setProperty('--d', `${delay}s`);
    if (prefs().reducedMotion) el.classList.add('is-in');
    else revealObserver.observe(el);
  }
}

let videoObserver;

/**
 * Wire a background <video data-video="name"> : pick poster + rendition, load
 * the source only when it nears the screen, play while visible, pause otherwise.
 */
export function playWhenVisible(video) {
  const p = prefs();
  const choice = pickRendition({
    width: window.innerWidth,
    coarse: p.touch,
    reducedMotion: p.reducedMotion,
    saveData: p.saveData,
  });
  const name = video.dataset.video;
  video.poster = videoUrls(name, choice.poster).poster;
  if (!choice.video) {
    video.removeAttribute('autoplay');
    return;
  }
  video.dataset.src = videoUrls(name, choice.video).src;
  video.muted = true;
  if (!videoObserver) {
    videoObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const v = e.target;
        if (e.isIntersecting) {
          if (!v.getAttribute('src')) v.src = v.dataset.src;
          v.play().catch(() => {});
        } else if (!v.paused) {
          v.pause();
        }
      }
    }, { threshold: 0.01 });
  }
  videoObserver.observe(video);
}

const frameCallbacks = [];
let frameQueued = false;

function runFrame() {
  frameQueued = false;
  const state = {
    y: window.scrollY,
    vh: window.innerHeight,
    max: document.documentElement.scrollHeight - window.innerHeight,
  };
  for (const fn of frameCallbacks) fn(state);
}

function queueFrame() {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(runFrame);
}

/**
 * Run `fn({y, vh, max})` once per animation frame after scroll or resize
 * (and once right away). Use it for scroll-linked effects.
 */
export function onFrame(fn) {
  if (!frameCallbacks.length) {
    window.addEventListener('scroll', queueFrame, { passive: true });
    window.addEventListener('resize', queueFrame);
  }
  frameCallbacks.push(fn);
  queueFrame();
}
