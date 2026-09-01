/**
 * Public surface of the drill engine.
 *
 * Renderers, the assessment layer and the credential issuer all import from
 * here. Nothing downstream should reach into individual modules — the tier
 * boundary is only meaningful if it is narrow.
 */

export { DIMENSIONS } from './types.ts';
export type {
  Action,
  ActionMatch,
  BriefNode,
  Dimension,
  ErrorRule,
  Expectation,
  LocalizedText,
  Narration,
  ObserveNode,
  OutcomeNode,
  Prop,
  RegulationRef,
  ResolvedScenario,
  Scenario,
  ScenarioNode,
  Severity,
  TimeWindow,
  TimeoutRule,
  VariantParam,
  Verb,
  WorldEffect,
} from './types.ts';

export { DrillSession, OUT_OF_ORDER } from './runtime.ts';
export type { DrillEvent, NodeResult, SessionOptions, StepResult, Verdict } from './runtime.ts';

export { distinctVariants, resolveVariant, sampleParams } from './variant.ts';
export { ScenarioError, validateScenario } from './validate.ts';
export type { Issue } from './validate.ts';

export { availableLanguages, interpolate, resolve as resolveText } from './text.ts';
export { hashString, makeRng } from './rng.ts';
