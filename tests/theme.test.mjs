import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme, nextTheme, validTheme } from '../js/theme.js';

test('an explicit stored choice wins over the system preference', () => {
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('dark', true), 'dark');
});

test('with no valid stored choice the system preference decides', () => {
  assert.equal(resolveTheme(null, true), 'light');
  assert.equal(resolveTheme(null, false), 'dark');
  assert.equal(resolveTheme('sepia', true), 'light');
  assert.equal(resolveTheme('', false), 'dark');
});

test('validTheme accepts only light and dark', () => {
  assert.equal(validTheme('light'), 'light');
  assert.equal(validTheme('dark'), 'dark');
  assert.equal(validTheme('auto'), null);
  assert.equal(validTheme(undefined), null);
});

test('the toggle flips between light and dark', () => {
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'light');
});
