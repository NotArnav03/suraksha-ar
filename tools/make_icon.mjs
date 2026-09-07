#!/usr/bin/env node
// Generates the PWA/APK app icons as plain PNGs — no image library, so this
// runs anywhere Node runs, offline, with nothing to `npm install`.
// Draws a white checkmark (the certification mark) on the app's ink-green.
// Run: node tools/make_icon.mjs

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'public/icons';
mkdirSync(OUT, { recursive: true });

const BG = [15, 61, 41, 255]; // #0f3d29 — dark safety green, matches the app's ink tone
const FG = [255, 255, 255, 255];

// ── minimal PNG encoder (RGBA8, no interlace, filter-none per scanline) ─────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter type: None
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── drawing ───────────────────────────────────────────────────────────────

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq));
  const cx = ax + t * abx, cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

/** @param safeZone 1.0 = checkmark fills the full square; <1 shrinks it toward centre for maskable icons */
function draw(size, safeZone) {
  const buf = Buffer.alloc(size * size * 4);
  const strokeW = size * 0.11 * safeZone;
  const scale = (v) => 0.5 + (v - 0.5) * safeZone;
  // classic checkmark, normalised [0,1] coords, scaled toward centre for the safe zone
  const ax = scale(0.24) * size, ay = scale(0.53) * size;
  const bx = scale(0.42) * size, by = scale(0.72) * size;
  const cx = scale(0.78) * size, cy = scale(0.28) * size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.min(
        distToSegment(x + 0.5, y + 0.5, ax, ay, bx, by),
        distToSegment(x + 0.5, y + 0.5, bx, by, cx, cy),
      );
      const on = d <= strokeW / 2;
      const i = (y * size + x) * 4;
      const [r, g, b, a] = on ? FG : BG;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
    }
  }
  return buf;
}

for (const [name, size, safeZone] of [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-512-maskable.png', 512, 0.72],
]) {
  const png = encodePng(size, size, draw(size, safeZone));
  writeFileSync(`${OUT}/${name}`, png);
  console.log(`wrote ${OUT}/${name} (${png.length} bytes)`);
}
