# Fire & Explosion — 3D Asset Workflow & How to Keep Them Light

**For `fire_explosion_v1` — 9 assets, one `.glb` each, `public/assets/`**

Do not rename: `electrical_panel.glb`, `fire_panel.glb`, `ext_dcp.glb`, `ext_water.glb`, `ext_co2.glb`, `scsr.glb`, `exit_arrow.glb`, `exit_marker.glb`, `colleague_down.glb`
Live in `public/assets/` → served at `/assets/<name>.glb` (Vite copies `public/` verbatim). Current files in repo are **12-tri placeholders** that validate scale/pivot — replace with real art, keep names.

---

## Recommendation: fire/smoke as in-engine effect, NOT a .glb

**`fire_panel.glb` ships as a placeholder slab only. Real fire = `three.js` particle/shader effect parented to `panel` anchor.**

Why: a static mesh with baked flames looks frozen in AR, can't flicker/smoke, needs heavy texture to look real, and at `1024` still reads as fake under phone camera. A shader plane + particle system (`Points` + `Smoke` texture + `alpha` + `additive` + slight `vertex` turbulence) is <30 draw calls, animated, and disappears cleanly on `apply_pass` success. This repo already does `spawn/despawn` for `casualty` — `fire_panel` gets same `WorldEffect spawn:fire` → renderer creates/shows the particle group, `despawn` or `fail_equipment` swaps it.

If you must ship fire as .glb: export only a distorted flame proxy with unlit emissive material and drive opacity via material in `tierA.ts#effect` — but particles are lighter and better.

---

## Fastest workflow that stays realistic & light

### 1. Blender (recommended — 60-90 min for all 9, production-clean)

AI text-to-3D (Meshy, Luma Genie, Sloyd) is **not** recommended for this brief: topology is triangulated soup, scale is random, origin is bounding-box centre, PBR bakes are 2-4K, and the three extinguishers will not be distinguishable without manual repaint. Use AI only for concept reference, not final .glb.

Free libraries (Sketchfab CC0, Poly Haven, Kenney.nl) are good for **kitbashing**: grab one clean extinguisher hull, one electrical cabinet, retopo to <8k, rescale, repaint. Do not use as-is — most are 20-60k tris, 2 materials, 4K textures.

**Blender steps per asset (single material, ≤8k, 1024, Draco optional):**

1. `Scene Properties → Units: Metric, Scale 1.0` — +Y up is Blender default; keep it.
2. Model low-poly: extinguisher = 16-sided cylinder + simple cap/hose/gauge (keep hose as extruded curve, not tube mesh); panel = box with inset door (bevel modifier 2 segments); SCSR = rounded box; arrow = extruded 2D arrow shape; colleague = capsule (low poly).
3. **Pivot:** `Object → Set Origin → Origin to Geometry` then `G Z` to base or back-face:
   - extinguishers & SCSR: origin at **base centre** (`G Z -h/2` then `Apply → Origin to 3D Cursor` at world 0)
   - panel: origin at **back face centre** (`G Z -d/2`)
   - arrow: origin at **tail centre**, arrow points along **+Z** (model along +Z axis in Blender)
   - markers: origin at base centre
   - colleague: origin at ground contact (lay along +Z, origin at chest base)
4. **Material:** one `Principled BSDF` per asset, `Roughness 0.65 Metallic 0.1` for paint, `0.3/0.7` for metal panel. Bake AO + baseColor to single `1024×1024` PNG ( `Render → Bake → Ambient Occlusion` → combine in `Shader Editor` → `Image Texture` → save). No more than one image per .glb.
5. **Check tris:** `Overlays → Statistics` — keep `<8k`. Decimate modifier if over.
6. **Export:** `File → Export → glTF 2.0 (.glb)`:
   - ✓ `Apply Modifiers`, `+Y Up`, `Transform: +Y Up`
   - ✓ `Compression: Draco` (ratio ~3:1, three.js `DRACOLoader` already handles it — if you skip Draco, still <8k is fine)
   - ✗ `Cameras`, `Punctual Lights`
   - Textures `Automatic` → packs 1024 into .glb
7. **Re-import** the .glb in fresh Blender file to verify pivot/scale before handing over.

### 2. Distinguish the three extinguishers — instantly

| Asset | Colour (Indian code) | Shape cue | Label |
|-------|----------------------|-----------|-------|
| `ext_dcp.glb` | body **signal red** + horizontal **deep blue band** (DCP) | short + squat, pressure gauge on top | `DCP` + `BC Powder` |
| `ext_water.glb` | **solid red** (all red) | taller/narrower, plain cylindrical | `WATER` |
| `ext_co2.glb` | **matte black** | **huge black conical horn** — horn is the tell, 0.25m long | `CO₂` |

In Tier A they sit at `anchors.ext_slot_{left,mid,right}` `[-1,0,-1]` / `[0,0,-1]` / `[1,0,-1]` — `params.ext_layout` shuffles which slot holds which. Horn must be visible at 2m AR distance.

### 3. Keep them realistic but light — rules

- No ngons, no subdivision surface — start low, stay low.
- One material per file — merge by `Ctrl+J` then `Material → Merge`.
- No web fonts, no 4K — bake AO shadows into baseColor, keep single 1024.
- No animation in .glb — AR placement + `spawn/despawn` handles visibility; fire flicker is shader, not skeleton.
- Scale in **metres** — ext `0.55m tall`, panel `1.0m tall` — measure with `N` panel → `Dimensions`.

### 4. Test each .glb (required)

- In **https://gltf-viewer.donmccurdy.com/** or **https://sandbox.babylonjs.com/** — drag .glb, check:
  - Scale looks right vs 1m grid (panel ≈ 1m)
  - +Y up (arrow points +Z, not -Z)
  - Pivot at base/back (drag origin gizmo)
  - Single material, <8k tris (Stats panel)
- Also `npx gltf-validator public/assets/<name>.glb` if you have it — should be 0 errors.

### 5. Current placeholders in this repo

- Generated by `tools/make_placeholders.mjs` — each is 24 verts / 12 tris, correct `size` & `pivotOffset`, single material, no textures. Search-replace them:
  ```
  node tools/make_placeholders.mjs   # regenerates public/assets/*.glb
  ```
  Then in Blender: `Import → glTF` one placeholder, model over it keeping origin at `(0,0,0)`, re-export same filename.

### 6. How Tier A uses them (when you wire GLTFLoader)

Current `src/app/render/tierA.ts` uses `geometryFor(kind)` primitives + canvas labels + `Slot` arc. To load real .glb:

```ts
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
const draco = new DRACOLoader(); draco.setDecoderPath('/draco/');
const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
// in #build(prop): loader.load(`/assets/${prop.id}.glb`, gltf => root.add(gltf.scene))
```

Keep `labelTexture` sprite — real geometry + canvas label reads in AR. `fire_panel` is **not** loaded this way — create `Points` fire there.

---

**Do not push to GitHub** — assets stay local under `public/assets/` until L.A.R.P signs off. `docs/fire_explosion_v1.spec.json` is the frozen spec; `src/scenarios/fire-explosion.json` is the engine-valid drill derived from it.
