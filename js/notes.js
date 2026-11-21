/*
 * notes.js — the notes reader (notes.html, ticket 05).
 *
 *   notes.html                 → notes index (every Resource with its chapters)
 *   notes.html?r=<id>          → the index, narrowed to one Resource
 *   notes.html?r=<id>&c=<nn>   → one Note: notes/<id>/<nn>-<slug>.md
 *
 * Notes are plain Markdown listed in notes/index.json. They are rendered with
 * marked + KaTeX (pinned on cdnjs, SRI). Math is pulled out of the Markdown
 * BEFORE marked parses it and put back afterwards, so `\\`, `_…_` and `*`
 * inside formulas survive, and "$5" in prose stays a price.
 *
 * The top of the file is pure logic (no DOM at import time), tested in
 * tests/notes.test.mjs. Rendering starts further down, in the browser only.
 */
import {
  el, loadKatex, loadScript, loadBooks, loadNotesIndex, notesFor, resolveNoteResource, noteUrl,
} from './shared.js';

/* ---------- pure logic: math extraction ---------- */

// Placeholders use private-use characters, which Markdown never touches
// and an author never types.
const PH_OPEN = '';
const PH_CLOSE = '';

/*
 * Block structure, just enough to know which lines are code.
 * Each line start is looked at for: blockquote markers (`> `), list items
 * (`- `, `1. `), indented code (4+ columns past its container) and fences.
 * A fence inside a blockquote or a list item ends with its container.
 */

const LIST_MARKER = /^([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/;

/** Index of the end of the line starting at `i` (its '\n', or md.length). */
function lineEndAt(md, i) {
  const nl = md.indexOf('\n', i);
  return nl === -1 ? md.length : nl;
}

/** Leading whitespace of `s`: its width in columns (tab stop 4) and length in chars. */
function indentOf(s) {
  let col = 0;
  let k = 0;
  for (; k < s.length; k++) {
    if (s[k] === ' ') col++;
    else if (s[k] === '\t') col += 4 - (col % 4);
    else break;
  }
  return { col, k };
}

/** Strip up to `depth` blockquote markers (all of them when depth is Infinity). */
function stripQuotes(line, depth = Infinity) {
  let rest = line;
  let n = 0;
  while (n < depth) {
    const m = /^ {0,3}> ?/.exec(rest);
    if (!m) break;
    rest = rest.slice(m[0].length);
    n++;
  }
  return { depth: n, rest };
}

/** A fence opening `s` (already past its container's indent), or null. */
function fenceOpen(s) {
  const m = FENCE_OPEN.exec(s);
  // A backtick fence's info string cannot contain backticks (CommonMark):
  // "```js```" on one line is a code span, not a fence.
  if (!m || (m[1][0] === '`' && m[2].includes('`'))) return null;
  return m[1];
}

/**
 * End of a fenced block whose opening line ends at `from`: the end of its
 * closing line, or of the last line still inside its container.
 * quote: blockquote depth; col: the container's content column.
 */
function fenceEnd(md, from, { fence, quote, col }) {
  let end = from;
  while (end < md.length) {
    const start = end + 1;
    const lineEnd = lineEndAt(md, start);
    const line = md.slice(start, lineEnd);
    const q = quote ? stripQuotes(line, quote) : { depth: 0, rest: line };
    if (q.depth < quote) return end; // the blockquote ended
    const ind = indentOf(q.rest);
    const blank = !q.rest.trim();
    if (col > 0 && !blank && ind.col < col) return end; // the list item ended
    const close = /^(`{3,}|~{3,})\s*$/.exec(q.rest.slice(ind.k));
    if (close && ind.col - col <= 3 && close[1][0] === fence[0] && close[1].length >= fence.length) {
      return lineEnd;
    }
    end = lineEnd;
  }
  return md.length;
}

/**
 * Look at the line starting at `i`: when it opens a code block (fenced or
 * indented), return the index where that code ends; otherwise -1.
 * `st` carries block state from line to line.
 */
function codeBlockEnd(md, i, st) {
  const lineEnd = lineEndAt(md, i);
  const { depth, rest } = stripQuotes(md.slice(i, lineEnd));
  if (depth !== st.quote) Object.assign(st, { quote: depth, list: -1, blank: true, code: false });
  if (!rest.trim()) {
    st.blank = true;
    return -1;
  }
  const ind = indentOf(rest);
  const text = rest.slice(ind.k);
  const marker = LIST_MARKER.exec(text);
  if (st.list >= 0 && ind.col < st.list && st.blank && !marker) st.list = -1; // left the list
  const base = st.list >= 0 && ind.col >= st.list ? st.list : 0;
  const rel = ind.col - base;
  // Indented code cannot interrupt a paragraph.
  if (rel >= 4 && (st.blank || st.code)) {
    Object.assign(st, { blank: false, code: true });
    return lineEnd;
  }
  st.code = false;
  st.blank = false;
  if (rel > 3) return -1;
  let fenceText = text;
  let col = base;
  if (marker) {
    const pad = marker[2] ? indentOf(marker[2]).col : 1;
    col = ind.col + marker[1].length + (pad > 4 ? 1 : pad);
    st.list = col;
    fenceText = text.slice(marker[0].length);
  }
  const fence = fenceOpen(fenceText);
  return fence ? fenceEnd(md, lineEnd, { fence, quote: depth, col }) : -1;
}

/** Closing index of an inline `$…$` opening at `i` (Pandoc rules), or -1. */
function inlineMathEnd(md, i) {
  const first = md[i + 1];
  if (first === undefined || /\s|\$/.test(first)) return -1;
  for (let k = i + 1; k < md.length; k++) {
    if (md[k] === '\\') { k++; continue; }
    if (md[k] === '\n' && md[k + 1] === '\n') return -1;
    if (md[k] !== '$') continue;
    // No space before the closing $, no digit right after it ("$5 or $10").
    if (/\s/.test(md[k - 1]) || /\d/.test(md[k + 1] || '')) return -1;
    return k;
  }
  return -1;
}

/**
 * Pull `$…$` and `$$…$$` out of Markdown before it is parsed.
 * Code spans, fenced code and `\$` are left alone.
 * @returns {{text: string, math: {tex: string, display: boolean}[]}}
 *   text has a placeholder where each formula was.
 */
export function extractMath(md) {
  const math = [];
  let out = '';
  let i = 0;
  const put = (tex, display) => {
    out += `${PH_OPEN}${math.length}${PH_CLOSE}`;
    math.push({ tex, display });
  };
  const block = { quote: 0, list: -1, blank: true, code: false };
  while (i < md.length) {
    if (i === 0 || md[i - 1] === '\n') {
      const end = codeBlockEnd(md, i, block);
      if (end !== -1) {
        out += md.slice(i, end);
        i = end;
        continue;
      }
    }
    const ch = md[i];
    if (ch === '\\') {
      out += md.slice(i, i + 2);
      i += 2;
    } else if (ch === '`') {
      const run = /^`+/.exec(md.slice(i))[0];
      const close = new RegExp(`(?<!\`)${run}(?!\`)`, 'g');
      close.lastIndex = i + run.length;
      const m = close.exec(md);
      const end = m ? m.index + run.length : i + run.length;
      out += md.slice(i, end);
      i = end;
    } else if (ch === '$' && md[i + 1] === '$') {
      const j = md.indexOf('$$', i + 2);
      if (j > i + 2) {
        put(md.slice(i + 2, j).trim(), true);
        i = j + 2;
      } else {
        out += '$$';
        i += 2;
      }
    } else if (ch === '$') {
      const k = inlineMathEnd(md, i);
      if (k !== -1) {
        put(md.slice(i + 1, k), false);
        i = k + 1;
      } else {
        out += '$';
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return { text: out, math };
}

/**
 * Put rendered formulas back into the HTML marked produced.
 * A display formula alone in a paragraph becomes a <div class="math-display">
 * box (it scrolls sideways on its own when too wide).
 * @param {(tex: string, display: boolean) => string} render
 */
export function restoreMath(html, math, render) {
  const ph = `${PH_OPEN}(\\d+)${PH_CLOSE}`;
  // Inside a tag (an img alt, a link title) a formula goes back as its
  // escaped TeX source: KaTeX HTML there would break the attribute.
  const asText = (whole, n) => {
    const m = math[n];
    if (!m) return whole;
    const d = m.display ? '$$' : '$';
    return `${d}${m.tex}${d}`.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  return html
    .replace(/<[^>]*>/g, (tag) => tag.replace(new RegExp(ph, 'g'), asText))
    .replace(new RegExp(`<p>\\s*${ph}\\s*</p>`, 'g'), (whole, n) => {
      const m = math[n];
      return m && m.display ? `<div class="math-display">${render(m.tex, true)}</div>` : whole;
    })
    .replace(new RegExp(ph, 'g'), (whole, n) => {
      const m = math[n];
      return m ? render(m.tex, m.display) : whole;
    });
}

/* ---------- pure logic: URL and index ---------- */

const RESOURCE_ID = /^[A-Za-z0-9-]{1,40}$/;
const CHAPTER_N = /^\d{2,3}$/;

/**
 * Which page the query string asks for.
 * @returns {{view:'index'} | {view:'resource', r} | {view:'note', r, c} | {view:'bad'}}
 */
export function parseNoteParams(search) {
  const q = new URLSearchParams(search);
  const r = q.get('r');
  const c = q.get('c');
  if (r == null && c == null) return { view: 'index' };
  if (r == null || !RESOURCE_ID.test(r)) return { view: 'bad' };
  if (c == null) return { view: 'resource', r };
  if (!CHAPTER_N.test(c)) return { view: 'bad' };
  return { view: 'note', r, c };
}

/**
 * Look a note up in the index, with the chapters before and after it.
 * @returns {{entry, chapter, prev, next} | null}
 */
export function findNote(index, r, c) {
  const entry = index && index.resources && Object.hasOwn(index.resources, r) ? index.resources[r] : null;
  const chapters = (entry && entry.chapters) || [];
  const i = chapters.findIndex((ch) => ch.n === c);
  if (i === -1) return null;
  return { entry, chapter: chapters[i], prev: chapters[i - 1] || null, next: chapters[i + 1] || null };
}

/** Where a note's Markdown lives. */
export function notePath(r, chapter) {
  return `notes/${r}/${chapter.n}-${chapter.slug}.md`;
}

/* ---------- browser: libraries ---------- */

/* marked 18.1.3 on cdnjs. Bump the version and the hash together. */
const MARKED = {
  js: 'https://cdnjs.cloudflare.com/ajax/libs/marked/18.1.3/lib/marked.umd.min.js',
  sri: 'sha512-aGS0R+ig5xP86FA70qY4Rk8EstGqd6T0r60hdSAIEMN4LicYom0kwwNl6IsqQ3lYHEGsgQI0cmIRpUBl9vSpmw==',
};

async function loadMarked() {
  if (!window.marked) await loadScript(MARKED.js, MARKED.sri);
  if (!window.marked) throw new Error('marked missing');
  return window.marked;
}

/** Markdown with $…$ / $$…$$ maths → HTML. */
function renderNote(md, marked, katex) {
  const { text, math } = extractMath(md);
  const html = marked.parse(text, { gfm: true });
  return restoreMath(html, math, (tex, displayMode) =>
    katex.renderToString(tex, { displayMode, throwOnError: false, output: 'htmlAndMathml' }));
}

/* ---------- browser: rendering ---------- */

const LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/';

function link(href, text, className) {
  const a = el('a', className, text);
  a.href = href;
  return a;
}

const KIND_LABEL = { book: 'Book', course: 'Course' };

function chapterLabel(kind) {
  return kind === 'course' ? 'Lecture' : 'Chapter';
}

/** A short "something went wrong" page, always with a way back. */
function showProblem(main, title, text) {
  document.title = 'Notes · The Stallion';
  const box = el('section', 'nt-problem');
  box.append(el('h1', 'nt-title', title), el('p', 'nt-lead', text));
  const p = el('p');
  p.append(link('notes.html', '← All notes'));
  box.append(p);
  main.replaceChildren(box);
}

function resourceBlock(res, { headingLevel = 'h2' } = {}) {
  const section = el('section', 'nt-res');
  section.id = `r-${res.id}`;
  section.append(el('p', 'nt-kind', KIND_LABEL[res.kind] || 'Resource'));
  const h = el(headingLevel, 'nt-res-title');
  h.append(link(`notes.html?r=${encodeURIComponent(res.id)}`, res.title));
  section.append(h);
  if (res.author) section.append(el('p', 'nt-res-by', res.author));
  const ol = el('ol', 'nt-toc');
  for (const ch of res.chapters) {
    const li = el('li');
    const a = link(noteUrl(res.id, ch.n), '');
    a.append(el('span', 'nt-toc-n', ch.n), el('span', 'nt-toc-t', ch.title));
    li.append(a);
    ol.append(li);
  }
  section.append(ol);
  return section;
}

function showIndex(main, index, books) {
  document.title = 'Notes · The Stallion';
  const wrap = el('div', 'nt-index');
  wrap.append(
    el('p', 'nt-label', 'Study notes'),
    el('h1', 'nt-title', 'Notes'),
    el('p', 'nt-lead', 'Chapter notes on the books and courses I study: summaries, key results, formulas and my own derivations. Free to reuse under CC BY 4.0.'),
  );
  const ids = Object.keys((index && index.resources) || {}).filter((id) => notesFor(index, id));
  if (!ids.length) wrap.append(el('p', 'nt-empty', 'No notes published yet.'));
  for (const id of ids) wrap.append(resourceBlock(resolveNoteResource(id, index.resources[id], books)));
  main.replaceChildren(wrap);
}

function showResource(main, index, books, r) {
  const entry = notesFor(index, r);
  if (!entry) {
    showProblem(main, 'No notes here', 'There are no notes for that book or course yet.');
    return;
  }
  const res = resolveNoteResource(r, entry, books);
  document.title = `${res.title} · Notes · The Stallion`;
  const wrap = el('div', 'nt-index');
  const back = el('p', 'nt-label');
  back.append(link('notes.html', '← All notes'));
  wrap.append(back, resourceBlock(res, { headingLevel: 'h1' }));
  main.replaceChildren(wrap);
}

/** Chapter list for the sidebar / drawer. */
function fillSidebar(nav, res, current) {
  const head = el('p', 'nt-side-res');
  head.append(link(`notes.html?r=${encodeURIComponent(res.id)}`, res.title));
  const ol = el('ol', 'nt-side-list');
  for (const ch of res.chapters) {
    const li = el('li');
    const a = link(noteUrl(res.id, ch.n), '');
    a.append(el('span', 'nt-toc-n', ch.n), el('span', 'nt-toc-t', ch.title));
    if (ch.n === current) a.setAttribute('aria-current', 'page');
    li.append(a);
    ol.append(li);
  }
  const all = el('p', 'nt-side-all');
  all.append(link('notes.html', '← All notes'));
  nav.querySelector('.nt-side-body').replaceChildren(head, ol, all);
}

/** ← previous / next → links; nothing when the note is the only one. */
function pager(res, prev, next) {
  if (!prev && !next) return '';
  const nav = el('nav', 'nt-pager');
  nav.setAttribute('aria-label', `Previous and next ${chapterLabel(res.kind).toLowerCase()}`);
  const side = (ch, dir) => {
    if (!ch) return el('span', `nt-pager-${dir} nt-pager-none`);
    const a = link(noteUrl(res.id, ch.n), '', `nt-pager-${dir}`);
    a.rel = dir;
    a.append(
      el('small', null, dir === 'prev' ? '← previous' : 'next →'),
      el('span', null, `${ch.n} · ${ch.title}`),
    );
    return a;
  };
  nav.append(side(prev, 'prev'), side(next, 'next'));
  return nav;
}

function licence() {
  const p = el('p', 'nt-licence');
  p.append('Notes by “The Stallion”, licensed ', link(LICENCE_URL, 'CC BY 4.0'),
    '. Reuse them freely with credit. Short quotes stay with their authors.');
  p.querySelector('a').rel = 'license';
  return p;
}

/** Give h2/h3 an id so sections can be linked. */
function anchorHeadings(body) {
  const seen = new Set();
  for (const h of body.querySelectorAll('h2, h3')) {
    let id = h.textContent.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'section';
    while (seen.has(id)) id += '-';
    seen.add(id);
    h.id = id;
  }
}

async function showNote(main, sidebar, index, books, r, c) {
  const found = findNote(index, r, c);
  if (!found) {
    showProblem(main, 'Note not found', 'That chapter has no notes (yet), or the link is wrong.');
    return false;
  }
  const res = resolveNoteResource(r, found.entry, books);
  fillSidebar(sidebar, res, c);
  document.title = `${found.chapter.title} · ${res.title} · Notes · The Stallion`;

  let html;
  try {
    const [md, marked, katex] = await Promise.all([
      fetch(notePath(r, found.chapter), { cache: 'no-cache' }).then((resp) => {
        if (!resp.ok) throw new Error(`${resp.status}`);
        return resp.text();
      }),
      loadMarked(),
      loadKatex(),
    ]);
    html = renderNote(md, marked, katex);
  } catch (err) {
    console.warn('Notes: could not render the note', err);
    showProblem(main, 'Could not load this note', 'Something went wrong fetching it. Try again in a moment.');
    return true;
  }

  const article = el('article', 'nt-note');
  const kicker = el('p', 'nt-label');
  kicker.append(`${chapterLabel(res.kind)} ${found.chapter.n} · `, link(`notes.html?r=${encodeURIComponent(r)}`, res.title));
  const body = el('div', 'nt-body');
  body.innerHTML = html;
  anchorHeadings(body);
  // Display maths sits in its own scroll box; let keyboard users scroll it too.
  for (const box of body.querySelectorAll('.math-display')) box.tabIndex = 0;
  article.append(kicker, body, pager(res, found.prev, found.next), licence());
  main.replaceChildren(article);
  if (location.hash) {
    let id = null;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      // A malformed hash ("#%E0") is just ignored.
    }
    if (id) document.getElementById(id)?.scrollIntoView();
  }
  return true;
}

/* ---------- browser: chapters drawer (phones) ---------- */

function setupDrawer(button, sidebar, scrim, main) {
  const phone = window.matchMedia('(max-width: 860px)');
  const closeBtn = sidebar.querySelector('.nt-side-close');
  let open = false;

  const focusables = () => [...sidebar.querySelectorAll('a[href], button')];

  function set(next, { restoreFocus = true } = {}) {
    open = next;
    button.setAttribute('aria-expanded', String(open));
    sidebar.classList.toggle('is-open', open);
    scrim.hidden = !open;
    document.body.classList.toggle('nt-drawer-open', open);
    main.inert = open;
    if (open) {
      (sidebar.querySelector('[aria-current="page"]') || closeBtn).focus();
    } else if (restoreFocus) {
      button.focus();
    }
  }

  button.addEventListener('click', () => set(!open));
  closeBtn.addEventListener('click', () => set(false));
  scrim.addEventListener('click', () => set(false));
  sidebar.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      set(false);
    } else if (e.key === 'Tab') {
      const f = focusables();
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') set(false);
  });
  phone.addEventListener('change', () => {
    if (open) set(false, { restoreFocus: false });
  });
}

/* ---------- boot ---------- */

async function init() {
  const main = document.getElementById('nt-main');
  const sidebar = document.getElementById('nt-sidebar');
  const button = document.getElementById('nt-chapters-btn');
  const scrim = document.getElementById('nt-scrim');
  const params = parseNoteParams(location.search);
  if (params.view === 'bad') {
    showProblem(main, 'Note not found', 'That link does not point at a note.');
    return;
  }
  const [index, books] = await Promise.all([
    loadNotesIndex(),
    loadBooks().catch(() => []),
  ]);
  const bookList = Array.isArray(books) ? books : [];
  if (params.view === 'index') return showIndex(main, index, bookList);
  if (params.view === 'resource') return showResource(main, index, bookList, params.r);
  const hasSidebar = await showNote(main, sidebar, index, bookList, params.r, params.c);
  if (!hasSidebar) return;
  document.body.classList.add('nt-has-sidebar');
  sidebar.hidden = false;
  button.hidden = false;
  setupDrawer(button, sidebar, scrim, main);
}

if (typeof document !== 'undefined') {
  init().catch((err) => {
    console.warn('Notes: could not start', err);
    const main = document.getElementById('nt-main');
    // Keep a note that did render; otherwise say what happened.
    if (main && !main.querySelector('.nt-note')) showProblem(main, 'Something went wrong', 'The notes could not be shown. Try again in a moment.');
  });
}
