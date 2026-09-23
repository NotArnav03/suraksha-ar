import assert from 'node:assert/strict';
import { test } from 'node:test';

import { certify } from '../src/assess/certify.ts';
import type { Competency } from '../src/assess/score.ts';
import { issueCredential, verifyCredential } from '../src/credential/credential.ts';
import { generateIssuerKey, nodeSigner, nodeVerifier } from '../src/credential/node-crypto.ts';
import { resolveDigests, isKnown, describeParams, scenarioForDomain } from '../src/admin/replay.ts';
import { resolveVariant } from '../src/engine/variant.ts';

/**
 * Auditor replay.
 *
 * The credential spends four bytes per variant rather than carrying the
 * parameters, because it has to scan off a cracked screen in a coal yard. That
 * trade is only honest if the drills can be recovered from those four bytes,
 * which is what the dashboard now does: a supervisor sees that the worker faced
 * belt C4, tripped, on the night shift, and can run the identical drill.
 *
 * This is the round trip, end to end: real variants, a real signed credential,
 * verified, and then turned back into the drills it was earned on.
 */

function passedAttempt(variantId: string, seed: number, scenarioId: string): Competency {
  return {
    scenarioId,
    variantId,
    seed,
    result: 'pass',
    outcomeNodeId: 'outcome_pass',
    vector: [],
    shortfalls: [],
    fatalErrors: [],
    errorCounts: [],
    latency: { medianTimeToFirstCorrectMs: 900, slowestNodeId: null, slowestMs: null, hesitations: 0 },
    nodes: { assessed: 10, satisfied: 10 },
    contributions: [],
    mode: 'assess',
    hinted: false,
  };
}

test('a credential can be turned back into the exact drills it was earned on', async () => {
  const scenario = scenarioForDomain('machinery_haulage_loto');
  assert.ok(scenario, 'the conveyor drill should be findable by its domain');

  // Three distinct variants, taken from the engine rather than made up.
  const seeds = [1, 3, 4];
  const variants = seeds.map((seed) => resolveVariant(scenario, seed));
  const distinct = new Set(variants.map((v) => v.variantId));
  assert.equal(distinct.size, 3, 'the chosen seeds should be three different drills');

  const attempts = variants.map((v) => passedAttempt(v.variantId, v.seed, scenario.id));
  const certification = certify(scenario, attempts);
  assert.equal(certification.granted, true);

  const key = generateIssuerKey();
  const issued = await issueCredential(
    certification,
    { subjectId: 'JH/CHP/7781', domain: scenario.domain },
    nodeSigner(key),
  );
  const verified = await verifyCredential(issued.text, nodeVerifier({ [key.keyId]: key.publicKeySpki }));
  assert.equal(verified.valid, true);
  if (!verified.valid) return;

  const recovered = resolveDigests(verified.domain, verified.variantDigests);
  assert.equal(recovered.length, 3);
  assert.ok(recovered.every(isKnown), 'every digest should resolve to a drill in this build');

  const recoveredIds = recovered.filter(isKnown).map((r) => r.variantId).sort();
  assert.deepEqual(recoveredIds, [...distinct].sort(), 'the drills recovered must be the drills passed');

  for (const entry of recovered.filter(isKnown)) {
    // The parameters, not just an id: this is what the supervisor reads.
    assert.ok(entry.params.belt === 'C3' || entry.params.belt === 'C4');
    assert.match(describeParams(entry.params), /belt C[34]/);
    // And the link has to run that same drill, which is why an explicitly
    // named seed now resolves directly instead of being looked up in the pool.
    assert.match(entry.href, /scenario=machinery-conveyor-loto/);
    assert.match(entry.href, new RegExp(`seed=${entry.seed}\\b`));
    assert.equal(resolveVariant(scenario, entry.seed).variantId, entry.variantId);
  }
});

test('a digest from a module that has since been edited is reported, not hidden', () => {
  // A supervisor holding a credential whose drill no longer exists in this
  // build needs to be told that, or the empty list reads as "no drills".
  const recovered = resolveDigests('machinery_haulage_loto', [0xdeadbeef]);
  assert.equal(recovered.length, 1);
  assert.equal(isKnown(recovered[0]!), false);
  assert.equal(recovered[0]!.scenarioId, 'machinery-conveyor-loto');
});

test('a domain with no module on this device resolves to nothing recognisable', () => {
  const recovered = resolveDigests('electrical_ppe_emergency', [1, 2]);
  assert.equal(recovered.length, 2);
  assert.ok(recovered.every((entry) => !isKnown(entry)));
  assert.equal(recovered[0]!.scenarioId, null);
});

test('every drill the app can hand out is recoverable from its digest', async () => {
  // The search has to cover at least the pool the app draws from, or a worker
  // could pass a variant the dashboard cannot name.
  for (const domain of ['gas_leak_confined_space', 'fire_explosion', 'machinery_haulage_loto']) {
    const scenario = scenarioForDomain(domain)!;
    const digestsOfFirstSeeds = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => resolveVariant(scenario, seed));
    for (const variant of digestsOfFirstSeeds) {
      const [entry] = resolveDigests(domain, [
        // recompute the digest the same way the issuer does
        parseInt((await import('../src/engine/rng.ts')).hashString(variant.variantId), 16) >>> 0,
      ]);
      assert.ok(isKnown(entry!), `${domain} seed ${variant.seed} was not recoverable`);
    }
  }
});
