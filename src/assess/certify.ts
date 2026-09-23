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

/** A reason a certificate was withheld, in a form the learner's UI can translate. */
export type ReasonDetail =
  | { code: 'moreVariants'; passed: number; required: number; short: number }
  | { code: 'aidedRuns'; count: number }
  | { code: 'fatalAttempt'; error: string }
  | { code: 'belowMark'; dimension: Dimension; mark: number | null };

export interface Certification {
  scenarioId: string;
  granted: boolean;
  reasons: string[];
  /**
   * The same reasons as structured data.
   *
   * `reasons` is English prose, which is fine for a supervisor's dashboard and
   * wrong for the worker's own screen: a Hindi debrief was printing "below pass
   * mark on ppe_discipline" straight through. The learner's UI renders these
   * instead and looks the words up in their language.
   */
  details: ReasonDetail[];
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

  const all = attempts.filter((a) => a.scenarioId === scenario.id);

  // A guided run names every step as the learner takes it, and a hinted run
  // hands over the one step the learner could not find. Both teach; neither is
  // evidence of competence, so neither can be counted towards a credential.
  const forThisScenario = all.filter((a) => a.mode === 'assess' && !a.hinted);
  const aided = all.length - forThisScenario.length;

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
  const details: ReasonDetail[] = [];
  const granted = counted.size >= required;
  if (!granted) {
    reasons.push(
      `${counted.size} of ${required} distinct variants passed — ${required - counted.size} more required`,
    );
    details.push({ code: 'moreVariants', passed: counted.size, required, short: required - counted.size });
    if (aided > 0) {
      reasons.push(
        `${aided} guided or hinted ${aided === 1 ? 'run does' : 'runs do'} not count towards a certificate`,
      );
      details.push({ code: 'aidedRuns', count: aided });
    }
    const fatal = forThisScenario.filter((a) => a.result === 'fatal');
    for (const attempt of fatal) {
      for (const error of attempt.fatalErrors) {
        reasons.push(`attempt on ${attempt.variantId} ended fatally: ${error.code}`);
        details.push({ code: 'fatalAttempt', error: error.code });
      }
    }
    const shortfalls = new Set(forThisScenario.flatMap((a) => a.shortfalls));
    for (const dimension of shortfalls) {
      const mark = scenario.scoring.passMark[dimension];
      reasons.push(`below pass mark on ${dimension}${mark === undefined ? '' : ` (needs ${mark})`}`);
      details.push({ code: 'belowMark', dimension, mark: mark ?? null });
    }
  } else {
    // Nothing is added to `details` here on purpose: on a pass the learner's
    // screen already carries this line as a localised heading above the pips,
    // and printing it twice in two languages is how the certificate panel
    // ended up with an English sentence under a Hindi one.
    reasons.push(`${counted.size} distinct variants passed, ${required} required`);
  }

  const rated = vector.filter((d): d is AggregateScore & { mean: number } => d.mean !== null);
  const lowest = rated.length === 0 ? null : rated.reduce((low, d) => (d.mean < low.mean ? d : low), rated[0]!);
  const weakest = lowest === null ? null : { dimension: lowest.dimension, mean: lowest.mean };

  return {
    scenarioId: scenario.id,
    granted,
    reasons,
    details,
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
