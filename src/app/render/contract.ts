import type { Action, Prop, ScenarioNode, Verb, WorldEffect } from '../../engine/types.ts';
import type { Verdict } from '../../engine/runtime.ts';

/**
 * The renderer contract.
 *
 * A tier owns exactly one thing: how the world is shown and how a learner
 * touches it. The prompt, the checklist, the countdown, the consequence banner
 * and every assessment decision live above this line and are shared, because
 * the moment a tier owns any of them the tiers stop being comparable and the
 * certificate stops meaning the same thing on different handsets.
 */

export type Tier = 'A' | 'B' | 'C';

/** What a learner may plausibly do to a thing. The verb is a deliberate choice,
 *  which is why entering a confined space can never be an accidental tap. */
export const VERBS_BY_KIND: Record<Prop['kind'], Verb[]> = {
  structure: ['inspect', 'enter', 'exit'],
  signage: ['inspect'],
  instrument: ['inspect', 'use'],
  equipment: ['inspect', 'use', 'attach', 'report'],
  ppe: ['inspect', 'wear'],
  person: ['inspect', 'signal', 'report'],
  hazard: ['inspect'],
};

export interface PropView {
  /** the prop id, which is what the engine matches on */
  id: string;
  /** the role bound to it in this variant, when there is one */
  role: string | null;
  kind: Prop['kind'];
  label: string;
  verbs: Verb[];
  /** spawned props stay hidden until a WorldEffect brings them into the scene */
  visible: boolean;
}

export interface ChecklistItem {
  label: string;
  done: boolean;
}

export interface NodeView {
  node: ScenarioNode;
  prompt: string;
  /** authored expectation labels — the checklist is content, not UI copy */
  checklist: ChecklistItem[];
  props: PropView[];
  /** true when the node advances on acknowledgement rather than an action */
  narrationOnly: boolean;
  window: { hesitationMs: number; deadlineMs: number } | null;
  enteredAt: number;
}

export interface Feedback {
  verdict: Verdict;
  /** the authored consequence, in the learner's language */
  consequence: string | null;
  severity: 'minor' | 'major' | 'fatal' | null;
}

export interface RendererHooks {
  act(action: Action): void;
  acknowledge(): void;
}

export interface WorldRenderer {
  readonly tier: Tier;
  readonly label: string;
  mount(host: HTMLElement, hooks: RendererHooks): Promise<void>;
  present(view: NodeView): void;
  effect(effect: WorldEffect): void;
  feedback(feedback: Feedback): void;
  dispose(): void;
}
