import * as THREE from 'three';

import type { Prop } from '../../engine/types.ts';
import type { PropView } from './contract.ts';

/**
 * The work site as three.js geometry, shared by both camera tiers.
 *
 * Tier A stands it on the learner's floor at full size; Tier B stands it on a
 * printed card at tabletop scale. They build it from this one file, so a
 * learner sees the same isolator, the same extinguishers and the same
 * collapsed colleague whichever tier their phone gets, in the same places
 * relative to one another.
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
export interface Slot {
  angle: number;
  radius: number;
  height: number;
}

export function labelTexture(text: string): THREE.CanvasTexture {
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

/**
 * What a prop is built from, in metres, positioned relative to its group's
 * own origin (which `#layout` places at `slot.height` above the floor — see
 * there for why that number differs by kind). Still primitives, still
 * placeholder art (see README's "Known gaps" — this is coloured geometry,
 * not a site twin) — but a supervisor should be recognisable as a person
 * across a room, not read as a floating pill.
 *
 * Per-prop-id branches (the three extinguishers below) are precedent that
 * already exists in this file — `#layout` special-cases `sump_opening` by
 * id for the same reason: some things are individual enough that "kind"
 * alone can't carry them.
 */
function stdMaterial(color: number, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.1, ...opts });
}

/** Head, torso, two arms, two legs — feet at the floor, not floating mid-air. */
function personParts(color: number): THREE.Mesh[] {
  const skin = stdMaterial(0xd9a066, { roughness: 0.75 });
  const cloth = stdMaterial(color);

  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.62, 12), cloth);
  legL.position.set(-0.08, -0.69, 0);
  const legR = legL.clone();
  legR.position.x = 0.08;

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.58, 14), cloth);
  torso.position.y = -0.09;

  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.045, 0.46, 10), cloth);
  armL.position.set(-0.2, -0.12, 0);
  armL.rotation.z = 0.12;
  const armR = armL.clone();
  armR.position.x = 0.2;
  armR.rotation.z = -0.12;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skin);
  head.position.y = 0.34;

  const hardHat = new THREE.Mesh(
    new THREE.SphereGeometry(0.125, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    stdMaterial(0xf0a02e, { roughness: 0.4 }),
  );
  hardHat.position.y = 0.4;

  return [legL, legR, torso, armL, armR, head, hardHat];
}

/** An oxygen/air cylinder with a valve — what SCBA, SCSR and a harness pack all actually are. */
function ppeParts(): THREE.Mesh[] {
  const tank = stdMaterial(0x4a90d9);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.07, 0.3, 16), tank);
  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), tank);
  shoulder.position.y = 0.15;
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.07, 8), stdMaterial(0x2b3238));
  valve.position.y = 0.23;
  return [body, shoulder, valve];
}

/** A rimmed opening you look down into — a curb around a dark void, not a solid puck. */
function structureParts(): THREE.Mesh[] {
  // A *solid* rim cylinder completely covers whatever "hole" sits inside its
  // own radius, whatever colour either one is - there is no actual gap for
  // the hole to show through. RingGeometry is a true annulus (a real
  // geometric hole, not just a darker mesh underneath); the shaft then
  // extends genuinely downward instead of being a second flat disc, so it
  // reads as depth from an angle, not just a color difference from directly
  // above. Concrete-pale rim against a near-black shaft also has to contrast
  // against whatever real floor this sits on in AR passthrough, not just
  // against itself.
  const lip = new THREE.Mesh(
    new THREE.RingGeometry(0.36, 0.44, 28).rotateX(-Math.PI / 2),
    stdMaterial(0x8a8f86, { roughness: 0.85, side: THREE.DoubleSide }),
  );
  lip.position.y = 0.02;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.32, 0.3, 28), stdMaterial(0x0b0f12, { roughness: 0.9 }));
  shaft.position.y = -0.15;
  return [lip, shaft];
}

/** A plate on a post — reads as a standing sign, not a plaque floating in the air. */
function signageParts(): THREE.Mesh[] {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.34, 8), stdMaterial(0x3a3f33));
  post.position.y = -0.17;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.02), stdMaterial(0xf0a02e, { roughness: 0.5 }));
  plate.position.y = 0.05;
  return [post, plate];
}

/** A hand-held gas detector: a body with a small display, not a bare box. */
function instrumentParts(): THREE.Mesh[] {
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.05), stdMaterial(0x35b39c));
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.01), stdMaterial(0x0b0f12, { roughness: 0.3 }));
  screen.position.set(0, 0.03, 0.028);
  return [body, screen];
}

/** DCP / water / CO2 look meaningfully different, matching docs/ASSETS_FIRE_EXPLOSION.md's colour code. */
function extinguisherParts(kind: 'dcp' | 'water' | 'co2'): THREE.Mesh[] {
  const bodyColor = kind === 'co2' ? 0x1a1a1a : 0xc0281c;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.32, 16), stdMaterial(bodyColor));
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.06, 10), stdMaterial(0x2b3238));
  neck.position.y = 0.19;
  const parts = [body, neck];

  if (kind === 'dcp') {
    // Radius has to clear the body's own taper (0.055-0.065) by a visible
    // margin, or the "band" renders inside the body and is invisible from
    // every angle — caught by actually rendering this, not by the geometry
    // tests, which only check that vertices are finite, not that they're
    // outside the parent mesh.
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.05, 16), stdMaterial(0x2255aa));
    band.position.y = 0.02;
    parts.push(band);
  }
  if (kind === 'co2') {
    // The horn is the tell on a CO2 unit — a real one is unmistakable even at
    // a glance, so this has to read clearly in silhouette, not just exist.
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 12, 1, true), stdMaterial(0x3a3f42));
    horn.rotation.z = Math.PI / 2.4;
    horn.position.set(0.11, 0.12, 0);
    parts.push(horn);
  }
  return parts;
}

const EXTINGUISHER_KIND: Record<string, 'dcp' | 'water' | 'co2'> = {
  ext_dcp: 'dcp',
  ext_water: 'water',
  ext_co2: 'co2',
};

/**
 * A flame, not a coloured box. The generic-box fallback used to apply to
 * `hazard` too, which is exactly wrong for the one prop a learner is
 * specifically asked to spot and point at ("find the hazard you see") - a
 * box gives no visual reason to pick it over anything else in the scene.
 * Emissive, not just brightly-coloured: AR passthrough lighting is whatever
 * the real room happens to be, and this has to read as fire regardless.
 */
function hazardParts(): THREE.Mesh[] {
  const flameMat = (color: number, emissive: number) =>
    stdMaterial(color, { emissive, emissiveIntensity: 1.1, roughness: 0.55 });

  const base = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 12), flameMat(0xd7371a, 0xb32a10));
  base.position.y = 0.01;

  const mid = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.22, 12), flameMat(0xf0791e, 0xe0620f));
  mid.position.set(0.02, 0.1, 0.01);
  mid.rotation.z = 0.12;

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.15, 10), flameMat(0xffcf4d, 0xffb020));
  tip.position.set(-0.015, 0.19, -0.01);
  tip.rotation.z = -0.1;

  return [base, mid, tip];
}

/**
 * The conveyor drill's props. Most are `equipment`, which would otherwise all
 * be the same grey box, and the drill turns on telling them apart: isolator C3
 * from isolator C4, the start button from the pull cord. Two are `hazard`, and
 * a coal jam or a hanging cloth drawn as a flame would teach the wrong thing.
 * Parts hang from the group origin, which `#layout` places 0.85 m up.
 */
function conveyorParts(): THREE.Mesh[] {
  const steel = stdMaterial(0x5c6166, { metalness: 0.4 });
  const legA = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), steel);
  legA.position.set(-0.2, -0.6, 0);
  const legB = legA.clone();
  legB.position.x = 0.2;
  const bed = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.05, 0.24), steel);
  bed.position.y = -0.33;
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.2), stdMaterial(0x1c1f22, { roughness: 0.9 }));
  belt.position.y = -0.295;
  // Drums run across the belt, so their axis is along z.
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.24, 16).rotateX(Math.PI / 2), steel);
  tail.position.set(0.26, -0.3, 0);
  const head = tail.clone();
  head.position.x = -0.26;
  return [legA, legB, bed, belt, tail, head];
}

function coalJamParts(): THREE.Mesh[] {
  const coal = stdMaterial(0x15171a, { roughness: 0.95 });
  const lumps: [number, number, number, number][] = [
    [0, -0.78, 0, 0.07],
    [0.08, -0.79, 0.04, 0.05],
    [-0.07, -0.79, -0.03, 0.055],
    [0.02, -0.71, 0.01, 0.045],
  ];
  return lumps.map(([x, y, z, r]) => {
    const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(r), coal);
    lump.position.set(x, y, z);
    return lump;
  });
}

/** A hanging checked cloth: red and white strips, the gamchha a worker actually wears. */
function gamchhaParts(): THREE.Mesh[] {
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.012), stdMaterial(0xc0392b, { roughness: 0.9 }));
  red.position.set(-0.035, -0.05, 0);
  const white = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.012), stdMaterial(0xe8e2d4, { roughness: 0.9 }));
  white.position.set(0.035, -0.05, 0);
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 8).rotateZ(Math.PI / 2), stdMaterial(0x5c6166));
  rail.position.y = 0.13;
  return [red, white, rail];
}

function isolatorParts(): THREE.Mesh[] {
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.1), stdMaterial(0x8a9099, { metalness: 0.3 }));
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 16).rotateX(Math.PI / 2), stdMaterial(0xc0281c));
  handle.position.set(0, 0.02, 0.07);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.005), stdMaterial(0xf0c419));
  plate.position.set(0, -0.08, 0.053);
  return [box, handle, plate];
}

function padlockParts(): THREE.Mesh[] {
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.03), stdMaterial(0xc9a227, { metalness: 0.5 }));
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.007, 8, 20, Math.PI), stdMaterial(0xb8bcc2, { metalness: 0.7 }));
  shackle.position.y = 0.035;
  return [body, shackle];
}

function dangerTagParts(): THREE.Mesh[] {
  const tag = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.005), stdMaterial(0xc0281c));
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.006), stdMaterial(0xf4f1ea));
  band.position.y = 0.03;
  return [tag, band];
}

function startButtonParts(): THREE.Mesh[] {
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.08), stdMaterial(0x2b3238));
  const start = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.02, 16).rotateX(Math.PI / 2), stdMaterial(0x2e9e4f));
  start.position.set(0, 0.03, 0.05);
  const stop = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 16).rotateX(Math.PI / 2), stdMaterial(0xc0281c));
  stop.position.set(0, -0.035, 0.05);
  return [box, start, stop];
}

/** A switch on a post with the cord running off along the belt line. */
function pullCordParts(): THREE.Mesh[] {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 8), stdMaterial(0x5c6166));
  post.position.y = -0.4;
  const switchBox = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.06), stdMaterial(0xf0c419));
  switchBox.position.y = 0.05;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.5, 6).rotateZ(Math.PI / 2), stdMaterial(0xc0281c));
  cord.position.set(0.27, 0.03, 0);
  return [post, switchBox, cord];
}

const PARTS_BY_ID: Record<string, () => THREE.Mesh[]> = {
  conveyor_tail: conveyorParts,
  coal_jam: coalJamParts,
  loose_gamchha: gamchhaParts,
  isolator_c3: isolatorParts,
  isolator_c4: isolatorParts,
  padlock: padlockParts,
  danger_tag: dangerTagParts,
  start_button: startButtonParts,
  pull_cord: pullCordParts,
};

/** Exported for tests/tierA-shapes.test.ts — geometry construction needs no WebGL/DOM, so it can run for real under plain Node. */
export function partsFor(prop: PropView): THREE.Mesh[] {
  const extinguisher = EXTINGUISHER_KIND[prop.id];
  if (extinguisher) return extinguisherParts(extinguisher);
  const byId = PARTS_BY_ID[prop.id];
  if (byId) return byId();

  switch (prop.kind) {
    case 'person':
      return personParts(KIND_COLOR.person);
    case 'ppe':
      return ppeParts();
    case 'structure':
      return structureParts();
    case 'signage':
      return signageParts();
    case 'instrument':
      return instrumentParts();
    case 'hazard':
      return hazardParts();
    default:
      return [new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.16), stdMaterial(KIND_COLOR[prop.kind]))];
  }
}

/**
 * Props sit on an arc in front of the anchor, with the sump on the floor at
 * its centre. Fixed slots rather than a random scatter: two learners in
 * different rooms must walk the same distances, or the time-to-first-action
 * numbers stop being comparable between them. Metres, before any tier scales it.
 */
export function siteSlots(props: PropView[]): Map<string, Slot> {
  const slots = new Map<string, Slot>();
  const arranged = props.filter((p) => p.id !== 'sump_opening');
  slots.set('sump_opening', { angle: 0, radius: 0, height: 0.02 });
  arranged.forEach((prop, index) => {
    const spread = Math.PI * 1.15;
    const angle = -spread / 2 + (spread * index) / Math.max(arranged.length - 1, 1);
    const radius = 1.35 + (index % 2) * 0.45;
    const height = prop.kind === 'ppe' ? 0.7 : prop.kind === 'person' ? 1.0 : 0.85;
    slots.set(prop.id, { angle, radius, height });
  });
  return slots;
}

/** One prop, labelled and standing on a footprint ring, placed at its slot. */
export function buildProp(prop: PropView, slot: Slot = { angle: 0, radius: 1.5, height: 0.9 }): THREE.Group {
  const group = new THREE.Group();
  group.userData.propId = prop.id;
  group.position.set(Math.sin(slot.angle) * slot.radius, slot.height, -Math.cos(slot.angle) * slot.radius);

  // Every part is a child of `group`, which already carries `userData.propId`;
  // a renderer resolving a hit walks up the parent chain, so a tap landing on
  // any individual part (the head, an extinguisher's horn) still resolves to
  // this prop without each mesh needing its own tag.
  for (const part of partsFor(prop)) group.add(part);

  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(prop.label), depthTest: false }));
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
  return group;
}

/** A tripped machine: greyed out and knocked askew, so it reads as dead at a glance. */
export function showFailed(group: THREE.Group | undefined): void {
  const mesh = group?.children[0];
  if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.MeshStandardMaterial) {
    mesh.material.color.set(0x3a4147);
    mesh.rotation.z = 0.35;
  }
}
