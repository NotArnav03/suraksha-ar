import type { WorldEffect } from '../../engine/types.ts';
import type { Localizer } from '../ui/i18n.ts';
import { VERB_ICON, VERB_LABEL } from './verbs.ts';
import type {
  Feedback,
  NodeView,
  PropView,
  RendererHooks,
  Tier,
  WorldRenderer,
} from './contract.ts';

/**
 * Tier C — the flat world.
 *
 * This is the tier that runs on the phone a first-week recruit actually owns:
 * no ARCore, no depth, sometimes no gyroscope. It is deliberately not a
 * consolation prize. The learner still has to find the hazard among the clutter,
 * still has to choose a verb rather than tap a right answer, and still gets
 * assessed on exactly the same event stream — so a certificate earned here is
 * the same certificate.
 *
 * The verb menu is the load-bearing idea. Entering a confined space is two
 * deliberate touches on a named action, never an accidental tap on scenery, so
 * "went in without testing" is a decision the learner made and can be shown.
 */

const KIND_ICON: Record<PropView['kind'], string> = {
  structure: '🕳',
  signage: '🪧',
  instrument: '📟',
  equipment: '⚙️',
  ppe: '🥽',
  person: '🧑',
  hazard: '☣️',
};

export class TierCRenderer implements WorldRenderer {
  readonly tier: Tier = 'C';
  readonly label = 'Flat interactive — any Android 10+, no camera required';

  #i18n: Localizer;
  #host: HTMLElement | null = null;
  #grid = document.createElement('div');
  #sheet = document.createElement('div');
  #hooks: RendererHooks | null = null;
  #visible = new Set<string>();
  #alarm: 'none' | 'warning' | 'critical' = 'none';
  #gasReadout: { species: string; value: number; unit: string } | null = null;
  #readoutBox = document.createElement('div');
  #failed = new Set<string>();

  constructor(i18n: Localizer) {
    this.#i18n = i18n;
  }

  async mount(host: HTMLElement, hooks: RendererHooks): Promise<void> {
    this.#host = host;
    this.#hooks = hooks;
    this.#grid.className = 'world-grid';
    this.#readoutBox.className = 'readout';
    this.#readoutBox.hidden = true;
    this.#sheet.className = 'sheet';
    this.#sheet.hidden = true;
    this.#sheet.addEventListener('click', (event) => {
      if (event.target === this.#sheet) this.#closeSheet();
    });
    host.append(this.#readoutBox, this.#grid, this.#sheet);
  }

  present(view: NodeView): void {
    for (const prop of view.props) {
      // A spawned prop stays out of the scene until an effect brings it in;
      // everything else is present from the start, clutter included.
      if (prop.visible) this.#visible.add(prop.id);
    }

    this.#grid.replaceChildren();
    if (view.narrationOnly) {
      this.#grid.classList.add('muted');
    } else {
      this.#grid.classList.remove('muted');
    }

    for (const prop of view.props) {
      if (!this.#visible.has(prop.id)) continue;
      this.#grid.append(this.#tile(prop, view.narrationOnly));
    }
  }

  #tile(prop: PropView, disabled: boolean): HTMLElement {
    const tile = document.createElement('button');
    tile.className = 'tile';
    tile.disabled = disabled;
    if (this.#failed.has(prop.id)) tile.classList.add('failed');

    const icon = document.createElement('span');
    icon.className = 'tile-icon';
    icon.textContent = KIND_ICON[prop.kind];

    const label = document.createElement('span');
    label.className = 'tile-label';
    label.textContent = prop.label;

    tile.append(icon, label);
    tile.addEventListener('click', () => this.#openSheet(prop));
    return tile;
  }

  /** Two touches, never one: choose the thing, then choose what you do to it. */
  #openSheet(prop: PropView): void {
    this.#sheet.replaceChildren();
    const card = document.createElement('div');
    card.className = 'sheet-card';

    const title = document.createElement('h2');
    title.textContent = prop.label;
    card.append(title);

    for (const verb of prop.verbs) {
      const button = document.createElement('button');
      button.className = `verb verb-${verb}`;
      const text = this.#i18n.text(VERB_LABEL[verb]);
      button.textContent = `${VERB_ICON[verb]}  ${text}`;
      button.addEventListener('click', () => {
        this.#closeSheet();
        this.#hooks?.act({ verb, target: prop.id });
      });
      card.append(button);
    }

    const cancel = document.createElement('button');
    cancel.className = 'ghost';
    cancel.textContent = this.#i18n.ui('cancel');
    cancel.addEventListener('click', () => this.#closeSheet());
    card.append(cancel);

    this.#sheet.append(card);
    this.#sheet.hidden = false;
  }

  #closeSheet(): void {
    this.#sheet.hidden = true;
  }

  effect(effect: WorldEffect): void {
    switch (effect.type) {
      case 'spawn':
        this.#visible.add(effect.role);
        break;
      case 'despawn':
        this.#visible.delete(effect.role);
        break;
      case 'fail_equipment':
        this.#failed.add(effect.role);
        break;
      case 'set_gas':
        this.#gasReadout = {
          species: effect.species,
          value: Number(effect.value),
          unit: effect.unit,
        };
        this.#renderReadout();
        break;
      case 'alarm':
        this.#alarm = effect.level;
        this.#host?.classList.toggle('alarm-warning', effect.level === 'warning');
        this.#host?.classList.toggle('alarm-critical', effect.level === 'critical');
        this.#renderReadout();
        break;
      case 'haptic':
        this.#vibrate(effect.pattern);
        break;
      case 'ambient':
        break;
    }
  }

  /**
   * Haptics carry the alarm on a phone held in a gloved hand in a noisy yard,
   * where neither the screen nor the speaker is reliable. Absent on iOS and on
   * desktop, which is why it is never the only channel.
   */
  #vibrate(pattern: 'pulse' | 'sos' | 'continuous'): void {
    if (!('vibrate' in navigator)) return;
    const patterns: Record<typeof pattern, number[]> = {
      pulse: [120, 90, 120],
      sos: [90, 60, 90, 60, 90, 200, 240, 60, 240, 60, 240],
      continuous: [700],
    };
    navigator.vibrate(patterns[pattern]);
  }

  #renderReadout(): void {
    if (!this.#gasReadout) {
      this.#readoutBox.hidden = true;
      return;
    }
    const { species, value, unit } = this.#gasReadout;
    this.#readoutBox.hidden = false;
    this.#readoutBox.className = `readout ${this.#alarm}`;
    this.#readoutBox.textContent = `${species} ${value}${unit}`;
  }

  feedback(_feedback: Feedback): void {
    // The consequence banner belongs to the shared HUD. If this tier drew its
    // own, tiers would stop showing learners the same thing.
  }

  dispose(): void {
    this.#grid.remove();
    this.#sheet.remove();
    this.#readoutBox.remove();
  }
}
