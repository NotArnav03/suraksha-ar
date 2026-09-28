import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * Which modes the start screen offers. The switcher disables every button this
 * returns no tier for, so a wrong answer here either strands a learner in a
 * mode their phone cannot run or hides one it can.
 */

const { supportedTiers } = await import('../src/app/tier.ts');

type Capability = 'webxrImmersiveAr' | 'camera' | 'deviceOrientation' | 'webgl' | 'secureContext';
const phone = (over: Partial<Record<Capability, boolean>>) => ({
  webxrImmersiveAr: false,
  camera: false,
  deviceOrientation: true,
  webgl: false,
  secureContext: true,
  ...over,
});

test('an ARCore phone can run all three, best first', () => {
  assert.deepEqual(supportedTiers(phone({ webxrImmersiveAr: true, camera: true, webgl: true })), ['A', 'B', 'C']);
});

test('a phone with a camera but no ARCore gets Card AR and flat', () => {
  assert.deepEqual(supportedTiers(phone({ camera: true, webgl: true })), ['B', 'C']);
});

test('no camera, no WebGL or no secure context leaves only flat', () => {
  assert.deepEqual(supportedTiers(phone({ webgl: true })), ['C']);
  assert.deepEqual(supportedTiers(phone({ camera: true })), ['C']);
  assert.deepEqual(supportedTiers(phone({ camera: true, webgl: true, secureContext: false })), ['C']);
});

test('flat is always offered, so the switcher never leaves a learner with nothing to press', () => {
  for (const webxrImmersiveAr of [true, false])
    for (const camera of [true, false])
      for (const webgl of [true, false])
        for (const secureContext of [true, false])
          assert.ok(supportedTiers(phone({ webxrImmersiveAr, camera, webgl, secureContext })).includes('C'));
});
