import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByShelf, defaultShelf, shortTitle, emptyMessage, coverUrl } from '../js/reading.js';

const book = (title, shelf, extra = {}) => ({ title, author: 'A', shelf, isbn: '1', ...extra });

test('groupByShelf puts every book on its shelf, keeping file order', () => {
  const books = [book('A', 'read'), book('B', 'want'), book('C', 'read'), book('D', 'reading')];
  const s = groupByShelf(books);
  assert.deepEqual(s.reading.map((b) => b.title), ['D']);
  assert.deepEqual(s.read.map((b) => b.title), ['A', 'C']);
  assert.deepEqual(s.want.map((b) => b.title), ['B']);
});

test('groupByShelf gives empty shelves and ignores unknown shelves', () => {
  const s = groupByShelf([book('X', 'lost')]);
  assert.deepEqual(s, { reading: [], read: [], want: [] });
});

test('defaultShelf opens Currently reading when it has books', () => {
  assert.equal(defaultShelf(groupByShelf([book('A', 'read'), book('B', 'reading')])), 'reading');
});

test('defaultShelf falls back to Read when nothing is on the go', () => {
  assert.equal(defaultShelf(groupByShelf([book('A', 'read'), book('B', 'want')])), 'read');
  assert.equal(defaultShelf(groupByShelf([])), 'read');
});

test('shortTitle drops the subtitle after a colon or comma', () => {
  assert.equal(shortTitle('Hands-On Machine Learning with Scikit-Learn, Keras, and TensorFlow'), 'Hands-On Machine Learning with Scikit-Learn');
  assert.equal(shortTitle('Zero to One: Notes on Startups'), 'Zero to One');
  assert.equal(shortTitle('All of Statistics'), 'All of Statistics');
});

test('emptyMessage names the first Want to read book as next up', () => {
  const s = groupByShelf([book('A', 'read'), book('Zero to One: Notes', 'want'), book('Later', 'want')]);
  assert.equal(emptyMessage(s), 'Nothing on the go right now — next up: Zero to One.');
});

test('emptyMessage on other shelves', () => {
  assert.equal(emptyMessage(groupByShelf([]), 'want'), 'Nothing on this shelf yet.');
});

test('coverUrl uses Open Library by ISBN, 404 on a missing cover', () => {
  assert.equal(coverUrl({ isbn: '9780385512053' }), 'https://covers.openlibrary.org/b/isbn/9780385512053-M.jpg?default=false');
});

test('coverUrl prefers the cover override', () => {
  assert.equal(coverUrl({ isbn: '1', cover: 'https://covers.openlibrary.org/b/olid/OL1M-M.jpg' }), 'https://covers.openlibrary.org/b/olid/OL1M-M.jpg');
});

test('coverUrl is null with no ISBN and no override', () => {
  assert.equal(coverUrl({ title: 'X' }), null);
});

test('emptyMessage without any Want to read book', () => {
  assert.equal(emptyMessage(groupByShelf([book('A', 'read')])), 'Nothing on the go right now.');
});
