import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { certify } from '../src/assess/certify.ts';
import type { Competency } from '../src/assess/score.ts';
import { validateScenario } from '../src/engine/validate.ts';

/**
 * Guided mode and assessment mode.
 *
 * The drill used to have one voice: "tap the pull-cord switch and choose Use to
 * stop the belt". That teaches, and it is the right thing to say the first time
 * a worker meets a procedure. It is also the reason the score could not be
 * called competence, because a careful reader who has never seen a conveyor can
 * follow it. Assessment mode says the situation and stops, and only an unaided
 * assessment run can earn a certificate.
 */

const dir = fileURLToPath(new URL('../src/scenarios/', import.meta.url));

async function scenarios() {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  return Promise.all(files.map(async (f) => validateScenario(JSON.parse(await readFile(dir + f, 'utf8')))));
}

/** Words that give the step away: the verb, the tap, the order. */
const GIVEAWAYS = [
  // English: the UI verbs and the mechanics of using the screen
  /\btap\b/i, /\bchoose\b/i, /\bpress\b/i, /\bselect\b/i, /\bbutton\b/i,
  /\bfirst,/i, /\bthen\b/i,
  // Hindi UI words only. Ordering words do not survive a regex here: फिर is
  // "again" as often as "then", and पहले is "before" as often as "first".
  /टैप/, /चुनिए/, /दबाइए/,
];

test('every scored step in every module has a goal line, so all three can be assessed', async () => {
  for (const scenario of await scenarios()) {
    const scored = scenario.nodes.filter((n) => n.kind === 'expect' || n.kind === 'observe');
    assert.ok(scored.length > 0);
    for (const node of scored) {
      assert.ok(node.goal?.text?.en, `${scenario.id}.${node.id} has no goal line`);
      assert.ok(node.goal?.text?.hi, `${scenario.id}.${node.id} has no Hindi goal line`);
    }
  }
});

test('a goal line never names the step: no verbs, no taps, no screen mechanics', async () => {
  // This is the test that keeps assessment mode honest. Without it the goal
  // lines drift back towards instructions one helpful edit at a time, and the
  // competency claim quietly stops being true again.
  const offenders: string[] = [];
  for (const scenario of await scenarios()) {
    for (const node of scenario.nodes) {
      if (!node.goal) continue;
      for (const [lang, text] of Object.entries(node.goal.text)) {
        for (const pattern of GIVEAWAYS) {
          if (pattern.test(text)) offenders.push(`${scenario.id}.${node.id}.${lang}: ${pattern} in "${text}"`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('the guided line says more than the goal, which is what makes it guided', async () => {
  // The inverse check. Vocabulary is a poor proxy here, since a prompt can name
  // the step perfectly well as "report this to your supervisor" without a
  // single UI word. The shape holds regardless: an instruction says more than
  // the situation it carries out, and the two are never the same sentence.
  for (const scenario of await scenarios()) {
    for (const node of scenario.nodes) {
      if (!node.goal) continue;
      const step = node.prompt.text.en;
      const goal = node.goal.text.en;
      assert.notEqual(step, goal, `${scenario.id}.${node.id}: both modes say the same thing`);
      assert.ok(
        step.length > goal.length,
        `${scenario.id}.${node.id}: the guided line (${step.length} chars) should say more than the goal (${goal.length})`,
      );
    }
  }
});

function attempt(overrides: Partial<Competency> = {}): Competency {
  return {
    scenarioId: 'gas-confined-space',
    variantId: 'gas-confined-space@1',
    seed: 1,
    result: 'pass',
    outcomeNodeId: 'outcome_pass',
    vector: [],
    shortfalls: [],
    fatalErrors: [],
    errorCounts: [],
    latency: { medianTimeToFirstCorrectMs: 1000, slowestNodeId: null, slowestMs: null, hesitations: 0 },
    nodes: { assessed: 10, satisfied: 10 },
    contributions: [],
    mode: 'assess',
    hinted: false,
    ...overrides,
  };
}

const scoring = { id: 'gas-confined-space', scoring: { passMark: {}, requiredVariants: 3 } };

test('guided runs never earn a certificate, however many are passed', () => {
  const guided = [1, 2, 3, 4].map((seed) =>
    attempt({ seed, variantId: `gas-confined-space@${seed}`, mode: 'guided' }),
  );
  const certification = certify(scoring, guided);
  assert.equal(certification.granted, false);
  assert.equal(certification.distinctVariantsPassed, 0);
  assert.ok(
    certification.reasons.some((r) => /guided or hinted/.test(r)),
    `the learner should be told why: ${certification.reasons.join(' | ')}`,
  );
});

test('a run where a hint was taken does not count either', () => {
  const attempts = [
    attempt({ seed: 1, variantId: 'gas-confined-space@1' }),
    attempt({ seed: 2, variantId: 'gas-confined-space@2', hinted: true }),
    attempt({ seed: 3, variantId: 'gas-confined-space@3' }),
  ];
  const certification = certify(scoring, attempts);
  assert.equal(certification.distinctVariantsPassed, 2, 'the hinted variant must not be counted');
  assert.equal(certification.granted, false);
});

test('three unaided assessment runs still certify exactly as before', () => {
  const attempts = [1, 2, 3].map((seed) => attempt({ seed, variantId: `gas-confined-space@${seed}` }));
  const certification = certify(scoring, attempts);
  assert.equal(certification.granted, true);
  assert.equal(certification.distinctVariantsPassed, 3);
});
