import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { LANGUAGES } from '../src/app/ui/i18n.ts';
import { resolve } from '../src/engine/text.ts';
import { validateScenario } from '../src/engine/validate.ts';
import type { LocalizedText } from '../src/engine/types.ts';

const scenario = validateScenario(
  JSON.parse(
    await readFile(
      fileURLToPath(new URL('../src/scenarios/gas-confined-space.json', import.meta.url)),
      'utf8',
    ),
  ),
);

/**
 * The scenario declares three languages. Declaring one and shipping almost none
 * of it is the failure these guard: not a crash, just a Santali learner reading
 * Hindi on every screen while the picker says their language is supported.
 */
test('every language the scenario declares can resolve every string', () => {
  const texts: LocalizedText[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (typeof record.en === 'string') {
      texts.push(record as LocalizedText);
      return;
    }
    Object.values(record).forEach(walk);
  };
  walk(scenario);

  for (const language of LANGUAGES) {
    for (const text of texts) {
      const value = resolve(text, language.chain);
      assert.ok(value.length > 0, `${language.code} resolves to nothing`);
    }
  }
});

test('every fallback chain ends somewhere that is always authored', () => {
  for (const language of LANGUAGES) {
    assert.equal(
      language.chain.at(-1),
      'en',
      `${language.code} must end at English, the one language every string has`,
    );
  }
});

/**
 * Santali degrades to Hindi, never straight to English. A worker who reads
 * Devanagari is served by the Hindi line; dropping them to English is a further
 * step away from a language they are likely to have.
 */
test('Santali falls back through Hindi before English', () => {
  const sat = LANGUAGES.find((l) => l.code === 'sat');
  assert.deepEqual(sat?.chain, ['sat', 'hi', 'en']);
});

test('a string authored only in Santali is not lost to the fallback', () => {
  const onlySat = { en: '', sat: 'ᱥᱮᱴᱞᱤᱝ' } as LocalizedText;
  assert.equal(resolve(onlySat, ['sat', 'hi', 'en']), 'ᱥᱮᱴᱞᱤᱝ');
});
