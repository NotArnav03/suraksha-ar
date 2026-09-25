import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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

/**
 * The whole app, not one scenario.
 *
 * All three drills, the daily question bank and the interface are now authored
 * in all three languages, and the way that quietly comes undone is an edit that
 * adds an English line and a Hindi one and moves on: the fallback chain serves
 * the Hindi, nothing looks broken, and a Santali learner reads a language they
 * did not pick. This is the test that notices.
 *
 * Three interface strings are a deliberate exception, named below.
 */
const SPEAKER_ONLY = ['startingAr', 'arRefused', 'arTimedOut'];

function localizedStrings(value: unknown, path: string, out: Array<{ path: string; text: LocalizedText }>): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => localizedStrings(item, `${path}[${i}]`, out));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record.en === 'string') {
    out.push({ path, text: record as LocalizedText });
    return;
  }
  for (const [key, child] of Object.entries(record)) localizedStrings(child, `${path}.${key}`, out);
}

test('every authored file carries all three languages, not English and Hindi', () => {
  const dir = fileURLToPath(new URL('../src/scenarios', import.meta.url));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(dir, f));
  files.push(fileURLToPath(new URL('../src/quiz/bank.json', import.meta.url)));

  const missing: string[] = [];
  for (const file of files) {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    const strings: Array<{ path: string; text: LocalizedText }> = [];
    localizedStrings(json, '$', strings);
    assert.ok(strings.length > 0, `${file} has no localized strings at all`);
    for (const { path, text } of strings) {
      for (const language of ['hi', 'sat'] as const) {
        const value = (text as Record<string, unknown>)[language];
        if (typeof value !== 'string' || value.length === 0) {
          missing.push(`${file.split(/[\\/]/).pop()} ${path} (${language})`);
        }
      }
    }
  }
  assert.deepEqual(missing.slice(0, 10), [], `${missing.length} authored strings are missing a language`);
});

test('the interface table is complete too, apart from the three left for a speaker', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/app/ui/i18n.ts', import.meta.url)), 'utf8');
  const table = source.slice(source.indexOf('const UI'), source.indexOf('export class Localizer'));
  const entries = [...table.matchAll(/(?:^|\n)  (\w+): \{/g)];
  assert.ok(entries.length > 30, `only found ${entries.length} interface strings, the scan is wrong`);

  const withoutSantali: string[] = [];
  for (const [i, match] of entries.entries()) {
    const start = match.index! + match[0].length;
    const end = i + 1 < entries.length ? entries[i + 1]!.index! : table.length;
    const block = table.slice(start, end);
    if (!/\bsat:/.test(block)) withoutSantali.push(match[1]!);
  }
  assert.deepEqual(
    withoutSantali,
    SPEAKER_ONLY,
    'only the three AR-handshake lines are meant to be Hindi-only, and they are waiting on a speaker rather than a draft',
  );
});
