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

/** Tiers whose renderer actually exists. Both of them, now that there are two. */
export const IMPLEMENTED: Tier[] = ['A', 'B'];

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
  let capable: Tier;

  if (capabilities.webxrImmersiveAr && capabilities.webgl) {
    capable = 'A';
    reasons.push('WebXR immersive-ar is supported, so the drill can be placed in the room');
  } else if (!capabilities.webxrImmersiveAr) {
    capable = 'B';
    reasons.push('no WebXR immersive-ar on this phone, so the drill runs flat');
  } else {
    capable = 'B';
    reasons.push('WebXR is present but there is no WebGL to draw with, so the drill runs flat');
  }
  if (capabilities.webxrImmersiveAr && !capabilities.secureContext) {
    reasons.push('AR also needs a secure context (https or localhost)');
  }

  const serving = force ?? capable;
  if (force) reasons.push(`tier forced to ${force}`);

  return { capable, serving, reasons, capabilities };
}
