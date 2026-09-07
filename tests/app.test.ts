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

async function mount(seed: number, lang: 'en' | 'hi' | 'sat' = 'en'): Promise<Harness> {
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

test('setting .hidden on every toggled element actually hides it, per the real stylesheet', async () => {
  // Regression test for a real bug: `.sheet { display: flex; ... }` set
  // `display` unconditionally, and an author-stylesheet declaration beats the
  // browser's built-in `[hidden] { display: none }` regardless of selector
  // specificity — origin is checked before specificity in the cascade. So
  // `sheet.hidden = true` was a silent no-op: the sheet stayed laid out and
  // visible no matter what the DOM property said. Cancel looked broken;
  // really, nothing that ever closed a sheet had worked, on any tier, ever —
  // it just went unnoticed because a newly opened sheet's content visually
  // replaces the "closed" one still sitting there.
  //
  // This loads the actual shipped CSS (not a copy) into a real stylesheet and
  // checks computed style, which is the only way to catch a cascade-origin
  // bug — asserting on the `hidden` DOM property, as every other test here
  // does for convenience, cannot see this class of bug at all.
  // happy-dom does not implement the browser's built-in `[hidden] { display:
  // none }` user-agent rule at all — even a bare element with zero author CSS
  // computes `display:block` when hidden in this test environment. Real
  // browsers apply that UA rule at lower cascade priority than any author
  // rule, regardless of specificity; the closest honest simulation here is
  // textual order, injecting the UA-equivalent rule before the real app CSS,
  // which resolves identically for every tied-specificity case this guards.
  const css = await readFile(fileURLToPath(new URL('../src/app/style.css', import.meta.url)), 'utf8');
  const style = window.document.createElement('style');
  style.textContent = `[hidden] { display: none; }\n${css}`;
  window.document.head.append(style as never);

  for (const className of ['sheet', 'ar-hint', 'ar-crosshair', 'readout', 'banner', 'timer']) {
    const el = window.document.createElement('div');
    el.className = className;
    (el as unknown as HTMLElement).hidden = true;
    window.document.body.append(el as never);
    const display = window.getComputedStyle(el as never).display;
    assert.equal(display, 'none', `.${className}[hidden] computed to display:${display}, not none`);
    el.remove();
  }

  style.remove();
});

test('both tiers name every verb identically', () => {
  // Tier A and Tier C import the same table by construction; this fails if
  // either grows a private copy, which would mean the two tiers were asking
  // subtly different questions and their results were no longer comparable.
  for (const verbs of Object.values(VERBS_BY_KIND)) {
    for (const verb of verbs) {
      assert.ok(VERB_ICON[verb], `no icon for "${verb}"`);
      assert.ok(
        VERB_LABEL[verb]?.en && VERB_LABEL[verb]?.hi && VERB_LABEL[verb]?.sat,
        `"${verb}" is missing a language — a learner who picked Santali would silently see Hindi here`,
      );
    }
  }
});

test('verb labels actually resolve to the selected language, not a hardcoded fallback', () => {
  // Regression test for a real bug: verb labels used to be read via
  // `code === 'en' ? labels.en : labels.hi` at every call site, so a learner
  // who picked Santali silently kept seeing Hindi on every single verb.
  const hi = new Localizer('hi');
  const sat = new Localizer('sat');
  for (const verb of Object.keys(VERB_LABEL) as (keyof typeof VERB_LABEL)[]) {
    const hindi = hi.text(VERB_LABEL[verb]);
    const santali = sat.text(VERB_LABEL[verb]);
    assert.notEqual(santali, hindi, `"${verb}" reads the same in Santali as in Hindi`);
    assert.equal(santali, VERB_LABEL[verb].sat, `"${verb}" did not resolve to its authored Santali text`);
  }
});

test('the verb sheet renders in the language actually selected, live in the DOM', async () => {
  const { world, chrome } = await mount(2, 'sat');
  pressContinue(chrome); // past the narration-only brief node, where tiles are disabled
  const tile = tiles(world).find((t) => labelOf(t).length > 0 && !t.disabled);
  assert.ok(tile, 'no prop tile rendered');
  tile.click();

  const verbText = world.querySelector('.sheet-card .verb')?.textContent ?? '';
  assert.match(verbText, /[᱐-᱿]/, 'expected Ol Chiki script in the Santali verb sheet');
});

test('Cancel actually closes the verb sheet without recording an action', async () => {
  const { controller, world, chrome } = await mount(2);
  pressContinue(chrome); // past the narration-only brief node, where tiles are disabled
  const before = controller.session.events.length;

  const tile = tiles(world).find((t) => labelOf(t).length > 0 && !t.disabled);
  tile!.click();
  const sheet = world.querySelector<HTMLElement>('.sheet');
  assert.ok(sheet && !sheet.hidden, 'sheet did not open');

  const cancel = [...sheet.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.className === 'ghost',
  );
  assert.ok(cancel, 'no Cancel button found in the sheet');
  cancel.click();

  assert.ok(sheet.hidden, 'Cancel did not close the sheet');
  assert.equal(
    controller.session.events.length,
    before,
    'Cancel must not dispatch an action into the session',
  );
});

after(() => {
  void window.happyDOM.close();
});

/**
 * Silence is indistinguishable from a broken app.
 *
 * A learner who taps a verb that does not apply at this step used to get nothing
 * back at all — which is exactly what this project was first reported as: "the
 * buttons don't work". The receipt says the tap arrived. What it must never do
 * is say whether the tap was right, because choosing the right action is the
 * thing being measured.
 */
test('every action gets a receipt, and the receipt does not reveal the verdict', async () => {
  const { controller, world, chrome } = await mount(2);
  const pulse = chrome.querySelector<HTMLElement>('.input-pulse');
  assert.ok(pulse, 'the HUD must carry an input receipt');

  pressContinue(chrome);

  // an action that does nothing here at all
  assert.ok(touch(world, 'Tool box', 'Look at'), 'the distractor must be tappable');
  assert.ok(pulse.classList.contains('on'), 'an ignored action must still be acknowledged');
  const afterIgnored = pulse.className;

  // and one that is exactly right
  assert.ok(touch(world, 'Settling sump opening', 'Look at'));
  assert.ok(pulse.classList.contains('on'), 'a correct action is acknowledged the same way');
  assert.equal(pulse.className, afterIgnored, 'the receipt must not differ by verdict');

  controller.stop();
});

/**
 * A step out of order is scored as a major error against procedure_sequence.
 * Being marked down for something you were never told about hides the mistake
 * and reads as a bug, so it has to reach the banner like any other consequence.
 */
test('a step taken out of order is shown to the learner, not only scored', async () => {
  const { controller, world, chrome } = await mount(2);

  pressContinue(chrome);
  touch(world, 'Settling sump opening', 'Look at');
  touch(world, 'Confined space warning board', 'Look at');
  touch(world, 'Work permit board', 'Look at');
  touch(world, 'Shift supervisor', 'Report to');

  // gas_test is ordered: the readout cannot be read before the detector is used
  assert.match(prompt(chrome), /test the air from outside/i);
  assert.ok(touch(world, 'Detector readout', 'Look at'), 'the readout must be tappable');

  const banner = chrome.querySelector<HTMLElement>('.banner');
  assert.ok(banner && !banner.hidden, 'an out-of-order step must be shown, not silently scored');
  assert.match(banner.className, /major/);
  assert.ok((banner.textContent ?? '').length > 0);

  controller.stop();
});
