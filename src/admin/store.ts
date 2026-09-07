import type { Dimension } from '../engine/types.ts';

/**
 * The admin roster.
 *
 * There is no backend — every credential here was scanned or pasted on THIS
 * device and verified offline, exactly like a supervisor at a pit gate. That
 * is deliberate, not a shortcut: the whole design commitment of the
 * credential is that checking one needs no network and no central database.
 * A "compliance dashboard" for a real deployment aggregates *these* records
 * across many supervisors' devices — export/import (below) is the seam
 * where that sync would plug in; nothing here pretends that already exists.
 */

export interface RosterRecord {
  /** subjectId + domain + issuedAt, so re-scanning the same credential updates rather than duplicates */
  id: string;
  subjectId: string;
  domain: string;
  scores: { dimension: Dimension; score: number }[];
  variantsPassed: number;
  issuedAt: string; // ISO
  expiresAt: string; // ISO
  provisional: boolean;
  practicalSignedOff: boolean;
  /** when this device scanned/added it — not when the credential was issued */
  scannedAt: string; // ISO
}

const STORE_KEY = 'suraksha.admin.roster.v1';

export function recordId(subjectId: string, domain: string, issuedAt: string): string {
  return `${subjectId}::${domain}::${issuedAt}`;
}

export function loadRoster(): RosterRecord[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as RosterRecord[]) : [];
  } catch {
    return [];
  }
}

function persist(roster: RosterRecord[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(roster));
  } catch {
    /* private window, cleared storage — the scan already happened, don't crash it away */
  }
}

/** Upserts by id: re-scanning the same credential refreshes `scannedAt`, not a duplicate row. */
export function addRecord(record: RosterRecord): RosterRecord[] {
  const roster = loadRoster().filter((r) => r.id !== record.id);
  roster.push(record);
  roster.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
  persist(roster);
  return roster;
}

export function removeRecord(id: string): RosterRecord[] {
  const roster = loadRoster().filter((r) => r.id !== id);
  persist(roster);
  return roster;
}

export function clearRoster(): void {
  persist([]);
}

/** Merges an imported roster in — used to combine scans from multiple supervisors' devices. */
export function mergeRoster(incoming: RosterRecord[]): RosterRecord[] {
  const byId = new Map(loadRoster().map((r) => [r.id, r]));
  for (const record of incoming) {
    const existing = byId.get(record.id);
    // Keep whichever scan is more recent, not just whichever arrived last.
    if (!existing || existing.scannedAt < record.scannedAt) {
      byId.set(record.id, record);
    }
  }
  const merged = [...byId.values()].sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
  persist(merged);
  return merged;
}
