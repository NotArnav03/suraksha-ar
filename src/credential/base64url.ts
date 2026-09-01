/**
 * base64url over raw bytes.
 *
 * Hand-rolled rather than reaching for Buffer, because this exact module has to
 * run unchanged in the supervisor's browser at the pit gate — the verifier is
 * the half of this system that must never depend on Node.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function toBase64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += ALPHABET[c & 0x3f];
  }
  return out;
}

export function fromBase64url(text: string): Uint8Array {
  const clean = text.trim();
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let length = 0;
  let accumulator = 0;
  let bits = 0;

  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const value = code < 128 ? LOOKUP[code]! : -1;
    if (value < 0) throw new Error(`invalid base64url character at index ${i}`);
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[length++] = (accumulator >> bits) & 0xff;
    }
  }
  return bytes.subarray(0, length);
}
