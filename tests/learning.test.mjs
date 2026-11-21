import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusLabel, resolveResource, shapeLearning, linkLabel } from '../js/learning.js';

test('each learning topic status has its human label', () => {
  assert.equal(statusLabel('started'), 'just started');
  assert.equal(statusLabel('deep'), 'deep in it');
  assert.equal(statusLabel('wrapping-up'), 'wrapping up');
});

const BOOKS = [
  { title: 'Introduction to Probability', author: 'Joseph K. Blitzstein & Jessica Hwang', shelf: 'want', isbn: '9781466575578' },
  { title: 'Linear Algebra Done Right', author: 'Sheldon Axler', shelf: 'want', isbn: '9783031410253' },
];

test('a resource with an ISBN takes its title and author from the reading list', () => {
  assert.deepEqual(resolveResource({ isbn: '9781466575578' }, BOOKS), {
    kind: 'book', title: 'Introduction to Probability', author: 'Joseph K. Blitzstein & Jessica Hwang', isbn: '9781466575578',
  });
});

test('a course or paper keeps its name and links out', () => {
  assert.deepEqual(resolveResource({ name: 'linux-rdma/perftest', url: 'https://github.com/linux-rdma/perftest' }, BOOKS), {
    kind: 'link', title: 'linux-rdma/perftest', url: 'https://github.com/linux-rdma/perftest',
  });
});

test('an ISBN missing from the reading list is dropped', () => {
  assert.equal(resolveResource({ isbn: '0000000000000' }, BOOKS), null);
});

test('a non-http link is never rendered as a link', () => {
  assert.equal(resolveResource({ name: 'x', url: 'javascript:alert(1)' }, BOOKS), null);
});

test('topics carry their status label and resolved resources', () => {
  const { topics } = shapeLearning({
    topics: [{ name: 'Probability', why: 'Because.', status: 'deep', resources: [{ isbn: '9781466575578' }, { isbn: 'nope' }] }],
  }, BOOKS);
  assert.deepEqual(topics, [{
    name: 'Probability', why: 'Because.', status: 'deep', label: 'deep in it',
    resources: [{ kind: 'book', title: 'Introduction to Probability', author: 'Joseph K. Blitzstein & Jessica Hwang', isbn: '9781466575578' }],
  }]);
});

test('a topic whose resource has notes carries that resource id for its ✎ Notes badge', () => {
  const index = { resources: { '9781466575578': { kind: 'book', chapters: [{ n: '01', slug: 'x', title: 'X' }] } } };
  const data = {
    topics: [
      { name: 'Probability', status: 'deep', resources: [{ name: 'Site', url: 'https://x.org' }, { isbn: '9781466575578' }] },
      { name: 'Ansible', status: 'started', resources: [{ name: 'Docs', url: 'https://docs.ansible.com' }] },
    ],
  };
  const { topics } = shapeLearning(data, BOOKS, index);
  assert.equal(topics[0].notes, '9781466575578');
  assert.equal('notes' in topics[1], false);
  assert.equal('notes' in shapeLearning(data, BOOKS).topics[0], false);
});

test('a topic marked learned moves to the Learned list', () => {
  const shaped = shapeLearning({
    topics: [{ name: 'Ansible', why: 'All of it.', status: 'learned', resources: [] }],
    learned: [{ name: 'Linear algebra', why: 'The basics.' }],
  }, BOOKS);
  assert.deepEqual(shaped.topics, []);
  assert.deepEqual(shaped.learned, [
    { name: 'Linear algebra', why: 'The basics.' },
    { name: 'Ansible', why: 'All of it.' },
  ]);
});

test('missing sections come back empty', () => {
  assert.deepEqual(shapeLearning({}, []), { topics: [], learned: [], radar: [] });
});

test('a radar item keeps at most 3 web links, labelled by site', () => {
  const { radar } = shapeLearning({
    radar: [{
      topic: 'LLM inference serving', hook: 'KV cache.',
      links: ['https://github.com/sgl-project/sglang', 'https://www.example.org/paper', 'ftp://x', 'https://a.dev/', 'https://b.dev/'],
    }],
  }, []);
  assert.deepEqual(radar, [{
    topic: 'LLM inference serving', hook: 'KV cache.',
    links: [
      { url: 'https://github.com/sgl-project/sglang', label: 'sgl-project/sglang' },
      { url: 'https://www.example.org/paper', label: 'example.org' },
      { url: 'https://a.dev/', label: 'a.dev' },
    ],
  }]);
});

test('a malformed http(s) URL is dropped instead of crashing the section', () => {
  const { radar } = shapeLearning({
    radar: [{ topic: 'T', links: ['https://', 'http://exa mple.com', 'https://ok.dev/x'] }],
  }, []);
  assert.deepEqual(radar[0].links, [{ url: 'https://ok.dev/x', label: 'ok.dev' }]);
  assert.equal(resolveResource({ name: 'x', url: 'https://' }, BOOKS), null);
});

test('linkLabel falls back to the raw string when it cannot parse the URL', () => {
  assert.equal(linkLabel('not a url'), 'not a url');
});
