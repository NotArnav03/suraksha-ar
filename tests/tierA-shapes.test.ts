import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as THREE from 'three';

/**
 * Tier A's props are built from real three.js geometry, and geometry
 * construction needs no WebGL context or DOM — only *rendering* does. So
 * this runs the actual shape-building code (`partsFor`), not a description
 * of it, and would fail if a person/extinguisher/etc. definition ever threw,
 * produced degenerate geometry, or silently dropped back to a bare box.
 *
 * This is the one place in the render layer that has never had test
 * coverage (WebXR/WebGL can't run under happy-dom) — see README's "Known
 * gaps": Tier A is unproven on real hardware. This doesn't change that, but
 * it does mean a broken shape definition fails `npm test`, not just a demo.
 */

const { partsFor } = await import('../src/app/render/tierA.ts');

function mockProp(id: string, kind: string, label = id): Parameters<typeof partsFor>[0] {
  return { id, role: null, kind: kind as never, label, verbs: [], visible: true };
}

function assertSaneGeometry(mesh: THREE.Mesh, context: string): void {
  assert.ok(mesh instanceof THREE.Mesh, `${context}: not a Mesh`);
  const position = mesh.geometry.getAttribute('position');
  assert.ok(position && position.count > 0, `${context}: geometry has no vertices`);
  for (let i = 0; i < position.count; i++) {
    const v = position.getX(i);
    assert.ok(Number.isFinite(v), `${context}: NaN/Infinite vertex data`);
  }
  for (const axis of ['x', 'y', 'z'] as const) {
    assert.ok(Number.isFinite(mesh.position[axis]), `${context}: non-finite position.${axis}`);
  }
  assert.ok(mesh.material instanceof THREE.Material, `${context}: no material`);
}

test('every prop kind builds at least one part with sane geometry', () => {
  for (const kind of ['person', 'ppe', 'structure', 'signage', 'instrument', 'equipment', 'hazard']) {
    const parts = partsFor(mockProp(`test_${kind}`, kind));
    assert.ok(parts.length > 0, `kind "${kind}" produced no parts`);
    parts.forEach((part, i) => assertSaneGeometry(part, `${kind}[${i}]`));
  }
});

test('a person is built from distinct body parts, not a single capsule', () => {
  const parts = partsFor(mockProp('supervisor', 'person'));
  // legs x2, torso, arms x2, head, hard hat
  assert.equal(parts.length, 7, 'expected head + torso + 2 arms + 2 legs + hard hat');
  // Feet must reach the floor: with the group placed at slot.height (1.0 for
  // person, in tierA.ts's #layout), the lowest part has to extend down close
  // to local y = -1.0, or the figure floats instead of standing on the ring.
  const lowestY = Math.min(
    ...parts.map((p) => {
      const geo = p.geometry as THREE.CylinderGeometry | THREE.SphereGeometry;
      geo.computeBoundingBox();
      return p.position.y + (geo.boundingBox?.min.y ?? 0);
    }),
  );
  assert.ok(lowestY < -0.9, `feet should reach near local y=-1.0 (the floor); lowest point was ${lowestY}`);
});

test('the three extinguishers are visually distinct, matching docs/ASSETS_FIRE_EXPLOSION.md', () => {
  const dcp = partsFor(mockProp('ext_dcp', 'equipment'));
  const water = partsFor(mockProp('ext_water', 'equipment'));
  const co2 = partsFor(mockProp('ext_co2', 'equipment'));

  const bodyColor = (parts: THREE.Mesh[]) => (parts[0]!.material as THREE.MeshStandardMaterial).color.getHex();

  assert.equal(bodyColor(co2), 0x1a1a1a, 'CO2 body should be black');
  assert.equal(bodyColor(dcp), bodyColor(water), 'DCP and water are both red-bodied per the colour code — the band is what distinguishes DCP');
  assert.ok(dcp.length > water.length, 'DCP must have an extra part (the blue band) that water does not');
  assert.ok(co2.length > water.length, 'CO2 must have an extra part (the horn) that water does not');
});

test('an unrecognised prop id does not accidentally hit an extinguisher branch', () => {
  // ext_dcp/ext_water/ext_co2 are matched by exact id — a differently-named
  // equipment prop must fall through to the generic box, not silently share
  // an extinguisher shape it has no business wearing.
  const generic = partsFor(mockProp('toolbox', 'equipment'));
  assert.equal(generic.length, 1);
  assert.ok(generic[0]!.geometry instanceof THREE.BoxGeometry);
});
