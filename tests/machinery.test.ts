import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { VERBS_BY_KIND } from '../src/app/render/contract.ts';
import { scoreSession } from '../src/assess/score.ts';
import { DrillSession } from '../src/engine/runtime.ts';
import type { Action, ResolvedScenario } from '../src/engine/types.ts';
import { validateScenario } from '../src/engine/validate.ts';
import { distinctVariants, resolveVariant } from '../src/engine/variant.ts';

/**
 * The conveyor lock-out drill.
 *
 * SIH26041 names three domains (fire response, gas leaks, machinery hazards)
 * and this is the third. Its fatal reflex is the machinery version of the one
 * the other two drills measure: grabbing a person caught in a machine before
 * the machine is stopped. These tests drive the real engine through each
 * variant, correctly and with each named mistake.
 */

const dir = fileURLToPath(new URL('../src/scenarios/', import.meta.url));
const scenario = validateScenario(JSON.parse(await readFile(dir + 'machinery-conveyor-loto.json', 'utf8')));

type Sabotage = { at: string; action: Action };

/** Plays a variant the way an ideal operator would, optionally doing one wrong thing at one node. */
function play(variant: ResolvedScenario, sabotage?: Sabotage) {
  let clock = 0;
  const session = new DrillSession(variant, { now: () => clock });
  let sabotaged = false;
  for (let guard = 0; !session.finished && guard < 200; guard++) {
    clock += 2500;
    const node = session.node;
    if (sabotage && !sabotaged && node.id === sabotage.at) {
      sabotaged = true;
      session.dispatch(sabotage.action);
      continue;
    }
    if (node.kind === 'brief') {
      session.acknowledge();
    } else if (node.kind === 'expect') {
      const next = session.pending[0];
      assert.ok(next, `${node.id} has nothing pending but did not advance`);
      session.dispatch({ verb: next.match.verb ?? 'inspect', ...(next.match.target ? { target: next.match.target } : {}) });
    } else if (node.kind === 'observe') {
      const remaining = node.targets.find((t) => !session.observed.has(session.resolveTarget(t)));
      assert.ok(remaining, `${node.id} has no target left but did not advance`);
      session.dispatch({ verb: 'inspect', target: remaining });
    }
  }
  assert.ok(session.finished, `drill did not finish; stuck on ${session.node.id}`);
  if (sabotage) assert.ok(sabotaged, `the drill never reached ${sabotage.at}`);
  return { session, competency: scoreSession(session) };
}

/** One resolved variant for every belt / state combination. */
function everyCombination(): ResolvedScenario[] {
  const found = new Map<string, ResolvedScenario>();
  for (let seed = 1; seed < 200 && found.size < 4; seed++) {
    const v = resolveVariant(scenario, seed);
    found.set(`${v.params.belt}/${v.params.belt_state}`, v);
  }
  assert.equal(found.size, 4, 'both belts and both belt states should all be reachable');
  return [...found.values()];
}

test('an ideal operator passes every belt and belt-state combination', () => {
  for (const variant of everyCombination()) {
    const { session, competency } = play(variant);
    assert.equal(competency.result, 'pass', `${variant.params.belt}/${variant.params.belt_state}`);
    assert.equal(session.node.id, 'outcome_pass');
    assert.deepEqual(competency.shortfalls, []);
  }
});

test('the variant decides which isolator is the right one, and whether the belt must be stopped first', () => {
  for (const variant of everyCombination()) {
    const ids = variant.nodes.map((n) => n.id);
    const own = `isolate_${String(variant.params.belt).toLowerCase()}`;
    assert.ok(ids.includes(own), `${variant.variantId} should keep ${own}`);
    assert.equal(ids.filter((id) => id.startsWith('isolate_')).length, 1, 'exactly one isolation step per variant');
    assert.equal(ids.includes('stop_belt'), variant.params.belt_state === 'running');
  }
  assert.equal(distinctVariants(scenario, scenario.scoring.requiredVariants).length, scenario.scoring.requiredVariants);
});

test('grabbing the caught helper before the belt is stopped is fatal, and says why', () => {
  for (const variant of everyCombination()) {
    const { session, competency } = play(variant, {
      at: 'rescue_decision',
      action: { verb: 'inspect', target: 'casualty' },
    });
    assert.equal(competency.result, 'fatal');
    assert.equal(session.node.id, 'outcome_fatal_second_victim');
    assert.ok(competency.errorCounts.some((e) => e.code === 'SECOND_VICTIM_PULLED_IN'));
    assert.ok(competency.shortfalls.includes('rescue_restraint'));
  }
});

test('reaching into the jam on a live belt is fatal', () => {
  const [variant] = everyCombination();
  const { session, competency } = play(variant!, { at: 'observe_hazards', action: { verb: 'use', target: 'jam' } });
  assert.equal(competency.result, 'fatal');
  assert.equal(session.node.id, 'outcome_fatal_live_belt');
});

test('going to the helper before the lock-out fails the drill without ending it', () => {
  const [variant] = everyCombination();
  const { session, competency } = play(variant!, { at: 'lock_and_tag', action: { verb: 'inspect', target: 'casualty' } });
  assert.equal(session.node.id, 'outcome_pass', 'the drill runs to the end so the learner still finishes the procedure');
  assert.equal(competency.result, 'fail', 'but the certificate is withheld: rescue restraint has no partial credit');
  assert.ok(competency.shortfalls.includes('rescue_restraint'));
});

test('opening the wrong isolator is a named error, and the right one is still required', () => {
  for (const variant of everyCombination()) {
    const belt = String(variant.params.belt).toLowerCase();
    const other = belt === 'c3' ? 'c4' : 'c3';
    const { session, competency } = play(variant, {
      at: `isolate_${belt}`,
      action: { verb: 'open', target: `isolator_${other}` },
    });
    assert.ok(competency.errorCounts.some((e) => e.code === 'WRONG_ISOLATOR'));
    const isolated = session.results.find((r) => r.nodeId === `isolate_${belt}`);
    assert.ok(isolated?.satisfied, 'the step only completes when the correct isolator is opened');
  }
});

test('every language this drill claims is authored on every string in it', () => {
  // Declaring a language and shipping half of it is the failure here. The
  // fallback chain hides it: a Santali learner just reads Hindi, on the one
  // screen where the missing line was, and nothing anywhere says so.
  const missing: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.en === 'string') {
      for (const language of scenario.languages) {
        if (language === 'en') continue;
        const translated = record[language];
        if (typeof translated !== 'string' || translated.length === 0) {
          missing.push(`${path} (${language})`);
          continue;
        }
        // `{{shift}}` is the exception: the shift names are English words the
        // translations say in their own, so the placeholder does not survive
        // and should not. Every other placeholder carries a belt number or a
        // reading, and losing one puts the wrong plant in front of a learner.
        const dropped = (record.en.match(/\{\{\w+\}\}/g) ?? []).filter(
          (placeholder) => placeholder !== '{{shift}}' && !translated.includes(placeholder),
        );
        if (dropped.length > 0) missing.push(`${path} (${language}, lost ${dropped.join(' ')})`);
      }
      return;
    }
    for (const [k, v] of Object.entries(record)) walk(v, `${path}.${k}`);
  };
  walk(scenario, '$');
  assert.deepEqual(missing, []);
  assert.deepEqual(
    scenario.languages,
    ['en', 'hi', 'sat'],
    'the conveyor drill is authored in all three; drop one here only by removing its text too',
  );
});

test('every action any scenario expects can be performed with the verbs the UI offers', async () => {
  // The general form of the gas-drill check in app.test.ts, over every module.
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  assert.ok(files.includes('machinery-conveyor-loto.json'));
  for (const file of files) {
    const s = validateScenario(JSON.parse(await readFile(dir + file, 'utf8')));
    const kindOf = new Map(s.props.map((p) => [p.id, p.kind]));
    for (let seed = 1; seed <= 12; seed++) {
      const variant = resolveVariant(s, seed);
      const check = (verb: string | undefined, target: string | undefined, where: string) => {
        if (!verb || verb === 'wait' || !target) return;
        const propId = variant.bindings[target] ?? target;
        const kind = kindOf.get(propId);
        assert.ok(kind, `${file} ${where}: "${propId}" is not a declared prop`);
        assert.ok(
          (VERBS_BY_KIND[kind] as string[]).includes(verb),
          `${file} ${where}: a ${kind} offers [${VERBS_BY_KIND[kind].join(', ')}], not "${verb}"`,
        );
      };
      for (const node of variant.nodes) {
        if (node.kind === 'expect') {
          node.expect.forEach((e, i) => check(e.match.verb, e.match.target, `${node.id}.expect[${i}]`));
          node.errors?.forEach((r, i) => check(r.match.verb, r.match.target, `${node.id}.errors[${i}]`));
        }
        if (node.kind === 'observe') {
          [...node.targets, ...(node.distractors ?? [])].forEach((t) => check('inspect', t, `${node.id}.targets`));
          node.errors?.forEach((r, i) => check(r.match.verb, r.match.target, `${node.id}.errors[${i}]`));
        }
      }
    }
  }
});
