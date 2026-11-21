import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMath, restoreMath, parseNoteParams, findNote, notePath } from '../js/notes.js';

/* ---------- which page the URL asks for ---------- */

test('no params shows the notes index', () => {
  assert.deepEqual(parseNoteParams(''), { view: 'index' });
});

test('?r= narrows the index to one resource; ?r=&c= opens one note', () => {
  assert.deepEqual(parseNoteParams('?r=9781108455145'), { view: 'resource', r: '9781108455145' });
  assert.deepEqual(parseNoteParams('?r=cs229&c=03'), { view: 'note', r: 'cs229', c: '03' });
});

test('malformed params are reported, not passed on to a fetch', () => {
  assert.equal(parseNoteParams('?r=../secret&c=01').view, 'bad');
  assert.equal(parseNoteParams('?r=cs229&c=1x').view, 'bad');
  assert.equal(parseNoteParams('?c=01').view, 'bad');
});

/* ---------- looking a note up, with its neighbours ---------- */

const INDEX = {
  resources: {
    cs229: {
      kind: 'course', title: 'CS229',
      chapters: [
        { n: '01', slug: 'intro', title: 'Intro' },
        { n: '02', slug: 'regression', title: 'Regression' },
        { n: '03', slug: 'classification', title: 'Classification' },
      ],
    },
  },
};

test('a middle chapter links to the one before and after', () => {
  const found = findNote(INDEX, 'cs229', '02');
  assert.equal(found.chapter.title, 'Regression');
  assert.equal(found.prev.n, '01');
  assert.equal(found.next.n, '03');
});

test('the first chapter has no previous, the last no next', () => {
  assert.equal(findNote(INDEX, 'cs229', '01').prev, null);
  assert.equal(findNote(INDEX, 'cs229', '03').next, null);
});

test('an unknown resource or chapter is null', () => {
  assert.equal(findNote(INDEX, 'nope', '01'), null);
  assert.equal(findNote(INDEX, 'cs229', '09'), null);
});

test('a note lives at notes/<resource>/<nn>-<slug>.md', () => {
  assert.equal(notePath('9781108455145', { n: '02', slug: 'linear-algebra' }), 'notes/9781108455145/02-linear-algebra.md');
});

/* ---------- math extraction ---------- */

const fake = (tex, display) => `[${display ? 'D' : 'I'}:${tex}]`;
const roundTrip = (md) => {
  const { text, math } = extractMath(md);
  return restoreMath(text, math, fake);
};

test('inline math is pulled out before Markdown sees its _ and *', () => {
  const { text, math } = extractMath(String.raw`Let $a_1 * b_2$ and $x_i^*$ be.`);
  assert.deepEqual(math, [{ tex: 'a_1 * b_2', display: false }, { tex: 'x_i^*', display: false }]);
  assert.ok(!text.includes('_') && !text.includes('*'));
});

test('a display block keeps its row breaks and becomes a math box', () => {
  const md = 'Before\n\n$$\n\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}\n$$\n\nAfter';
  const { text, math } = extractMath(md);
  assert.deepEqual(math, [{ tex: '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}', display: true }]);
  // As Markdown would wrap each block in a paragraph:
  const html = text.split('\n\n').map((p) => `<p>${p}</p>`).join('\n');
  assert.equal(
    restoreMath(html, math, fake),
    '<p>Before</p>\n<div class="math-display">[D:\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}]</div>\n<p>After</p>',
  );
});

test('dollar amounts stay text', () => {
  assert.equal(roundTrip('It cost $5 or $10.'), 'It cost $5 or $10.');
  assert.equal(roundTrip('A $5 coffee and $x$ apples.'), 'A $5 coffee and [I:x] apples.');
});

test('an escaped dollar is left for Markdown to unescape', () => {
  assert.equal(roundTrip(String.raw`Pay \$3 for $y$.`), String.raw`Pay \$3 for [I:y].`);
});

test('code spans and fences are never treated as math', () => {
  assert.equal(roundTrip('Use `$x$` here'), 'Use `$x$` here');
  assert.equal(roundTrip('```\n$$a$$ and $b$\n```\nthen $c$'), '```\n$$a$$ and $b$\n```\nthen [I:c]');
});

test('inline math does not run across a blank line', () => {
  assert.equal(roundTrip('a $x\n\ny$ b'), 'a $x\n\ny$ b');
});

/* ---------- code-review regressions ---------- */

test('a one-line ```js``` code span is not an opening fence', () => {
  const { math } = extractMath('```js```\n$x$');
  assert.deepEqual(math, [{ tex: 'x', display: false }]);
});

test('an indented code block stays literal', () => {
  assert.equal(roundTrip('Run:\n\n    echo $HOME$PATH\n\nthen $y$'), 'Run:\n\n    echo $HOME$PATH\n\nthen [I:y]');
  assert.equal(roundTrip('\techo $a$'), '\techo $a$');
});

test('a fence inside a blockquote stays literal, and ends with the quote', () => {
  assert.equal(roundTrip('> ```\n> $a$\n> ```\n\n$b$'), '> ```\n> $a$\n> ```\n\n[I:b]');
  assert.equal(roundTrip('> ```\n> $a$\n\n$b$'), '> ```\n> $a$\n\n[I:b]');
});

test('a fence inside a list item stays literal', () => {
  assert.equal(roundTrip('- step:\n  ```\n  $a$\n  ```\n- $b$'), '- step:\n  ```\n  $a$\n  ```\n- [I:b]');
  assert.equal(roundTrip('1. ~~~\n   $a$\n   ~~~\n\n$b$'), '1. ~~~\n   $a$\n   ~~~\n\n[I:b]');
});

test('math in an image alt or link title stays escaped TeX text, never KaTeX HTML', () => {
  const { text, math } = extractMath('![plot of $f(x) < "1"$](f.png) and [see $y$](u "about $z$")');
  // As marked would render that text:
  const alt = text.match(/^!\[(.*?)\]/)[1];
  const label = text.match(/\[see (.*?)\]/)[1];
  const title = text.match(/"about (.*?)"/)[1];
  const html = `<p><img src="f.png" alt="${alt}"> and <a href="u" title="about ${title}">see ${label}</a></p>`;
  const katexish = (tex) => `<span class="katex" title="x">${tex}</span>`;
  assert.equal(
    restoreMath(html, math, katexish),
    '<p><img src="f.png" alt="plot of $f(x) &lt; &quot;1&quot;$"> and '
      + '<a href="u" title="about $z$">see <span class="katex" title="x">y</span></a></p>',
  );
});

test('an indented paragraph inside a list item still has math', () => {
  assert.equal(roundTrip('- item\n\n    more $x$'), '- item\n\n    more [I:x]');
});
