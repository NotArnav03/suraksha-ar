import * as THREE from 'three';

import type { WorldEffect } from '../../engine/types.ts';
import type { Localizer } from '../ui/i18n.ts';
import { icon as iconEl } from '../ui/icons.ts';
import { CardTracker } from './card-tracker.ts';
import { buildProp, showFailed, siteSlots, type Slot } from './props3d.ts';
import { VERB_ICON, VERB_LABEL } from './verbs.ts';
import type { Feedback, NodeView, PropView, RendererHooks, Tier, WorldRenderer } from './contract.ts';

/**
 * Tier B: Card AR. The work site stands on a printed card the camera tracks.
 *
 * Tier A needs an ARCore-certified phone, and many phones a worker owns are
 * not. They have a camera and WebGL, which is all this needs: the card gives
 * the tracker four hard corners to find, so it can place the site without any
 * understanding of the room. The price is scale. The site exists only while
 * the card is in view, so this is a tabletop drill, looked into and leant
 * over, rather than one the learner walks through.
 *
 * What does not change is everything above the renderer. The same props in
 * the same arrangement (from props3d.ts), the same verb sheet, the same HUD,
 * and the same `Action`s into the same engine, so a certificate earned on the
 * card means what one earned on the floor means.
 */

/**
 * Card widths per metre of site. At 0.36 the arc of props stands just around
 * the card's edges (1.35 to 1.8 m out becomes half to two thirds of a card
 * width), and a standing person is about 9 cm tall on a 15 cm card: the whole
 * site fits in view from a comfortable distance above the table.
 */
const SITE_SCALE = 0.36;
/** Labels grow by this much against the shrunken site, or a prop's name would be a few pixels high. */
const LABEL_BOOST = 2.3;
/** The long side of the frame handed to the tracker. Bigger finds a smaller card; smaller keeps a cheap phone at frame rate. */
const TRACK_LONG_SIDE = 480;
/** How long the site stays up after the card was last seen, so a blink of glare does not make it flicker. */
const LOST_AFTER_MS = 350;
/** How far from a prop, on screen, a tap still counts as a tap on it. Fingers are wider than a three-centimetre isolator. */
const TAP_SLOP_PX = 56;

export interface TierBOptions {
  /** the rear camera, already granted; this renderer owns it from here and stops it on dispose */
  stream: MediaStream;
  /** the HUD's container: the verb sheet, the gas readout and the find-the-card hint go in here */
  overlay: HTMLElement;
  /** the learner has no card; the caller starts the same drill flat */
  onNoCard(): void;
}

export class TierBRenderer implements WorldRenderer {
  readonly tier: Tier = 'B';
  readonly label = 'Card AR: the site stands on a printed card the camera tracks';

  #i18n: Localizer;
  #options: TierBOptions;
  #hooks: RendererHooks | null = null;

  #stage = document.createElement('div');
  #video = document.createElement('video');
  #frameCanvas = document.createElement('canvas');
  #frameContext: CanvasRenderingContext2D | null = null;
  #tracker: CardTracker | null = null;
  #rebuilding = false;

  #renderer: THREE.WebGLRenderer;
  #scene = new THREE.Scene();
  #camera = new THREE.PerspectiveCamera();
  /** follows the card: its matrix is the smoothed marker-to-camera pose */
  #anchor = new THREE.Group();
  /** the site itself, stood up on the card and shrunk to tabletop size */
  #site = new THREE.Group();
  #raycaster = new THREE.Raycaster();

  #pose = { position: new THREE.Vector3(), rotation: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1) };
  #lastSeen = -Infinity;
  #raf = 0;

  #slots = new Map<string, Slot>();
  #meshes = new Map<string, THREE.Group>();
  #visible = new Set<string>();
  #seeded = new Set<string>();
  #props: PropView[] = [];
  #interactive = true;

  #sheet = document.createElement('div');
  #readout = document.createElement('div');
  #hint = document.createElement('div');
  #guide = document.createElement('div');
  #gas: { species: string; value: number; unit: string } | null = null;
  #alarm: 'none' | 'warning' | 'critical' = 'none';

  constructor(i18n: Localizer, options: TierBOptions) {
    this.#i18n = i18n;
    this.#options = options;

    this.#renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.#renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.#renderer.setClearColor(0x000000, 0);

    // The camera never moves; the card does. ARToolKit reports the card in
    // camera space, so the camera stays at the origin and the anchor carries
    // the pose.
    this.#camera.matrixAutoUpdate = false;
    this.#anchor.matrixAutoUpdate = false;
    this.#anchor.visible = false;

    // ARToolKit's card is the XY plane facing the camera along +Z; the site
    // is built Y-up. A quarter turn about X stands it on the card, with the
    // far side of the site (-Z) toward the top edge of the printed card.
    this.#site.rotation.x = Math.PI / 2;
    this.#site.scale.setScalar(SITE_SCALE);
    this.#anchor.add(this.#site);
    this.#scene.add(this.#anchor);

    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1, 3, 2);
    this.#scene.add(key);
  }

  async mount(host: HTMLElement, hooks: RendererHooks): Promise<void> {
    this.#hooks = hooks;

    this.#video.playsInline = true;
    this.#video.muted = true;
    this.#video.autoplay = true;
    this.#video.srcObject = this.#options.stream;
    this.#stage.className = 'card-stage';
    this.#stage.append(this.#video, this.#renderer.domElement);
    this.#stage.addEventListener('click', this.#onTap);
    host.append(this.#stage);

    this.#readout.className = 'readout ar';
    this.#readout.hidden = true;
    this.#sheet.className = 'sheet';
    this.#sheet.hidden = true;
    this.#sheet.addEventListener('click', (event) => {
      if (event.target === this.#sheet) this.#closeSheet();
    });

    // Until the card is found there is nothing to touch, so the screen says
    // what to do, draws where to aim, and offers the way out for a learner
    // who has no card: the same drill, flat. Never a dead end.
    this.#hint.className = 'ar-hint card-hint';
    const hintText = document.createElement('p');
    hintText.textContent = this.#i18n.ui('cardFind');
    const noCard = document.createElement('button');
    noCard.className = 'ghost';
    noCard.textContent = this.#i18n.ui('cardNoCard');
    noCard.addEventListener('click', () => this.#options.onNoCard());
    this.#hint.append(hintText, noCard);
    this.#guide.className = 'card-guide';
    this.#options.overlay.prepend(this.#readout, this.#guide, this.#hint, this.#sheet);

    await this.#video.play().catch(() => undefined);
    if (!this.#video.videoWidth) {
      await new Promise((resolve) => this.#video.addEventListener('loadedmetadata', resolve, { once: true }));
    }
    await this.#rebuildTracker();

    // Turning the phone swaps the stream's width and height, and the tracker
    // is sized to the frame, so it is rebuilt for the new shape.
    this.#video.addEventListener('resize', () => void this.#rebuildTracker());
    addEventListener('resize', this.#fit);
    this.#fit();
    this.#raf = requestAnimationFrame(this.#frame);
  }

  async #rebuildTracker(): Promise<void> {
    if (this.#rebuilding) return;
    this.#rebuilding = true;
    try {
      const { videoWidth: vw, videoHeight: vh } = this.#video;
      if (!vw || !vh) return;
      const k = TRACK_LONG_SIDE / Math.max(vw, vh);
      const width = Math.round((vw * k) / 4) * 4;
      const height = Math.round((vh * k) / 4) * 4;
      if (this.#tracker?.width === width && this.#tracker?.height === height) return;

      this.#tracker?.dispose();
      this.#tracker = null;
      this.#frameCanvas.width = width;
      this.#frameCanvas.height = height;
      this.#frameContext = this.#frameCanvas.getContext('2d', { willReadFrequently: true });
      const tracker = await CardTracker.create(width, height);
      // The tracker's projection and its poses come from one calibration,
      // rescaled to this frame, so what is drawn lands on the card in the
      // picture even though the calibration is not this phone's camera.
      this.#camera.projectionMatrix.fromArray(tracker.projection);
      this.#camera.projectionMatrixInverse.copy(this.#camera.projectionMatrix).invert();
      this.#tracker = tracker;
      this.#fit();
    } finally {
      this.#rebuilding = false;
    }
  }

  /**
   * The video fills the screen the way a camera app does, cropping whichever
   * sides overflow. The 3D canvas is laid over exactly the same box, so the
   * crop is applied to both at once and the site cannot drift off the card.
   */
  #fit = (): void => {
    const { videoWidth: vw, videoHeight: vh } = this.#video;
    if (!vw || !vh) return;
    const aspect = vw / vh;
    let width = innerWidth;
    let height = width / aspect;
    if (height < innerHeight) {
      height = innerHeight;
      width = height * aspect;
    }
    Object.assign(this.#stage.style, {
      width: `${width}px`,
      height: `${height}px`,
      left: `${(innerWidth - width) / 2}px`,
      top: `${(innerHeight - height) / 2}px`,
    });
    this.#renderer.setSize(width, height, false);
  };

  #frame = (now: number): void => {
    this.#raf = requestAnimationFrame(this.#frame);
    const tracker = this.#tracker;
    const context = this.#frameContext;
    if (tracker && context && this.#video.readyState >= 2) {
      context.drawImage(this.#video, 0, 0, tracker.width, tracker.height);
      const sighting = tracker.detect(context.getImageData(0, 0, tracker.width, tracker.height).data);
      if (sighting) this.#follow(sighting.modelView, now);
      // Counters on the element, readable from a remote debugger (tools/phone.mjs
      // eval), because "the card is not being found" and "the card is found but
      // the site is drawn somewhere else" look identical on the screen.
      const stats = this.#stage.dataset;
      stats.frames = String(Number(stats.frames ?? 0) + 1);
      if (sighting) {
        stats.sightings = String(Number(stats.sightings ?? 0) + 1);
        stats.confidence = sighting.confidence.toFixed(2);
      }
    }

    const tracking = now - this.#lastSeen < LOST_AFTER_MS;
    this.#anchor.visible = tracking;
    this.#hint.hidden = tracking;
    this.#guide.hidden = tracking;
    if (!tracking) this.#closeSheet();
    this.#renderer.render(this.#scene, this.#camera);
  };

  /**
   * Ease toward each new pose rather than jump to it. ARToolKit's pose
   * shivers by a few millimetres frame to frame, which on a 20 cm site reads
   * as the whole thing vibrating. Coming back after losing the card, it snaps.
   */
  #follow(modelView: Float64Array, now: number): void {
    const target = new THREE.Matrix4().fromArray(modelView);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    target.decompose(position, rotation, scale);

    const snap = now - this.#lastSeen > LOST_AFTER_MS;
    const ease = snap ? 1 : 0.45;
    this.#pose.position.lerp(position, ease);
    this.#pose.rotation.slerp(rotation, ease);
    this.#anchor.matrix.compose(this.#pose.position, this.#pose.rotation, this.#pose.scale);
    this.#anchor.matrixWorldNeedsUpdate = true;
    this.#lastSeen = now;
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
    this.#layout();
  }

  #layout(): void {
    if (this.#slots.size === 0) this.#slots = siteSlots(this.#props);
    for (const prop of this.#props) {
      const shouldShow = this.#visible.has(prop.id);
      const existing = this.#meshes.get(prop.id);
      if (existing) {
        existing.visible = shouldShow;
        continue;
      }
      if (!shouldShow) continue;
      const group = buildProp(prop, this.#slots.get(prop.id));
      for (const child of group.children) {
        if (child instanceof THREE.Sprite) {
          child.scale.multiplyScalar(LABEL_BOOST);
          child.position.y *= 1.6;
        }
      }
      this.#site.add(group);
      this.#meshes.set(prop.id, group);
    }
  }

  /**
   * A tap is aimed where the finger is, not from the centre of the screen as
   * in Tier A: here the phone is held still over a table and the learner
   * points at the thing they mean. A miss by less than a fingertip still
   * finds the nearest prop, since the smallest ones are a couple of
   * centimetres across on the card.
   */
  #onTap = (event: MouseEvent): void => {
    if (!this.#interactive || !this.#anchor.visible || !this.#sheet.hidden) return;
    const rect = this.#renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    this.#scene.updateMatrixWorld();
    this.#raycaster.setFromCamera(ndc, this.#camera);
    for (const hit of this.#raycaster.intersectObjects(this.#site.children, true)) {
      const prop = this.#propOf(hit.object);
      if (prop) return this.#openSheet(prop);
    }

    let nearest: { prop: PropView; distance: number } | null = null;
    const point = new THREE.Vector3();
    for (const prop of this.#props) {
      const group = this.#meshes.get(prop.id);
      if (!group?.visible) continue;
      group.getWorldPosition(point).project(this.#camera);
      const dx = ((point.x - ndc.x) / 2) * rect.width;
      const dy = ((point.y - ndc.y) / 2) * rect.height;
      const distance = Math.hypot(dx, dy);
      if (distance < TAP_SLOP_PX && (!nearest || distance < nearest.distance)) nearest = { prop, distance };
    }
    if (nearest) this.#openSheet(nearest.prop);
  };

  #propOf(object: THREE.Object3D): PropView | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      const id = current.userData.propId as string | undefined;
      if (id) return this.#props.find((p) => p.id === id) ?? null;
      current = current.parent;
    }
    return null;
  }

  #openSheet(prop: PropView): void {
    if ('vibrate' in navigator) navigator.vibrate(30);
    this.#sheet.replaceChildren();
    const card = document.createElement('div');
    card.className = 'sheet-card';

    const title = document.createElement('h2');
    title.textContent = prop.label;
    card.append(title);

    for (const verb of prop.verbs) {
      const button = document.createElement('button');
      button.className = `verb verb-${verb}`;
      const text = document.createElement('span');
      text.textContent = this.#i18n.text(VERB_LABEL[verb]);
      button.append(iconEl(VERB_ICON[verb], 'verb-icon'), text);
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

  /** `WorldEffect.role` names a role; the meshes are keyed by prop id. See the same lookup in Tier A. */
  #idForRole(role: string): string {
    return this.#props.find((p) => p.role === role)?.id ?? role;
  }

  effect(effect: WorldEffect): void {
    switch (effect.type) {
      case 'spawn':
        this.#visible.add(this.#idForRole(effect.role));
        this.#layout();
        break;
      case 'despawn':
        this.#visible.delete(this.#idForRole(effect.role));
        this.#layout();
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
    // Shared HUD, as in every tier: see the note in TierCRenderer.
  }

  dispose(): void {
    cancelAnimationFrame(this.#raf);
    removeEventListener('resize', this.#fit);
    for (const track of this.#options.stream.getTracks()) track.stop();
    this.#video.srcObject = null;
    this.#tracker?.dispose();
    this.#tracker = null;
    this.#sheet.remove();
    this.#readout.remove();
    this.#hint.remove();
    this.#guide.remove();
    this.#options.overlay.classList.remove('alarm-warning', 'alarm-critical');
    this.#renderer.dispose();
    this.#stage.remove();
  }
}
