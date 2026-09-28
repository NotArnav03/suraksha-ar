import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { gunzipSync } from 'node:zlib';

/**
 * Card AR's tracker, run for real. The frames are the printed card as a phone
 * camera would see it, drawn by tools/make_mark.py from the same geometry as
 * public/card.svg and the template in card-marker.ts. So a template generated
 * with the turns in the wrong order, a frame ratio that no longer matches the
 * print, or a card that only reads in colour fails here, not in a classroom.
 */

const { CardTracker } = await import('../src/app/render/card-tracker.ts');
const { PATT_RATIO } = await import('../src/app/render/card-marker.ts');
const { inFront, repairProjection } = await import('../src/app/render/card-tracker.ts');

const W = 320;
const H = 240;
const tracker = await CardTracker.create(W, H);
after(() => {
  tracker.dispose();
  // The WASM runtime keeps Node's event loop alive after the last test, and a
  // test file that never exits hangs the whole suite.
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

/** A lighting test must not inherit the cut-off a previous one settled on. */
function settle(): void {
  for (let i = 0; i < 12; i++) if (tracker.detect(frame('card-upright'))) return;
}

type Look = 'colour' | 'grey' | 'dim' | 'dark' | 'washed';

function frame(name: string, look: Look = 'colour'): Uint8ClampedArray {
  const data = new Uint8ClampedArray(gunzipSync(readFileSync(new URL(`./fixtures/${name}.rgba.gz`, import.meta.url))));
  for (let i = 0; i < data.length; i += 4) {
    if (look === 'grey') {
      const y = (data[i]! * 3 + data[i + 1]! * 4 + data[i + 2]!) >> 3;
      data[i] = data[i + 1] = data[i + 2] = y;
    } else if (look !== 'colour') {
      const [gain, lift] = look === 'dim' ? [0.45, 0] : look === 'dark' ? [0.28, 0] : [1.6, 60];
      for (let c = 0; c < 3; c++) data[i + c] = data[i + c]! * gain + lift;
    }
  }
  return data;
}

/** Where a point on the card lands in the frame, in pixels. */
function project(modelView: Float64Array, point: [number, number, number]): [number, number] {
  const p = tracker.projection;
  const [x, y, z] = point;
  const eye = [0, 1, 2, 3].map((r) => modelView[r]! * x + modelView[4 + r]! * y + modelView[8 + r]! * z + modelView[12 + r]!);
  const clip = [0, 1, 3].map((r) => p[r]! * eye[0]! + p[4 + r]! * eye[1]! + p[8 + r]! * eye[2]! + p[12 + r]! * eye[3]!);
  return [((clip[0]! / clip[2]! + 1) / 2) * W, ((1 - clip[1]! / clip[2]!) / 2) * H];
}

test('finds the card square-on, the right way up, where it actually is', () => {
  const seen = tracker.detect(frame('card-upright'));
  assert.ok(seen, 'the card was not found');
  assert.ok(seen.confidence > 0.9, `confidence ${seen.confidence}`);

  // The fixture's frame corners: (104,52) (228,60) (236,186) (96,180).
  const [cx, cy] = project(seen.modelView, [0, 0, 0]);
  assert.ok(Math.abs(cx - 166) < 6 && Math.abs(cy - 119) < 6, `centre projected to ${cx},${cy}`);
  const [tlx, tly] = project(seen.modelView, [-0.5, 0.5, 0]);
  assert.ok(Math.abs(tlx - 104) < 6 && Math.abs(tly - 52) < 6, `top-left corner projected to ${tlx},${tly}`);
});

test('knows which way round the card is, so the site does not spin with it', () => {
  const upright = tracker.detect(frame('card-upright'));
  const quarter = tracker.detect(frame('card-quarter'));
  assert.ok(upright && quarter);
  // The card's own x axis, in camera space. Upright it points right; the
  // fixture turns the card a quarter clockwise, so there it points down.
  assert.ok(upright.modelView[0]! > 0.9, `upright x axis ${upright.modelView.slice(0, 3).join(',')}`);
  assert.ok(quarter.modelView[1]! < -0.9, `quarter-turned x axis ${quarter.modelView.slice(0, 3).join(',')}`);
});

test('reads a black-and-white print and a dim room as well as the colour card', () => {
  for (const name of ['card-upright', 'card-quarter']) {
    for (const look of ['grey', 'dim'] as const) {
      settle();
      const seen = tracker.detect(frame(name, look));
      assert.ok(seen && seen.confidence > 0.9, `${name} (${look}) was not found`);
    }
  }
});

test('finds the card in a dark room or a washed-out one within a few frames', () => {
  // A phone hands the tracker thirty frames a second, so taking a few to
  // settle on a cut-off is invisible; never finding it is not.
  for (const look of ['dark', 'washed'] as const) {
    let seen = null;
    for (let i = 0; i < 6 && !seen; i++) seen = tracker.detect(frame('card-upright', look));
    assert.ok(seen, `the card was never found in the ${look} frame`);
  }
});

test('an empty black square is not the card', () => {
  // ARToolKit lets a square inherit the identity of a marker seen in the same
  // place a moment ago, which smooths flicker on a real camera. Every earlier
  // test left the card in exactly this spot, so the memory is cleared first;
  // a card that turns into an empty square between two frames is not a
  // situation a phone ever sees.
  const blank = new Uint8ClampedArray(W * H * 4).fill(128);
  for (let i = 0; i < 4; i++) assert.equal(tracker.detect(blank), null);

  // A bare frame on a table: every square-shaped thing in a classroom is this.
  const data = new Uint8ClampedArray(W * H * 4).fill(150);
  for (let y = 50; y < 190; y++) {
    for (let x = 90; x < 230; x++) {
      const inside = x >= 111 && x < 209 && y >= 71 && y < 169;
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = inside ? 240 : 20;
    }
  }
  for (let i = 0; i < 4; i++) assert.equal(tracker.detect(data), null);
});

test('the printed sheet has the frame the tracker is looking for', () => {
  const svg = readFileSync(new URL('../public/card.svg', import.meta.url), 'utf8');
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#(15140c|f2b202)"/g)];
  const frameRect = rects.find((r) => r[5] === '15140c');
  const field = rects.find((r) => r[5] === 'f2b202');
  assert.ok(frameRect && field, 'card.svg has lost its frame or its field');
  assert.ok(Math.abs(Number(field[3]) / Number(frameRect[3]) - PATT_RATIO) < 1e-6, 'field / frame differs from PATT_RATIO');
});

test('the projection gives the site a depth range, so three.js does not clip all of it', () => {
  const p = tracker.projection;
  // A point on the card two widths in front of the lens must land inside the
  // clip volume, not on its far face where it is thrown away.
  const z = -2;
  const depth = (p[10]! * z + p[14]!) / (p[11]! * z);
  assert.ok(depth > -1 && depth < 1, `depth ${depth} is outside the clip volume`);
  // And the lens terms are left exactly as ARToolKit gave them.
  const raw = [1.9, 0, 0, 0, 0, 2.5, 0, 0, -0.01, -0.02, -1, -1, 0, 0, 0, 0];
  const fixed = repairProjection(raw);
  for (const i of [0, 5, 8, 9]) assert.equal(fixed[i], raw[i]);
});

test('a pose behind the camera is turned into the one in front that draws the same card', () => {
  // Recorded on the Pixel 9: ARToolKit's twin solution, 2.3 card widths behind the lens.
  const behind = [-0.983, -0.014, -0.182, 0, 0.182, -0.179, -0.967, 0, -0.019, -0.984, 0.178, 0, 0.02, -0.407, 2.318, 1];
  const fixed = inFront(behind);
  assert.ok(fixed[14]! < 0, 'still behind the camera');

  const pixel = (m: ArrayLike<number>, x: number, y: number): [number, number] => {
    const e = [0, 1, 2].map((r) => m[r]! * x + m[4 + r]! * y + m[12 + r]!);
    return [e[0]! / e[2]!, e[1]! / e[2]!];
  };
  for (const [x, y] of [[-0.5, 0.5], [0.5, 0.5], [0.5, -0.5], [-0.5, -0.5], [0, 0]] as const) {
    const [ax, ay] = pixel(behind, x, y);
    const [bx, by] = pixel(fixed, x, y);
    assert.ok(Math.abs(ax - bx) < 1e-9 && Math.abs(ay - by) < 1e-9, `corner ${x},${y} moved`);
  }
  // Still a rotation, not a mirror: the third axis is the cross product of the first two.
  const [a, b, c] = [[0, 1, 2], [4, 5, 6], [8, 9, 10]].map((i) => i.map((k) => fixed[k]!));
  const cross = [a![1]! * b![2]! - a![2]! * b![1]!, a![2]! * b![0]! - a![0]! * b![2]!, a![0]! * b![1]! - a![1]! * b![0]!];
  cross.forEach((v, i) => assert.ok(Math.abs(v - c![i]!) < 1e-2, `axis ${i}`));

  const ahead = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -2, 1];
  assert.deepEqual(Array.from(inFront(ahead)), ahead);
});
