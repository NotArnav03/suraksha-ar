/**
 * The whole loop, end to end: drill → certify → issue → scan → verify offline.
 *
 * The last step is the one worth watching. Verification here imports no issuer
 * state and makes no network call — it holds a trust list and a string, which is
 * exactly what a supervisor's phone has at the pit gate.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { certify } from '../assess/certify.ts';
import { scoreSession, type Competency } from '../assess/score.ts';
import { DrillSession } from '../engine/runtime.ts';
import type { Action, ResolvedScenario, Scenario } from '../engine/types.ts';
import { distinctVariants } from '../engine/variant.ts';
import { validateScenario } from '../engine/validate.ts';
import { qrVersionFor } from '../credential/codec.ts';
import { issueCredential, verifyCredential, CredentialError } from '../credential/credential.ts';
import { generateIssuerKey, nodeSigner, nodeVerifier } from '../credential/node-crypto.ts';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (useColor ? `[${code}m${s}[0m` : s);
const dim = c('2');
const bold = c('1');
const red = c('31');
const green = c('32');
const yellow = c('33');
const magenta = c('35');

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const subjectId = flag('--worker') ?? 'JH/CHP/2291';
const tamper = argv.includes('--tamper');
const wrongKey = argv.includes('--wrong-key');
const expired = argv.includes('--expired');

const scenario: Scenario = validateScenario(
  JSON.parse(
    await readFile(
      fileURLToPath(new URL('../scenarios/gas-confined-space.json', import.meta.url)),
      'utf8',
    ),
  ),
);

function runIdeal(variant: ResolvedScenario): Competency {
  let clock = 0;
  const session = new DrillSession(variant, { now: () => clock });
  let guard = 0;
  while (!session.finished && guard++ < 200) {
    clock += 2500;
    const node = session.node;
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

// ── 1. drill ────────────────────────────────────────────────────────────────
const variants = distinctVariants(scenario, scenario.scoring.requiredVariants);
const attempts = variants.map(runIdeal);
console.log(`${bold('1 · DRILL')}  ${dim(`${attempts.length} distinct variants`)}`);
for (const attempt of attempts) {
  const paint = attempt.result === 'pass' ? green : red;
  console.log(`   ${magenta(attempt.variantId)}  ${paint(attempt.result)}`);
}

// ── 2. certify ──────────────────────────────────────────────────────────────
const certification = certify(scenario, attempts);
console.log(
  `\n${bold('2 · CERTIFY')}  ${
    certification.granted ? green('granted') : red('withheld')
  }  ${dim(`${certification.distinctVariantsPassed}/${certification.requiredVariants} distinct variants`)}`,
);

// ── 3. issue ────────────────────────────────────────────────────────────────
const issuerKey = generateIssuerKey();
const signer = nodeSigner(issuerKey);

let issued;
try {
  issued = await issueCredential(
    certification,
    {
      subjectId,
      domain: scenario.domain,
      validForDays: expired ? -1 : 180,
      practicalSignedOff: false,
    },
    signer,
  );
} catch (error) {
  if (error instanceof CredentialError) {
    console.error(`\n${red(bold('3 · ISSUE  refused'))}\n   ${error.message}`);
    process.exit(1);
  }
  throw error;
}

let wire = issued.text;
if (tamper) {
  // flip one score byte inside the signed payload
  const parts = wire.split('.');
  const body = parts[1]!;
  const at = body.length - 20;
  const swapped = body[at] === 'A' ? 'B' : 'A';
  parts[1] = body.slice(0, at) + swapped + body.slice(at + 1);
  wire = parts.join('.');
}

const total = wire.length;
const qr = qrVersionFor(total);
console.log(
  `\n${bold('3 · ISSUE')}\n` +
    `   ${dim('issuer key')}   ${issuerKey.keyId}\n` +
    `   ${dim('payload')}      ${issued.bytes} bytes signed, 64-byte P-256 signature\n` +
    `   ${dim('QR string')}    ${total} chars → ${
      qr === null ? red('too large for a practical QR') : green(`QR version ${qr} at EC level M`)
    }\n` +
    `   ${dim('wire')}         ${wire}`,
);
if (tamper) console.log(`   ${yellow('one payload byte has been flipped')}`);

// ── 4. verify, offline ──────────────────────────────────────────────────────
// The supervisor's device holds only the trust list and the scanned string.
const trustList = wrongKey
  ? { [generateIssuerKey().keyId]: generateIssuerKey().publicKeySpki }
  : { [issuerKey.keyId]: issuerKey.publicKeySpki };

const result = await verifyCredential(wire, nodeVerifier(trustList));

console.log(`\n${bold('4 · VERIFY')}  ${dim('offline — trust list and a string, nothing else')}`);
if (!result.valid) {
  console.log(`   ${red(bold('REJECTED'))}  ${result.reason}`);
  if (result.untrustedPayload) {
    console.log(`   ${dim('decoded but not trusted, so not shown as fact')}`);
  }
  process.exit(0);
}

console.log(`   ${green(bold('VALID'))}`);
console.log(`   ${dim('worker')}       ${result.subjectId}`);
console.log(`   ${dim('domain')}       ${result.domain}`);
console.log(`   ${dim('variants')}     ${result.variantsPassed} distinct, passed`);
console.log(
  `   ${dim('issued')}       ${result.issuedAt.toISOString().slice(0, 10)}` +
    `   ${dim('expires')}  ${result.expiresAt.toISOString().slice(0, 10)}`,
);
console.log(`   ${dim('competency')}   ${dim('(worst attempt, not the mean)')}`);
for (const score of result.scores) {
  console.log(`     ${score.dimension.padEnd(20)} ${String(score.score).padStart(3)}`);
}
for (const warning of result.warnings) {
  console.log(`   ${yellow('!')} ${warning}`);
}
