import * as THREE from 'three';

import type { Prop, WorldEffect } from '../../engine/types.ts';
import type { Localizer } from '../ui/i18n.ts';
import { OverlayTaps } from './overlay-taps.ts';
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
 * literally the same code that Tier C runs. Only the world changed.
 */

const KIND_COLOR: Record<Prop['kind'], number> = {
  structure: 0x2b3238,
  signage: 0xf0a02e,
  instrument: 0x35b39c,
  equipment: 0x6f7d86,
  ppe: 0x4a90d9,
  person: 0xe0c07a,
  hazard: 0xe4695c,
};

/** Where a thing sits relative to the anchor, in metres. Scenery, not scenography. */
interface Slot {
  angle: number;
  radius: number;
  height: number;
}

function labelTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = 512 * scale;
  canvas.height = 128 * scale;
  const context = canvas.getContext('2d')!;
  context.scale(scale, scale);

  context.fillStyle = 'rgba(11, 15, 18, 0.88)';
  context.beginPath();
  context.roundRect(0, 0, 512, 128, 18);
  context.fill();
  context.strokeStyle = 'rgba(240, 160, 46, 0.85)';
  context.lineWidth = 3;
  context.stroke();

  context.fillStyle = '#eef3f5';
  context.font = '600 40px system-ui, "Noto Sans Devanagari", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  // Wrap rather than clip: Devanagari prop names are long, and a label a learner
  // cannot read is a hazard they cannot identify.
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > 460 && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  const start = 64 - ((lines.length - 1) * 44) / 2;
  lines.slice(0, 2).forEach((entry, index) => {
    context.fillText(entry, 256, start + index * 44, 470);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function geometryFor(kind: Prop['kind']): THREE.BufferGeometry {
  switch (kind) {
    case 'structure':
      return new THREE.CylinderGeometry(0.42, 0.42, 0.12, 24);
    case 'person':
      return new THREE.CapsuleGeometry(0.11, 0.42, 6, 12);
    case 'signage':
      return new THREE.BoxGeometry(0.3, 0.22, 0.02);
    case 'instrument':
      return new THREE.BoxGeometry(0.1, 0.16, 0.05);
    case 'ppe':
      return new THREE.SphereGeometry(0.11, 20, 14);
    default:
      return new THREE.BoxGeometry(0.2, 0.18, 0.16);
  }
}

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

  /**
   * Props sit on an arc in front of the anchor, with the sump on the floor at
   * its centre. Fixed slots rather than a random scatter: two learners in
   * different rooms must walk the same distances, or the time-to-first-action
   * numbers stop being comparable between them.
   */
  #layout(): void {
    if (this.#slots.size === 0) {
      const arranged = this.#props.filter((p) => p.id !== 'sump_opening');
      this.#slots.set('sump_opening', { angle: 0, radius: 0, height: 0.02 });
      arranged.forEach((prop, index) => {
        const spread = Math.PI * 1.15;
        const angle = -spread / 2 + (spread * index) / Math.max(arranged.length - 1, 1);
        const radius = 1.35 + (index % 2) * 0.45;
        const height = prop.kind === 'ppe' ? 0.7 : prop.kind === 'person' ? 1.0 : 0.85;
        this.#slots.set(prop.id, { angle, radius, height });
      });
    }

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
      this.#meshes.set(prop.id, this.#build(prop));
    }
  }

  #build(prop: PropView): THREE.Group {
    const slot = this.#slots.get(prop.id) ?? { angle: 0, radius: 1.5, height: 0.9 };
    const group = new THREE.Group();
    group.userData.propId = prop.id;
    group.position.set(
      Math.sin(slot.angle) * slot.radius,
      slot.height,
      -Math.cos(slot.angle) * slot.radius,
    );

    const mesh = new THREE.Mesh(
      geometryFor(prop.kind),
      new THREE.MeshStandardMaterial({
        color: KIND_COLOR[prop.kind],
        roughness: 0.65,
        metalness: 0.1,
      }),
    );
    mesh.userData.propId = prop.id;
    group.add(mesh);

    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: labelTexture(prop.label), depthTest: false }),
    );
    label.scale.set(0.44, 0.11, 1);
    label.position.y = 0.26;
    label.userData.propId = prop.id;
    group.add(label);

    // A ground ring gives the thing a footprint, which is what makes it read as
    // standing in the room rather than floating in front of the camera.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.17, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xf0a02e, transparent: true, opacity: 0.5 }),
    );
    ring.position.y = -slot.height + 0.01;
    group.add(ring);

    this.#root.add(group);
    return group;
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
      button.textContent = `${VERB_ICON[verb]}  ${this.#i18n.text(VERB_LABEL[verb])}`;
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
        if (this.#placed) this.#layout();
        break;
      case 'despawn':
        this.#visible.delete(effect.role);
        if (this.#placed) this.#layout();
        break;
      case 'fail_equipment': {
        const group = this.#meshes.get(effect.role);
        const mesh = group?.children[0];
        if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.MeshStandardMaterial) {
          mesh.material.color.set(0x3a4147);
          mesh.rotation.z = 0.35;
        }
        break;
      }
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
    // Shared HUD. See the note in TierCRenderer — if a tier drew its own
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
