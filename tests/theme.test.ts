import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Window } from 'happy-dom';

/**
 * Following the phone has to mean *nothing written down*.
 *
 * The failure worth guarding is subtle: stamping data-theme="light" for the
 * `system` choice looks identical on a light phone and pins the app to light on
 * a dark one, silently defeating the whole setting.
 */
const window = new Window({ url: 'https://localhost/' });
const globals = globalThis as unknown as Record<string, unknown>;
for (const name of ['window', 'document', 'localStorage', 'HTMLElement', 'Element']) {
  Object.defineProperty(globals, name, {
    value: (window as unknown as Record<string, unknown>)[name],
    writable: true,
    configurable: true,
  });
}

const { applyTheme, loadTheme, nextTheme, resolvedTheme, THEME_ICON } = await import(
  '../src/app/ui/theme.ts'
);

const root = () => window.document.documentElement;

test('system writes no attribute, so the phone is what answers', () => {
  applyTheme('dark');
  assert.equal(root().getAttribute('data-theme'), 'dark');

  applyTheme('system');
  assert.equal(root().hasAttribute('data-theme'), false, 'system must not pin a palette');
});

test('an explicit choice is stamped and survives a reload', () => {
  applyTheme('light');
  assert.equal(root().getAttribute('data-theme'), 'light');
  assert.equal(loadTheme(), 'light');

  applyTheme('dark');
  assert.equal(loadTheme(), 'dark');
});

test('the control cycles through every state and returns', () => {
  const seen = new Set<string>();
  let choice = loadTheme();
  for (let i = 0; i < 3; i++) {
    choice = nextTheme(choice);
    seen.add(choice);
  }
  assert.deepEqual([...seen].sort(), ['dark', 'light', 'system']);
  assert.equal(nextTheme(nextTheme(nextTheme(choice))), choice, 'cycling must return home');
});

test('every state has an icon, because the control has no room for words', () => {
  for (const choice of ['system', 'light', 'dark'] as const) {
    assert.ok(THEME_ICON[choice]?.length, `${choice} has no icon`);
  }
});

test('an explicit choice resolves to itself without consulting the phone', () => {
  assert.equal(resolvedTheme('light'), 'light');
  assert.equal(resolvedTheme('dark'), 'dark');
});

test('a corrupted stored value falls back to following the phone', () => {
  window.localStorage.setItem('suraksha.theme.v1', 'chartreuse');
  assert.equal(loadTheme(), 'system');
});
