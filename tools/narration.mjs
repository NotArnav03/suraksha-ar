#!/usr/bin/env node
/**
 * Recorded narration: what to record, and what has been recorded.
 *
 * Speech synthesis is a stand-in. The languages this has to reach have either
 * a poor synthetic voice (Hindi) or none at all (Santali, Ho, Mundari,
 * Kurukh), and a worker who cannot read is being asked to trust a voice that
 * mispronounces the word for the gas that will kill him. A recording by a
 * speaker of the language is the real answer, and the app already prefers one
 * wherever it exists.
 *
 * The app plays a clip only if its id appears in narration/manifest.json, so a
 * missing recording costs nothing on a phone with the radio off: no request,
 * no wait, straight to the synthetic voice.
 *
 *   node tools/narration.mjs --report              what exists and what does not
 *   node tools/narration.mjs --ids --apply         write clip ids into the scenarios
 *   node tools/narration.mjs --script --lang hi    a recording sheet, one line per clip
 *   node tools/narration.mjs --manifest --apply    rebuild the manifest from the files present
 *
 * Recording: one file per line, mono, at `public/narration/<id>.mp3`. Read the
 * line as written. If a line is wrong in your language, fix the scenario text
 * first and record the corrected line, rather than reading it differently.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIO_DIR = join(ROOT, 'src/scenarios');
const AUDIO_DIR = join(ROOT, 'public/narration');
const MANIFEST = join(AUDIO_DIR, 'manifest.json');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};
const apply = has('--apply');

function scenarioFiles() {
  return readdirSync(SCENARIO_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(SCENARIO_DIR, f));
}

/**
 * Every line the app ever speaks, with the id its recording would carry.
 * Node prompts, the consequence of every coded error, every timeout, and every
 * outcome summary: the debrief is narrated too, because the learner who most
 * needs the lesson is the one least likely to read it.
 */
function lines(scenario) {
  const found = [];
  const add = (narration, key) => {
    if (!narration?.text) return;
    for (const [lang, text] of Object.entries(narration.text)) {
      if (typeof text === 'string' && text.length > 0) {
        // A line with a `{{param}}` in it says "belt C3" in one variant and
        // "belt C4" in the next. One recording cannot be both, and a clip that
        // names the wrong belt is worse than the synthetic voice naming the
        // right one, so these stay synthetic and never get an id.
        const varies = /\{\{\w+\}\}/.test(text);
        found.push({ id: `${scenario.id}/${key}.${lang}`, lang, text, narration, key, varies });
      }
    }
  };
  for (const node of scenario.nodes) {
    add(node.prompt, `${node.id}.prompt`);
    if (node.kind === 'outcome') add(node.summary, `${node.id}.summary`);
    for (const rule of node.errors ?? []) add(rule.consequence, `${node.id}.error.${rule.code}`);
    if (node.onTimeout) add(node.onTimeout.consequence, `${node.id}.timeout`);
  }
  return found;
}

const scenarios = scenarioFiles().map((path) => ({ path, scenario: JSON.parse(readFileSync(path, 'utf8')) }));
const clipPath = (id) => join(AUDIO_DIR, `${id}.mp3`);

if (has('--ids')) {
  // The id is derived, never typed: a hand-written one drifts from its node the
  // first time a node is renamed, and the drift is silent (the app just speaks
  // with the synthetic voice, exactly as it would with no recording at all).
  //
  // Hindi and Santali by default, not English: English is the written fallback
  // the other two fall back *to*, and no worker this is built for needs an
  // English voice. Santali needs one most, having no synthetic voice at all.
  const wanted = new Set(valueOf('--lang', 'hi,sat').split(','));
  let written = 0;
  for (const { path, scenario } of scenarios) {
    for (const line of lines(scenario)) {
      if (!wanted.has(line.lang)) continue;
      if (line.varies) {
        // Also clears an id written before the text gained a placeholder.
        if (line.narration.audio?.[line.lang]) {
          delete line.narration.audio[line.lang];
          if (Object.keys(line.narration.audio).length === 0) delete line.narration.audio;
          written++;
        }
        continue;
      }
      line.narration.audio ??= {};
      if (line.narration.audio[line.lang] !== line.id) {
        line.narration.audio[line.lang] = line.id;
        written++;
      }
    }
    if (apply) writeFileSync(path, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8');
  }
  console.log(apply ? `Wrote ${written} clip id(s).` : `${written} clip id(s) would change. Re-run with --apply.`);
}

if (has('--script')) {
  const lang = valueOf('--lang', 'hi');
  const only = valueOf('--scenario', null);
  console.log(['file', 'language', 'text'].join('\t'));
  for (const { scenario } of scenarios) {
    if (only && scenario.id !== only) continue;
    for (const line of lines(scenario)) {
      if (line.lang !== lang || line.varies) continue;
      console.log([`${line.id}.mp3`, line.lang, line.text.replace(/\s+/g, ' ')].join('\t'));
    }
  }
}

if (has('--manifest')) {
  const clips = [];
  for (const { scenario } of scenarios) {
    for (const line of lines(scenario)) {
      if (!line.varies && existsSync(clipPath(line.id))) clips.push(line.id);
    }
  }
  clips.sort();
  if (apply) {
    mkdirSync(AUDIO_DIR, { recursive: true });
    writeFileSync(MANIFEST, `${JSON.stringify({ clips }, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${relative(ROOT, MANIFEST)} with ${clips.length} clip(s).`);
  } else {
    console.log(`${clips.length} recorded clip(s) found. Re-run with --apply to write the manifest.`);
  }
}

if (has('--report') || args.length === 0) {
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')).clips ?? [] : [];
  const listed = new Set(manifest);
  // Same default as --ids: English is not a language anyone here records.
  const wanted = new Set(valueOf('--lang', 'hi,sat').split(','));
  console.log(`manifest: ${existsSync(MANIFEST) ? `${manifest.length} clip(s) listed` : 'none yet, every line uses the synthetic voice'}`);
  for (const { scenario } of scenarios) {
    const all = lines(scenario);
    const byLang = new Map();
    for (const line of all) {
      const entry = byLang.get(line.lang) ?? { total: 0, recorded: 0, unlisted: 0, missingId: 0, varies: 0 };
      if (line.varies) {
        entry.varies++;
        byLang.set(line.lang, entry);
        continue;
      }
      entry.total++;
      if (existsSync(clipPath(line.id))) {
        entry.recorded++;
        if (!listed.has(line.id)) entry.unlisted++;
      }
      if (wanted.has(line.lang) && line.narration.audio?.[line.lang] !== line.id) entry.missingId++;
      byLang.set(line.lang, entry);
    }
    console.log(`\n${scenario.id}`);
    for (const [lang, entry] of [...byLang].sort()) {
      const notes = [];
      if (entry.unlisted > 0) notes.push(`${entry.unlisted} recorded but not in the manifest (run --manifest --apply)`);
      if (entry.missingId > 0) notes.push(`${entry.missingId} without a clip id (run --ids --apply)`);
      if (entry.varies > 0) notes.push(`${entry.varies} vary by variant, so they stay synthetic`);
      console.log(
        `  ${lang}: ${entry.recorded}/${entry.total} recorded${notes.length ? ` — ${notes.join('; ')}` : ''}`,
      );
    }
  }
  console.log('\nRecord to public/narration/<id>.mp3, then: node tools/narration.mjs --manifest --apply');
}
