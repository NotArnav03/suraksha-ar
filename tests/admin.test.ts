import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { Window } from 'happy-dom';

/**
 * The compliance dashboard's two claims worth actually verifying:
 *
 * 1. The roster store (pure logic) dedupes/merges the way its comments say.
 * 2. Pasting a *real* credential — issued through the same code path the
 *    worker app uses — into the dashboard's own UI produces a roster row,
 *    and garbage input produces a rejection, not a silently-empty table.
 *    This is the test that would have caught the fixed-vs-random demo-issuer-key
 *    bug: before that fix, a credential issued by one `createDemoIssuer()`
 *    call could never verify against a fresh one, which is exactly the
 *    dashboard's situation.
 */

const window = new Window({ url: 'https://localhost/' });
const globals = globalThis as unknown as Record<string, unknown>;
function define(name: string, value: unknown): void {
  Object.defineProperty(globals, name, { value, writable: true, configurable: true });
}
for (const name of [
  'window',
  'document',
  'localStorage',
  'HTMLElement',
  'Element',
  'Node',
  'CustomEvent',
  'Option',
  'Blob',
  'URL',
]) {
  define(name, (window as unknown as Record<string, unknown>)[name]);
}

const { addRecord, clearRoster, loadRoster, mergeRoster, recordId, removeRecord } = await import(
  '../src/admin/store.ts'
);
const { mountDashboard } = await import('../src/admin/dashboard.ts');
const { createDemoIssuer, webVerifier } = await import('../src/credential/web-crypto.ts');
const { issueCredential } = await import('../src/credential/credential.ts');
const { DEMO_TRUST_LIST } = await import('../src/credential/demo-trust.ts');

function record(overrides: Partial<Parameters<typeof addRecord>[0]> = {}) {
  return {
    id: recordId('JH/1', 'gas_leak_confined_space', '2026-01-01T00:00:00.000Z'),
    subjectId: 'JH/1',
    domain: 'gas_leak_confined_space',
    scores: [],
    variantsPassed: 3,
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-06-01T00:00:00.000Z',
    provisional: false,
    practicalSignedOff: false,
    scannedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

test('adding the same credential twice updates the row, not duplicates it', () => {
  clearRoster();
  addRecord(record({ scannedAt: '2026-01-02T00:00:00.000Z' }));
  addRecord(record({ scannedAt: '2026-01-03T00:00:00.000Z' }));
  const roster = loadRoster();
  assert.equal(roster.length, 1);
  assert.equal(roster[0]!.scannedAt, '2026-01-03T00:00:00.000Z');
});

test('removeRecord takes exactly the matching id', () => {
  clearRoster();
  addRecord(record({ id: 'a', subjectId: 'A' }));
  addRecord(record({ id: 'b', subjectId: 'B' }));
  const remaining = removeRecord('a');
  assert.deepEqual(
    remaining.map((r) => r.subjectId),
    ['B'],
  );
});

test('mergeRoster keeps whichever scan is newer, per record, not whichever import ran last', () => {
  clearRoster();
  addRecord(record({ id: 'x', subjectId: 'X', scannedAt: '2026-01-05T00:00:00.000Z' }));
  const merged = mergeRoster([record({ id: 'x', subjectId: 'X-STALE', scannedAt: '2026-01-01T00:00:00.000Z' })]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.subjectId, 'X', 'an older incoming scan must not overwrite a newer local one');

  const mergedNewer = mergeRoster([record({ id: 'x', subjectId: 'X-FRESH', scannedAt: '2026-01-09T00:00:00.000Z' })]);
  assert.equal(mergedNewer[0]!.subjectId, 'X-FRESH', 'a genuinely newer incoming scan must win');
});

/**
 * End-to-end through the dashboard's real UI: mount it, paste an actually-
 * issued credential into the actual textarea, click the actual button, read
 * the actual table row it produces.
 */
let admin: HTMLElement;
before(() => {
  clearRoster();
  window.document.body.innerHTML = '<div id="admin"></div>';
  admin = window.document.querySelector('#admin') as unknown as HTMLElement;
  mountDashboard(admin);
});

after(() => {
  window.close();
});

test('a real credential pasted into the dashboard produces a roster row', async () => {
  const issuer = await createDemoIssuer();
  const certification = {
    granted: true,
    scenarioId: 'gas-confined-space',
    reasons: ['3 distinct variants passed, 3 required'],
    requiredVariants: 3,
    distinctVariantsPassed: 3,
    countedVariantIds: ['gas-confined-space@1', 'gas-confined-space@2', 'gas-confined-space@3'],
    attempts: { total: 3, passed: 3, failed: 0, fatal: 0 },
    vector: (['hazard_recognition', 'procedure_sequence', 'time_criticality', 'ppe_discipline', 'communication', 'rescue_restraint'] as const).map(
      (dimension) => ({ dimension, mean: 90, worst: 88, passMark: 70, attempts: 3 }),
    ),
    weakest: null,
  };
  const issued = await issueCredential(
    certification as never,
    { subjectId: 'JH/CHP/4242', domain: 'gas_leak_confined_space' },
    issuer.signer,
  );

  // Sanity: this credential really does verify against the dashboard's own
  // trust list before we even touch the DOM — isolates a UI bug from a crypto one.
  const preCheck = await (await import('../src/credential/credential.ts')).verifyCredential(
    issued.text,
    webVerifier(DEMO_TRUST_LIST),
  );
  assert.equal(preCheck.valid, true);

  const textarea = admin.querySelector<HTMLTextAreaElement>('.credential-input')!;
  textarea.value = issued.text;
  const verifyButton = [...admin.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === 'Verify & add',
  )!;
  verifyButton.click();

  // The click handler is async; give its microtasks a turn.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const feedback = admin.querySelector('.feedback')!;
  assert.match(feedback.textContent ?? '', /Added JH\/CHP\/4242/);

  const row = [...admin.querySelectorAll('td.cell-subject')].find((td) => td.textContent === 'JH/CHP/4242');
  assert.ok(row, 'the verified credential must appear as a roster row, not just a feedback message');
});

test('garbage input is rejected, not silently added', async () => {
  clearRoster();
  window.document.body.innerHTML = '<div id="admin"></div>';
  const root = window.document.querySelector('#admin') as unknown as HTMLElement;
  mountDashboard(root);

  const textarea = root.querySelector<HTMLTextAreaElement>('.credential-input')!;
  textarea.value = 'not a credential';
  const verifyButton = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === 'Verify & add',
  )!;
  verifyButton.click();
  await new Promise((resolve) => setTimeout(resolve, 50));

  const feedback = root.querySelector('.feedback')!;
  assert.match(feedback.textContent ?? '', /Rejected/);
  assert.equal(loadRoster().length, 0);
});
