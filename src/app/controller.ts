import { DrillSession, type StepResult } from '../engine/runtime.ts';
import type { Action, ResolvedScenario } from '../engine/types.ts';
import { VERBS_BY_KIND, type ChecklistItem, type NodeView, type PropView, type WorldRenderer } from './render/contract.ts';
import { Hud } from './ui/hud.ts';
import type { Localizer } from './ui/i18n.ts';
import type { LangCode } from './ui/i18n.ts';

/**
 * Drives one drill.
 *
 * Everything a tier is allowed to do goes through here: the controller owns the
 * session, builds the view both the HUD and the world renderer read, and runs
 * the frame loop that makes deadlines fire without an input. A renderer never
 * touches `DrillSession` — if it could, the tiers would stop being comparable.
 */

export interface DrillHooks {
  onFinish(session: DrillSession): void;
}

/**
 * Clock and frame source.
 *
 * Injected for the same reason the session's clock is: deadlines are assessed
 * evidence, and evidence that depends on an ambient global cannot be reproduced.
 * It also means a headless harness can drive the client without a render loop
 * pinning the process open.
 */
export interface Scheduler {
  now(): number;
  frame(callback: () => void): number;
  cancel(handle: number): void;
}

export const rafScheduler: Scheduler = {
  now: () => performance.now(),
  frame: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export class DrillController {
  readonly session: DrillSession;
  readonly hud: Hud;

  #scenario: ResolvedScenario;
  #renderer: WorldRenderer;
  #i18n: Localizer;
  #hooks: DrillHooks;
  #scheduler: Scheduler;
  #roleOf: Map<string, string>;
  #nodeId = '';
  #enteredAt = 0;
  #frame = 0;
  #done = false;

  constructor(
    scenario: ResolvedScenario,
    renderer: WorldRenderer,
    i18n: Localizer,
    hooks: DrillHooks,
    scheduler: Scheduler = rafScheduler,
  ) {
    this.#scenario = scenario;
    this.#renderer = renderer;
    this.#i18n = i18n;
    this.#hooks = hooks;
    this.#scheduler = scheduler;

    // prop id -> role, so a tile can show which role it is filling this variant
    this.#roleOf = new Map(
      Object.entries(scenario.bindings).map(([role, propId]) => [propId, role]),
    );

    this.session = new DrillSession(scenario, { now: () => scheduler.now() });
    this.hud = new Hud(i18n, {
      onAcknowledge: () => this.#apply(this.session.acknowledge()),
      onLanguage: (code: LangCode) => {
        i18n.setLanguage(code);
        this.#present(true);
      },
      onSpeechToggle: (enabled) => (i18n.speechEnabled = enabled),
      onWait: () => this.act({ verb: 'wait' }),
    }, renderer.tier, renderer.label);
  }

  async start(world: HTMLElement, chrome: HTMLElement): Promise<void> {
    await this.#renderer.mount(world, {
      act: (action) => this.act(action),
      acknowledge: () => this.#apply(this.session.acknowledge()),
    });
    chrome.append(this.hud.root);

    // Effects fired on entering the very first node happen inside the session
    // constructor, before anything is mounted. Replay them so the world starts
    // in the state the scenario asked for.
    for (const event of this.session.events) {
      if (event.type === 'effect') this.#renderer.effect(event.effect);
    }

    this.#present(true);
    this.#loop();
  }

  act(action: Action): void {
    if (this.#done) return;
    this.#apply(this.session.dispatch(action));
  }

  stop(): void {
    this.#done = true;
    this.#scheduler.cancel(this.#frame);
    this.#i18n.stop();
    this.#renderer.dispose();
    this.hud.root.remove();
  }

  #loop = (): void => {
    if (this.#done) return;
    const step = this.session.tick();
    if (step) this.#apply(step);
    this.hud.tick(this.#scheduler.now());
    this.#frame = this.#scheduler.frame(this.#loop);
  };

  #apply(step: StepResult): void {
    for (const effect of step.effects) this.#renderer.effect(effect);

    const feedback = {
      verdict: step.verdict,
      consequence: step.consequence ? this.#i18n.text(step.consequence.text) : null,
      severity: step.severity ?? null,
    };

    // Present first, then feed back. A fatal mistake advances to the outcome
    // node in the same step that produced its consequence, and presenting a new
    // node clears the banner — so feeding back first meant the learner was told
    // they had died without ever being shown why.
    this.#present(step.advanced);
    this.hud.feedback(feedback);
    this.#renderer.feedback(feedback);

    if (this.session.finished && !this.#done) {
      this.#done = true;
      this.#scheduler.cancel(this.#frame);
      this.#hooks.onFinish(this.session);
    }
  }

  #present(nodeChanged: boolean): void {
    const node = this.session.node;
    if (nodeChanged || node.id !== this.#nodeId) {
      this.#nodeId = node.id;
      this.#enteredAt = this.#scheduler.now();
    }

    const view: NodeView = {
      node,
      prompt: this.#i18n.text(node.prompt.text),
      checklist: this.#checklist(),
      props: this.#props(),
      narrationOnly: node.kind === 'brief' || node.kind === 'outcome',
      window: node.kind === 'expect' || node.kind === 'observe' ? (node.window ?? null) : null,
      enteredAt: this.#enteredAt,
    };

    this.hud.present(view);
    this.#renderer.present(view);
  }

  #checklist(): ChecklistItem[] {
    const node = this.session.node;

    if (node.kind === 'expect') {
      const pending = new Set(this.session.pending);
      return node.expect.map((expectation) => ({
        label: this.#i18n.text(expectation.label),
        done: !pending.has(expectation),
      }));
    }

    if (node.kind === 'observe') {
      // Progress without answers. Naming the remaining hazards would hand the
      // learner exactly the thing hazard recognition is meant to measure.
      const found = [...this.session.observed];
      const items: ChecklistItem[] = found.map((propId) => ({
        label: this.#labelFor(propId),
        done: true,
      }));
      while (items.length < node.minCorrect) items.push({ label: '—', done: false });
      return items;
    }

    return [];
  }

  #labelFor(propId: string): string {
    const prop = this.#scenario.props.find((p) => p.id === propId);
    return prop ? this.#i18n.text(prop.label) : propId;
  }

  #props(): PropView[] {
    return this.#scenario.props.map((prop) => ({
      id: prop.id,
      role: this.#roleOf.get(prop.id) ?? null,
      kind: prop.kind,
      label: this.#i18n.text(prop.label),
      verbs: VERBS_BY_KIND[prop.kind],
      visible: prop.spawned !== true,
    }));
  }
}
