import { DIMENSIONS, type Dimension } from '../engine/types.ts';
import { fromBase64url, toBase64url } from './base64url.ts';

/**
 * Compact credential codec.
 *
 * The constraint that shapes everything here is physical: a supervisor has to
 * scan this off a cracked phone screen, outdoors, in a coal yard, on a handset
 * that is not new. A JSON-LD verifiable credential is a few kilobytes, which is
 * a QR so dense it stops scanning under those conditions. So the wire format is
 * packed binary — roughly 90 bytes, a QR small enough to read at arm's length —
 * and the verbose representation is reconstructed by the verifier from fields it
 * already holds.
 *
 * Nothing here is personal beyond the worker id already printed on their card.
 * No name, no biometric, no photograph: the QR carries the proof, and the person
 * it belongs to is matched against the card in their hand.
 */

export const FORMAT = 'SRK1';
export const FORMAT_VERSION = 1;

/**
 * Domain codes are a wire enum: append only, never renumber. A code that
 * changes meaning silently reinterprets every credential already in circulation.
 */
export const DOMAIN_CODES: Record<string, number> = {
  fire_explosion: 1,
  gas_leak_confined_space: 2,
  ground_control_and_height: 3,
  machinery_haulage_loto: 4,
  electrical_ppe_emergency: 5,
};

export const DOMAIN_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(DOMAIN_CODES).map(([name, code]) => [code, name]),
);

export const FLAG_PROVISIONAL = 1 << 0;
/** a certified instructor has signed off the live practical for this domain */
export const FLAG_PRACTICAL_SIGNED = 1 << 1;

export interface CredentialPayload {
  version: number;
  flags: number;
  keyId: number;
  /** unix minutes — a second's precision is not worth two bytes here */
  issuedAtMinutes: number;
  expiresAtMinutes: number;
  /** the worker id already on their card; ASCII, at most 32 characters */
  subjectId: string;
  domainCode: number;
  scores: { dimension: Dimension; score: number }[];
  /** 32-bit digests of the variantIds actually passed — an auditor replays them */
  variantDigests: number[];
}

export class CredentialFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialFormatError';
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CredentialFormatError(message);
}

export function encodePayload(payload: CredentialPayload): Uint8Array {
  const subject = new TextEncoder().encode(payload.subjectId);
  assert(subject.length <= 32, `subjectId is ${subject.length} bytes, limit is 32`);
  assert(payload.scores.length <= 255, 'too many dimensions');
  assert(payload.variantDigests.length <= 255, 'too many variants');

  const size = 13 + subject.length + 2 + payload.scores.length * 2 + 1 + payload.variantDigests.length * 4;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let offset = 0;

  bytes[offset++] = payload.version;
  bytes[offset++] = payload.flags;
  view.setUint16(offset, payload.keyId);
  offset += 2;
  view.setUint32(offset, payload.issuedAtMinutes);
  offset += 4;
  view.setUint32(offset, payload.expiresAtMinutes);
  offset += 4;

  bytes[offset++] = subject.length;
  bytes.set(subject, offset);
  offset += subject.length;

  bytes[offset++] = payload.domainCode;
  bytes[offset++] = payload.scores.length;
  for (const { dimension, score } of payload.scores) {
    const index = DIMENSIONS.indexOf(dimension);
    assert(index >= 0, `unknown dimension "${dimension}"`);
    assert(score >= 0 && score <= 100, `score ${score} out of range`);
    bytes[offset++] = index;
    bytes[offset++] = score;
  }

  bytes[offset++] = payload.variantDigests.length;
  for (const digest of payload.variantDigests) {
    view.setUint32(offset, digest >>> 0);
    offset += 4;
  }

  return bytes;
}

export function decodePayload(bytes: Uint8Array): CredentialPayload {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const need = (count: number, what: string) =>
    assert(offset + count <= bytes.length, `truncated credential: expected ${what}`);

  need(13, 'header');
  const version = bytes[offset++]!;
  assert(version === FORMAT_VERSION, `unsupported credential version ${version}`);
  const flags = bytes[offset++]!;
  const keyId = view.getUint16(offset);
  offset += 2;
  const issuedAtMinutes = view.getUint32(offset);
  offset += 4;
  const expiresAtMinutes = view.getUint32(offset);
  offset += 4;

  const subjectLength = bytes[offset++]!;
  need(subjectLength, 'subject id');
  const subjectId = new TextDecoder().decode(bytes.subarray(offset, offset + subjectLength));
  offset += subjectLength;

  need(2, 'domain and score count');
  const domainCode = bytes[offset++]!;
  const scoreCount = bytes[offset++]!;

  need(scoreCount * 2, 'scores');
  const scores: CredentialPayload['scores'] = [];
  for (let i = 0; i < scoreCount; i++) {
    const index = bytes[offset++]!;
    const score = bytes[offset++]!;
    const dimension = DIMENSIONS[index];
    assert(dimension !== undefined, `unknown dimension index ${index}`);
    scores.push({ dimension, score });
  }

  need(1, 'variant count');
  const variantCount = bytes[offset++]!;
  need(variantCount * 4, 'variant digests');
  const variantDigests: number[] = [];
  for (let i = 0; i < variantCount; i++) {
    variantDigests.push(view.getUint32(offset));
    offset += 4;
  }

  return {
    version,
    flags,
    keyId,
    issuedAtMinutes,
    expiresAtMinutes,
    subjectId,
    domainCode,
    scores,
    variantDigests,
  };
}

/** `SRK1.<payload>.<signature>` — the exact string the QR carries. */
export function serialize(payload: Uint8Array, signature: Uint8Array): string {
  return `${FORMAT}.${toBase64url(payload)}.${toBase64url(signature)}`;
}

export function deserialize(text: string): { payload: Uint8Array; signature: Uint8Array } {
  const parts = text.trim().split('.');
  assert(parts.length === 3, 'a credential has three dot-separated parts');
  assert(parts[0] === FORMAT, `unrecognised format tag "${parts[0]}"`);
  return { payload: fromBase64url(parts[1]!), signature: fromBase64url(parts[2]!) };
}

/**
 * Smallest QR version that holds `length` bytes at error-correction level M.
 * Level M is the right trade here: enough redundancy to survive a scratched
 * screen, not so much that the modules shrink below what a cheap camera resolves.
 */
const QR_BYTE_CAPACITY_M: [version: number, bytes: number][] = [
  [1, 14], [2, 26], [3, 42], [4, 62], [5, 84], [6, 106], [7, 122], [8, 152],
  [9, 180], [10, 213], [11, 251], [12, 287], [13, 331], [14, 362], [15, 412],
  [16, 450], [17, 504], [18, 560], [19, 624], [20, 666],
];

export function qrVersionFor(length: number): number | null {
  for (const [version, capacity] of QR_BYTE_CAPACITY_M) {
    if (length <= capacity) return version;
  }
  return null;
}
