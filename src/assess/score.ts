import type { DrillSession, NodeResult } from '../engine/runtime.ts';
import { DIMENSIONS, type Dimension, type ResolvedScenario, type Severity } from '../engine/types.ts';

/**
 * Competency scoring.
 *
 * The output is a vector over six dimensions, never a single number. A worker
 * who is fast and careless and a worker who is slow and correct do not have the
 * same competency, and collapsing them into "78%" throws away the one thing a
 * supervisor can act on — *which* reflex is weak.
 *
 * Every figure here traces back to named nodes. `contributions` is not debug
 * output; it is what the debrief screen and the audit trail both read, and it is
 * why a disputed certificate can be argued about with evidence.
 */

/** How much of a node's credit each class of mistake burns. */
export const SEVERITY_PENALTY: Record<Severity, number> = {
  minor: 0.15,
  major: 0.4,
  fatal: 1,
};

/** Hesitating past the soft window costs time_criticality, never correctness. */
export const HESITATION_PENALTY = 0.25;

export interface Penalty {
  reason: string;
  amount: number;
}

/** One node's effect on one dimension — the unit of explanation. */
export interface Contribution {
  nodeId: string;
  dimension: Dimension;
  weight: number;
  /** 1 if the node was satisfied, 0 if not */
  credit: number;
  penalties: Penalty[];
  earned: number;
}

export interface DimensionScore {
  dimension: Dimension;
  /** 0..100, or null when this run produced no evidence about the dimension */
  score: number | null;
  earned: number;
  possible: number;
  /** how many nodes spoke to this dimension — a score off one node is a thin score */
  evidence: number;
  /** a fatal error zeroes the dimension outright rather than averaging it away */
  floored: boolean;
  passMark: number | null;
  passed: boolean | null;
}

export interface ErrorCount {
  code: string;
  count: number;
  severity: Severity;
  dimension: Dimension;
}

export interface Competency {
  scenarioId: string;
  variantId: string;
  seed: number;
  result: 'pass' | 'fail' | 'fatal';
  outcomeNodeId: string | null;
  vector: DimensionScore[];
  /** dimensions that came in under their pass mark */
  shortfalls: Dimension[];
  fatalErrors: { code: string; dimension: Dimension }[];
  errorCounts: ErrorCount[];
  latency: {
    /** median time-to-first-correct-action across assessed nodes */
    medianTimeToFirstCorrectMs: number | null;
    slowestNodeId: string | null;
    slowestMs: number | null;
    hesitations: number;
  };
  nodes: { assessed: number; satisfied: number };
  contributions: Contribution[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Dimensions this node carries evidence about: the ones it declares, plus any
 * the learner damaged here. A sequence error on a PPE node is still evidence
 * about sequencing even though the node was not authored to measure it.
 */
function dimensionsFor(result: NodeResult): Set<Dimension> {
  const dims = new Set<Dimension>(result.dimensions);
  for (const error of result.errors) dims.add(error.dimension);
  return dims;
}

export function scoreResults(
  scenario: Pick<ResolvedScenario, 'id' | 'variantId' | 'seed' | 'scoring'>,
  results: NodeResult[],
  outcome: 'pass' | 'fail' | 'fatal' | null,
  outcomeNodeId: string | null,
): Competency {
  const assessed = results.filter((r) => r.kind === 'expect' || r.kind === 'observe');

  const earned = new Map<Dimension, number>();
  const possible = new Map<Dimension, number>();
  const evidence = new Map<Dimension, number>();
  const floored = new Set<Dimension>();
  const contributions: Contribution[] = [];

  for (const result of assessed) {
    const weight = result.weight;
    if (weight <= 0) continue;

    for (const dimension of dimensionsFor(result)) {
      const penalties: Penalty[] = [];
      const credit = result.satisfied ? 1 : 0;

      for (const error of result.errors) {
        if (error.dimension !== dimension) continue;
        penalties.push({
          reason: error.code,
          amount: SEVERITY_PENALTY[error.severity],
        });
        if (error.severity === 'fatal') floored.add(dimension);
      }

      // Hesitation is a latency finding. It only touches the dimension that is
      // actually about acting fast, and only where the node measures it.
      if (dimension === 'time_criticality' && result.hesitations > 0) {
        penalties.push({
          reason: `HESITATED_x${result.hesitations}`,
          amount: HESITATION_PENALTY * result.hesitations,
        });
      }

      const deduction = penalties.reduce((sum, p) => sum + p.amount, 0);
      const fraction = clamp01(credit - deduction);
      const value = weight * fraction;

      contributions.push({
        nodeId: result.nodeId,
        dimension,
        weight,
        credit,
        penalties,
        earned: Number(value.toFixed(3)),
      });

      possible.set(dimension, (possible.get(dimension) ?? 0) + weight);
      earned.set(dimension, (earned.get(dimension) ?? 0) + value);
      evidence.set(dimension, (evidence.get(dimension) ?? 0) + 1);
    }
  }

  const vector: DimensionScore[] = DIMENSIONS.map((dimension) => {
    const total = possible.get(dimension) ?? 0;
    const got = earned.get(dimension) ?? 0;
    const isFloored = floored.has(dimension);
    const passMark = scenario.scoring.passMark[dimension] ?? null;
    const score =
      total === 0 ? null : isFloored ? 0 : Math.round((got / total) * 100);

    return {
      dimension,
      score,
      earned: Number(got.toFixed(3)),
      possible: total,
      evidence: evidence.get(dimension) ?? 0,
      floored: isFloored,
      passMark,
      passed: score === null || passMark === null ? null : score >= passMark,
    };
  });

  const shortfalls = vector.filter((d) => d.passed === false).map((d) => d.dimension);

  const errorIndex = new Map<string, ErrorCount>();
  const fatalErrors: { code: string; dimension: Dimension }[] = [];
  for (const result of results) {
    for (const error of result.errors) {
      const existing = errorIndex.get(error.code);
      if (existing) existing.count += 1;
      else
        errorIndex.set(error.code, {
          code: error.code,
          count: 1,
          severity: error.severity,
          dimension: error.dimension,
        });
      if (error.severity === 'fatal') {
        fatalErrors.push({ code: error.code, dimension: error.dimension });
      }
    }
  }

  const latencies = assessed
    .map((r) => r.timeToFirstCorrectMs)
    .filter((value): value is number => value !== null);
  const slowest = assessed
    .filter((r) => r.timeToFirstCorrectMs !== null)
    .sort((a, b) => b.timeToFirstCorrectMs! - a.timeToFirstCorrectMs!)[0];

  // Reaching the pass outcome is necessary but not sufficient — you also have to
  // clear every dimension the scenario sets a mark for.
  const result: Competency['result'] =
    outcome === 'fatal' || fatalErrors.length > 0
      ? 'fatal'
      : outcome === 'pass' && shortfalls.length === 0
        ? 'pass'
        : 'fail';

  return {
    scenarioId: scenario.id,
    variantId: scenario.variantId,
    seed: scenario.seed,
    result,
    outcomeNodeId,
    vector,
    shortfalls,
    fatalErrors,
    errorCounts: [...errorIndex.values()].sort((a, b) => b.count - a.count),
    latency: {
      medianTimeToFirstCorrectMs: median(latencies),
      slowestNodeId: slowest?.nodeId ?? null,
      slowestMs: slowest?.timeToFirstCorrectMs ?? null,
      hesitations: assessed.reduce((sum, r) => sum + r.hesitations, 0),
    },
    nodes: {
      assessed: assessed.length,
      satisfied: assessed.filter((r) => r.satisfied).length,
    },
    contributions,
  };
}

export function scoreSession(session: DrillSession): Competency {
  const node = session.node;
  return scoreResults(
    session.scenario,
    session.results,
    session.outcome,
    node.kind === 'outcome' ? node.id : null,
  );
}
