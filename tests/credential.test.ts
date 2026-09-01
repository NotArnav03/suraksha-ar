import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { certify, type Certification } from '../src/assess/certify.ts';
import { scoreSession, type Competency } from '../src/assess/score.ts';
import { fromBase64url, toBase64url } from '../src/credential/base64url.ts';
import {
  CredentialFormatError,
  decodePayload,
  deserialize,
  encodePayload,
  qrVersionFor,
  type CredentialPayload,
} from '../src/credential/codec.ts';
import {
  CredentialError,
  issueCredential,
  verifyCredential,
} from '../src/credential/credential.ts';
import { generateIssuerKey, nodeSigner, nodeVerifier } from '../src/credential/node-crypto.ts';
import { DrillSession } from '../src/engine/runtime.ts';
import { makeRng } from '../src/engine/rng.ts';
import type { Action, ResolvedScenario, Scenario } from '../src/engine/types.ts';
import { distinctVariants } from '../src/engine/variant.ts';
import { validateScenario } from '../src/engine/validate.ts';

const scenario: Scenario = validateScenario(
  JSON.parse(
    await readFile(
      fileURLToPath(new URL('../src/scenarios/gas-confined-space.json', import.meta.url)),
      'utf8',
    ),
  ),
);

function runIdeal(variant: ResolvedScenario, stopAt?: string): Competency {
  let clock = 0;
  const session = new DrillSession(variant, { now: () => clock });
  let guard = 0;
  while (!session.finished && guard++ < 200) {
    const node = session.node;
    if (stopAt && node.id === stopAt) break;
    clock += 2500;
    if (node.kind === 'brief') session.acknowledge();
    else if (node.kind === 'expect') {
      const next = session.pending[0];
      if (!next) break;
      const { verb, target } = next.match;
      session.dispatch({ verb: verb ?? 'inspect', ...(target ? { target } : {}) } as Action);
    } else if (node.kind === 'observe') {
      const remaining = node.targets.find((r) => !session.observed.has(session.resolveTarget(r)));
      if (!remaining) break;
      session.dispatch({ verb: 'inspect', target: remaining });
    } else break;
  }
  return scoreSession(session);
}

function grantedCertification(): Certification {
  const variants = distinctVariants(scenario, scenario.scoring.requiredVariants);
  const certification = certify(scenario, variants.map((v) => runIdeal(v)));
  assert.equal(certification.granted, true);
  return certification;
}

const key = generateIssuerKey();
const signer = nodeSigner(key);
const verifier = nodeVerifier({ [key.keyId]: key.publicKeySpki });

// ── base64url ───────────────────────────────────────────────────────────────

test('base64url round-trips every length remainder', () => {
  const rng = makeRng(9);
  for (let length = 0; length < 40; length++) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(rng() * 256);
    const decoded = fromBase64url(toBase64url(bytes));
    assert.deepEqual([...decoded], [...bytes], `length ${length}`);
  }
});

test('base64url output is URL and QR safe', () => {
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) bytes[i] = i;
  const encoded = toBase64url(bytes);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
});

test('base64url rejects a character outside the alphabet', () => {
  assert.throws(() => fromBase64url('abc$def'), /invalid base64url character/);
});

// ── codec ───────────────────────────────────────────────────────────────────

const samplePayload: CredentialPayload = {
  version: 1,
  flags: 0b11,
  keyId: 40_000,
  issuedAtMinutes: 29_000_000,
  expiresAtMinutes: 29_259_200,
  subjectId: 'JH/CHP/2291',
  domainCode: 2,
  scores: [
    { dimension: 'hazard_recognition', score: 87 },
    { dimension: 'rescue_restraint', score: 100 },
  ],
  variantDigests: [0xdeadbeef, 0x00000001],
};

test('the payload codec round-trips exactly', () => {
  const decoded = decodePayload(encodePayload(samplePayload));
  assert.deepEqual(decoded, samplePayload);
});

test('the codec rejects a truncated credential rather than guessing', () => {
  const bytes = encodePayload(samplePayload);
  for (const cut of [1, 5, 13, bytes.length - 3, bytes.length - 1]) {
    assert.throws(
      () => decodePayload(bytes.subarray(0, cut)),
      CredentialFormatError,
      `truncating to ${cut} bytes should have failed`,
    );
  }
});

test('the codec refuses a subject id that will not fit', () => {
  assert.throws(
    () => encodePayload({ ...samplePayload, subjectId: 'x'.repeat(33) }),
    /limit is 32/,
  );
});

test('deserialize rejects a foreign format tag', () => {
  assert.throws(() => deserialize('OTHER.aaaa.bbbb'), /unrecognised format tag/);
});

// ── issue and verify ────────────────────────────────────────────────────────

test('a granted certification issues a credential that verifies offline', async () => {
  const issued = await issueCredential(
    grantedCertification(),
    { subjectId: 'JH/CHP/2291', domain: scenario.domain },
    signer,
  );
  const result = await verifyCredential(issued.text, verifier);

  assert.equal(result.valid, true);
  assert.ok(result.valid);
  assert.equal(result.subjectId, 'JH/CHP/2291');
  assert.equal(result.domain, 'gas_leak_confined_space');
  assert.equal(result.variantsPassed, scenario.scoring.requiredVariants);
  assert.ok(result.warnings.some((w) => w.includes('revocation')));
});

test('the issuer refuses to mint a credential for an ungranted certification', async () => {
  const withheld = certify(scenario, []);
  assert.equal(withheld.granted, false);

  await assert.rejects(
    () => issueCredential(withheld, { subjectId: 'JH/CHP/2291', domain: scenario.domain }, signer),
    (error: unknown) =>
      error instanceof CredentialError && /certification not granted/.test(error.message),
  );
});

test('flipping any single payload byte breaks verification', async () => {
  const issued = await issueCredential(
    grantedCertification(),
    { subjectId: 'JH/CHP/2291', domain: scenario.domain },
    signer,
  );
  const { payload, signature } = deserialize(issued.text);

  for (let i = 0; i < payload.length; i++) {
    const mutated = Uint8Array.from(payload);
    mutated[i] = mutated[i]! ^ 0x01;
    const forged = `SRK1.${toBase64url(mutated)}.${toBase64url(signature)}`;
    const result = await verifyCredential(forged, verifier);
    assert.equal(result.valid, false, `byte ${i} was mutable without detection`);
  }
});

test('a credential signed by an unknown issuer is rejected before its signature is even checked', async () => {
  const issued = await issueCredential(
    grantedCertification(),
    { subjectId: 'JH/CHP/2291', domain: scenario.domain },
    signer,
  );
  const stranger = generateIssuerKey();
  const result = await verifyCredential(
    issued.text,
    nodeVerifier({ [stranger.keyId]: stranger.publicKeySpki }),
  );

  assert.equal(result.valid, false);
  assert.ok(!result.valid && /not in this device's trust list/.test(result.reason));
});

test('an expired credential is rejected and its contents are not presented as fact', async () => {
  const issuedAt = new Date('2026-01-01T00:00:00Z');
  const issued = await issueCredential(
    grantedCertification(),
    { subjectId: 'JH/CHP/2291', domain: scenario.domain, validForDays: 30, now: issuedAt },
    signer,
  );

  const inWindow = await verifyCredential(issued.text, verifier, {
    now: new Date('2026-01-20T00:00:00Z'),
  });
  assert.equal(inWindow.valid, true);

  const after = await verifyCredential(issued.text, verifier, {
    now: new Date('2026-03-01T00:00:00Z'),
  });
  assert.equal(after.valid, false);
  assert.ok(!after.valid && /expired on/.test(after.reason));
  assert.ok(!('subjectId' in after), 'a rejected credential must expose no display fields');
});

test('a credential nearing expiry warns without being rejected', async () => {
  const issuedAt = new Date('2026-01-01T00:00:00Z');
  const issued = await issueCredential(
    grantedCertification(),
    { subjectId: 'JH/CHP/2291', domain: scenario.domain, validForDays: 40, now: issuedAt },
    signer,
  );
  const result = await verifyCredential(issued.text, verifier, {
    now: new Date('2026-02-01T00:00:00Z'),
  });
  assert.ok(result.valid);
  assert.ok(result.warnings.some((w) => /expires in \d+ day/.test(w)));
});

test('the credential carries the worst attempt, not the flattering mean', async () => {
  const variants = distinctVariants(scenario, scenario.scoring.requiredVariants);
  const attempts = variants.map((variant, index) => {
    if (index !== 1) return runIdeal(variant);
    // one sloppier attempt: sniff the opening instead of trusting the detector
    let clock = 0;
    const session = new DrillSession(variant, { now: () => clock });
    let guard = 0;
    let sniffed = false;
    while (!session.finished && guard++ < 200) {
      clock += 2500;
      const node = session.node;
      if (node.kind === 'brief') session.acknowledge();
      else if (node.kind === 'expect') {
        if (node.id === 'gas_test' && !sniffed) {
          sniffed = true;
          session.dispatch({ verb: 'inspect', target: 'sump' });
          continue;
        }
        const next = session.pending[0];
        if (!next) break;
        const { verb, target } = next.match;
        session.dispatch({ verb: verb ?? 'inspect', ...(target ? { target } : {}) } as Action);
      } else if (node.kind === 'observe') {
        const remaining = node.targets.find((r) => !session.observed.has(session.resolveTarget(r)));
        if (!remaining) break;
        session.dispatch({ verb: 'inspect', target: remaining });
      } else break;
    }
    return scoreSession(session);
  });

  const certification = certify(scenario, attempts);
  assert.equal(certification.granted, true);

  const aggregate = certification.vector.find((d) => d.dimension === 'hazard_recognition')!;
  assert.ok(aggregate.worst! < aggregate.mean!, 'test setup should produce one weaker attempt');

  const issued = await issueCredential(
    certification,
    { subjectId: 'JH/CHP/2291', domain: scenario.domain },
    signer,
  );
  const result = await verifyCredential(issued.text, verifier);
  assert.ok(result.valid);

  const carried = result.scores.find((s) => s.dimension === 'hazard_recognition');
  assert.equal(carried?.score, aggregate.worst);
});

test('the QR string stays small enough to scan off a scratched phone screen', async () => {
  const issued = await issueCredential(
    grantedCertification(),
    { subjectId: 'JH/CHP/2291', domain: scenario.domain },
    signer,
  );

  assert.ok(issued.bytes < 80, `signed payload grew to ${issued.bytes} bytes`);
  const version = qrVersionFor(issued.text.length);
  assert.ok(version !== null && version <= 12, `needs QR version ${version}, too dense for the yard`);
});

test('garbage input is rejected without throwing', async () => {
  for (const junk of ['', 'hello', 'SRK1.', 'SRK1.a.b', 'SRK1.!!!.???']) {
    const result = await verifyCredential(junk, verifier);
    assert.equal(result.valid, false, `"${junk}" should not verify`);
  }
});
