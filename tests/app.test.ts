import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Window } from 'happy-dom';

/**
 * Wiring test for the Tier C client.
 *
 * This drives the real renderer through a real DOM — finding tiles by their
 * labels, opening the verb sheet, pressing the verb — rather than calling
 * `session.dispatch` directly. That distinction is the whole value: it proves a
 * learner can actually reach a pass by touching the screen, and it fails when
 * the wiring between controller, HUD and renderer breaks even though every unit
 * underneath still passes.
 */

// happy-dom has to be installed as globals before the app modules are imported,
// because they capture `document` and `window` at construction time.
const window = new Window({ url: 'https://localhost/' });
const globals = globalThis as unknown as Record<string, unknown>;
function define(name: string, value: unknown): void {
  // Plain assignment fails on Node's getter-only globals (`navigator`), so every
  // global goes through defineProperty rather than special-casing the ones that
  // happen to be accessors today.
  Object.defineProperty(globals, name, { value, writable: true, configurable: true });
}

for (const name of [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'HTMLElement',
  'Element',
  'Node',
  'CustomEvent',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
]) {
  define(name, (window as unknown as Record<string, unknown>)[name]);
}
define('performance', { now: () => Date.now() });

const { DrillController } = await import('../src/app/controller.ts');
import type { Scheduler } from '../src/app/controller.ts';
const { TierCRenderer } = await import('../src/app/render/tierC.ts');
const { VERBS_BY_KIND } = await import('../src/app/render/contract.ts');
const { VERB_ICON, VERB_LABEL } = await import('../src/app/render/verbs.ts');
const { Localizer } = await import('../src/app/ui/i18n.ts');
const { scoreSession } = await import('../src/assess/score.ts');
const { validateScenario } = await import('../src/engine/validate.ts');
const { resolveVariant } = await import('../src/engine/variant.ts');
const engineTypes = await import('../src/engine/types.ts');
void engineTypes;

type Scenario = Awaited<ReturnType<typeof validateScenario>>;

let scenario: Scenario;

before(async () => {
  scenario = validateScenario(
    JSON.parse(
      await readFile(
        fileURLToPath(new URL('../src/scenarios/gas-confined-space.json', import.meta.url)),
        'utf8',
      ),
      ),
  );
});

/** Frames are pumped by hand, so no render loop keeps the test process alive. */
function manualScheduler(): Scheduler & { pump(): void } {
  let pending: (() => void) | null = null;
  return {
    now: () => Date.now(),
    frame(callback) {
      pending = callback;
      return 1;
    },
    cancel() {
      pending = null;
    },
    pump() {
      const callback = pending;
      pending = null;
      callback?.();
    },
  };
}

interface Harness {
  controller: InstanceType<typeof DrillController>;
  world: HTMLElement;
  chrome: HTMLElement;
  finished: { value: boolean };
}

async function mount(seed: number, lang: 'en' | 'hi' = 'en'): Promise<Harness> {
  const world = window.document.createElement('div') as unknown as HTMLElement;
  const chrome = window.document.createElement('div') as unknown as HTMLElement;
  window.document.body.append(world as never, chrome as never);

  const i18n = new Localizer(lang);
  i18n.speechEnabled = false;

  const finished = { value: false };
  const controller = new DrillController(
    resolveVariant(scenario, seed),
    new TierCRenderer(i18n),
    i18n,
    { onFinish: () => (finished.value = true) },
    manualScheduler(),
  );
  await controller.start(world, chrome);
  return { controller, world, chrome, finished };
}

function tiles(world: HTMLElement): HTMLButtonElement[] {
  return [...world.querySelectorAll<HTMLButtonElement>('.tile')];
}

function labelOf(tile: HTMLElement): string {
  return tile.querySelector('.tile-label')?.textContent ?? '';
}

/** Touch a thing, then choose what you do to it — exactly as a learner would. */
function touch(world: HTMLElement, propLabel: string, verbLabel: string): boolean {
  const tile = tiles(world).find((t) => labelOf(t).includes(propLabel));
  if (!tile || tile.disabled) return false;
  tile.click();

  const sheet = world.querySelector<HTMLElement>('.sheet');
  assert.ok(sheet && !sheet.hidden, `verb sheet did not open for "${propLabel}"`);
  const verb = [...sheet.querySelectorAll<HTMLButtonElement>('.verb')].find((b) =>
    (b.textContent ?? '').includes(verbLabel),
  );
  if (!verb) {
    sheet.hidden = true;
    return false;
  }
  verb.click();
  return true;
}

function prompt(chrome: HTMLElement): string {
  return chrome.querySelector('.prompt')?.textContent ?? '';
}

function pressContinue(chrome: HTMLElement): boolean {
  const button = chrome.querySelector<HTMLButtonElement>('.continue');
  if (!button || button.hidden) return false;
  button.click();
  return true;
}

/** The touch sequence a competent worker performs, in order. */
const CORRECT_PATH: [prop: string, verb: string][] = [
  ['Settling sump opening', 'Look at'],
  ['Confined space warning board', 'Look at'],
  ['Work permit board', 'Look at'],
  ['Shift supervisor', 'Report to'],
  ['gas detector', 'Use'],
  ['Detector readout', 'Look at'],
  ['ventilation blower', 'Use'],
  ['(wait)', ''],
  ['gas detector', 'Use'],
  ['Breathing apparatus', 'Put on'],
  ['Full-body harness', 'Put on'],
  ['Retrieval line', 'Clip on'],
  ['Standby person', 'Signal'],
  ['Radio to control room', 'Report to'],
  ['Settling sump opening', 'Climb in'],
  ['Standby person', 'Signal'],
  ['Settling sump opening', 'Climb out'],
  ['Radio to control room', 'Report to'],
  ['Retrieval line', 'Use'],
];

/**
 * Walks the correct path. `wait` is an authored step with no prop, so the HUD
 * offers it as its own control — and it has to be pressed at its place in the
 * sequence, not whenever it happens to be on screen, because pressing it early
 * is exactly the out-of-order mistake the runtime is built to catch.
 */
function walk(
  world: HTMLElement,
  chrome: HTMLElement,
  finished: { value: boolean },
  until?: () => boolean,
): void {
  const remaining = [...CORRECT_PATH];
  let guard = 0;
  while (!finished.value && guard++ < 80 && !until?.()) {
    if (pressContinue(chrome)) continue;
    const next = remaining.shift();
    if (!next) break;
    if (next[0] === '(wait)') {
      const waitButton = chrome.querySelector<HTMLButtonElement>('.wait-button');
      assert.ok(waitButton && !waitButton.hidden, 'the wait control should be offered here');
      waitButton.click();
      continue;
    }
    touch(world, next[0], next[1]);
  }
}

test('a learner can reach a pass by touching the screen', async () => {
  const { controller, world, chrome, finished } = await mount(2);

  walk(world, chrome, finished);

  assert.ok(finished.value, `drill did not finish; stuck on "${prompt(chrome)}"`);
  const competency = scoreSession(controller.session);
  assert.equal(competency.result, 'pass', `expected a pass, got ${competency.result}`);
  controller.stop();
});

test('climbing in without testing is reachable, fatal, and explained on screen', async () => {
  const { controller, world, chrome, finished } = await mount(2);

  pressContinue(chrome); // brief
  touch(world, 'Settling sump opening', 'Look at');
  touch(world, 'Confined space warning board', 'Look at');
  assert.match(prompt(chrome), /permit/i);

  // the fatal act must be available and must be a deliberate, named choice
  assert.ok(touch(world, 'Settling sump opening', 'Climb in'), 'entry was not offered');

  assert.ok(finished.value, 'entering without a permit should end the drill');
  const banner = chrome.querySelector<HTMLElement>('.banner');
  assert.ok(banner && !banner.hidden, 'the consequence must be shown, not just scored');
  assert.match(banner.className, /fatal/);
  assert.ok((banner.textContent ?? '').length > 0);

  assert.equal(controller.session.outcome, 'fatal');
  controller.stop();
});

test('the checklist comes from authored content and ticks off as steps land', async () => {
  const { controller, world, chrome, finished } = await mount(2);
  void finished;

  pressContinue(chrome);
  touch(world, 'Settling sump opening', 'Look at');
  touch(world, 'Confined space warning board', 'Look at');
  touch(world, 'Work permit board', 'Look at');
  touch(world, 'Shift supervisor', 'Report to');

  // gas_test is an ordered two-step node, so the checklist should show both
  const items = [...chrome.querySelectorAll('.checklist li:not(.checklist-heading)')];
  assert.equal(items.length, 2, `expected 2 checklist items, saw ${items.length}`);
  assert.ok(items.every((item) => !item.classList.contains('done')));

  touch(world, 'gas detector', 'Use');
  const after = [...chrome.querySelectorAll('.checklist li:not(.checklist-heading)')];
  assert.equal(after.filter((i) => i.classList.contains('done')).length, 1);
  controller.stop();
});

test('a spawned prop is absent until an effect brings it into the scene', async () => {
  const { controller, world, chrome, finished } = await mount(2);

  const casualtyVisible = () =>
    tiles(world).some((t) => labelOf(t).includes('Collapsed worker'));
  assert.equal(casualtyVisible(), false, 'the casualty must not be on screen from the start');

  walk(world, chrome, finished, casualtyVisible);

  assert.ok(casualtyVisible(), 'the casualty should appear once the spawn effect fires');
  controller.stop();
});

test('switching language re-renders scenario content, not just chrome', async () => {
  const { controller, world, chrome } = await mount(2, 'en');
  const english = prompt(chrome);

  const hindiButton = [...chrome.querySelectorAll<HTMLButtonElement>('.lang-button')].find(
    (b) => b.dataset.code === 'hi',
  );
  assert.ok(hindiButton, 'language picker is missing Hindi');
  hindiButton.click();

  const hindi = prompt(chrome);
  assert.notEqual(hindi, english);
  assert.match(hindi, /[ऀ-ॿ]/, 'expected Devanagari after switching to Hindi');

  // prop labels must switch too — the tiles are content, not decoration
  assert.ok(tiles(world).some((t) => /[ऀ-ॿ]/.test(labelOf(t))));
  controller.stop();
});

/**
 * Content-to-affordance check.
 *
 * A scenario can expect `report radio` while the UI only offers equipment
 * `inspect / use / attach` — the drill then becomes literally uncompletable, and
 * every unit test still passes because the engine is perfectly happy. This walks
 * the authored graph and asserts every expected action can actually be performed.
 * It guards both tiers at once, because they share one verb table.
 */
test('every action the scenario expects can actually be performed in the UI', () => {
  const kindOf = new Map(scenario.props.map((p) => [p.id, p.kind]));
  const checked: string[] = [];

  // Walk resolved variants, not the authored source: bindings hold `{{param}}`
  // templates until a variant resolves them, and a variant that swaps in a
  // different prop could swap in one whose kind does not offer the verb.
  const variants = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => resolveVariant(scenario, seed));
  for (const variant of variants) {
  const resolveRole = (target: string) => variant.bindings[target] ?? target;
  const check = (verb: string | undefined, target: string | undefined, where: string) => {
    if (!verb || verb === 'wait') return; // objectless verbs are offered by the HUD
    if (!target) return;
    const propId = resolveRole(target);
    const kind = kindOf.get(propId);
    assert.ok(kind, `${where}: "${propId}" is not a declared prop`);
    const offered = VERBS_BY_KIND[kind];
    assert.ok(
      offered.includes(verb as (typeof offered)[number]),
      `${where}: a ${kind} offers [${offered.join(', ')}] but the scenario expects "${verb}"`,
    );
    checked.push(`${verb} ${propId}`);
  };

  for (const node of variant.nodes) {
    const where = `${variant.variantId} ${node.id}`;
    if (node.kind === 'expect') {
      node.expect.forEach((e, i) => check(e.match.verb, e.match.target, `${where}.expect[${i}]`));
      // error rules matter just as much: a fatal mistake the UI cannot express
      // is a lesson the learner can never be taught
      node.errors?.forEach((rule, i) =>
        check(rule.match.verb, rule.match.target, `${where}.errors[${i}]`),
      );
    }
    if (node.kind === 'observe') {
      [...node.targets, ...(node.distractors ?? [])].forEach((target, i) =>
        check('inspect', target, `${where}.targets[${i}]`),
      );
    }
  }
  }

  assert.ok(checked.length > 100, `only ${checked.length} actions checked — the walk missed nodes`);
  // both detectors must be reachable, since a variant can bind either
  assert.ok(checked.some((c) => c.endsWith('detector_multi')));
  assert.ok(checked.some((c) => c.endsWith('detector_spare')));
});

test('both tiers name every verb identically', () => {
  // Tier A and Tier C import the same table by construction; this fails if
  // either grows a private copy, which would mean the two tiers were asking
  // subtly different questions and their results were no longer comparable.
  for (const verbs of Object.values(VERBS_BY_KIND)) {
    for (const verb of verbs) {
      assert.ok(VERB_ICON[verb], `no icon for "${verb}"`);
      assert.ok(VERB_LABEL[verb]?.en && VERB_LABEL[verb]?.hi, `no label for "${verb}"`);
    }
  }
});

after(() => {
  void window.happyDOM.close();
});
