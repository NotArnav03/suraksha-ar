import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { makeRng, pickNumber } from '../src/engine/rng.ts';
import { DrillSession } from '../src/engine/runtime.ts';
import type { Action, Scenario, ScenarioNode } from '../src/engine/types.ts';
import { distinctVariants, resolveVariant, sampleParams } from '../src/engine/variant.ts';
import { ScenarioError, validateScenario } from '../src/engine/validate.ts';

const SCENARIO_PATH = fileURLToPath(
  new URL('../src/scenarios/gas-confined-space.json', import.meta.url),
);

const scenario: Scenario = validateScenario(
  JSON.parse(await readFile(SCENARIO_PATH, 'utf8')),
);

/** Clock we control, because latency is assessed evidence rather than decoration. */
function stepper(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/** Plays the graph's own expectations back at it — no hard-coded happy path. */
function playIdeal(
  session: DrillSession,
  clock: { advance: (ms: number) => number },
  stepMs = 2000,
  stopAt?: string,
): void {
  let guard = 0;
  while (!session.finished && guard++ < 200) {
    const node = session.node;
    if (stopAt && node.id === stopAt) return;
    clock.advance(stepMs);
    if (node.kind === 'brief') {
      session.acknowledge();
    } else if (node.kind === 'expect') {
      const next = session.pending[0];
      if (!next) return;
      const { verb, target } = next.match;
      session.dispatch({ verb: verb ?? 'inspect', ...(target ? { target } : {}) } as Action);
    } else if (node.kind === 'observe') {
      const remaining = node.targets.find((r) => !session.observed.has(session.resolveTarget(r)));
      if (!remaining) return;
      session.dispatch({ verb: 'inspect', target: remaining });
    } else {
      return;
    }
  }
}

test('the authored scenario passes validation', () => {
  assert.equal(scenario.id, 'gas-confined-space');
  assert.ok(scenario.nodes.length > 10);
});

test('validation reports the path of a dangling node reference', () => {
  const broken = structuredClone(scenario) as Scenario;
  const node = broken.nodes.find((n) => n.id === 'check_permit');
  assert.ok(node && node.kind === 'expect');
  node.next = 'no_such_node';

  assert.throws(
    () => validateScenario(broken),
    (error: unknown) => {
      assert.ok(error instanceof ScenarioError);
      assert.ok(
        error.issues.some(
          (i) => i.path.includes('check_permit') && i.message.includes('no_such_node'),
        ),
        `expected a dangling-reference issue, got ${JSON.stringify(error.issues)}`,
      );
      return true;
    },
  );
});

test('validation rejects a fatal error rule that does not route anywhere', () => {
  const broken = structuredClone(scenario) as Scenario;
  const node = broken.nodes.find((n) => n.id === 'gas_test');
  assert.ok(node && node.kind === 'expect');
  delete node.errors![0]!.goto;

  assert.throws(
    () => validateScenario(broken),
    (error: unknown) =>
      error instanceof ScenarioError &&
      error.issues.some((i) => i.message.includes('fatal error must route')),
  );
});

test('a seed reproduces the same variant exactly', () => {
  const a = resolveVariant(scenario, 42);
  const b = resolveVariant(scenario, 42);
  assert.equal(a.variantId, b.variantId);
  assert.deepEqual(a.params, b.params);
});

test('guarded permit nodes splice out cleanly and leave a walkable graph', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 60; seed++) {
    const variant = resolveVariant(scenario, seed);
    const state = String(variant.params.permit_state);
    seen.add(state);

    const ids = new Set(variant.nodes.map((n) => n.id));
    assert.equal(ids.has('permit_absent'), state === 'absent', `seed ${seed} (${state})`);
    assert.equal(ids.has('permit_expired'), state === 'expired', `seed ${seed} (${state})`);

    // whichever branch survived, every edge still lands on a live node
    for (const node of variant.nodes) {
      if (node.kind !== 'outcome') assert.ok(ids.has(node.next), `${node.id} -> ${node.next}`);
    }
  }
  assert.deepEqual([...seen].sort(), ['absent', 'expired', 'valid']);
});

test('distinct variants are distinct by content, not merely by seed', () => {
  const variants = distinctVariants(scenario, scenario.scoring.requiredVariants * 4);
  const ids = new Set(variants.map((v) => v.variantId));
  assert.equal(ids.size, variants.length);
});

test('the ideal operator can complete every variant branch', () => {
  for (const state of ['valid', 'expired', 'absent']) {
    let seed = 1;
    while (String(sampleParams(scenario, seed).permit_state) !== state) seed++;

    const clock = stepper();
    const session = new DrillSession(resolveVariant(scenario, seed), { now: clock.now });
    playIdeal(session, clock);

    assert.equal(session.outcome, 'pass', `permit_state=${state} (seed ${seed}) did not reach a pass`);
    assert.ok(session.results.every((r) => r.errors.length === 0));
  }
});

test('going in after the collapsed colleague is fatal and named', () => {
  const clock = stepper();
  const session = new DrillSession(resolveVariant(scenario, 7), { now: clock.now });
  playIdeal(session, clock, 2000, 'rescue_decision');
  assert.equal(session.node.id, 'rescue_decision');

  clock.advance(2000);
  const step = session.dispatch({ verb: 'enter', target: 'sump' });

  assert.equal(step.verdict, 'wrong');
  assert.equal(session.outcome, 'fatal');
  assert.equal(session.node.id, 'outcome_fatal_rescue');
  assert.ok(
    session.events.some(
      (e) => e.type === 'error' && e.code === 'SECOND_VICTIM_ENTRY' && e.severity === 'fatal',
    ),
  );
  const result = session.results.find((r) => r.nodeId === 'rescue_decision');
  assert.equal(result?.errors[0]?.dimension, 'rescue_restraint');
});

test('a right step at the wrong time is recorded as a sequence error, not a pass', () => {
  const clock = stepper();
  const session = new DrillSession(resolveVariant(scenario, 2), { now: clock.now });
  playIdeal(session, clock, 2000, 'don_ppe');
  assert.equal(session.node.id, 'don_ppe');

  // clipping the retrieval line before the breathing set is on: correct action, wrong moment
  clock.advance(2000);
  const step = session.dispatch({ verb: 'attach', target: 'line' });

  assert.equal(step.verdict, 'out_of_order');
  assert.equal(session.node.id, 'don_ppe', 'an out-of-order step must not advance the node');
  assert.ok(
    session.events.some((e) => e.type === 'error' && e.dimension === 'procedure_sequence'),
  );
});

test('missing the evacuation deadline is fatal via tick, with no input at all', () => {
  const clock = stepper();
  const session = new DrillSession(resolveVariant(scenario, 2), { now: clock.now });
  playIdeal(session, clock, 2000, 'evacuate');
  assert.equal(session.node.id, 'evacuate');

  assert.equal(session.tick(), null, 'must not fire before the deadline');
  clock.advance(31_000);
  const step = session.tick();

  assert.ok(step);
  assert.equal(session.outcome, 'fatal');
  assert.equal(session.node.id, 'outcome_fatal_gas');
  assert.ok(session.events.some((e) => e.type === 'timeout' && e.code === 'FAILED_TO_EVACUATE'));
});

test('hesitation is recorded without being counted as an error', () => {
  const clock = stepper();
  const session = new DrillSession(resolveVariant(scenario, 2), { now: clock.now });
  playIdeal(session, clock, 2000, 'evacuate');

  clock.advance(20_000); // past hesitationMs (8s), inside deadlineMs (30s)
  const step = session.dispatch({ verb: 'exit', target: 'sump' });

  assert.equal(step.verdict, 'correct', 'slow is still correct');
  assert.ok(
    session.events.some((e) => e.type === 'action' && e.nodeId === 'evacuate' && e.hesitated),
  );
  assert.ok(
    !session.events.some((e) => e.type === 'error' && e.nodeId === 'evacuate'),
    'hesitating is a latency finding, not a taxonomy error',
  );

  // the node is still open (one expectation outstanding), so its record is not folded in yet
  assert.equal(session.node.id, 'evacuate');
  assert.equal(session.results.find((r) => r.nodeId === 'evacuate'), undefined);

  clock.advance(1000);
  session.dispatch({ verb: 'signal', target: 'standby' });
  const result = session.results.find((r) => r.nodeId === 'evacuate');
  assert.equal(result?.hesitations, 1, 'the hesitation survives into the assessed record');
  assert.equal(result?.errors.length, 0);
});

test('distractors are recorded but cost nothing', () => {
  const clock = stepper();
  const session = new DrillSession(resolveVariant(scenario, 2), { now: clock.now });
  assert.equal(session.node.kind, 'brief');
  clock.advance(1000);
  session.acknowledge();
  assert.equal(session.node.id, 'observe_hazards');

  clock.advance(1000);
  const step = session.dispatch({ verb: 'inspect', target: 'barrow' });
  assert.equal(step.verdict, 'distractor');
  assert.equal(session.node.id, 'observe_hazards');
  assert.ok(!session.events.some((e) => e.type === 'error'));
});

test('roles resolve through variant bindings, so the detector prop can change', () => {
  const withMulti = distinctVariants(scenario, 40).find(
    (v) => v.params.detector_choice === 'detector_multi',
  );
  const withSpare = distinctVariants(scenario, 40).find(
    (v) => v.params.detector_choice === 'detector_spare',
  );
  assert.ok(withMulti && withSpare);
  assert.equal(withMulti.bindings.detector, 'detector_multi');
  assert.equal(withSpare.bindings.detector, 'detector_spare');

  // the same authored action works against either binding
  const clock = stepper();
  const session = new DrillSession(withSpare, { now: clock.now });
  playIdeal(session, clock, 2000, 'gas_test');
  clock.advance(2000);
  assert.equal(session.dispatch({ verb: 'use', target: 'detector_spare' }).verdict, 'correct');
});

test('every authored language is present or absent honestly', () => {
  assert.ok(scenario.languages.includes('hi'));
  for (const node of scenario.nodes) {
    assert.ok(node.prompt.text.en, `${node.id} has no English fallback`);
  }
});

test('pickNumber reaches both ends of a fractional range', () => {
  const seen = new Set<number>();
  for (let seed = 1; seed <= 4000; seed++) {
    seen.add(pickNumber(makeRng(seed), 15.4, 19.2, 0.1, 1));
  }
  assert.ok(seen.has(15.4), 'range floor unreachable');
  assert.ok(seen.has(19.2), 'range ceiling unreachable');
});

/**
 * The hazard survey is a looking task, but the UI still offers every verb the
 * prop supports while it runs. The engine used to read only the target and never
 * the verb here, so climbing into the sump during the survey was recorded as
 * having correctly *spotted* the sump: the most lethal act in the scenario,
 * scored as competence, with nothing shown to the learner.
 */
test('entering the sump during the hazard survey is fatal, not an observation', () => {
  const session = new DrillSession(resolveVariant(scenario, 2), { now: () => 0 });
  session.acknowledge();
  assert.equal(session.node.kind, 'observe');

  const step = session.dispatch({ verb: 'enter', target: 'sump' });

  assert.equal(step.verdict, 'wrong', 'climbing in is not a way of noticing');
  assert.equal(session.observed.size, 0, 'it must not count toward the survey');
  assert.equal(session.outcome, 'fatal');
  assert.ok(step.consequence, 'the learner must be told what happened');
  assert.equal(step.severity, 'fatal');
  assert.ok(
    step.effects.some((e) => e.type === 'haptic'),
    'the consequence must be felt, not only scored',
  );

  // The debrief is the pedagogical payload — a learner reads it after the
  // banner has gone. Routing this rule at the permit outcome, as the first
  // version did, told someone who never reached a permit that a permit was
  // what killed them.
  assert.equal(session.node.id, 'outcome_fatal_survey');

  const debrief = scenario.nodes.find(
    (n): n is Extract<ScenarioNode, { kind: 'outcome' }> =>
      n.kind === 'outcome' && n.id === 'outcome_fatal_survey',
  );
  const permitDebrief = scenario.nodes.find(
    (n): n is Extract<ScenarioNode, { kind: 'outcome' }> =>
      n.kind === 'outcome' && n.id === 'outcome_fatal_entry',
  );
  assert.ok(debrief, 'the survey entry needs an outcome of its own');
  assert.ok(permitDebrief);
  assert.notEqual(
    debrief.summary.text.en,
    permitDebrief.summary.text.en,
    'a learner who never reached a permit must not be told a permit killed them',
  );
  assert.match(
    debrief.summary.text.en,
    /look/i,
    'the debrief has to name the reflex that actually failed',
  );
});

test('looking at a hazard during the survey still counts as spotting it', () => {
  const session = new DrillSession(resolveVariant(scenario, 2), { now: () => 0 });
  session.acknowledge();

  const step = session.dispatch({ verb: 'inspect', target: 'sump' });

  assert.equal(step.verdict, 'correct');
  assert.equal(session.observed.size, 1);
  assert.equal(session.outcome, null);
});
