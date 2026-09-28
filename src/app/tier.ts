import type { Tier } from './render/contract.ts';

/**
 * Capability detection.
 *
 * The honest output here is two answers, not one: the best tier this device
 * *could* run, and the tier we are actually serving it. Conflating them is how
 * a pitch ends up claiming AR coverage it does not have, and how a worker ends
 * up staring at a black screen because the app insisted on a session the phone
 * was never going to grant.
 */

export interface TierReport {
  /** the best tier this hardware supports */
  capable: Tier;
  /** the tier actually being served — never better than `capable` */
  serving: Tier;
  reasons: string[];
  capabilities: {
    webxrImmersiveAr: boolean;
    camera: boolean;
    deviceOrientation: boolean;
    webgl: boolean;
    secureContext: boolean;
  };
}

/** Tiers whose renderer actually exists. All three. */
export const IMPLEMENTED: Tier[] = ['A', 'B', 'C'];

/**
 * Every tier this phone can run, best first. Flat always; Card AR wherever
 * there is a camera and something to draw with; full AR only with WebXR too.
 * An ARCore phone can run all three, which is what lets a learner with no
 * floor space take the card instead, and one with no card take the flat drill.
 */
export function supportedTiers(capabilities: TierReport['capabilities']): Tier[] {
  const tiers: Tier[] = [];
  if (capabilities.webxrImmersiveAr && capabilities.webgl) tiers.push('A');
  if (capabilities.camera && capabilities.webgl && capabilities.secureContext) tiers.push('B');
  tiers.push('C');
  return tiers;
}

async function hasImmersiveAr(): Promise<boolean> {
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr?.isSessionSupported) return false;
  try {
    return await xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

function hasWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export async function detectTier(force?: Tier): Promise<TierReport> {
  const capabilities = {
    webxrImmersiveAr: await hasImmersiveAr(),
    // Presence of the API, not permission — asking for the camera before the
    // learner has any reason to trust the app is how you lose the permission.
    camera: Boolean(navigator.mediaDevices?.getUserMedia),
    deviceOrientation: 'DeviceOrientationEvent' in window,
    webgl: hasWebgl(),
    secureContext: window.isSecureContext,
  };

  const reasons: string[] = [];
  const capable = supportedTiers(capabilities)[0]!;

  if (capable === 'A') {
    reasons.push('WebXR immersive-ar is supported, so the drill can be placed in the room');
  } else if (capable === 'B') {
    // No ARCore, but a camera and something to draw with: the drill stands on
    // the printed card instead of the floor.
    reasons.push('no WebXR immersive-ar, but a camera and WebGL, so the drill can stand on the printed card');
  } else {
    reasons.push(
      !capabilities.webgl
        ? 'no WebGL to draw a 3D site with, so the drill runs flat'
        : !capabilities.camera
          ? 'no camera the browser can use, so the drill runs flat'
          : 'the camera needs a secure context (https or localhost), so the drill runs flat',
    );
  }
  if (capabilities.webxrImmersiveAr && !capabilities.secureContext) {
    reasons.push('AR also needs a secure context (https or localhost)');
  }

  const serving = force ?? capable;
  if (force) reasons.push(`tier forced to ${force}`);

  return { capable, serving, reasons, capabilities };
}
