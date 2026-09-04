import type { Feedback, NodeView, Tier } from '../render/contract.ts';
import type { Localizer } from './i18n.ts';
import { LANGUAGES, type LangCode } from './i18n.ts';
import { applyTheme, loadTheme, nextTheme, THEME_ICON, type ThemeChoice } from './theme.ts';

/**
 * The shared instrument panel.
 *
 * Prompt, checklist, countdown and consequence are identical in every tier by
 * construction — this class is the only thing that draws them. A tier that drew
 * its own countdown could quietly give its learners a different amount of time,
 * and two credentials that cost different amounts of time are not the same
 * credential.
 */

export interface HudHooks {
  onAcknowledge(): void;
  onLanguage(code: LangCode): void;
  onSpeechToggle(enabled: boolean): void;
  onWait(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class Hud {
  readonly root = el('div', 'hud');

  #i18n: Localizer;
  #hooks: HudHooks;

  #tierBadge = el('span', 'badge');
  #prompt = el('p', 'prompt');
  #listen = el('button', 'ghost');
  #checklist = el('ul', 'checklist');
  #timer = el('div', 'timer');
  #timerFill = el('div', 'timer-fill');
  #timerLabel = el('span', 'timer-label');
  #banner = el('div', 'banner');
  #pulse = el('div', 'input-pulse');
  #waitButton = el('button', 'wait-button');
  #continue = el('button', 'primary continue');

  #view: NodeView | null = null;
  #bannerTimeout: number | null = null;

  constructor(i18n: Localizer, hooks: HudHooks, tier: Tier, tierLabel: string) {
    this.#i18n = i18n;
    this.#hooks = hooks;

    const bar = el('div', 'hud-bar');
    this.#tierBadge.textContent = `TIER ${tier}`;
    this.#tierBadge.title = tierLabel;
    bar.append(this.#tierBadge, this.#languagePicker(), this.#themeToggle(), this.#speechToggle());

    this.#listen.className = 'listen';
    this.#listen.textContent = `🔊 ${this.#i18n.ui('listen')}`;
    this.#listen.addEventListener('click', () => this.speakPrompt());

    this.#timer.append(this.#timerFill, this.#timerLabel);
    this.#timer.hidden = true;

    this.#banner.hidden = true;

    this.#waitButton.textContent = `⏱ ${this.#i18n.ui('wait')}`;
    this.#waitButton.addEventListener('click', () => this.#hooks.onWait());

    this.#continue.textContent = this.#i18n.ui('next');
    this.#continue.addEventListener('click', () => this.#hooks.onAcknowledge());
    this.#continue.hidden = true;

    const panel = el('div', 'hud-panel');
    const head = el('div', 'prompt-row');
    head.append(this.#prompt, this.#listen);
    panel.append(this.#pulse, head, this.#timer, this.#checklist, this.#banner, this.#continue);

    this.root.append(bar, panel, this.#waitButton);
  }

  #languagePicker(): HTMLElement {
    const wrap = el('div', 'lang');
    for (const language of LANGUAGES) {
      const button = el('button', 'lang-button', language.name);
      button.dataset.code = language.code;
      button.addEventListener('click', () => {
        this.#hooks.onLanguage(language.code);
        this.#syncLanguage();
      });
      wrap.append(button);
    }
    queueMicrotask(() => this.#syncLanguage());
    return wrap;
  }

  #syncLanguage(): void {
    // `[data-code]` matters: the theme and speech controls share the pill
    // styling but carry no language, so an unscoped query switched them both
    // off every time the learner changed language — the speaker icon went dark
    // while speech was still on.
    for (const button of this.root.querySelectorAll<HTMLElement>('.lang-button[data-code]')) {
      button.classList.toggle('on', button.dataset.code === this.#i18n.language.code);
    }
    this.#listen.textContent = `🔊 ${this.#i18n.ui('listen')}`;
    this.#waitButton.textContent = `⏱ ${this.#i18n.ui('wait')}`;
    this.#continue.textContent = this.#i18n.ui('next');
    if (this.#view) this.present(this.#view);
  }

  /** Light, dark, or whatever the phone says — see theme.ts for why all three. */
  #themeToggle(): HTMLElement {
    let choice: ThemeChoice = loadTheme();
    const button = el('button', 'lang-button theme-toggle', THEME_ICON[choice]);
    button.title = this.#i18n.ui('theme');
    button.addEventListener('click', () => {
      choice = nextTheme(choice);
      applyTheme(choice);
      button.textContent = THEME_ICON[choice];
    });
    return button;
  }

  #speechToggle(): HTMLElement {
    const button = el('button', 'lang-button speech-toggle on', '🔊');
    button.addEventListener('click', () => {
      const enabled = !this.#i18n.speechEnabled;
      this.#hooks.onSpeechToggle(enabled);
      button.classList.toggle('on', enabled);
      button.textContent = enabled ? '🔊' : '🔇';
    });
    return button;
  }

  present(view: NodeView): void {
    const changed = this.#view?.node.id !== view.node.id;
    this.#view = view;

    this.#prompt.textContent = view.prompt;
    this.#continue.hidden = !view.narrationOnly;
    this.#waitButton.hidden = view.narrationOnly || !this.#expectsWait(view);

    this.#checklist.replaceChildren();
    if (view.checklist.length > 1) {
      const heading = el('li', 'checklist-heading', this.#i18n.ui('todo'));
      this.#checklist.append(heading);
      for (const item of view.checklist) {
        const row = el('li', item.done ? 'done' : '');
        row.append(el('span', 'tick', item.done ? '✓' : '○'), el('span', '', item.label));
        this.#checklist.append(row);
      }
    }

    this.#timer.hidden = view.window === null;
    if (changed) {
      this.hideBanner();
      this.speakPrompt();
    }
  }

  /** `wait` is a real authored step in some nodes; only offer it where it counts. */
  #expectsWait(view: NodeView): boolean {
    return view.node.kind === 'expect' && view.node.expect.some((e) => e.match.verb === 'wait');
  }

  speakPrompt(): void {
    if (this.#view) this.#i18n.speak(this.#view.prompt);
  }

  /** Called every frame while a node with a deadline is open. */
  tick(now: number): void {
    const view = this.#view;
    if (!view?.window) return;
    const elapsed = now - view.enteredAt;
    const remaining = Math.max(0, view.window.deadlineMs - elapsed);
    const fraction = remaining / view.window.deadlineMs;

    this.#timerFill.style.width = `${fraction * 100}%`;
    this.#timer.classList.toggle('urgent', fraction < 0.34);
    this.#timerLabel.textContent = `${this.#i18n.ui('timeLeft')} ${Math.ceil(remaining / 1000)}s`;
  }

  /**
   * Say that an action was received. Deliberately says nothing about whether it
   * was the right one.
   *
   * A learner who taps a verb that does not apply here used to get literally
   * nothing back — no banner, no movement — which is indistinguishable from a
   * broken app, and was reported as exactly that. The cure cannot be to tell
   * them they were wrong: choosing the right action is the thing being measured,
   * and a "not that" hint hands over the answer. So this fires identically for
   * every verdict, including the correct ones. It is a receipt, not a verdict.
   */
  registerInput(): void {
    // Restart the animation even when one is already running, so two taps in
    // quick succession read as two receipts rather than one.
    this.#pulse.classList.remove('on');
    void this.#pulse.offsetWidth;
    this.#pulse.classList.add('on');
  }

  feedback(feedback: Feedback): void {
    if (!feedback.consequence) return;
    this.#banner.textContent = feedback.consequence;
    this.#banner.className = `banner ${feedback.severity ?? 'minor'}`;
    this.#banner.hidden = false;
    this.#i18n.speak(feedback.consequence);

    if (this.#bannerTimeout !== null) clearTimeout(this.#bannerTimeout);
    // A fatal consequence is the lesson, so it stays until the outcome screen
    // replaces it. Everything else clears itself so the prompt is readable again.
    if (feedback.severity !== 'fatal') {
      this.#bannerTimeout = window.setTimeout(() => this.hideBanner(), 7000);
    }
  }

  hideBanner(): void {
    this.#banner.hidden = true;
  }
}
