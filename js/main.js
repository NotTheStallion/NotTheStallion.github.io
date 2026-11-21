/*
 * main.js — page-wide motion and background videos.
 *
 * How section modules plug in (no need to edit this file):
 *   - Render into your mount element: #workbench-root, #learning-root or #reading-root.
 *   - Import helpers from './shared.js' (also on window.Stallion):
 *       reveal(elOrListOrSelector, {delay})  fade in on scroll (respects reduced motion)
 *       playWhenVisible(videoEl)             background <video data-video="name"> handling
 *       onFrame(({y, vh, max}) => {})        scroll/resize-linked effects, rAF-throttled
 *       prefs()                              {reducedMotion, saveData, touch}
 *   - Keep your styles in your own css/<module>.css.
 *
 * Motion rules (ticket 014): touch screens get no parallax, grain, tilt or dots;
 * reduced motion turns everything off and shows posters instead of videos.
 */
import { prefs, reveal, playWhenVisible, onFrame, splitWords, litWordCount, loadNotesIndex } from './shared.js';

window.Stallion = Object.freeze({ prefs, reveal, playWhenVisible, onFrame });

const { reducedMotion, touch } = prefs();

/* Title letters rise in one by one. */
function splitTitle(el) {
  const text = el.textContent;
  el.setAttribute('aria-label', text);
  el.textContent = '';
  [...text].forEach((c, i) => {
    if (c === ' ') { el.append(' '); return; }
    const span = document.createElement('span');
    span.className = 'ch';
    span.setAttribute('aria-hidden', 'true');
    span.style.setProperty('--d', `${0.15 + i * 0.05}s`);
    span.textContent = c;
    el.append(span);
  });
}

/* Wrap every word of the intro in a span so it can light up. */
function splitLead(el) {
  const wrap = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.ELEMENT_NODE) { wrap(child); continue; }
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const frag = document.createDocumentFragment();
      for (const tok of splitWords(child.textContent)) {
        if (/^\s+$/.test(tok)) { frag.append(tok); continue; }
        const span = document.createElement('span');
        span.className = 'w';
        span.textContent = tok;
        frag.append(span);
      }
      child.replaceWith(frag);
    }
  };
  wrap(el);
  return [...el.querySelectorAll('.w')];
}

/* Repeat the marquee group so it always covers the screen while it slides. */
function fillMarquee(track) {
  const group = track.querySelector('.marquee-group');
  for (let i = 0; i < 7; i++) track.append(group.cloneNode(true));
  return group;
}

/* Highlight the dot of the section on screen. */
function watchDots(nav) {
  const links = [...nav.querySelectorAll('a')];
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const a of links) a.classList.toggle('on', a.hash === `#${e.target.id}`);
    }
  }, { rootMargin: '-45% 0px -45% 0px' });
  for (const a of links) {
    const target = document.querySelector(a.hash);
    if (target) io.observe(target);
  }
}

const title = document.getElementById('title');
const lead = document.getElementById('lead');
const marquee = document.getElementById('marquee');
const openingIn = document.getElementById('opening-in');
const progress = document.getElementById('progress');

splitTitle(title);
const words = splitLead(lead);
const marqueeGroup = fillMarquee(marquee);

reveal(document.querySelectorAll('.rv'));
// Tell the inline fail-safe in index.html that reveal is wired, so it keeps `.js`.
document.documentElement.dataset.reveal = 'ready';
document.querySelectorAll('video[data-video]').forEach(playWhenVisible);
if (!touch) watchDots(document.getElementById('dots'));

if (reducedMotion) words.forEach((w) => w.classList.add('lit'));

const drifts = [...document.querySelectorAll('.drift[data-drift]')];
const parallaxBgs = touch ? [] : [...document.querySelectorAll('.scene > .bg')];

onFrame(({ y, vh, max }) => {
  progress.style.transform = `scaleX(${max > 0 ? Math.min(y / max, 1) : 0})`;
  if (reducedMotion) return;
  const loop = marqueeGroup.offsetWidth || 1200;

  // Opening drifts up, shrinks and fades as you leave it.
  const o = Math.min(y / vh, 1);
  openingIn.style.transform = `translateY(${o * -120}px) scale(${1 - o * 0.15})`;
  openingIn.style.opacity = String(Math.max(1 - o * 1.2, 0));

  // Background parallax (desktop only).
  for (const bg of parallaxBgs) {
    const r = bg.parentElement.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh) continue;
    const p = (r.top + r.height / 2 - vh / 2) / vh;
    bg.style.transform = `translateY(${p * -12}%) scale(${1.08 - Math.min(Math.abs(p), 1) * 0.06})`;
  }

  // Giant titles slide sideways.
  for (const h of drifts) {
    const r = h.getBoundingClientRect();
    if (r.bottom < -vh || r.top > 2 * vh) continue;
    h.style.transform = `translateX(${((r.top - vh / 2) / vh) * h.dataset.drift * 18}vw)`;
  }

  // Intro words light up as it scrolls through.
  const lr = lead.getBoundingClientRect();
  const n = litWordCount({ top: lr.top, height: lr.height, vh, count: words.length });
  words.forEach((w, i) => w.classList.toggle('lit', i < n));

  // Marquee slides with scroll, looping over one group's width.
  marquee.style.transform = `translateX(${-((y * 0.4) % loop)}px)`;
});

/* Footer "Notes" link: only shown once at least one note is published. */
const notesSlot = document.getElementById('footer-notes-slot');
if (notesSlot) {
  loadNotesIndex().then((index) => {
    if (!Object.keys((index && index.resources) || {}).length) notesSlot.remove();
  });
}
