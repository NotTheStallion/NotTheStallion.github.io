/*
 * reading.js — Reading shelves (ticket 02).
 *
 * Mount: <div id="reading-root"> inside the Reading scene (#reading).
 * Data:  books.json at the site root, fetched at runtime. A flat array of
 *        { title, author, shelf: 'reading'|'read'|'want', isbn, take?, cover? };
 *        file order is display order. Moving a book's `shelf` is all an update takes.
 * Look:  tabs (Currently reading · Read · Want to read, each with a gold count)
 *        over a vertically scrolling grid of covers. Styles: css/reading.css.
 *
 * Each cover sits in a `.rd-cv` box (position: relative); a book with notes in
 * notes/index.json (looked up by ISBN) gets a gold "✎ Notes" corner badge.
 *
 * The first part is pure logic (no DOM at import time) so `node --test` can load it.
 */
import { prefs, reveal, el, loadBooks, loadNotesIndex, notesFor, noteUrl } from './shared.js';

/* ---------- pure logic ---------- */

/** Shelf keys in tab order, with their tab names. */
export const SHELVES = [
  ['reading', 'Currently reading'],
  ['read', 'Read'],
  ['want', 'Want to read'],
];

const EMPTY_LEAD = 'Nothing on the go right now';

/** Sort books onto their shelves, keeping file order. Unknown shelves are dropped. */
export function groupByShelf(books) {
  const out = { reading: [], read: [], want: [] };
  for (const b of books) if (out[b.shelf]) out[b.shelf].push(b);
  return out;
}

/** The tab the page opens on: Currently reading if it has books, otherwise Read. */
export function defaultShelf(shelves) {
  return shelves.reading.length ? 'reading' : 'read';
}

/** Title without its subtitle (cut at the first colon or comma). */
export function shortTitle(title) {
  return title.split(/[:,]/)[0].trim();
}

/** The book shown as "next up" on an empty Currently reading shelf. */
export function nextUp(shelves) {
  return shelves.want[0] || null;
}

/** Plain-text message for an empty shelf (Currently reading unless `shelf` says otherwise). */
export function emptyMessage(shelves, shelf = 'reading') {
  if (shelf !== 'reading') return 'Nothing on this shelf yet.';
  const next = nextUp(shelves);
  return next ? `${EMPTY_LEAD} — next up: ${shortTitle(next.title)}.` : `${EMPTY_LEAD}.`;
}

/** Cover image URL: the `cover` override, else Open Library by ISBN (404 when missing). */
export function coverUrl(book) {
  if (book.cover) return book.cover;
  if (!book.isbn) return null;
  return `https://covers.openlibrary.org/b/isbn/${book.isbn}-M.jpg?default=false`;
}

/* ---------- rendering ---------- */

/** Title/author block drawn in CSS, used when a cover is missing. */
function placeholder(book) {
  const ph = el('div', 'rd-ph');
  ph.setAttribute('aria-hidden', 'true');
  ph.append(el('b', '', shortTitle(book.title)), el('span', '', book.author));
  return ph;
}

function coverBox(book) {
  const cv = el('div', 'rd-cv');
  const url = coverUrl(book);
  if (!url) {
    cv.append(placeholder(book));
    return cv;
  }
  const img = el('img', 'rd-cover');
  img.alt = '';
  img.width = 180;
  img.height = 270;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener('error', () => img.replaceWith(placeholder(book)), { once: true });
  img.src = url;
  cv.append(img);
  return cv;
}

function notesBadge(book) {
  const a = el('a', 'notes-badge rd-notes', '✎ Notes');
  a.href = noteUrl(book.isbn);
  a.setAttribute('aria-label', `Notes on ${shortTitle(book.title)}`);
  return a;
}

function card(book, i, notesIndex) {
  const li = el('li', 'rd-card');
  li.style.setProperty('--i', String(i));
  const cv = coverBox(book);
  if (notesFor(notesIndex, book.isbn)) cv.append(notesBadge(book));
  li.append(cv, el('h3', 'rd-title', shortTitle(book.title)), el('p', 'rd-author', book.author));
  if (book.shelf === 'read' && book.take) li.append(el('p', 'rd-take', book.take));
  return li;
}

function emptyState(shelves, shelf) {
  const box = el('div', 'rd-empty');
  const mark = el('span', 'rd-mark');
  mark.setAttribute('aria-hidden', 'true');
  box.append(mark);
  const p = el('p');
  const next = shelf === 'reading' && nextUp(shelves);
  if (next) {
    p.append(`${EMPTY_LEAD} — next up: `, el('em', '', shortTitle(next.title)), '.');
  } else {
    p.textContent = emptyMessage(shelves, shelf);
  }
  box.append(p);
  return box;
}

function mount(root, books, notesIndex) {
  const shelves = groupByShelf(books);
  let active = defaultShelf(shelves);

  const tabs = el('div', 'rd-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Shelves');

  const panel = el('div', 'rd-panel');
  panel.id = 'rd-panel';
  panel.setAttribute('role', 'tabpanel');
  panel.tabIndex = 0;

  const buttons = SHELVES.map(([key, name]) => {
    const b = el('button', 'rd-tab');
    b.type = 'button';
    b.id = `rd-tab-${key}`;
    b.dataset.shelf = key;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', panel.id);
    const n = shelves[key].length;
    b.setAttribute('aria-label', `${name}, ${n} ${n === 1 ? 'book' : 'books'}`);
    b.append(name, el('span', 'rd-count', String(n)));
    b.addEventListener('click', () => select(key));
    return b;
  });
  tabs.append(...buttons);

  tabs.addEventListener('keydown', (e) => {
    const i = SHELVES.findIndex(([k]) => k === active);
    const n = SHELVES.length;
    const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    select(SHELVES[to][0]);
    buttons[to].focus();
  });

  // `follow`: on phones, slide the tab row so the chosen tab is in view
  // (off for the first render, where it would jump the page).
  function select(key, follow = true) {
    active = key;
    for (const b of buttons) {
      const on = b.dataset.shelf === key;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && follow) tabs.scrollTo({ left: b.offsetLeft - 16, behavior: 'smooth' });
    }
    panel.setAttribute('aria-labelledby', `rd-tab-${key}`);
    const list = shelves[key];
    if (list.length) {
      const grid = el('ul', 'rd-grid');
      grid.append(...list.map((b, i) => card(b, i, notesIndex)));
      panel.replaceChildren(grid);
    } else {
      panel.replaceChildren(emptyState(shelves, key));
    }
  }

  const credit = el('p', 'rd-credit');
  credit.append('Covers: ');
  const a = el('a', '', 'Open Library');
  a.href = 'https://openlibrary.org/';
  a.rel = 'noopener';
  credit.append(a);

  root.replaceChildren(tabs, panel, credit);
  select(active, false);

  const { touch, reducedMotion } = prefs();
  if (!touch && !reducedMotion) root.classList.add('rd-tilt');
  reveal(root);
}

async function init() {
  const root = document.getElementById('reading-root');
  if (!root) return;
  try {
    const [books, notesIndex] = await Promise.all([loadBooks(), loadNotesIndex()]);
    mount(root, books, notesIndex);
  } catch (err) {
    root.replaceChildren(el('p', 'rd-error', 'The shelves could not be loaded right now.'));
    console.warn(err);
  }
}

if (typeof document !== 'undefined') init();
