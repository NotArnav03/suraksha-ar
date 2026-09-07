#!/usr/bin/env node
// Generates placeholder .glb files with correct scale, pivot (+Y up), single material <8k tris.
// Real art replaces these; placeholders validate the pipeline: viewer, import, scale, pivot.
// Run: node tools/make_placeholders.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'public/assets';
// const OUT = 'src/assets' // alternative if you prefer bundled

mkdirSync(OUT, { recursive: true });

// --- minimal glTF builder (box primitive only, enough to test scale/pivot) ---
function makeGlb({ name, size, pivotOffset, color }) {
  // size: [w,h,d] in metres; pivotOffset: [ox,oy,oz] added to every vertex (so origin = pivot)
  const [w,h,d] = size;
  const [ox,oy,oz] = pivotOffset;
  const hw=w/2, hh=h/2, hd=d/2; // but for base-pivot we want y from 0..h not -hh..+hh
  // We'll construct box from 0..h in Y if base pivot, otherwise centred
  // For simplicity, build centred box then offset by pivotOffset
  const verts = [
    // 8 corners of box centred at origin, then offset
  ];
  // Build 24 vertices (4 per face) with normals for flat shading — simple for viewer
  const faces = [
    { n:[0,0,1],  q:[ [-hw,-hh, hd], [ hw,-hh, hd], [ hw, hh, hd], [-hw, hh, hd] ] }, // front +Z
    { n:[0,0,-1], q:[ [ hw,-hh,-hd], [-hw,-hh,-hd], [-hw, hh,-hd], [ hw, hh,-hd] ] }, // back -Z
    { n:[0,1,0],  q:[ [-hw, hh, hd], [ hw, hh, hd], [ hw, hh,-hd], [-hw, hh,-hd] ] }, // top +Y
    { n:[0,-1,0], q:[ [-hw,-hh,-hd], [ hw,-hh,-hd], [ hw,-hh, hd], [-hw,-hh, hd] ] }, // bottom -Y
    { n:[1,0,0],  q:[ [ hw,-hh, hd], [ hw,-hh,-hd], [ hw, hh,-hd], [ hw, hh, hd] ] }, // right +X
    { n:[-1,0,0], q:[ [-hw,-hh,-hd], [-hw,-hh, hd], [-hw, hh, hd], [-hw, hh,-hd] ] }, // left -X
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  let vi=0;
  for (const f of faces) {
    for (const p of f.q) {
      positions.push(p[0]+ox, p[1]+oy, p[2]+oz);
      normals.push(...f.n);
    }
    indices.push(vi,vi+1,vi+2, vi,vi+2,vi+3);
    vi+=4;
  }
  const posBuf = new Float32Array(positions);
  const normBuf = new Float32Array(normals);
  const idxBuf = new Uint16Array(indices);
  const bin = new Uint8Array(posBuf.byteLength + normBuf.byteLength + idxBuf.byteLength);
  bin.set(new Uint8Array(posBuf.buffer), 0);
  bin.set(new Uint8Array(normBuf.buffer), posBuf.byteLength);
  bin.set(new Uint8Array(idxBuf.buffer), posBuf.byteLength+normBuf.byteLength);

  const posByteLen = posBuf.byteLength;
  const normByteLen = normBuf.byteLength;
  const idxByteLen = idxBuf.byteLength;

  const json = {
    asset:{version:"2.0", generator:"suraksha-placeholder"},
    scene:0, scenes:[{nodes:[0]}],
    nodes:[{mesh:0, name}],
    meshes:[{primitives:[{
      attributes:{POSITION:0, NORMAL:1},
      indices:2,
      material:0
    }]}],
    materials:[{pbrMetallicRoughness:{baseColorFactor:[color[0],color[1],color[2],1], metallicFactor:0.1, roughnessFactor:0.65}, doubleSided:false}],
    accessors:[
      {bufferView:0, componentType:5126, count:24, type:"VEC3", max:[w/2+Math.abs(ox), h/2+Math.abs(oy), d/2+Math.abs(oz)], min:[-w/2+ox, -h/2+oy, -d/2+oz]},
      {bufferView:1, componentType:5126, count:24, type:"VEC3"},
      {bufferView:2, componentType:5123, count:36, type:"SCALAR"}
    ],
    bufferViews:[
      {buffer:0, byteOffset:0, byteLength:posByteLen, target:34962},
      {buffer:0, byteOffset:posByteLen, byteLength:normByteLen, target:34962},
      {buffer:0, byteOffset:posByteLen+normByteLen, byteLength:idxByteLen, target:34963}
    ],
    buffers:[{byteLength:bin.byteLength}]
  };
  const jsonText = JSON.stringify(json);
  const jsonPad = (4 - (jsonText.length %4))%4;
  const jsonPadded = jsonText + " ".repeat(jsonPad);
  const binPad = (4 - (bin.length %4))%4;
  const totalLen = 12 + 8 + jsonPadded.length + 8 + bin.length + binPad;
  const out = new Uint8Array(totalLen);
  const dv = new DataView(out.buffer);
  let o=0;
  dv.setUint32(o, 0x46546C67, true); o+=4; // glTF
  dv.setUint32(o, 2, true); o+=4;
  dv.setUint32(o, totalLen, true); o+=4;
  dv.setUint32(o, jsonPadded.length, true); o+=4;
  dv.setUint32(o, 0x4E4F534A, true); o+=4; // JSON
  out.set(new TextEncoder().encode(jsonPadded), o); o+=jsonPadded.length;
  dv.setUint32(o, bin.length+binPad, true); o+=4;
  dv.setUint32(o, 0x004E4942, true); o+=4; // BIN
  out.set(bin, o); o+=bin.length;
  // padding zeros already
  writeFileSync(join(OUT, name), out);
  console.log(`→ ${join(OUT,name)} ${out.length} bytes  size ${w}×${h}×${d}  pivot ${pivotOffset}  ${positions.length/3} verts  12 tris`);
}

// Spec: real-world metres, +Y up
// electrical_panel: ~1.0m tall x 0.6w x 0.15d, pivot at back face centre (back at z=0) so offset z = +0.075, y centred vertically around 0.5? But pivot at back face only, not base. So y centre 0.5, z 0.075.
makeGlb({name:"electrical_panel.glb", size:[0.6,1.0,0.15], pivotOffset:[0,0.5,0.075], color:[0.62,0.63,0.64]});
// fire_panel: DO NOT ship as model — this placeholder is a 1×1×0.05 red slab that sits on panel. Real fire = particle shader (see README below). Still export name for pipeline test.
makeGlb({name:"fire_panel.glb", size:[0.7,0.9,0.05], pivotOffset:[0,0.45,0.08], color:[0.95,0.32,0.15]});
// extinguishers: ~0.5m tall (h=0.55 with handle), dia 0.15, pivot at base centre => y offset = h/2
makeGlb({name:"ext_dcp.glb", size:[0.15,0.55,0.15], pivotOffset:[0,0.275,0], color:[0.17,0.32,0.72]}); // blue band
makeGlb({name:"ext_water.glb", size:[0.14,0.55,0.14], pivotOffset:[0,0.275,0], color:[0.75,0.18,0.18]}); // red
makeGlb({name:"ext_co2.glb", size:[0.14,0.60,0.14], pivotOffset:[0,0.30,0], color:[0.08,0.08,0.08]}); // black + horn (horn as scale hint — real horn modelled separately)
// scsr: ~0.24×0.18×0.12 box worn, pivot at base centre
makeGlb({name:"scsr.glb", size:[0.24,0.18,0.12], pivotOffset:[0,0.09,0], color:[0.28,0.56,0.85]});
// exit_arrow: arrow along +Z, 0.6m long, 0.2m wide, glowing green emissive placeholder (baseColor green, we add emissive in final Blender)
makeGlb({name:"exit_arrow.glb", size:[0.20,0.05,0.60], pivotOffset:[0,0.025,0], color:[0.15,0.85,0.35]});
// exit_marker: green exit sign 0.4×0.25, thin, pivot at back face if wall-mounted — keep base pivot for floor-marker variant
makeGlb({name:"exit_marker.glb", size:[0.40,0.25,0.02], pivotOffset:[0,0.125,0], color:[0.12,0.65,0.30]});
// colleague_down: capsule approximation as 1.7×0.4×0.4 box lying along +Z, pivot at base centre (lying on ground y=0.2)
makeGlb({name:"colleague_down.glb", size:[0.45,0.40,1.70], pivotOffset:[0,0.20,0], color:[0.85,0.70,0.55]});

console.log("\nDone. Test each in https://gltf-viewer.donmccurdy.com/ or https://sandbox.babylonjs.com/ — check scale (metres), +Y up, pivot, single material, <8k tris.");
console.log("Replace these placeholders in Blender: File→Import→glTF, remodel, keep origin at 0,0,0, apply same offsets, Export glTF 2.0 (.glb) with +Y up, Draco if <1024 textures.");
