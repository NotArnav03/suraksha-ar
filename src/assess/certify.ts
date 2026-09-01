import { DIMENSIONS, type Dimension, type Scenario } from '../engine/types.ts';
import type { Competency } from './score.ts';

/**
 * Certification.
 *
 * A credential is granted for passing several *distinct* variants, not for
 * passing several times. Two attempts at the same variant demonstrate that the
 * worker remembers one run; attempts at different variants demonstrate that the
 * procedure generalises, which is the only thing worth certifying.
 *
 * Failing does not bar a worker permanently — a variant counts once it has been
 * passed, so the path is drill, fail, learn, re-attempt. What cannot be
 * salvaged is a single attempt: any fatal error fails that attempt outright.
 */

export interface AggregateScore {
  dimension: Dimension;
  /** mean across the counted attempts */
  mean: number | null;
  /** the worst single attempt — what a safety credential is actually worth */
  worst: number | null;
  passMark: number | null;
  attempts: number;
}

export interface Certification {
  scenarioId: string;
  granted: boolean;
  reasons: string[];
  requiredVariants: number;
  distinctVariantsPassed: number;
  countedVariantIds: string[];
  attempts: { total: number; passed: number; failed: number; fatal: number };
  vector: AggregateScore[];
  /** lowest mean dimension, with its score — what the next micro-drill targets */
  weakest: { dimension: Dimension; mean: number } | null;
}

export function certify(
  scenario: Pick<Scenario, 'id' | 'scoring'>,
  attempts: Competency[],
): Certification {
  const required = scenario.scoring.requiredVariants;

  const forThisScenario = attempts.filter((a) => a.scenarioId === scenario.id);

  // One counted attempt per distinct variant: the first that passed it.
  const counted = new Map<string, Competency>();
  for (const attempt of forThisScenario) {
    if (attempt.result !== 'pass') continue;
    if (!counted.has(attempt.variantId)) counted.set(attempt.variantId, attempt);
  }

  const countedAttempts = [...counted.values()];
  const vector: AggregateScore[] = DIMENSIONS.map((dimension) => {
    const scores = countedAttempts
      .map((a) => a.vector.find((d) => d.dimension === dimension)?.score ?? null)
      .filter((value): value is number => value !== null);
    const passMark = scenario.scoring.passMark[dimension] ?? null;
    return {
      dimension,
      mean: scores.length === 0 ? null : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      worst: scores.length === 0 ? null : Math.min(...scores),
      passMark,
      attempts: scores.length,
    };
  });

  const reasons: string[] = [];
  const granted = counted.size >= required;
  if (!granted) {
    reasons.push(
      `${counted.size} of ${required} distinct variants passed — ${required - counted.size} more required`,
    );
    const fatal = forThisScenario.filter((a) => a.result === 'fatal');
    for (const attempt of fatal) {
      for (const error of attempt.fatalErrors) {
        reasons.push(`attempt on ${attempt.variantId} ended fatally: ${error.code}`);
      }
    }
    const shortfalls = new Set(forThisScenario.flatMap((a) => a.shortfalls));
    for (const dimension of shortfalls) {
      const mark = scenario.scoring.passMark[dimension];
      reasons.push(`below pass mark on ${dimension}${mark === undefined ? '' : ` (needs ${mark})`}`);
    }
  } else {
    reasons.push(`${counted.size} distinct variants passed, ${required} required`);
  }

  const rated = vector.filter((d): d is AggregateScore & { mean: number } => d.mean !== null);
  const lowest = rated.length === 0 ? null : rated.reduce((low, d) => (d.mean < low.mean ? d : low), rated[0]!);
  const weakest = lowest === null ? null : { dimension: lowest.dimension, mean: lowest.mean };

  return {
    scenarioId: scenario.id,
    granted,
    reasons,
    requiredVariants: required,
    distinctVariantsPassed: counted.size,
    countedVariantIds: [...counted.keys()],
    attempts: {
      total: forThisScenario.length,
      passed: forThisScenario.filter((a) => a.result === 'pass').length,
      failed: forThisScenario.filter((a) => a.result === 'fail').length,
      fatal: forThisScenario.filter((a) => a.result === 'fatal').length,
    },
    vector,
    weakest,
  };
}
