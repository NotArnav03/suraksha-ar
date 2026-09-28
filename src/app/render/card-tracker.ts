import ARToolkitModule from '@ar-js-org/artoolkit5-js';

import { CAMERA_PARA_BASE64, CARD_PATTERN, PATT_RATIO } from './card-marker.ts';

/**
 * Finds the printed card in a camera frame. No DOM, no camera, no three.js:
 * it takes RGBA pixels and returns a pose, which is what lets
 * tests/card.test.ts run the tracker the phone runs, under plain Node.
 *
 * ARToolKit (the tracker inside AR.js, through its WASM port) rather than
 * AR.js itself: AR.js pins its own three.js build, and this app already ships
 * one. Everything it needs, the card template and the camera calibration, is
 * compiled in, so the tier works with the radio off.
 *
 * artoolkit5-js is LGPL-3.0. It stays an unmodified, separately loaded chunk
 * (the Card AR tier imports this module dynamically), which keeps it
 * replaceable as that licence asks.
 */

/**
 * The slice of ARController this uses. The package's own declarations model
 * its default export as the module rather than the `{ ARToolkit, ARController }`
 * object it actually is at runtime, in Node and under Vite alike, and it
 * accepts raw bytes and pixel data where the declarations say URLs and elements.
 */
interface Controller {
  setPattRatio(ratio: number): void;
  setPatternDetectionMode(mode: number): void;
  setThresholdMode(mode: number): void;
  setThreshold(threshold: number): void;
  loadMarker(pattern: string): Promise<number>;
  trackPatternMarkerId(id: number, width: number): void;
  getCameraMatrix(): Float64Array;
  process(frame: { data: Uint8ClampedArray | Uint8Array }): void;
  addEventListener(name: string, listener: (event: never) => void): void;
  removeEventListener(name: string, listener: (event: never) => void): void;
  dispose(): void;
}
const { ARController } = ARToolkitModule as unknown as {
  ARController: { initWithDimensions(width: number, height: number, camera: Uint8Array): Promise<Controller> };
};

/** ARToolKit's constants, which this port does not export by name. */
const PATTERN_MARKER = 0;
const TEMPLATE_MATCHING_COLOR = 0;
const THRESH_MODE_MANUAL = 0;

/**
 * The black/white cut-off tried in turn while the card is lost. ARToolKit's
 * own automatic modes each lost the card in one of the test lightings (Otsu a
 * washed-out one, adaptive a black-and-white print) where a fixed 100 found
 * it in all of them; this keeps 100 and reaches either side of it for a room
 * that is darker or brighter than that, holding whichever value finds the card.
 */
const THRESHOLDS = [100, 70, 135, 50, 165];

/**
 * Below this the match is treated as some other black square. The real card
 * scores 0.99 in every fixture; a bare frame with nothing in it scores far
 * lower, and a phantom card appearing on a picture frame is worse than a
 * card that takes a moment to lock on.
 */
export const MIN_CONFIDENCE = 0.7;

export interface CardSighting {
  /** marker-to-camera, column-major, right-handed GL; one unit is the card's frame width */
  modelView: Float64Array;
  confidence: number;
}

/** Clip planes for the 3D site, in card widths. The site is a hand's length away. */
const NEAR = 0.05;
const FAR = 100;

/**
 * The camera's projection, repaired. ARToolKit's own matrix gets the focal
 * lengths and the image centre right, which is what puts the site on the card
 * in the picture, but carries no usable depth terms: every vertex lands on the
 * far clip plane, and three.js clips the whole site away. So the lens is taken
 * from ARToolKit and the depth range is supplied here.
 */
export function repairProjection(raw: ArrayLike<number>): Float64Array {
  const m = Float64Array.from(raw);
  m[10] = -(FAR + NEAR) / (FAR - NEAR);
  m[11] = -1;
  m[14] = (-2 * FAR * NEAR) / (FAR - NEAR);
  m[15] = 0;
  return m;
}

/**
 * A flat square has two poses that draw it identically: the real one, and a
 * twin with its two in-plane axes and its position negated, which sits behind
 * the camera. ARToolKit's solver sometimes settles on the twin; on the Pixel 9
 * it did, and the whole site was drawn behind the lens where nothing is
 * visible. A card cannot be behind the camera that is looking at it, so the
 * twin is turned back into the real pose. Every point on the card projects to
 * the same pixel either way, since the card's own z is zero.
 */
export function inFront(modelView: ArrayLike<number>): Float64Array {
  const m = Float64Array.from(modelView);
  if (m[14]! <= 0) return m;
  for (const i of [0, 1, 2, 4, 5, 6, 12, 13, 14]) m[i] = -m[i]!;
  return m;
}

function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class CardTracker {
  readonly width: number;
  readonly height: number;
  #controller: Controller;
  #markerId: number;
  #sighting: CardSighting | null = null;
  #threshold = 0;

  private constructor(controller: Controller, markerId: number, width: number, height: number) {
    this.#controller = controller;
    this.#markerId = markerId;
    this.width = width;
    this.height = height;
    controller.addEventListener('getMarker', this.#onMarker);
  }

  /**
   * `width` x `height` is the frame the tracker will be handed every time,
   * which need not be 640x480: the calibration is rescaled to it, and the
   * projection below is rescaled with it, so the two always agree.
   */
  static async create(width: number, height: number): Promise<CardTracker> {
    const controller = await ARController.initWithDimensions(width, height, decode(CAMERA_PARA_BASE64));
    // Both before the template loads: the matching mode decides which form of
    // the template is built, and switching it afterwards got the card's
    // orientation wrong in testing.
    controller.setPattRatio(PATT_RATIO);
    controller.setPatternDetectionMode(TEMPLATE_MATCHING_COLOR);
    controller.setThresholdMode(THRESH_MODE_MANUAL);
    controller.setThreshold(THRESHOLDS[0]!);
    const markerId = await controller.loadMarker(CARD_PATTERN);
    controller.trackPatternMarkerId(markerId, 1);
    // The controller announces itself on a 1 ms timer after setup, and that
    // timer throws if the controller has been disposed before it fires.
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new CardTracker(controller, markerId, width, height);
  }

  /** The camera's projection for this frame size, column-major GL. */
  get projection(): Float64Array {
    return repairProjection(this.#controller.getCameraMatrix());
  }

  /** Look for the card in one frame of RGBA pixels, `width * height * 4` long. */
  detect(rgba: Uint8ClampedArray | Uint8Array): CardSighting | null {
    this.#sighting = null;
    this.#controller.process({ data: rgba });
    if (!this.#sighting) {
      this.#threshold = (this.#threshold + 1) % THRESHOLDS.length;
      this.#controller.setThreshold(THRESHOLDS[this.#threshold]!);
    }
    return this.#sighting;
  }

  dispose(): void {
    this.#controller.removeEventListener('getMarker', this.#onMarker);
    this.#controller.dispose();
  }

  #onMarker = (event: {
    data: { type: number; marker: { idPatt: number; cfPatt: number }; matrixGL_RH: Float64Array };
  }): void => {
    const { type, marker, matrixGL_RH } = event.data;
    if (type !== PATTERN_MARKER || marker.idPatt !== this.#markerId) return;
    if (marker.cfPatt < MIN_CONFIDENCE) return;
    // The best of several squares wins, and the array is the library's own
    // scratch buffer, overwritten by the next marker, so it is copied.
    if (this.#sighting && this.#sighting.confidence >= marker.cfPatt) return;
    this.#sighting = { modelView: inFront(matrixGL_RH), confidence: marker.cfPatt };
  };
}
