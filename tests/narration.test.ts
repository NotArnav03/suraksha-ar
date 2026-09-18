import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Window } from 'happy-dom';

/**
 * Recorded narration.
 *
 * The synthetic voice is a stand-in: Hindi sounds like a machine reading a
 * safety instruction, and Santali has no voice at all, so an Ol Chiki line is
 * simply never spoken. A clip recorded by a speaker is the real answer, and
 * these tests cover the part that has to work before anyone records anything:
 * a clip is played when it exists, the synthetic voice still runs when it does
 * not, and no clip is ever attached to a line whose words change per variant.
 */

const window = new Window({ url: 'https://localhost/' });
const globals = globalThis as unknown as Record<string, unknown>;
function define(name: string, value: unknown): void {
  Object.defineProperty(globals, name, { value, writable: true, configurable: true });
}
for (const name of ['window', 'document', 'navigator', 'location', 'HTMLElement', 'Element', 'Node']) {
  define(name, (window as unknown as Record<string, unknown>)[name]);
}

/** Both the global and the window object: the Localizer asks `'x' in window`. */
function defineOnWindow(name: string, value: unknown): void {
  define(name, value);
  Object.defineProperty(window, name, { value, writable: true, configurable: true });
}

const spoken: string[] = [];
defineOnWindow('speechSynthesis', {
  getVoices: () => [{ lang: 'hi_IN', name: 'hi', default: false, localService: true, voiceURI: 'hi' }],
  addEventListener: () => {},
  cancel: () => {},
  speak: (utterance: { text: string }) => spoken.push(utterance.text),
});
defineOnWindow('SpeechSynthesisUtterance', class {
  text: string;
  lang = '';
  voice: unknown = null;
  rate = 1;
  constructor(text: string) {
    this.text = text;
  }
});

const played: string[] = [];
defineOnWindow('Audio', class {
  src: string;
  constructor(src: string) {
    this.src = src;
  }
  addEventListener(): void {}
  pause(): void {}
  play(): Promise<void> {
    played.push(this.src);
    return Promise.resolve();
  }
});

const { Localizer } = await import('../src/app/ui/i18n.ts');

/** Serves one manifest, then restores whatever fetch was there before. */
function withManifest(clips: string[]): void {
  define('fetch', async () => ({ ok: true, json: async () => ({ clips }) }));
}

after(() => window.close());

test('with no manifest, every line uses the synthetic voice', async () => {
  define('fetch', async () => ({ ok: false, json: async () => ({}) }));
  const i18n = new Localizer('hi');
  assert.equal(await i18n.loadNarration(), 0);
  spoken.length = 0;
  played.length = 0;
  i18n.speak('परमिट देखिए', { hi: 'gas/check_permit.prompt.hi' });
  assert.deepEqual(played, [], 'nothing should be fetched when no manifest lists it');
  assert.deepEqual(spoken, ['परमिट देखिए']);
});

test('a recorded clip is played instead of the synthetic voice', async () => {
  withManifest(['gas/check_permit.prompt.hi']);
  const i18n = new Localizer('hi');
  assert.equal(await i18n.loadNarration(), 1);
  spoken.length = 0;
  played.length = 0;
  i18n.speak('परमिट देखिए', { hi: 'gas/check_permit.prompt.hi' });
  assert.deepEqual(played, ['./narration/gas/check_permit.prompt.hi.mp3']);
  assert.deepEqual(spoken, [], 'the handset voice must not talk over the recording');
});

test('a line with no clip still speaks, and a clip for another line is not borrowed', async () => {
  withManifest(['gas/check_permit.prompt.hi']);
  const i18n = new Localizer('hi');
  await i18n.loadNarration();
  spoken.length = 0;
  played.length = 0;
  i18n.speak('गैस जाँचिए', { hi: 'gas/gas_test.prompt.hi' });
  assert.deepEqual(played, []);
  assert.deepEqual(spoken, ['गैस जाँचिए']);
});

test('Santali falls back to the Hindi recording, exactly as its text does', async () => {
  withManifest(['gas/check_permit.prompt.hi']);
  const i18n = new Localizer('sat');
  await i18n.loadNarration();
  played.length = 0;
  i18n.speak('ᱯᱟᱨᱢᱤᱴ', { hi: 'gas/check_permit.prompt.hi' });
  assert.deepEqual(played, ['./narration/gas/check_permit.prompt.hi.mp3']);
});

test('a Santali recording wins over the Hindi one once it exists', async () => {
  withManifest(['gas/check_permit.prompt.hi', 'gas/check_permit.prompt.sat']);
  const i18n = new Localizer('sat');
  await i18n.loadNarration();
  played.length = 0;
  i18n.speak('ᱯᱟᱨᱢᱤᱴ', { hi: 'gas/check_permit.prompt.hi', sat: 'gas/check_permit.prompt.sat' });
  assert.deepEqual(played, ['./narration/gas/check_permit.prompt.sat.mp3']);
});

test('the Listen control is offered for a recorded line even where the handset has no voice', async () => {
  withManifest(['gas/check_permit.prompt.sat']);
  const i18n = new Localizer('sat');
  await i18n.loadNarration();
  // No Ol Chiki voice is installed, so without a recording this is unspeakable.
  assert.equal(i18n.canSpeak('ᱯᱟᱨᱢᱤᱴ'), false);
  assert.equal(i18n.canSpeak('ᱯᱟᱨᱢᱤᱴ', { sat: 'gas/check_permit.prompt.sat' }), true);
});

test('no line whose words change per variant carries a clip id', async () => {
  // A recording of "belt C3 has jammed" played on the C4 variant names the
  // wrong belt, which is worse than the synthetic voice naming the right one.
  const dir = fileURLToPath(new URL('../src/scenarios/', import.meta.url));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const offenders: string[] = [];
  const ids: string[] = [];
  for (const file of files) {
    const scenario = JSON.parse(await readFile(dir + file, 'utf8'));
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== 'object') return;
      const record = value as { text?: Record<string, string>; audio?: Record<string, string> };
      if (record.text && record.audio) {
        for (const [lang, id] of Object.entries(record.audio)) {
          ids.push(`${scenario.id}|${lang}|${id}`);
          if (/\{\{\w+\}\}/.test(record.text[lang] ?? '')) offenders.push(`${file}: ${id}`);
        }
      }
      for (const nested of Object.values(record)) walk(nested);
    };
    walk(scenario);
  }
  assert.deepEqual(offenders, []);
  assert.ok(ids.length > 0, 'the scenarios should carry clip ids: run node tools/narration.mjs --ids --apply');
  for (const entry of ids) {
    const [scenarioId, lang, id] = entry.split('|');
    assert.ok(id!.startsWith(`${scenarioId}/`), `${id} should be namespaced by its scenario`);
    assert.ok(id!.endsWith(`.${lang}`), `${id} should end with its language`);
  }
});
