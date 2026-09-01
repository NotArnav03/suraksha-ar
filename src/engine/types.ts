/**
 * Scenario graph — the tier-agnostic contract.
 *
 * Nothing in this file knows whether a scenario is being rendered as 6DoF AR,
 * as a marker-tracked overlay, or as a flat 2D screen. Renderers translate
 * their input into `Action`s and their output from `WorldEffect`s; the engine
 * and the assessment see exactly the same stream in every tier. That property
 * is what lets a certificate mean the same thing on any handset.
 */

/** Competency dimensions. The assessment output is a vector over these, never a single number. */
export const DIMENSIONS = [
  'hazard_recognition', // did they notice the hazard at all
  'procedure_sequence', // right steps, right order
  'time_criticality', // fast enough once the alarm is live
  'ppe_discipline', // correct protective equipment, correctly worn
  'communication', // alerting standby, supervisor, control room
  'rescue_restraint', // NOT rushing in after a collapsed colleague
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

/** Language-keyed text. `en` is required; everything else is optional and falls back. */
export type LocalizedText = { en: string } & Record<string, string>;

/**
 * A narratable line. Audio is first-class, not an afterthought: a worker must be
 * able to complete a module without reading a single word.
 */
export interface Narration {
  text: LocalizedText;
  /** language code -> audio asset id */
  audio?: Record<string, string>;
}

export interface RegulationRef {
  /** e.g. "Mines Rules 1955 r.123" — shown in the debrief and carried into the credential */
  cite: string;
  note?: LocalizedText;
}

/** A physical thing in the scene. Placement is the renderer's problem, not the engine's. */
export interface Prop {
  id: string;
  kind:
    | 'equipment'
    | 'ppe'
    | 'instrument'
    | 'structure'
    | 'person'
    | 'signage'
    | 'hazard';
  label: LocalizedText;
  /** hint for the renderer's asset table; tiers may substitute freely */
  model?: string;
  /** true for props that only appear once a WorldEffect spawns them */
  spawned?: boolean;
}

export type Verb =
  | 'inspect' // look at / point at / examine
  | 'use' // operate an instrument or control
  | 'wear' // don PPE
  | 'attach' // clip on a harness, retrieval line
  | 'open'
  | 'close'
  | 'enter'
  | 'exit'
  | 'signal' // shout, whistle, radio, hand signal
  | 'report' // formally notify supervisor / control room
  | 'wait'
  | 'answer'; // respond to a posed question

/** What the learner did. Emitted by every renderer in an identical shape. */
export interface Action {
  verb: Verb;
  /** a role name (resolved through scenario bindings) or a literal prop id. Absent for objectless verbs like `wait`. */
  target?: string;
  value?: string | number;
}

/** Pattern matched against an incoming Action. Omitted fields are wildcards. */
export interface ActionMatch {
  verb?: Verb;
  target?: string;
  value?: string | number;
}

/** Something the world must do. Renderers subscribe; the engine never draws anything. */
export type WorldEffect =
  | { type: 'alarm'; level: 'none' | 'warning' | 'critical' }
  /** `value` may be authored as a `{{param}}` template; variant resolution coerces it to a number */
  | { type: 'set_gas'; species: 'O2' | 'CH4' | 'CO' | 'H2S'; value: number | string; unit: '%' | 'ppm' }
  | { type: 'spawn'; role: string }
  | { type: 'despawn'; role: string }
  | { type: 'fail_equipment'; role: string }
  | { type: 'haptic'; pattern: 'pulse' | 'sos' | 'continuous' }
  | { type: 'ambient'; state: string };

export type Severity = 'minor' | 'major' | 'fatal';

/**
 * The error taxonomy. Every wrong action a learner can take is a named, coded,
 * severity-graded mistake with a stated consequence — this is what turns a
 * failed run into a teachable debrief instead of a red X.
 */
export interface ErrorRule {
  match: ActionMatch;
  /** stable code, e.g. ENTERED_WITHOUT_GAS_TEST — aggregated across the workforce */
  code: string;
  severity: Severity;
  dimension: Dimension;
  /** what happens in the world as a result — shown, not just scored */
  consequence: Narration;
  effects?: WorldEffect[];
  /** fatal errors jump straight to an outcome node */
  goto?: string;
}

export interface TimeoutRule {
  code: string;
  severity: Severity;
  dimension: Dimension;
  consequence: Narration;
  effects?: WorldEffect[];
  goto?: string;
}

export interface TimeWindow {
  /** beyond this, the learner hesitated — costs time_criticality, not correctness */
  hesitationMs: number;
  /** beyond this, the timeout rule fires */
  deadlineMs: number;
}

export interface Expectation {
  match: ActionMatch;
  label: LocalizedText;
}

interface NodeBase {
  id: string;
  prompt: Narration;
  /** which competency dimensions this node measures */
  dimensions: Dimension[];
  weight?: number;
  cites?: RegulationRef[];
  /** fired on entering the node */
  effects?: WorldEffect[];
  /** drop this node from the graph unless every listed param matches */
  when?: Record<string, string | number>;
}

/** Narration only. Advances on acknowledgement. */
export interface BriefNode extends NodeBase {
  kind: 'brief';
  next: string;
}

/** Expects one or more actions, ordered or in any order. */
export interface ExpectNode extends NodeBase {
  kind: 'expect';
  ordered: boolean;
  expect: Expectation[];
  window?: TimeWindow;
  errors?: ErrorRule[];
  onTimeout?: TimeoutRule;
  next: string;
}

/** Hazard spotting: find at least `minCorrect` of the listed targets. */
export interface ObserveNode extends NodeBase {
  kind: 'observe';
  /** roles the learner should point out */
  targets: string[];
  minCorrect: number;
  /** pointing at these costs nothing but is recorded as a miss-cue */
  distractors?: string[];
  window?: TimeWindow;
  onTimeout?: TimeoutRule;
  next: string;
}

/** Terminal state. */
export interface OutcomeNode extends NodeBase {
  kind: 'outcome';
  result: 'pass' | 'fail' | 'fatal';
  /** shown in the debrief as the thing that actually happened */
  summary: Narration;
}

export type ScenarioNode = BriefNode | ExpectNode | ObserveNode | OutcomeNode;

/**
 * A randomisable parameter. Certification requires passing several distinct
 * variants, so memorising one run is worthless.
 */
export interface VariantParam {
  id: string;
  /** discrete choices, or a numeric range sampled on `step` */
  pick?: (string | number)[];
  range?: { min: number; max: number; step?: number; precision?: number };
  /** relative weights, parallel to `pick` */
  weights?: number[];
}

export interface Scenario {
  id: string;
  version: string;
  domain: string;
  title: LocalizedText;
  description: LocalizedText;
  languages: string[];
  regulations?: RegulationRef[];
  props: Prop[];
  /** role name -> prop id. Values may interpolate params: "{{detector}}" */
  bindings: Record<string, string>;
  params?: VariantParam[];
  start: string;
  nodes: ScenarioNode[];
  scoring: {
    /** minimum per-dimension score required to pass */
    passMark: Partial<Record<Dimension, number>>;
    /** how many distinct variants must be passed before a credential is issued */
    requiredVariants: number;
  };
}

/** A scenario with one variant's parameters resolved and its guards applied. */
export interface ResolvedScenario extends Omit<Scenario, 'params' | 'nodes'> {
  nodes: ScenarioNode[];
  /** deterministic id derived from scenario id + seed; carried into the credential */
  variantId: string;
  seed: number;
  params: Record<string, string | number>;
}
