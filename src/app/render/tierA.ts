import * as THREE from 'three';

import type { WorldEffect } from '../../engine/types.ts';
import type { Localizer } from '../ui/i18n.ts';
import { OverlayTaps } from './overlay-taps.ts';
import { buildProp, showFailed, siteSlots, type Slot } from './props3d.ts';
import { icon as iconEl } from '../ui/icons.ts';
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
 * Tier A — markerless AR on an ARCore phone.
 *
 * The point of this tier is not that it looks better. It is that the learner
 * walks to the sump, crouches to look into it, and turns their back on the
 * standby person to read the detector — the drill is performed with the body
 * instead of the thumb, which is what the retention argument actually rests on.
 *
 * What is deliberately *not* different: the HUD is the same DOM, drawn by the
 * same shared `Hud`, floating over the camera feed through WebXR's dom-overlay.
 * The prompt, the checklist, the countdown and the consequence banner are
 * literally the same code that Tiers B and C run. Only the world changed.
 */

/** Re-exported for tests/tierA-shapes.test.ts, which predates the shared module. */
export { partsFor } from './props3d.ts';

export interface TierAOptions {
  session: XRSession;
  /** the dom-overlay root — the HUD is mounted inside it by the controller */
  overlay: HTMLElement;
  onSessionEnd(): void;
}

export class TierARenderer implements WorldRenderer {
  readonly tier: Tier = 'A';
  readonly label = 'Markerless AR — WebXR hit-test, props anchored in the room';

  #i18n: Localizer;
  #options: TierAOptions;
  #hooks: RendererHooks | null = null;

  #renderer: THREE.WebGLRenderer;
  #scene = new THREE.Scene();
  #camera = new THREE.PerspectiveCamera(70, 1, 0.01, 40);
  #root = new THREE.Group();
  #reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.09, 0.12, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xf0a02e }),
  );
  #raycaster = new THREE.Raycaster();
  #xrController: THREE.XRTargetRaySpace | null = null;

  #taps: OverlayTaps | null = null;
  #hitTestSource: XRHitTestSource | null = null;
  #lastSelectAt = -Infinity;
  #placed = false;
  #slots = new Map<string, Slot>();
  #meshes = new Map<string, THREE.Group>();
  #visible = new Set<string>();
  #seeded = new Set<string>();
  #props: PropView[] = [];
  #interactive = true;

  #sheet = document.createElement('div');
  #readout = document.createElement('div');
  #hint = document.createElement('div');
  #crosshair = document.createElement('div');
  #gas: { species: string; value: number; unit: string } | null = null;
  #alarm: 'none' | 'warning' | 'critical' = 'none';

  constructor(i18n: Localizer, options: TierAOptions) {
    this.#i18n = i18n;
    this.#options = options;

    this.#renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.#renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    // `alpha: true` only gives the canvas an alpha channel — it does not make
    // the clear itself transparent. Without this, every frame clears to an
    // opaque-ish default before drawing, which lays a faint black wash over
    // the entire camera passthrough, not just where our objects are.
    this.#renderer.setClearColor(0x000000, 0);
    this.#renderer.xr.enabled = true;
    this.#renderer.xr.setReferenceSpaceType('local');

    this.#reticle.matrixAutoUpdate = false;
    this.#reticle.visible = false;
    this.#scene.add(this.#reticle);

    this.#root.visible = false;
    this.#scene.add(this.#root);

    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1, 3, 2);
    this.#scene.add(key);
  }

  async mount(host: HTMLElement, hooks: RendererHooks): Promise<void> {
    this.#hooks = hooks;
    host.append(this.#renderer.domElement);

    const overlay = this.#options.overlay;
    // Every tap anywhere on screen is "on the overlay", so both the XR select
    // and the DOM click contend for each one and neither is dependable alone on
    // real hardware. `OverlayTaps` arbitrates: it keeps both channels live,
    // works out which button the finger was over, and delivers each tap exactly
    // once. Without it a verb press buzzed and did nothing — the click never
    // came, and #onSelect below could only tell that *a* tap had happened.
    this.#taps = new OverlayTaps(overlay);

    this.#readout.className = 'readout ar';
    this.#readout.hidden = true;
    this.#hint.className = 'ar-hint';
    this.#hint.textContent = this.#i18n.ui('placeHint');
    this.#sheet.className = 'sheet';
    this.#sheet.hidden = true;
    this.#sheet.addEventListener('click', (event) => {
      if (event.target === this.#sheet) this.#closeSheet();
    });
    this.#crosshair.className = 'ar-crosshair';
    this.#crosshair.hidden = true;
    overlay.prepend(this.#readout, this.#hint, this.#crosshair, this.#sheet);

    const session = this.#options.session;
    session.addEventListener('end', () => this.#options.onSessionEnd());
    await this.#renderer.xr.setSession(session);

    const viewer = await session.requestReferenceSpace('viewer');
    this.#hitTestSource = (await session.requestHitTestSource?.({ space: viewer })) ?? null;

    this.#xrController = this.#renderer.xr.getController(0);
    this.#xrController.addEventListener('select', this.#onSelect);
    this.#scene.add(this.#xrController);

    this.#renderer.setAnimationLoop(this.#frame);
  }

  #frame = (_time: number, frame?: XRFrame): void => {
    if (frame && !this.#placed && this.#hitTestSource) {
      const space = this.#renderer.xr.getReferenceSpace();
      const hits = space ? frame.getHitTestResults(this.#hitTestSource) : [];
      const pose = hits[0]?.getPose(space!);
      if (pose) {
        this.#reticle.visible = true;
        this.#reticle.matrix.fromArray(pose.transform.matrix);
      } else {
        this.#reticle.visible = false;
      }
    }
    this.#renderer.render(this.#scene, this.#camera);
  };

  #onSelect = (): void => {
    // Some Android/Chrome builds dispatch more than one `select` for what is
    // physically a single tap. Without this guard, a tap on Cancel could fire
    // twice: the first closes the sheet, the second — with the crosshair
    // still resting on the same prop, since the phone hasn't moved — reopens
    // it via the ordinary prop-selection path below. Net visible effect: a
    // vibration, and the sheet that looks like it never closed at all.
    const now = performance.now();
    if (now - this.#lastSelectAt < 350) return;
    this.#lastSelectAt = now;

    // A short buzz on every registered select, before anything else, so a tap
    // that reaches the page is distinguishable from one that never did — the
    // two look identical to a learner when the visible result is "nothing".
    if ('vibrate' in navigator) navigator.vibrate(30);

    // The finger was on a control — a verb, Cancel, Continue, a language chip.
    // That is the learner's actual choice, and it outranks anything the tap
    // would otherwise mean for the world behind it.
    if (this.#taps?.activate()) return;

    if (!this.#placed) {
      this.#place();
      return;
    }
    if (!this.#sheet.hidden) {
      // Not a control, so the finger was outside the sheet's card — the same
      // gesture as the backdrop-tap-to-close wired on `.sheet` itself. The
      // sheet can never become a dead end a learner is stuck behind.
      this.#closeSheet();
      return;
    }

    if (!this.#interactive) {
      // Narration/outcome nodes have no props to tap, so any tap on the world
      // advances them. Android draws its own "exit fullscreen" system toast
      // over the bottom of the screen during an immersive session, and it can
      // sit right on top of the HUD's Continue button — this is the fallback
      // so a learner is never blocked behind that toast with no way forward.
      this.#hooks?.acknowledge();
      return;
    }

    // Aim from the centre of the camera view — the transient screen-tap input
    // source three.js exposes as a "controller" is unreliable for exactly this
    // (props were unhittable no matter where you tapped, on real hardware).
    // The camera-forward ray is the same mechanism the floor-placement reticle
    // already uses successfully, and it matches a "look at it, then tap" style
    // that a phone-in-hand AR interaction wants anyway — see the crosshair.
    this.#raycaster.setFromCamera(new THREE.Vector2(0, 0), this.#camera);
    const hits = this.#raycaster.intersectObjects(this.#root.children, true);
    for (const hit of hits) {
      const propId = this.#propIdOf(hit.object);
      if (!propId) continue;
      const prop = this.#props.find((p) => p.id === propId);
      if (prop) this.#openSheet(prop);
      return;
    }
  };

  #propIdOf(object: THREE.Object3D): string | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      const id = current.userData.propId as string | undefined;
      if (id) return id;
      current = current.parent;
    }
    return null;
  }

  /** The site is anchored once, on the learner's own floor, and never moves again. */
  #place(): void {
    if (!this.#reticle.visible) {
      // The tap registered (see the buzz above) but hit-test has not found a
      // plane yet — most often a shiny or low-texture floor ARCore cannot find
      // feature points on. Say so, rather than doing nothing and leaving a
      // learner unable to tell a missed tap from an undetected floor.
      this.#hint.textContent = this.#i18n.ui('noSurface');
      this.#hint.classList.add('ar-hint-warn');
      return;
    }
    this.#root.position.setFromMatrixPosition(this.#reticle.matrix);
    this.#root.visible = true;
    this.#placed = true;
    this.#reticle.visible = false;
    this.#hint.hidden = true;
    this.#layout();
  }

  present(view: NodeView): void {
    this.#props = view.props;
    this.#interactive = !view.narrationOnly;
    for (const prop of view.props) {
      // Starting visibility is applied once; after that only effects change it,
      // or a `despawn` would be undone on the very next step.
      if (this.#seeded.has(prop.id)) continue;
      this.#seeded.add(prop.id);
      if (prop.visible) this.#visible.add(prop.id);
    }
    if (this.#placed) {
      this.#layout();
      this.#hint.hidden = !view.narrationOnly;
      if (view.narrationOnly) {
        this.#hint.textContent = this.#i18n.ui('tapToContinue');
      }
      // Selection raycasts from screen centre, so the learner needs a fixed
      // aim point on screen — without it, "tap the thing" has no visible target.
      this.#crosshair.hidden = view.narrationOnly;
    }
  }

  /** See `siteSlots`: the same arc, in metres, on the learner's own floor. */
  #layout(): void {
    if (this.#slots.size === 0) this.#slots = siteSlots(this.#props);

    for (const prop of this.#props) {
      const shouldShow = this.#visible.has(prop.id);
      const existing = this.#meshes.get(prop.id);
      if (!shouldShow) {
        if (existing) existing.visible = false;
        continue;
      }
      if (existing) {
        existing.visible = true;
        continue;
      }
      const group = buildProp(prop, this.#slots.get(prop.id));
      this.#root.add(group);
      this.#meshes.set(prop.id, group);
    }
  }

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
      const icon = document.createElement('span');
      icon.className = 'verb-icon';
      icon.replaceChildren(iconEl(VERB_ICON[verb]).firstChild!);
      const text = document.createElement('span');
      text.textContent = this.#i18n.text(VERB_LABEL[verb]);
      button.append(icon, text);
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

  /**
   * `WorldEffect.role` is a *role* name ("fire"), but `#visible` and `#meshes`
   * are keyed by *prop id* ("fire_panel") — `#build`/`#layout` both work in
   * prop ids throughout. Where a scenario's bindings happen to map a role to
   * an identically-named prop id (gas-confined-space's `"casualty":
   * "casualty"`), using the raw role as if it were the id silently works by
   * coincidence; fire-explosion's `"fire": "fire_panel"` and `"casualty":
   * "colleague_down"` don't share that coincidence, and neither effect ever
   * found its mesh — spawned props stayed invisible forever, on real
   * hardware, which is exactly the "the fire is literally not there" this
   * fixes. PropView already carries each prop's own role (`#roleOf` in
   * controller.ts), so resolving is just a lookup, not new bookkeeping.
   */
  #idForRole(role: string): string {
    return this.#props.find((p) => p.role === role)?.id ?? role;
  }

  effect(effect: WorldEffect): void {
    switch (effect.type) {
      case 'spawn':
        this.#visible.add(this.#idForRole(effect.role));
        if (this.#placed) this.#layout();
        break;
      case 'despawn':
        this.#visible.delete(this.#idForRole(effect.role));
        if (this.#placed) this.#layout();
        break;
      case 'fail_equipment':
        showFailed(this.#meshes.get(this.#idForRole(effect.role)));
        break;
      case 'set_gas':
        this.#gas = { species: effect.species, value: Number(effect.value), unit: effect.unit };
        this.#renderReadout();
        break;
      case 'alarm':
        this.#alarm = effect.level;
        this.#options.overlay.classList.toggle('alarm-warning', effect.level === 'warning');
        this.#options.overlay.classList.toggle('alarm-critical', effect.level === 'critical');
        this.#renderReadout();
        break;
      case 'haptic':
        if ('vibrate' in navigator) {
          const patterns = {
            pulse: [120, 90, 120],
            sos: [90, 60, 90, 60, 90, 200, 240, 60, 240, 60, 240],
            continuous: [700],
          } as const;
          navigator.vibrate(patterns[effect.pattern] as unknown as number[]);
        }
        break;
      case 'ambient':
        break;
    }
  }

  #renderReadout(): void {
    if (!this.#gas) {
      this.#readout.hidden = true;
      return;
    }
    this.#readout.hidden = false;
    this.#readout.className = `readout ar ${this.#alarm}`;
    this.#readout.textContent = `${this.#gas.species} ${this.#gas.value}${this.#gas.unit}`;
  }

  feedback(_feedback: Feedback): void {
    // Shared HUD. See the note in TierCRenderer: if a tier drew its own
    // consequence banner, tiers would stop showing learners the same thing.
  }

  dispose(): void {
    this.#taps?.dispose();
    this.#renderer.setAnimationLoop(null);
    this.#xrController?.removeEventListener('select', this.#onSelect);
    this.#hitTestSource?.cancel();
    this.#sheet.remove();
    this.#readout.remove();
    this.#hint.remove();
    this.#crosshair.remove();
    this.#options.overlay.classList.remove('alarm-warning', 'alarm-critical');
    void this.#options.session.end().catch(() => undefined);
    this.#renderer.dispose();
    this.#renderer.domElement.remove();
  }
}
