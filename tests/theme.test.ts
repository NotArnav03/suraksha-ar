import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * THEME_ICON holds the *name* of a drawn pictogram, not a character to print.
 *
 * Assigning it as text has now shipped twice - once in the HUD, once in the
 * start screen's preferences row - and both times the button read the literal
 * word "contrast" beside its label. The mistake is invisible at the call site
 * and obvious on the phone, which is exactly the kind worth pinning down in a
 * test rather than in a reviewer's memory.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

test('an icon name is always rendered as a drawing, never printed as text', () => {
  const offenders: string[] = [];
  for (const file of [...sourceFiles('src/app'), ...sourceFiles('src/admin')]) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!line.includes('THEME_ICON[')) return;
      // The only legitimate use is handing the name to `icon()`, which turns it
      // into an <svg>. Anything else puts the name itself on screen.
      if (/icon\(\s*THEME_ICON\[/.test(line)) return;
      if (/^\s*(export )?const THEME_ICON/.test(line)) return;
      offenders.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `an icon name is being printed rather than drawn:\n${offenders.join('\n')}`);
});
