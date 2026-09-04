#!/usr/bin/env node
/**
 * Fill in the Santali the scenario is missing, and say plainly that a machine
 * wrote it.
 *
 * 82 of the scenario's 86 localised strings, and 14 of 29 interface strings,
 * have no Santali at all — so a learner who picks Santali is served Hindi by
 * the fallback chain almost everywhere. Hindi is a language many Jharkhand
 * workers read, so this is not a broken app; it is the app quietly declining to
 * be what it claims to be.
 *
 * Translation goes through Bhashini, the Government of India's own language
 * stack (IndicTrans2 for Santali), rather than a general-purpose engine: it is
 * the service built for exactly these languages, and for a Smart India
 * Hackathon entry it is also the one a judge will recognise.
 *
 * ── the part that matters ──────────────────────────────────────────────────
 * Machine translation of a low-resource language is a draft, not an authority.
 * These are instructions about entering a space that can kill you, and a
 * mistranslated one teaches the wrong reflex to the person least able to catch
 * the error. So every string this tool writes is also recorded in
 * l10n/sat-review.tsv against its English source, for a Santali speaker to
 * check line by line before any of it is presented to a worker as training.
 *
 *   node tools/translate.mjs --report     what is missing, translate nothing
 *   node tools/translate.mjs --dry-run    translate, print, write nothing
 *   node tools/translate.mjs --apply      translate and write
 *
 * Credentials come from the environment, free after registering at
 * https://bhashini.gov.in/ulca/user/register :
 *   BHASHINI_USER_ID, BHASHINI_ULCA_API_KEY
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIO = join(ROOT, 'src/scenarios/gas-confined-space.json');
const I18N = join(ROOT, 'src/app/ui/i18n.ts');
const REVIEW = join(ROOT, 'l10n/sat-review.tsv');

const ULCA_CONFIG = 'https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline';
// The public pipeline every Bhashini example uses; override if yours differs.
const PIPELINE_ID = process.env.BHASHINI_PIPELINE_ID ?? '64392f96daac500b55c543cd';
const SOURCE = 'en';
const TARGET = 'sat';

const mode = process.argv.includes('--apply')
  ? 'apply'
  : process.argv.includes('--dry-run')
    ? 'dry-run'
    : 'report';

// ── finding what is missing ─────────────────────────────────────────────────

/**
 * A LocalizedText is any object carrying an `en` string. Walking for that shape
 * rather than for known key names means a field added to the scenario later is
 * picked up without this tool being taught about it.
 */
function collectFromScenario(node, path, out) {
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectFromScenario(child, `${path}[${i}]`, out));
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (typeof node.en === 'string') {
    if (!node.sat) out.push({ path, en: node.en, node });
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    collectFromScenario(child, `${path}.${key}`, out);
  }
}

/**
 * The interface strings live in a TypeScript literal rather than a data file.
 * Read them, but never write them back — regenerating hand-written source from
 * a script is how comments and formatting get quietly destroyed. Interface
 * strings are emitted for review and pasted in deliberately.
 */
function collectFromUi(source) {
  const start = source.indexOf('const UI');
  const end = source.indexOf('export class Localizer');
  const block = source.slice(start, end);
  const out = [];

  // Brace counting rather than a pattern: entries are written both on one line
  // and across five, and a regex that assumed either shape silently skipped the
  // other — the first version of this found 5 of the 14 and reported success.
  const key = /(^|\n)\s{2}(\w+):\s*\{/g;
  for (let m = key.exec(block); m; m = key.exec(block)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < block.length && depth > 0; i++) {
      if (block[i] === '{') depth++;
      else if (block[i] === '}') depth--;
    }
    const body = block.slice(m.index + m[0].length, i - 1);
    key.lastIndex = i;
    if (/\bsat\s*:/.test(body)) continue;
    const en = readEnglish(body);
    if (en !== null) out.push({ path: `UI.${m[2]}`, en, key: m[2] });
  }
  return out;
}

/**
 * Read the `en:` value by scanning, not by matching.
 *
 * A regex for "quoted string with escapes" is the kind that looks right and
 * truncates at the first escaped apostrophe — which no current string has, so
 * it would have failed silently the day someone wrote "worker's". Walking the
 * characters costs four lines and cannot go quietly wrong.
 */
function readEnglish(body) {
  const at = body.search(/\ben\s*:/);
  if (at === -1) return null;
  let i = body.indexOf(':', at) + 1;
  while (i < body.length && /\s/.test(body[i])) i++;
  const quote = body[i];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let outText = '';
  for (i++; i < body.length; i++) {
    const ch = body[i];
    // 92 is the backslash, written as a code point on purpose: a literal one
    // has a habit of not surviving the trip through a shell into a file, and
    // this comparison is the whole reason the scanner exists.
    if (ch.charCodeAt(0) === 92) {
      outText += body[++i] ?? '';
      continue;
    }
    if (ch === quote) return outText;
    outText += ch;
  }
  return null;
}

// ── Bhashini ────────────────────────────────────────────────────────────────

function credentials() {
  const userID = process.env.BHASHINI_USER_ID;
  const ulcaApiKey = process.env.BHASHINI_ULCA_API_KEY;
  if (!userID || !ulcaApiKey) return null;
  return { userID, ulcaApiKey };
}

async function configurePipeline({ userID, ulcaApiKey }) {
  const task = {
    taskType: 'translation',
    config: { language: { sourceLanguage: SOURCE, targetLanguage: TARGET } },
  };
  const response = await fetch(ULCA_CONFIG, {
    method: 'POST',
    headers: { userID, ulcaApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pipelineTasks: [task],
      pipelineRequestConfig: { pipelineId: PIPELINE_ID },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Bhashini refused the pipeline config (HTTP ${response.status}). ` +
        `Check BHASHINI_USER_ID and BHASHINI_ULCA_API_KEY.\n${await response.text()}`,
    );
  }
  const body = await response.json();
  const serviceId = body?.pipelineResponseConfig?.[0]?.config?.[0]?.serviceId;
  const endpoint = body?.pipelineInferenceAPIEndPoint;
  if (!serviceId || !endpoint?.callbackUrl) {
    throw new Error(
      `Bhashini has no Santali translation service on pipeline ${PIPELINE_ID}.\n` +
        JSON.stringify(body).slice(0, 400),
    );
  }
  return {
    callbackUrl: endpoint.callbackUrl,
    // The header name is declared by the response; the reference client
    // hardcodes Authorization, which is true today and need not stay true.
    authHeader: endpoint.inferenceApiKey?.name || 'Authorization',
    authValue: endpoint.inferenceApiKey?.value,
    task: { ...task, config: { ...task.config, serviceId } },
  };
}

/** The compute endpoint takes many inputs per call, so ask once per batch. */
async function translateBatch(pipeline, texts) {
  const response = await fetch(pipeline.callbackUrl, {
    method: 'POST',
    headers: {
      [pipeline.authHeader]: pipeline.authValue,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pipelineTasks: [pipeline.task],
      pipelineRequestConfig: { pipelineId: PIPELINE_ID },
      inputData: { input: texts.map((source) => ({ source })) },
    }),
  });
  if (!response.ok) {
    throw new Error(`Translation failed (HTTP ${response.status}): ${await response.text()}`);
  }
  const body = await response.json();
  const output = body?.pipelineResponse?.[0]?.output;
  if (!Array.isArray(output) || output.length !== texts.length) {
    throw new Error(
      `Expected ${texts.length} translations, got ${output?.length ?? 0}.\n` +
        JSON.stringify(body).slice(0, 400),
    );
  }
  return output.map((entry) => entry.target);
}

/**
 * `{{param}}` placeholders must survive the round trip. A translator that
 * helpfully "corrects" {{gas}} into something readable silently breaks
 * interpolation, and the string still looks fine in review.
 */
function placeholders(text) {
  return [...text.matchAll(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g)].map((m) => m[0]).sort();
}

function placeholdersSurvived(source, translated) {
  const a = placeholders(source);
  const b = placeholders(translated);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ── main ────────────────────────────────────────────────────────────────────

const scenario = JSON.parse(readFileSync(SCENARIO, 'utf8'));
const missingScenario = [];
collectFromScenario(scenario, '$', missingScenario);
const missingUi = collectFromUi(readFileSync(I18N, 'utf8'));
const all = [...missingScenario, ...missingUi];

console.log(`missing Santali: ${missingScenario.length} scenario, ${missingUi.length} interface`);

if (mode === 'report') {
  for (const item of all) console.log(`  ${item.path}\n      ${item.en.slice(0, 88)}`);
  console.log('\nNothing translated. Re-run with --dry-run or --apply.');
  process.exit(0);
}

if (all.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

const creds = credentials();
if (!creds) {
  console.error(
    '\nBHASHINI_USER_ID and BHASHINI_ULCA_API_KEY are not set.\n' +
      'Register free at https://bhashini.gov.in/ulca/user/register, generate a key\n' +
      'in your profile, then:\n\n' +
      '  export BHASHINI_USER_ID=...\n' +
      '  export BHASHINI_ULCA_API_KEY=...\n',
  );
  process.exit(1);
}

const pipeline = await configurePipeline(creds);
console.log(`pipeline ready: ${pipeline.task.config.serviceId}`);

const BATCH = 20;
const results = [];
for (let i = 0; i < all.length; i += BATCH) {
  const slice = all.slice(i, i + BATCH);
  const targets = await translateBatch(pipeline, slice.map((s) => s.en));
  slice.forEach((item, j) => results.push({ ...item, sat: targets[j] }));
  console.log(`  translated ${Math.min(i + BATCH, all.length)}/${all.length}`);
}

const broken = results.filter((r) => !placeholdersSurvived(r.en, r.sat));
for (const item of broken) {
  console.warn(`  ! placeholders lost, skipping: ${item.path}\n      ${item.sat}`);
}
const usable = results.filter((r) => !broken.includes(r));

// The review sheet is written whatever the mode, because it is the deliverable
// that matters: a Santali speaker signing off every line before a worker sees it.
mkdirSync(dirname(REVIEW), { recursive: true });
writeFileSync(
  REVIEW,
  ['path\tenglish\tmachine_santali\treviewed_by\tcorrected_santali']
    .concat(
      results.map((r) =>
        [r.path, r.en, r.sat, '', ''].map((c) => String(c).replace(/[\t\n]/g, ' ')).join('\t'),
      ),
    )
    .join('\n') + '\n',
  'utf8',
);
console.log(`\nreview sheet: ${REVIEW}  (${results.length} lines awaiting a speaker)`);

if (mode === 'dry-run') {
  console.log('\n--dry-run: nothing written to the scenario.');
  process.exit(0);
}

for (const item of usable) {
  if (item.node) item.node.sat = item.sat;
}
writeFileSync(SCENARIO, JSON.stringify(scenario, null, 2) + '\n', 'utf8');
console.log(`wrote ${usable.filter((u) => u.node).length} scenario strings`);

const uiWrites = usable.filter((u) => !u.node);
if (uiWrites.length > 0) {
  console.log(`\n${uiWrites.length} interface strings — paste into src/app/ui/i18n.ts:\n`);
  for (const item of uiWrites) console.log(`  ${item.key}: sat: ${JSON.stringify(item.sat)},`);
}
console.log('\nNone of this is authoritative until l10n/sat-review.tsv is signed off.');
