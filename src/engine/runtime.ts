import type {
  Action,
  ActionMatch,
  Dimension,
  ErrorRule,
  Expectation,
  Narration,
  ResolvedScenario,
  ScenarioNode,
  Severity,
  WorldEffect,
} from './types.ts';

/**
 * The drill runtime.
 *
 * This is the only place a run is scored-in-fact: every tier feeds `dispatch`
 * the same `Action` shape and gets back the same event stream, so a competency
 * measurement taken through a 2D fallback is directly comparable to one taken
 * through 6DoF AR. The runtime knows nothing about cameras, meshes or taps.
 *
 * The clock is injected. Time is assessed evidence here — hesitation before a
 * self-rescuer is a finding, not a UI detail — so it has to be deterministic
 * under test rather than whatever the wall clock happened to say.
 */

export type Verdict =
  | 'correct'
  | 'wrong'
  | 'out_of_order'
  | 'ignored'
  | 'distractor'
  | 'noop';

export type DrillEvent =
  | { type: 'session_start'; t: number; variantId: string; seed: number }
  | { type: 'node_enter'; t: number; nodeId: string; kind: ScenarioNode['kind'] }
  | { type: 'effect'; t: number; nodeId: string; effect: WorldEffect }
  | {
      type: 'action';
      t: number;
      nodeId: string;
      action: Action;
      verdict: Verdict;
      /** ms since the node opened, or since the previous satisfied step */
      latencyMs: number;
      hesitated: boolean;
    }
  | {
      type: 'error';
      t: number;
      nodeId: string;
      code: string;
      severity: Severity;
      dimension: Dimension;
    }
  | {
      type: 'timeout';
      t: number;
      nodeId: string;
      code: string;
      severity: Severity;
      dimension: Dimension;
    }
  | { type: 'node_exit'; t: number; nodeId: string; satisfied: boolean }
  | { type: 'session_end'; t: number; nodeId: string; result: 'pass' | 'fail' | 'fatal' };

/** Per-node record, the raw material the competency scorer consumes. */
export interface NodeResult {
  nodeId: string;
  kind: ScenarioNode['kind'];
  dimensions: Dimension[];
  weight: number;
  satisfied: boolean;
  /** ms from node open to the first correct action — the headline latency metric */
  timeToFirstCorrectMs: number | null;
  hesitations: number;
  errors: { code: string; severity: Severity; dimension: Dimension }[];
  timedOut: boolean;
}

export interface StepResult {
  verdict: Verdict;
  advanced: boolean;
  finished: boolean;
  node: ScenarioNode;
  events: DrillEvent[];
  effects: WorldEffect[];
  consequence?: Narration;
  /** severity of the rule that fired, when one did — set alongside `consequence` */
  severity?: Severity;
}

export interface SessionOptions {
  /** monotonic ms source; injected so drills are reproducible under test */
  now?: () => number;
}

/** Built-in codes the runtime raises itself, alongside the authored taxonomy. */
export const OUT_OF_ORDER = 'STEP_OUT_OF_ORDER';

export class DrillSession {
  readonly scenario: ResolvedScenario;
  readonly events: DrillEvent[] = [];
  readonly results: NodeResult[] = [];

  #now: () => number;
  #byId: Map<string, ScenarioNode>;
  #nodeId: string;
  #nodeEnteredAt = 0;
  #lastProgressAt = 0;
  #pending: number[] = [];
  #observed = new Set<string>();
  #current: NodeResult;
  #finished = false;
  #outcome: 'pass' | 'fail' | 'fatal' | null = null;

  constructor(scenario: ResolvedScenario, options: SessionOptions = {}) {
    this.scenario = scenario;
    this.#now = options.now ?? (() => Date.now());
    this.#byId = new Map(scenario.nodes.map((node) => [node.id, node]));
    this.#nodeId = scenario.start;

    const t = this.#now();
    this.events.push({ type: 'session_start', t, variantId: scenario.variantId, seed: scenario.seed });
    this.#current = this.#blankResult(this.node);
    this.#enter(this.node, t, []);
  }

  get node(): ScenarioNode {
    const node = this.#byId.get(this.#nodeId);
    if (!node) throw new Error(`Runtime lost: node "${this.#nodeId}" is not in the resolved graph`);
    return node;
  }

  get finished(): boolean {
    return this.#finished;
  }

  /**
   * Expectations this node is still waiting on, in authored order. Renderers use
   * it to drive a checklist; the headless runner uses it to derive a correct
   * playthrough from the graph rather than hard-coding one beside it.
   */
  get pending(): Expectation[] {
    const node = this.node;
    if (node.kind !== 'expect') return [];
    return this.#pending.map((index) => node.expect[index]!);
  }

  /** Targets already spotted on an observe node. */
  get observed(): ReadonlySet<string> {
    return this.#observed;
  }

  get outcome(): 'pass' | 'fail' | 'fatal' | null {
    return this.#outcome;
  }

  /** Roles and prop ids are interchangeable at the boundary; both collapse to a prop id. */
  resolveTarget(target: string): string {
    return this.scenario.bindings[target] ?? target;
  }

  /** Advances a narration node once the learner has heard it out. */
  acknowledge(): StepResult {
    const node = this.node;
    if (this.#finished) return this.#noop(node);
    if (node.kind !== 'brief') return this.#noop(node);
    const t = this.#now();
    this.#current.satisfied = true;
    return this.#advance(node.next, t, 'correct');
  }

  /** The single input path. Every renderer, every tier, this shape. */
  dispatch(action: Action): StepResult {
    const node = this.node;
    if (this.#finished) return this.#noop(node);
    const t = this.#now();
    const latencyMs = t - this.#lastProgressAt;
    const window = node.kind === 'expect' || node.kind === 'observe' ? node.window : undefined;
    const hesitated = window ? latencyMs > window.hesitationMs : false;

    if (node.kind === 'expect') return this.#dispatchExpect(node, action, t, latencyMs, hesitated);
    if (node.kind === 'observe') return this.#dispatchObserve(node, action, t, latencyMs, hesitated);
    return this.#noop(node);
  }

  /** Renderers call this each frame so deadlines fire without an input. */
  tick(): StepResult | null {
    if (this.#finished) return null;
    const node = this.node;
    if (node.kind !== 'expect' && node.kind !== 'observe') return null;
    const { window, onTimeout: rule } = node;
    if (!window || !rule) return null;

    const t = this.#now();
    if (t - this.#nodeEnteredAt <= window.deadlineMs) return null;

    const events: DrillEvent[] = [];
    const effects: WorldEffect[] = [];
    events.push({
      type: 'timeout',
      t,
      nodeId: node.id,
      code: rule.code,
      severity: rule.severity,
      dimension: rule.dimension,
    });
    this.#current.timedOut = true;
    this.#current.errors.push({
      code: rule.code,
      severity: rule.severity,
      dimension: rule.dimension,
    });
    for (const effect of rule.effects ?? []) {
      events.push({ type: 'effect', t, nodeId: node.id, effect });
      effects.push(effect);
    }
    this.events.push(...events);

    const step = this.#advance(rule.goto ?? node.next, t, 'wrong', events, effects);
    return { ...step, consequence: rule.consequence, severity: rule.severity };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  #dispatchExpect(
    node: Extract<ScenarioNode, { kind: 'expect' }>,
    action: Action,
    t: number,
    latencyMs: number,
    hesitated: boolean,
  ): StepResult {
    const matchIndex = this.#pending.find((index) =>
      this.#matches(node.expect[index]!.match, action),
    );

    if (matchIndex !== undefined) {
      const isNext = !node.ordered || matchIndex === this.#pending[0];
      if (!isNext) {
        // Right action, wrong moment. Sequence is the competency being tested,
        // so this is a finding rather than a shrug.
        this.#record(t, node.id, action, 'out_of_order', latencyMs, hesitated);
        this.events.push({
          type: 'error',
          t,
          nodeId: node.id,
          code: OUT_OF_ORDER,
          severity: 'major',
          dimension: 'procedure_sequence',
        });
        this.#current.errors.push({
          code: OUT_OF_ORDER,
          severity: 'major',
          dimension: 'procedure_sequence',
        });
        return { verdict: 'out_of_order', advanced: false, finished: false, node, events: [], effects: [] };
      }

      this.#record(t, node.id, action, 'correct', latencyMs, hesitated);
      if (this.#current.timeToFirstCorrectMs === null) {
        this.#current.timeToFirstCorrectMs = t - this.#nodeEnteredAt;
      }
      if (hesitated) this.#current.hesitations += 1;
      this.#pending = this.#pending.filter((index) => index !== matchIndex);
      this.#lastProgressAt = t;

      if (this.#pending.length === 0) {
        this.#current.satisfied = true;
        return this.#advance(node.next, t, 'correct');
      }
      return { verdict: 'correct', advanced: false, finished: false, node, events: [], effects: [] };
    }

    const rule = node.errors?.find((candidate) => this.#matches(candidate.match, action));
    if (rule) return this.#raise(node, rule, action, t, latencyMs, hesitated);

    // Unmatched input is still evidence — flailing is a signal — but costs nothing.
    this.#record(t, node.id, action, 'ignored', latencyMs, hesitated);
    return { verdict: 'ignored', advanced: false, finished: false, node, events: [], effects: [] };
  }

  #dispatchObserve(
    node: Extract<ScenarioNode, { kind: 'observe' }>,
    action: Action,
    t: number,
    latencyMs: number,
    hesitated: boolean,
  ): StepResult {
    if (action.target === undefined) {
      this.#record(t, node.id, action, 'ignored', latencyMs, hesitated);
      return { verdict: 'ignored', advanced: false, finished: false, node, events: [], effects: [] };
    }

    // Before anything counts as having been *spotted*. An observe node used to
    // read only the target and never the verb, so climbing into the sump during
    // the hazard survey was recorded as having correctly identified the sump —
    // the most lethal act in the scenario, scored as competence, with no
    // consequence shown. Authored rules win over the observation they collide
    // with: surveying a confined space and entering it are different acts.
    const rule = node.errors?.find((candidate) => this.#matches(candidate.match, action));
    if (rule) return this.#raise(node, rule, action, t, latencyMs, hesitated);

    const target = this.resolveTarget(action.target);
    const isTarget = node.targets.some((role) => this.resolveTarget(role) === target);
    const isDistractor = (node.distractors ?? []).some(
      (role) => this.resolveTarget(role) === target,
    );

    if (isTarget && !this.#observed.has(target)) {
      this.#observed.add(target);
      this.#record(t, node.id, action, 'correct', latencyMs, hesitated);
      if (this.#current.timeToFirstCorrectMs === null) {
        this.#current.timeToFirstCorrectMs = t - this.#nodeEnteredAt;
      }
      if (hesitated) this.#current.hesitations += 1;
      this.#lastProgressAt = t;
      if (this.#observed.size >= node.minCorrect) {
        this.#current.satisfied = true;
        return this.#advance(node.next, t, 'correct');
      }
      return { verdict: 'correct', advanced: false, finished: false, node, events: [], effects: [] };
    }

    const verdict: Verdict = isDistractor ? 'distractor' : 'ignored';
    this.#record(t, node.id, action, verdict, latencyMs, hesitated);
    return { verdict, advanced: false, finished: false, node, events: [], effects: [] };
  }

  /**
   * Fire an authored error rule: record it, run its effects, and route where it
   * says. Shared by expect and observe nodes so a rule behaves identically
   * whichever kind of node carries it — a fatal on one cannot quietly become a
   * scratch on the other.
   */
  #raise(
    node: ScenarioNode,
    rule: ErrorRule,
    action: Action,
    t: number,
    latencyMs: number,
    hesitated: boolean,
  ): StepResult {
    const events: DrillEvent[] = [];
    const effects: WorldEffect[] = [];
    this.#record(t, node.id, action, 'wrong', latencyMs, hesitated);
    events.push({
      type: 'error',
      t,
      nodeId: node.id,
      code: rule.code,
      severity: rule.severity,
      dimension: rule.dimension,
    });
    this.#current.errors.push({
      code: rule.code,
      severity: rule.severity,
      dimension: rule.dimension,
    });
    for (const effect of rule.effects ?? []) {
      events.push({ type: 'effect', t, nodeId: node.id, effect });
      effects.push(effect);
    }
    this.events.push(...events);

    if (rule.goto) {
      const step = this.#advance(rule.goto, t, 'wrong', events, effects);
      return { ...step, consequence: rule.consequence, severity: rule.severity };
    }
    return {
      verdict: 'wrong',
      advanced: false,
      finished: false,
      node,
      events,
      effects,
      consequence: rule.consequence,
      severity: rule.severity,
    };
  }

  #matches(match: ActionMatch, action: Action): boolean {
    if (match.verb && match.verb !== action.verb) return false;
    if (match.target) {
      if (action.target === undefined) return false;
      if (this.resolveTarget(match.target) !== this.resolveTarget(action.target)) return false;
    }
    if (match.value !== undefined && match.value !== action.value) return false;
    return true;
  }

  #record(
    t: number,
    nodeId: string,
    action: Action,
    verdict: Verdict,
    latencyMs: number,
    hesitated: boolean,
  ): void {
    this.events.push({ type: 'action', t, nodeId, action, verdict, latencyMs, hesitated });
  }

  #blankResult(node: ScenarioNode): NodeResult {
    return {
      nodeId: node.id,
      kind: node.kind,
      dimensions: node.dimensions,
      weight: node.weight ?? 1,
      satisfied: false,
      timeToFirstCorrectMs: null,
      hesitations: 0,
      errors: [],
      timedOut: false,
    };
  }

  #enter(node: ScenarioNode, t: number, effects: WorldEffect[]): void {
    this.#nodeEnteredAt = t;
    this.#lastProgressAt = t;
    this.#observed = new Set();
    this.#pending = node.kind === 'expect' ? node.expect.map((_, index) => index) : [];
    this.events.push({ type: 'node_enter', t, nodeId: node.id, kind: node.kind });

    for (const effect of node.effects ?? []) {
      this.events.push({ type: 'effect', t, nodeId: node.id, effect });
      effects.push(effect);
    }

    if (node.kind === 'outcome') {
      this.#finished = true;
      this.#outcome = node.result;
      this.#current.satisfied = node.result === 'pass';
      this.events.push({ type: 'session_end', t, nodeId: node.id, result: node.result });
    }
  }

  #advance(
    nextId: string,
    t: number,
    verdict: Verdict,
    carriedEvents: DrillEvent[] = [],
    carriedEffects: WorldEffect[] = [],
  ): StepResult {
    const from = this.node;
    this.events.push({ type: 'node_exit', t, nodeId: from.id, satisfied: this.#current.satisfied });
    this.results.push(this.#current);

    this.#nodeId = nextId;
    const next = this.node;
    this.#current = this.#blankResult(next);
    const effects = [...carriedEffects];
    this.#enter(next, t, effects);

    if (next.kind === 'outcome') this.results.push(this.#current);

    return {
      verdict,
      advanced: true,
      finished: this.#finished,
      node: next,
      events: carriedEvents,
      effects,
    };
  }

  #noop(node: ScenarioNode): StepResult {
    return { verdict: 'noop', advanced: false, finished: this.#finished, node, events: [], effects: [] };
  }
}
