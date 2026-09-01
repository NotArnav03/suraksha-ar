import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { certify } from '../src/assess/certify.ts';
import { HESITATION_PENALTY, SEVERITY_PENALTY, scoreSession, type Competency } from '../src/assess/score.ts';
import { DrillSession } from '../src/engine/runtime.ts';
import type { Action, Dimension, Scenario } from '../src/engine/types.ts';
import { distinctVariants, resolveVariant, sampleParams } from '../src/engine/variant.ts';
import { validateScenario } from '../src/engine/validate.ts';

const scenario: Scenario = validateScenario(
  JSON.parse(
    await readFile(
      fileURLToPath(new URL('../src/scenarios/gas-confined-space.json', import.meta.url)),
      'utf8',
    ),
  ),
);

function stepper(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

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
    if (node.kind === 'brief') session.acknowledge();
    else if (node.kind === 'expect') {
      const next = session.pending[0];
      if (!next) return;
      const { verb, target } = next.match;
      session.dispatch({ verb: verb ?? 'inspect', ...(target ? { target } : {}) } as Action);
    } else if (node.kind === 'observe') {
      const remaining = node.targets.find((r) => !session.observed.has(session.resolveTarget(r)));
      if (!remaining) return;
      session.dispatch({ verb: 'inspect', target: remaining });
    } else return;
  }
}

function runIdeal(seed: number): Competency {
  const clock = stepper();
  const session = new DrillSession(resolveVariant(scenario, seed), { now: clock.now });
  playIdeal(session, clock);
  return scoreSession(session);
}

function scoreOf(competency: Competency, dimension: Dimension): number | null {
  return competency.vector.find((d) => d.dimension === dimension)?.score ?? null;
}

function seedFor(permitState: string): number {
  let seed = 1;
  while (String(sampleParams(scenario, seed).permit_state) !== permitState) seed++;
  return seed;
}

test('a clean run scores 100 on every dimension it produced evidence for', () => {
  const competency = runIdeal(2);
  assert.equal(competency.result, 'pass');
  assert.equal(competency.shortfalls.length, 0);
  for (const dimension of competency.vector) {
    if (dimension.evidence === 0) continue;
    assert.equal(dimension.score, 100, `${dimension.dimension} was ${dimension.score}`);
    assert.equal(dimension.passed, true);
  }
});

test('a fatal error floors its dimension outright rather than averaging away', () => {
  const clock = stepper();
  const session = new DrillSession(resolveVariant(scenario, 7), { now: clock.now });
  playIdeal(session, clock, 2000, 'rescue_decision');
  clock.advance(2000);
  session.dispatch({ verb: 'enter', target: 'sump' });

  const competency = scoreSession(session);
  assert.equal(competency.result, 'fatal');

  const restraint = competency.vector.find((d) => d.dimension === 'rescue_restraint');
  assert.equal(restraint?.score, 0);
  assert.equal(restraint?.floored, true);

  // Averaging is exactly what we are refusing to do: this worker was flawless
  // everywhere else, and a single-number system would have certified them.
  assert.equal(scoreOf(competency, 'procedure_sequence'), 100);
  assert.equal(scoreOf(competency, 'ppe_discipline'), 100);
});

test('a major error costs exactly its severity weight on one node', () => {
  const clock = stepper();
  const session = new DrillSession(resolveVariant(scenario, 11), { now: clock.now });
  playIdeal(session, clock, 2000, 'gas_test');

  clock.advance(2000);
  const step = session.dispatch({ verb: 'inspect', target: 'sump' }); // sniffed it
  assert.equal(step.verdict, 'wrong');
  playIdeal(session, clock);

  const competency = scoreSession(session);
  assert.equal(competency.result, 'pass', 'a recoverable mistake must not fail the drill');

  const recognition = competency.vector.find((d) => d.dimension === 'hazard_recognition');
  assert.ok(recognition);
  const expected = Math.round(
    ((recognition.possible - SEVERITY_PENALTY.major) / recognition.possible) * 100,
  );
  assert.equal(recognition.score, expected);
  assert.ok(recognition.score! < 100 && recognition.score! > 70);
});

test('hesitation costs time_criticality and nothing else', () => {
  const clock = stepper();
  const session = new DrillSession(resolveVariant(scenario, 2), { now: clock.now });
  playIdeal(session, clock, 2000, 'evacuate');

  clock.advance(20_000); // past the 8s hesitation window, inside the 30s deadline
  session.dispatch({ verb: 'exit', target: 'sump' });
  clock.advance(1000);
  session.dispatch({ verb: 'signal', target: 'standby' });
  playIdeal(session, clock);

  const competency = scoreSession(session);
  assert.equal(competency.latency.hesitations, 1);

  const time = competency.vector.find((d) => d.dimension === 'time_criticality');
  assert.equal(time?.score, Math.round((1 - HESITATION_PENALTY) * 100));

  // the same node also measures procedure_sequence, which must be untouched
  const sequence = competency.contributions.filter(
    (c) => c.nodeId === 'evacuate' && c.dimension === 'procedure_sequence',
  );
  assert.equal(sequence.length, 1);
  assert.equal(sequence[0]!.penalties.length, 0);
});

test('a dimension with no evidence scores null, not zero', () => {
  const clock = stepper();
  const session = new DrillSession(resolveVariant(scenario, seedFor('valid')), { now: clock.now });
  // die at the very first assessed decision, before most dimensions are touched
  playIdeal(session, clock, 2000, 'check_permit');
  clock.advance(2000);
  session.dispatch({ verb: 'enter', target: 'sump' });

  const competency = scoreSession(session);
  assert.equal(competency.result, 'fatal');

  const restraint = competency.vector.find((d) => d.dimension === 'rescue_restraint');
  assert.equal(restraint?.score, null, 'never tested is not the same as failed');
  assert.equal(restraint?.evidence, 0);
  assert.equal(restraint?.passed, null);
});

test('every score traces back to named nodes', () => {
  const clock = stepper();
  const session = new DrillSession(resolveVariant(scenario, 7), { now: clock.now });
  playIdeal(session, clock, 2000, 'rescue_decision');
  clock.advance(2000);
  session.dispatch({ verb: 'enter', target: 'sump' });

  const competency = scoreSession(session);
  const trace = competency.contributions.find(
    (c) => c.dimension === 'rescue_restraint' && c.nodeId === 'rescue_decision',
  );
  assert.ok(trace, 'a floored dimension must still say which node floored it');
  assert.equal(trace.earned, 0);
  assert.equal(trace.penalties[0]?.reason, 'SECOND_VICTIM_ENTRY');

  // the vector totals must equal the sum of the traced contributions
  for (const dimension of competency.vector) {
    if (dimension.floored || dimension.evidence === 0) continue;
    const summed = competency.contributions
      .filter((c) => c.dimension === dimension.dimension)
      .reduce((total, c) => total + c.earned, 0);
    assert.ok(
      Math.abs(summed - dimension.earned) < 0.01,
      `${dimension.dimension}: vector says ${dimension.earned}, contributions sum to ${summed}`,
    );
  }
});

test('certification needs distinct variants, not repeated attempts at one', () => {
  const single = runIdeal(2);
  const repeated = certify(scenario, [single, single, single, single]);
  assert.equal(repeated.granted, false);
  assert.equal(repeated.distinctVariantsPassed, 1);

  const variants = distinctVariants(scenario, scenario.scoring.requiredVariants);
  const attempts = variants.map((v) => runIdeal(v.seed));
  const granted = certify(scenario, attempts);
  assert.equal(granted.granted, true);
  assert.equal(granted.distinctVariantsPassed, scenario.scoring.requiredVariants);
});

test('failing then passing a variant still counts — a fatal is not a life sentence', () => {
  const variants = distinctVariants(scenario, scenario.scoring.requiredVariants);

  const failed: Competency[] = variants.map((variant) => {
    const clock = stepper();
    const session = new DrillSession(variant, { now: clock.now });
    playIdeal(session, clock, 2000, 'rescue_decision');
    clock.advance(2000);
    session.dispatch({ verb: 'enter', target: 'sump' });
    return scoreSession(session);
  });
  assert.equal(certify(scenario, failed).granted, false);

  const retried = variants.map((v) => runIdeal(v.seed));
  assert.equal(certify(scenario, [...failed, ...retried]).granted, true);
});

test('the aggregate reports the worst attempt, not just the mean', () => {
  const variants = distinctVariants(scenario, 3);
  const clean = variants.slice(0, 2).map((v) => runIdeal(v.seed));

  const sloppy = (() => {
    const clock = stepper();
    const session = new DrillSession(variants[2]!, { now: clock.now });
    playIdeal(session, clock, 2000, 'gas_test');
    clock.advance(2000);
    session.dispatch({ verb: 'inspect', target: 'sump' });
    playIdeal(session, clock);
    return scoreSession(session);
  })();

  const certification = certify(scenario, [...clean, sloppy]);
  const recognition = certification.vector.find((d) => d.dimension === 'hazard_recognition');
  assert.ok(recognition);
  assert.ok(recognition.worst! < recognition.mean!, 'the worst attempt must survive aggregation');
  assert.equal(certification.weakest?.dimension, 'hazard_recognition');
});

test('reaching the pass outcome is not on its own enough to be certified', () => {
  // Contrive a run that reaches outcome_pass while dropping a dimension below its
  // mark: hesitate repeatedly on the evacuation, which is the only time-scored node.
  const clock = stepper();
  const session = new DrillSession(resolveVariant(scenario, 2), { now: clock.now });
  playIdeal(session, clock, 2000, 'evacuate');

  clock.advance(20_000);
  session.dispatch({ verb: 'exit', target: 'sump' });
  clock.advance(20_000);
  session.dispatch({ verb: 'signal', target: 'standby' });
  playIdeal(session, clock);

  assert.equal(session.outcome, 'pass');
  const competency = scoreSession(session);
  assert.equal(scoreOf(competency, 'time_criticality'), 50);
  assert.equal(competency.result, 'fail', 'outcome pass + dimension shortfall must not certify');
  assert.deepEqual(competency.shortfalls, ['time_criticality']);
});
