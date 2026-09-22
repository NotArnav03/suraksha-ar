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

/**
 * "Coal Mines Regulations 2017, r.166(3)(a): where gas is detected ..." becomes
 * the provision on one line and what it says underneath, with the pinpoint kept
 * whole so a narrow screen never breaks "r.104(1)" from its "(a)".
 */
function ruleRow(cite: string, met: boolean): HTMLLIElement {
  const row = el('li', met ? 'met' : 'missed');
  const body = el('span', 'rule-cite');
  const split = cite.indexOf(': ');
  const ref = split === -1 ? cite : cite.slice(0, split);
  const lastComma = ref.lastIndexOf(', ');
  const refLine = el('span', 'rule-ref');
  if (lastComma === -1) {
    refLine.append(el('span', 'rule-pin', ref));
  } else {
    refLine.append(ref.slice(0, lastComma + 2), el('span', 'rule-pin', ref.slice(lastComma + 2)));
  }
  body.append(refLine);
  if (split !== -1) body.append(el('span', 'rule-says', cite.slice(split + 2)));
  row.append(el('span', 'rule-mark', met ? '✓' : '✗'), body);
  return row;
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
    i18n.speak(summary, outcome.summary.audio);
  }
  // Said on the screen that shows the score, not buried in the certificate
  // panel: a learner who just passed a guided run should not have to work out
  // for themselves why no certificate appeared.
  if (competency.mode === 'guided' || competency.hinted) {
    head.append(el('p', 'run-note', i18n.ui(competency.hinted ? 'hintCost' : 'guidedRun')));
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

  // ── the rules behind it ───────────────────────────────────────────────────
  // Every assessed step that cites a provision, missed ones first. A worker who
  // went in after the casualty should leave knowing it was not a judgement call
  // but a regulation, and a supervisor reading over their shoulder should be
  // able to check the provision rather than take the app's word for it.
  const creditByNode = new Map<string, number>();
  for (const c of competency.contributions) {
    creditByNode.set(c.nodeId, Math.min(creditByNode.get(c.nodeId) ?? 1, c.credit));
  }
  const cited = scenario.nodes
    .filter((node) => node.cites?.length && creditByNode.has(node.id))
    .map((node) => ({ node, met: creditByNode.get(node.id)! >= 1 }))
    .sort((a, b) => Number(a.met) - Number(b.met));
  if (cited.length > 0) {
    const section = el('section', 'panel');
    section.append(el('h2', '', i18n.ui('rulesBehind')));
    const missed = el('ul', 'rules');
    const followed = el('ul', 'rules');
    for (const { node, met } of cited) {
      for (const ref of node.cites!) {
        (met ? followed : missed).append(ruleRow(ref.cite, met));
      }
    }
    if (missed.childElementCount > 0) section.append(missed);
    if (followed.childElementCount > 0) {
      // Rules that were kept matter less than rules that were broken, and on a
      // clean pass the full list would push the certificate off the screen.
      const fold = el('details', 'rules-followed');
      const summary = i18n.ui('rulesFollowed').replace('{{count}}', String(followed.childElementCount));
      fold.append(el('summary', '', summary), followed);
      section.append(fold);
    }
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
      // The same string the start screen uses. This one was English on a Hindi
      // screen, which is the sort of thing that reads as a half-finished app to
      // the person least able to shrug it off.
      i18n
        .ui('variantsPassed')
        .replace('{{passed}}', String(certification.distinctVariantsPassed))
        .replace('{{required}}', String(certification.requiredVariants)),
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
      detail.textContent = i18n
        .ui(check.valid ? 'credentialOk' : 'credentialBad')
        .replace('{{bytes}}', String(issued.bytes))
        .replace('{{version}}', String(version))
        .replace('{{reason}}', check.valid ? '' : check.reason);
    })();
  }

  const again = el('button', 'primary', i18n.ui('restart'));
  again.addEventListener('click', options.onRestart);
  root.append(again);

  return root;
}
