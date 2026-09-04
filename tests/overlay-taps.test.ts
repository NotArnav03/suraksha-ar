import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Window } from 'happy-dom';

/**
 * Tap arbitration inside a WebXR dom-overlay.
 *
 * These are the four combinations a phone can actually produce for one physical
 * tap on a verb button — click only, select only, both in either order — and the
 * requirement is the same for all of them: the verb fires exactly once. The bug
 * these guard against is not cosmetic. A tap that fires nothing means the drill
 * cannot be played at all; a tap that fires twice means the learner climbs into
 * the sump they only meant to enter once, and gets scored for it.
 */

const window = new Window({ url: 'https://localhost/' });
const globals = globalThis as unknown as Record<string, unknown>;
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'PointerEvent']) {
  Object.defineProperty(globals, name, {
    value: (window as unknown as Record<string, unknown>)[name],
    writable: true,
    configurable: true,
  });
}

const { OverlayTaps } = await import('../src/app/render/overlay-taps.ts');

interface Rig {
  taps: InstanceType<typeof OverlayTaps>;
  overlay: HTMLElement;
  button: HTMLButtonElement;
  fired: () => number;
  aim(node: EventTarget, via: 'beforexrselect' | 'pointerdown'): void;
  tap(node: EventTarget): void;
  advance(ms: number): void;
}

function rig(): Rig {
  const overlay = window.document.createElement('div') as unknown as HTMLElement;
  const button = window.document.createElement('button') as unknown as HTMLButtonElement;
  // a child node, because a finger lands on the label inside the button
  const label = window.document.createElement('span');
  button.append(label as never);
  overlay.append(button as never);
  window.document.body.append(overlay as never);

  let count = 0;
  button.addEventListener('click', () => (count += 1));

  let clock = 1000;
  const taps = new OverlayTaps(overlay, { now: () => clock });

  return {
    taps,
    overlay,
    button,
    fired: () => count,
    aim(node, via) {
      node.dispatchEvent(new window.Event(via, { bubbles: true }) as never);
    },
    tap(node) {
      node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }) as never);
    },
    advance(ms) {
      clock += ms;
    },
  };
}

test('a select with no click still presses the button the finger was on', () => {
  const r = rig();
  r.aim(r.button.firstChild!, 'beforexrselect');
  assert.equal(r.taps.activate(), true, 'the tap belonged to a control');
  assert.equal(r.fired(), 1);
});

test('a click with no select presses the button exactly once', () => {
  const r = rig();
  r.aim(r.button.firstChild!, 'pointerdown');
  r.tap(r.button.firstChild!);
  assert.equal(r.fired(), 1);
});

test('click then select fires once, not twice', () => {
  const r = rig();
  r.aim(r.button.firstChild!, 'beforexrselect');
  r.tap(r.button.firstChild!);
  assert.equal(r.taps.activate(), true, 'the tap still belonged to a control');
  assert.equal(r.fired(), 1, 'the slower channel must be swallowed');
});

test('select then click fires once, not twice', () => {
  const r = rig();
  r.aim(r.button.firstChild!, 'beforexrselect');
  r.taps.activate();
  r.tap(r.button.firstChild!);
  assert.equal(r.fired(), 1, 'the slower channel must be swallowed');
});

test('a tap on the world is left to the caller', () => {
  const r = rig();
  r.aim(r.overlay, 'pointerdown');
  assert.equal(r.taps.activate(), false, 'no control was pressed');
  assert.equal(r.fired(), 0);
});

test('a select with nothing aimed is left to the caller', () => {
  const r = rig();
  assert.equal(r.taps.activate(), false);
});

test('a stale aim is not replayed onto a later select', () => {
  const r = rig();
  r.aim(r.button, 'pointerdown');
  r.advance(5000);
  assert.equal(r.taps.activate(), false, 'a tap from seconds ago is not this tap');
  assert.equal(r.fired(), 0);
});

test('a second, genuinely separate tap still fires', () => {
  const r = rig();
  r.aim(r.button, 'beforexrselect');
  r.taps.activate();
  r.advance(1000);
  r.aim(r.button, 'beforexrselect');
  r.taps.activate();
  assert.equal(r.fired(), 2);
});

test('dispose stops arbitrating', () => {
  const r = rig();
  r.taps.dispose();
  r.aim(r.button, 'beforexrselect');
  assert.equal(r.taps.activate(), false);
  r.tap(r.button);
  assert.equal(r.fired(), 1, 'the plain DOM click is untouched after dispose');
});
