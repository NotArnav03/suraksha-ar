/**
 * Tap arbitration for a WebXR dom-overlay.
 *
 * Inside an immersive session one physical tap on a DOM control can arrive on
 * two different channels, and on real Android hardware neither is dependable on
 * its own:
 *
 *   - the ordinary DOM `click`, which is what a button's own listener wants,
 *     and which some builds simply never deliver inside the overlay;
 *   - the XR `select`, which is delivered reliably — it is what places the
 *     floor anchor and picks props — but carries no notion of which button the
 *     finger was over.
 *
 * Suppressing `select` for our controls (via `beforexrselect`) and trusting the
 * click is what left the verb sheet dead: the click never came, the select was
 * either cancelled or fell through to "a tap happened somewhere", and the verb
 * the learner deliberately chose was discarded. Suppressing neither and acting
 * on both would fire every verb twice, which in this drill is the difference
 * between climbing in once and climbing in again.
 *
 * So both channels stay live and this class decides. `beforexrselect` and
 * `pointerdown` both name the element under the finger, so a `select` can be
 * turned back into "the learner pressed *this* button"; whichever channel gets
 * there first wins the tap, and the other is swallowed. The button's own click
 * listener stays the single place the action lives — every tier's controls are
 * ordinary DOM buttons, and this only changes what counts as pressing one.
 */

export interface OverlayTapsOptions {
  now?: () => number;
  /** how long one physical tap may take to arrive on both channels */
  windowMs?: number;
}

interface Tap {
  el: HTMLElement | null;
  at: number;
}

/** Controls are ordinary buttons; anything else is a tap on the world. */
function controlAt(target: EventTarget | null): HTMLElement | null {
  const node = target as HTMLElement | null;
  return node?.closest?.('button') ?? null;
}

export class OverlayTaps {
  #root: HTMLElement;
  #now: () => number;
  #windowMs: number;

  /** what the finger was over, from whichever channel named it first */
  #aimed: Tap | null = null;
  /** what has already been delivered, so the slower channel can be swallowed */
  #delivered: Tap | null = null;
  /** true only while re-dispatching, so our own click is not mistaken for a duplicate */
  #dispatching = false;

  constructor(root: HTMLElement, options: OverlayTapsOptions = {}) {
    this.#root = root;
    this.#now = options.now ?? (() => performance.now());
    this.#windowMs = options.windowMs ?? 500;

    root.addEventListener('beforexrselect', this.#onAim);
    root.addEventListener('pointerdown', this.#onAim, true);
    root.addEventListener('click', this.#onClick, true);
  }

  #onAim = (event: Event): void => {
    this.#aimed = { el: controlAt(event.target), at: this.#now() };
  };

  #onClick = (event: Event): void => {
    if (this.#dispatching) return; // our own re-dispatch, on its way to the button
    const el = controlAt(event.target);
    if (!el) return;
    if (this.#isFresh(this.#delivered, el)) {
      // `select` already delivered this tap. Let the button act once.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.#delivered = { el, at: this.#now() };
  };

  #isFresh(tap: Tap | null, el: HTMLElement | null = null): boolean {
    if (!tap) return false;
    if (el !== null && tap.el !== el) return false;
    return this.#now() - tap.at < this.#windowMs;
  }

  /**
   * Deliver the tap an XR `select` just reported, if it landed on a control.
   *
   * Returns true when the tap belonged to a button — whether this call
   * delivered it or an already-arrived DOM click did — so the caller knows to
   * leave the world alone. False means the finger was on the world, and the
   * caller should do whatever a tap on the world means for the current node.
   */
  activate(): boolean {
    const aimed = this.#aimed;
    this.#aimed = null;
    if (!this.#isFresh(aimed) || !aimed?.el) return false;

    const el = aimed.el;
    if (this.#isFresh(this.#delivered, el)) return true; // the click beat us to it

    this.#delivered = { el, at: this.#now() };
    this.#dispatching = true;
    try {
      el.click();
    } finally {
      this.#dispatching = false;
    }
    return true;
  }

  dispose(): void {
    this.#root.removeEventListener('beforexrselect', this.#onAim);
    this.#root.removeEventListener('pointerdown', this.#onAim, true);
    this.#root.removeEventListener('click', this.#onClick, true);
  }
}
