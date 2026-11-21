import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickRendition, videoUrls, splitWords, litWordCount,
  notesFor, notesIdForTopic, noteUrl, resolveNoteResource,
} from '../js/shared.js';

/* ---------- notes index (ticket 05) ---------- */

const INDEX = {
  resources: {
    '9781108455145': { kind: 'book', chapters: [{ n: '02', slug: 'linear-algebra', title: 'Linear Algebra' }] },
    cs229: { kind: 'course', title: 'CS229', chapters: [{ n: '01', slug: 'intro', title: 'Intro' }] },
    empty: { kind: 'course', title: 'Nothing yet', chapters: [] },
  },
};

test('notesFor finds a resource that has notes, by ISBN or course id', () => {
  assert.equal(notesFor(INDEX, '9781108455145').chapters[0].slug, 'linear-algebra');
  assert.equal(notesFor(INDEX, 'cs229').title, 'CS229');
});

test('notesFor is null for unknown ids, empty resources and a missing index', () => {
  assert.equal(notesFor(INDEX, '0000000000000'), null);
  assert.equal(notesFor(INDEX, 'empty'), null);
  assert.equal(notesFor(null, 'cs229'), null);
  assert.equal(notesFor(INDEX, 'toString'), null);
});

test('a learning topic gets a notes badge when any of its resources has notes', () => {
  assert.equal(notesIdForTopic(INDEX, [{ name: 'Docs', url: 'https://x.org' }, { isbn: '9781108455145' }]), '9781108455145');
  assert.equal(notesIdForTopic(INDEX, [{ id: 'cs229', name: 'CS229', url: 'https://cs229.stanford.edu' }]), 'cs229');
  assert.equal(notesIdForTopic(INDEX, [{ name: 'Docs', url: 'https://x.org' }, { isbn: '9780000000000' }]), null);
  assert.equal(notesIdForTopic(INDEX, undefined), null);
});

test('noteUrl points at the reader, with or without a chapter', () => {
  assert.equal(noteUrl('9781108455145'), 'notes.html?r=9781108455145');
  assert.equal(noteUrl('cs229', '01'), 'notes.html?r=cs229&c=01');
});

test('a book resource takes its title and author from the reading list', () => {
  const books = [{ title: 'Mathematics for Machine Learning', author: 'M. P. Deisenroth et al.', isbn: '9781108455145' }];
  const r = resolveNoteResource('9781108455145', INDEX.resources['9781108455145'], books);
  assert.deepEqual(
    { id: r.id, kind: r.kind, title: r.title, author: r.author, n: r.chapters.length },
    { id: '9781108455145', kind: 'book', title: 'Mathematics for Machine Learning', author: 'M. P. Deisenroth et al.', n: 1 },
  );
  assert.equal(resolveNoteResource('cs229', INDEX.resources.cs229, books).title, 'CS229');
  assert.equal(resolveNoteResource('x', { kind: 'book', chapters: [] }, []).title, 'x');
});

test('desktop gets the desktop rendition', () => {
  assert.deepEqual(pickRendition({ width: 1440 }), { video: 'desktop', poster: 'desktop' });
});

test('narrow or touch screens get the phone rendition', () => {
  assert.equal(pickRendition({ width: 390 }).video, 'phone');
  assert.equal(pickRendition({ width: 1180, coarse: true }).video, 'phone');
});

test('reduced motion and save-data show posters only', () => {
  assert.deepEqual(pickRendition({ width: 1440, reducedMotion: true }), { video: null, poster: 'desktop' });
  assert.deepEqual(pickRendition({ width: 390, saveData: true }), { video: null, poster: 'phone' });
  assert.equal(pickRendition({ width: 1440, reducedData: true }).video, null);
});

test('video urls', () => {
  assert.deepEqual(videoUrls('gpu-3', 'desktop'), { src: 'assets/video/gpu-3-desktop.mp4', poster: 'assets/video/gpu-3.jpg' });
  assert.deepEqual(videoUrls('read', 'phone'), { src: 'assets/video/read-phone.mp4', poster: 'assets/video/read-phone.jpg' });
});

test('splitWords keeps every character', () => {
  const text = "I'm an engineer,  trained — early";
  const toks = splitWords(text);
  assert.equal(toks.join(''), text);
  assert.deepEqual(toks.filter((t) => t.trim()), ["I'm", 'an', 'engineer,', 'trained', '—', 'early']);
});

test('litWordCount is clamped to 0..count', () => {
  assert.equal(litWordCount({ top: 2000, height: 400, vh: 800, count: 50 }), 0);
  assert.equal(litWordCount({ top: -2000, height: 400, vh: 800, count: 50 }), 50);
  const mid = litWordCount({ top: 300, height: 400, vh: 800, count: 50 });
  assert.ok(mid > 0 && mid < 50);
});

/* ---------- books.json, fetched once for every section ---------- */

test('loadBooks fetches books.json once and shares the result', async (t) => {
  const { loadBooks } = await import('../js/shared.js');
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url);
    return { ok: true, json: async () => [{ isbn: '1' }] };
  });
  const [a, b] = await Promise.all([loadBooks(), loadBooks()]);
  assert.deepEqual(a, [{ isbn: '1' }]);
  assert.equal(a, b);
  assert.deepEqual(await loadBooks(), [{ isbn: '1' }]);
  assert.deepEqual(urls, ['books.json']);
});
