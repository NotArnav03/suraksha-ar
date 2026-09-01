import QRCode from 'qrcode';

import { certify } from '../assess/certify.ts';
import type { Competency } from '../assess/score.ts';
import { qrVersionFor } from '../credential/codec.ts';
import { issueCredential, verifyCredential } from '../credential/credential.ts';
import { createDemoIssuer, webVerifier } from '../credential/web-crypto.ts';
import type { DrillSession } from '../engine/runtime.ts';
import type { Scenario } from '../engine/types.ts';
import type { Localizer } from './ui/i18n.ts';

/**
 * The debrief.
 *
 * A failed drill is worth more than a passed one if the learner leaves knowing
 * which reflex failed and what it cost, so the outcome narration and the error
 * taxonomy get more room here than the score does. The vector is shown as six
 * separate bars for the same reason it is computed that way: a single number
 * would let a worker who is lethal in one dimension look competent.
 */

const STORE_KEY = 'suraksha.attempts.v1';

export function loadAttempts(): Competency[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Competency[]) : [];
  } catch {
    // Private windows, cleared site data, storage-blocking browsers. Losing the
    // history costs the learner a variant of progress, never a working drill.
    return [];
  }
}

export function saveAttempt(attempt: Competency): Competency[] {
  const attempts = [...loadAttempts(), attempt];
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(attempts));
  } catch {
    /* ignore — see loadAttempts */
  }
  return attempts;
}

export function clearAttempts(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface ResultsOptions {
  scenario: Scenario;
  session: DrillSession;
  competency: Competency;
  attempts: Competency[];
  i18n: Localizer;
  workerId: string;
  onRestart(): void;
}

export function renderResults(options: ResultsOptions): HTMLElement {
  const { scenario, session, competency, attempts, i18n } = options;
  const root = el('div', 'results');

  // ── outcome ───────────────────────────────────────────────────────────────
  const outcome = session.node;
  const verdictClass =
    competency.result === 'pass' ? 'pass' : competency.result === 'fatal' ? 'fatal' : 'fail';

  const head = el('div', `outcome ${verdictClass}`);
  head.append(el('h1', '', i18n.ui(`result_${competency.result}`)));
  if (outcome.kind === 'outcome') {
    const summary = i18n.text(outcome.summary.text);
    head.append(el('p', 'outcome-summary', summary));
    i18n.speak(summary);
  }
  root.append(head);

  // ── what went wrong ───────────────────────────────────────────────────────
  if (competency.errorCounts.length > 0) {
    const section = el('section', 'panel');
    section.append(el('h2', '', i18n.ui('whatWentWrong')));
    const list = el('ul', 'errors');
    for (const error of competency.errorCounts) {
      const row = el('li', error.severity);
      row.append(
        el('span', 'error-code', error.code.replaceAll('_', ' ').toLowerCase()),
        el('span', 'error-meta', `${error.severity} · ${error.dimension.replaceAll('_', ' ')}`),
      );
      list.append(row);
    }
    section.append(list);
    root.append(section);
  }

  // ── competency vector ─────────────────────────────────────────────────────
  const vector = el('section', 'panel');
  vector.append(el('h2', '', i18n.ui('competency')));
  for (const dimension of competency.vector) {
    const row = el('div', 'dim');
    row.append(el('span', 'dim-name', dimension.dimension.replaceAll('_', ' ')));

    const track = el('div', 'dim-track');
    const fill = el('div', 'dim-fill');
    if (dimension.score === null) {
      track.classList.add('empty');
    } else {
      fill.style.width = `${dimension.score}%`;
      fill.classList.add(dimension.passed === false ? 'under' : 'over');
    }
    track.append(fill);

    if (dimension.passMark !== null) {
      const mark = el('div', 'dim-mark');
      mark.style.left = `${dimension.passMark}%`;
      mark.title = `pass mark ${dimension.passMark}`;
      track.append(mark);
    }

    row.append(track, el('span', 'dim-score', dimension.score === null ? '—' : String(dimension.score)));
    if (dimension.floored) row.append(el('span', 'dim-note', 'fatal'));
    vector.append(row);
  }
  root.append(vector);

  // ── progress toward a credential ──────────────────────────────────────────
  const certification = certify(scenario, attempts);
  const progress = el('section', 'panel');
  progress.append(
    el(
      'h2',
      '',
      `${certification.distinctVariantsPassed} / ${certification.requiredVariants} variants passed`,
    ),
  );
  const pips = el('div', 'pips');
  for (let i = 0; i < certification.requiredVariants; i++) {
    pips.append(el('span', i < certification.distinctVariantsPassed ? 'pip on' : 'pip'));
  }
  progress.append(pips);
  for (const reason of certification.reasons.slice(0, 3)) {
    progress.append(el('p', 'reason', reason));
  }
  root.append(progress);

  // ── credential ────────────────────────────────────────────────────────────
  if (certification.granted) {
    const panel = el('section', 'panel credential');
    panel.append(el('h2', '', i18n.ui('credential')));
    const canvas = document.createElement('canvas');
    canvas.className = 'qr';
    panel.append(canvas, el('p', 'reason', i18n.ui('scanToVerify')));
    const detail = el('p', 'reason');
    panel.append(detail);
    root.append(panel);

    void (async () => {
      // Issuing in the browser is a demo shortcut, and a loud one: a device that
      // can sign its own credentials can award itself competence. Real issuance
      // is server-side. The verification below is the part that is real.
      const issuer = await createDemoIssuer();
      const issued = await issueCredential(
        certification,
        { subjectId: options.workerId, domain: scenario.domain },
        issuer.signer,
      );
      await QRCode.toCanvas(canvas, issued.text, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 260,
        color: { dark: '#0b0f12', light: '#ffffff' },
      });

      const check = await verifyCredential(
        issued.text,
        webVerifier({ [issuer.keyId]: issuer.publicKeySpki }),
      );
      const version = qrVersionFor(issued.text.length);
      detail.textContent =
        `${issued.bytes} signed bytes · QR version ${version} · ` +
        (check.valid ? 'verified offline on this device' : `rejected: ${check.reason}`);
    })();
  }

  const again = el('button', 'primary', i18n.ui('restart'));
  again.addEventListener('click', options.onRestart);
  root.append(again);

  return root;
}
