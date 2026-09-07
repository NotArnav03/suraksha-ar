import { webVerifier } from '../credential/web-crypto.ts';
import { verifyCredential, type VerifiedCredential } from '../credential/credential.ts';
import { DEMO_TRUST_LIST } from '../credential/demo-trust.ts';
import { DIMENSIONS } from '../engine/types.ts';
import {
  addRecord,
  clearRoster,
  loadRoster,
  mergeRoster,
  recordId,
  removeRecord,
  type RosterRecord,
} from './store.ts';
import { applyTheme, loadTheme, nextTheme, THEME_ICON, type ThemeChoice } from '../app/ui/theme.ts';

/**
 * The compliance dashboard, as a mountable function rather than a script that
 * runs itself — kept separate from `main.ts` (which only adds the CSS
 * imports and calls this) for the same reason `app/main.ts` stays separate
 * from `controller.ts`/`tierC.ts`: importing a `.css` file only works
 * through Vite, and this module has to be importable from Node's plain test
 * runner so the real render → click → verify → row loop can be tested
 * through the actual DOM, not just unit-tested in pieces.
 *
 * Reads real signed credentials — the same `verifyCredential` a supervisor's
 * phone runs at the gate, the same offline trust list the worker app issues
 * against (see `credential/demo-trust.ts`) — and aggregates whatever this
 * device has scanned. It does not talk to a server, because there isn't one
 * yet; see the module comment in `admin/store.ts` for what a real deployment
 * still needs. Every number on this page traces back to a credential that
 * actually verified, not a placeholder.
 */

const DOMAIN_LABELS: Record<string, string> = {
  gas_leak_confined_space: 'Gas Leak & Confined Space',
  fire_explosion: 'Fire & Explosion Response',
  ground_control_and_height: 'Ground Control & Height',
  machinery_haulage_loto: 'Machinery, Haulage & LOTO',
  electrical_ppe_emergency: 'Electrical, PPE & Emergency',
};

function domainLabel(domain: string): string {
  return DOMAIN_LABELS[domain] ?? domain.replaceAll('_', ' ');
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

const STALE_SOON_DAYS = 30;

type Status = 'valid' | 'expiring' | 'expired';

function statusOf(record: RosterRecord, now: Date): Status {
  const expires = new Date(record.expiresAt);
  if (expires < now) return 'expired';
  const daysLeft = (expires.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  if (daysLeft <= STALE_SOON_DAYS) return 'expiring';
  return 'valid';
}

function toRecord(subjectId: string, verified: VerifiedCredential): RosterRecord {
  const issuedAt = verified.issuedAt.toISOString();
  return {
    id: recordId(subjectId, verified.domain, issuedAt),
    subjectId,
    domain: verified.domain,
    scores: verified.scores,
    variantsPassed: verified.variantsPassed,
    issuedAt,
    expiresAt: verified.expiresAt.toISOString(),
    provisional: verified.provisional,
    practicalSignedOff: verified.practicalSignedOff,
    scannedAt: new Date().toISOString(),
  };
}

function scanSupported(): boolean {
  return 'BarcodeDetector' in window;
}

function option(label: string, value: string): HTMLOptionElement {
  const node = el('option');
  node.textContent = label;
  node.value = value;
  return node;
}

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function mountDashboard(app: HTMLElement): void {
  let theme: ThemeChoice = loadTheme();
  applyTheme(theme);

  let domainFilter = 'all';
  let statusFilter: 'all' | Status = 'all';
  // The feedback line has to survive `render()` — a success rebuilds the whole
  // tree to show the new row, which used to wipe out the very message telling
  // the supervisor it worked. Caught by a test driving the real click, not a
  // unit test of the pieces in isolation.
  let feedbackState = { text: '', cls: 'feedback' };

  function setFeedback(feedback: HTMLElement, text: string, cls: string): void {
    feedbackState = { text, cls };
    feedback.className = cls;
    feedback.textContent = text;
  }

  async function verifyAndAdd(text: string, feedback: HTMLElement): Promise<void> {
    setFeedback(feedback, 'Checking…', 'feedback');
    const result = await verifyCredential(text.trim(), webVerifier(DEMO_TRUST_LIST));
    if (!result.valid) {
      setFeedback(feedback, `Rejected: ${result.reason}`, 'feedback bad');
      return;
    }
    const record = toRecord(result.subjectId, result);
    addRecord(record);
    feedbackState = {
      text:
        `Added ${result.subjectId} — ${domainLabel(result.domain)}` +
        (result.warnings.length ? ` (${result.warnings.join('; ')})` : ''),
      cls: 'feedback good',
    };
    render();
  }

  async function scanQr(feedback: HTMLElement): Promise<void> {
    const BarcodeDetectorCtor = (
      window as unknown as {
        BarcodeDetector?: new (opts: { formats: string[] }) => {
          detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
        };
      }
    ).BarcodeDetector;
    if (!BarcodeDetectorCtor) {
      setFeedback(feedback, 'This browser cannot scan a camera QR code — paste the credential text instead.', 'feedback bad');
      return;
    }

    const video = el('video', 'scan-video');
    video.autoplay = true;
    video.playsInline = true;
    const overlay = el('div', 'scan-overlay');
    const stopButton = el('button', 'ghost', 'Cancel scan');
    overlay.append(video, stopButton);
    document.body.append(overlay);

    let stream: MediaStream | null = null;
    let stop = false;
    stopButton.addEventListener('click', () => {
      stop = true;
    });

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
      setFeedback(feedback, 'Point the camera at a credential QR code…', 'feedback');

      while (!stop) {
        try {
          const codes = await detector.detect(video);
          if (codes[0]) {
            await verifyAndAdd(codes[0].rawValue, feedback);
            break;
          }
        } catch {
          // A frame the detector can't read yet (motion blur, out of focus) — try the next one.
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } catch (error) {
      setFeedback(feedback, `Camera unavailable: ${(error as Error).message}`, 'feedback bad');
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      overlay.remove();
    }
  }

  function render(): void {
    app.replaceChildren();
    const now = new Date();
    const roster = loadRoster();

    const root = el('div', 'admin-root');

    // ── header ──────────────────────────────────────────────────────────────
    const header = el('header', 'admin-header');
    const titleBlock = el('div');
    titleBlock.append(el('p', 'eyebrow', 'Suraksha AR · Compliance'), el('h1', '', 'Certified workers'));
    const themeButton = el('button', 'lang-button', `${THEME_ICON[theme]}  Theme`);
    themeButton.addEventListener('click', () => {
      theme = nextTheme(theme);
      applyTheme(theme);
      render();
    });
    header.append(titleBlock, themeButton);
    root.append(header);

    const notice = el(
      'p',
      'reason admin-notice',
      'Every row here was verified offline, on this device, from a real signed credential — nothing is synced from anywhere else yet. Export/Import combines scans from multiple supervisors’ devices by hand.',
    );
    root.append(notice);

    // ── add a credential ───────────────────────────────────────────────────
    const addPanel = el('section', 'panel');
    addPanel.append(el('h2', '', 'Add a credential'));
    const textarea = el('textarea', 'credential-input');
    textarea.placeholder = 'Paste a scanned credential (SRK1.…) here, or scan with the camera';
    textarea.rows = 2;
    const feedback = el('p', feedbackState.cls, feedbackState.text);
    const actions = el('div', 'admin-actions');
    const verifyButton = el('button', 'primary', 'Verify & add');
    verifyButton.addEventListener('click', () => void verifyAndAdd(textarea.value, feedback));
    actions.append(verifyButton);
    if (scanSupported()) {
      const scanButton = el('button', 'ghost', '📷 Scan QR');
      scanButton.addEventListener('click', () => void scanQr(feedback));
      actions.append(scanButton);
    }
    addPanel.append(textarea, actions, feedback);
    root.append(addPanel);

    // ── summary ─────────────────────────────────────────────────────────────
    const summary = el('section', 'summary-grid');
    const byStatus = { valid: 0, expiring: 0, expired: 0 } satisfies Record<Status, number>;
    for (const r of roster) byStatus[statusOf(r, now)]++;
    const domains = new Set(roster.map((r) => r.domain));

    const statCard = (n: number | string, label: string, cls = '') => {
      const card = el('div', `stat-card ${cls}`);
      card.append(el('span', 'stat-n', String(n)), el('span', 'stat-label', label));
      return card;
    };
    summary.append(
      statCard(roster.length, 'workers tracked'),
      statCard(byStatus.valid, 'valid', 'ok'),
      statCard(byStatus.expiring, `expiring ≤${STALE_SOON_DAYS}d`, 'warn'),
      statCard(byStatus.expired, 'expired', 'bad'),
      statCard(domains.size, 'modules represented'),
    );
    root.append(summary);

    // per-dimension average, across whatever's currently in view (post-filter, computed below)
    const filtered = roster.filter((r) => {
      if (domainFilter !== 'all' && r.domain !== domainFilter) return false;
      if (statusFilter !== 'all' && statusOf(r, now) !== statusFilter) return false;
      return true;
    });

    const dimAverages = el('section', 'panel');
    dimAverages.append(el('h2', '', 'Average competency (filtered view)'));
    if (filtered.length === 0) {
      dimAverages.append(el('p', 'reason', 'No records match the current filter.'));
    } else {
      for (const dimension of DIMENSIONS) {
        const scores = filtered
          .map((r) => r.scores.find((s) => s.dimension === dimension)?.score)
          .filter((v): v is number => v !== undefined);
        const row = el('div', 'dim');
        row.append(el('span', 'dim-name', dimension.replaceAll('_', ' ')));
        const track = el('div', 'dim-track');
        const fill = el('div', 'dim-fill over');
        const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
        if (avg !== null) fill.style.width = `${avg}%`;
        track.append(fill);
        row.append(track, el('span', 'dim-score', avg === null ? '—' : String(avg)));
        dimAverages.append(row);
      }
    }
    root.append(dimAverages);

    // ── filters + table ─────────────────────────────────────────────────────
    const tablePanel = el('section', 'panel');
    const tableHead = el('div', 'admin-table-head');
    tableHead.append(el('h2', '', `Roster (${filtered.length})`));

    const filterRow = el('div', 'admin-filters');
    const domainSelect = el('select');
    domainSelect.append(option('All modules', 'all'));
    for (const d of [...domains].sort()) domainSelect.append(option(domainLabel(d), d));
    domainSelect.value = domainFilter;
    domainSelect.addEventListener('change', () => {
      domainFilter = domainSelect.value;
      render();
    });

    const statusSelect = el('select');
    for (const [value, label] of [
      ['all', 'All statuses'],
      ['valid', 'Valid'],
      ['expiring', 'Expiring soon'],
      ['expired', 'Expired'],
    ] as const) {
      statusSelect.append(option(label, value));
    }
    statusSelect.value = statusFilter;
    statusSelect.addEventListener('change', () => {
      statusFilter = statusSelect.value as typeof statusFilter;
      render();
    });
    filterRow.append(domainSelect, statusSelect);
    tableHead.append(filterRow);
    tablePanel.append(tableHead);

    if (filtered.length === 0) {
      tablePanel.append(
        el('p', 'reason', roster.length === 0 ? 'No credentials scanned yet.' : 'Nothing matches this filter.'),
      );
    } else {
      const table = el('table', 'admin-table');
      const thead = el('thead');
      const headRow = el('tr');
      for (const h of ['Worker', 'Module', 'Status', 'Issued', 'Expires', 'Variants', '']) {
        headRow.append(el('th', '', h));
      }
      thead.append(headRow);
      table.append(thead);

      const tbody = el('tbody');
      for (const r of filtered) {
        const status = statusOf(r, now);
        const row = el('tr', `row-${status}`);
        row.append(el('td', 'cell-subject', r.subjectId));
        row.append(el('td', '', domainLabel(r.domain)));
        const statusCell = el('td');
        statusCell.append(el('span', `badge badge-${status}`, status));
        if (r.provisional) statusCell.append(el('span', 'badge badge-warn', 'provisional'));
        row.append(statusCell);
        row.append(el('td', '', new Date(r.issuedAt).toLocaleDateString()));
        row.append(el('td', '', new Date(r.expiresAt).toLocaleDateString()));
        row.append(el('td', '', String(r.variantsPassed)));
        const removeCell = el('td');
        const removeButton = el('button', 'ghost small', 'Remove');
        removeButton.addEventListener('click', () => {
          removeRecord(r.id);
          render();
        });
        removeCell.append(removeButton);
        row.append(removeCell);
        tbody.append(row);
      }
      table.append(tbody);
      tablePanel.append(table);
    }
    root.append(tablePanel);

    // ── export / import / clear ────────────────────────────────────────────
    const dataPanel = el('section', 'panel admin-data-actions');
    const exportButton = el('button', 'ghost', 'Export roster (.json)');
    exportButton.addEventListener('click', () => {
      download(
        `suraksha-roster-${now.toISOString().slice(0, 10)}.json`,
        JSON.stringify(loadRoster(), null, 2),
        'application/json',
      );
    });

    const importLabel = el('label', 'ghost file-label', 'Import roster (.json)');
    const importInput = el('input');
    importInput.type = 'file';
    importInput.accept = 'application/json';
    importInput.hidden = true;
    importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text()) as RosterRecord[];
        const merged = mergeRoster(parsed);
        feedbackState = { text: `Imported — roster now has ${merged.length} record(s).`, cls: 'feedback good' };
        render();
      } catch {
        setFeedback(feedback, 'That file is not a roster export this dashboard can read.', 'feedback bad');
      }
      importInput.value = '';
    });
    importLabel.append(importInput);

    const clearButton = el('button', 'ghost danger', 'Clear this device’s roster');
    clearButton.addEventListener('click', () => {
      if (roster.length === 0) return;
      if (!confirm(`Remove all ${roster.length} record(s) from this device? This cannot be undone.`)) return;
      clearRoster();
      render();
    });

    dataPanel.append(exportButton, importLabel, clearButton);
    root.append(dataPanel);

    app.append(root);
  }

  render();
}
