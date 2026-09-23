import gasScenarioJson from '../scenarios/gas-confined-space.json' with { type: 'json' };
import fireScenarioJson from '../scenarios/fire-explosion.json' with { type: 'json' };
import machineryScenarioJson from '../scenarios/machinery-conveyor-loto.json' with { type: 'json' };

import { hashString } from '../engine/rng.ts';
import type { Scenario } from '../engine/types.ts';
import { validateScenario } from '../engine/validate.ts';
import { sampleParams } from '../engine/variant.ts';

/**
 * Turning a credential back into the drills it was earned on.
 *
 * The credential carries a 32-bit digest of each variant the worker passed,
 * which is four bytes rather than the parameters themselves, because the whole
 * payload has to stay small enough to scan off a cracked screen. That is only
 * worth carrying if a supervisor can get the drill back out of it, which is
 * what this does: walk the seeds, sample each one's parameters, and match the
 * digest. The worker faced belt C4, tripped, on the night shift, and an auditor
 * can now see that and run the identical drill rather than taking the
 * certificate's word for it.
 *
 * A digest that matches nothing is reported as unrecognised rather than hidden.
 * It means the module was edited after the credential was issued, so the run it
 * attests to no longer exists in this build. A supervisor should be told that,
 * not shown an empty list.
 */

const SCENARIOS: Scenario[] = [gasScenarioJson, fireScenarioJson, machineryScenarioJson].map((json) =>
  validateScenario(json),
);

/**
 * How far to search. Variants come from a handful of parameters, so every
 * distinct one shows up within the first few dozen seeds; this is generous
 * enough to be certain and small enough to run while a row expands.
 */
const SEED_LIMIT = 400;

export interface ReplayVariant {
  digest: number;
  scenarioId: string;
  seed: number;
  variantId: string;
  /** the parameters the worker actually faced, e.g. { belt: 'C4', belt_state: 'tripped' } */
  params: Record<string, string | number>;
  /** deep link that runs this exact drill, in the mode it was assessed in */
  href: string;
}

export interface UnknownVariant {
  digest: number;
  scenarioId: string | null;
}

export type ResolvedDigest = ReplayVariant | UnknownVariant;

export function isKnown(entry: ResolvedDigest): entry is ReplayVariant {
  return 'seed' in entry;
}

/** The same signature `resolveVariant` builds its variantId from. */
function variantIdFor(scenario: Scenario, params: Record<string, string | number>): string {
  const signature = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return `${scenario.id}@${hashString(`${scenario.id}|${signature}`)}`;
}

function digestOf(variantId: string): number {
  return parseInt(hashString(variantId), 16) >>> 0;
}

const indexCache = new Map<string, Map<number, ReplayVariant>>();

/** digest -> variant, for one scenario. Built once, on first use. */
function indexFor(scenario: Scenario): Map<number, ReplayVariant> {
  const cached = indexCache.get(scenario.id);
  if (cached) return cached;

  const index = new Map<number, ReplayVariant>();
  for (let seed = 1; seed <= SEED_LIMIT; seed++) {
    const params = sampleParams(scenario, seed);
    const variantId = variantIdFor(scenario, params);
    const digest = digestOf(variantId);
    // First seed wins: two seeds that sample the same parameters are the same
    // drill, and the lower one is the one the app itself would have used.
    if (!index.has(digest)) {
      index.set(digest, {
        digest,
        scenarioId: scenario.id,
        seed,
        variantId,
        params,
        href: `./index.html?scenario=${encodeURIComponent(scenario.id)}&seed=${seed}&mode=assess`,
      });
    }
  }
  indexCache.set(scenario.id, index);
  return index;
}

export function scenarioForDomain(domain: string): Scenario | null {
  return SCENARIOS.find((s) => s.domain === domain) ?? null;
}

/** Every variant a credential's digests refer to, in the order they were issued. */
export function resolveDigests(domain: string, digests: number[]): ResolvedDigest[] {
  const scenario = scenarioForDomain(domain);
  if (!scenario) return digests.map((digest) => ({ digest, scenarioId: null }));
  const index = indexFor(scenario);
  return digests.map((digest) => index.get(digest) ?? { digest, scenarioId: scenario.id });
}

/** "belt C4 · tripped · night shift" — the drill in the words the scenario uses. */
export function describeParams(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key.replaceAll('_', ' ')} ${value}`)
    .join(' · ');
}
