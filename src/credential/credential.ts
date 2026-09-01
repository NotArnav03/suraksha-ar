import type { Certification } from '../assess/certify.ts';
import { hashString } from '../engine/rng.ts';
import type { Dimension } from '../engine/types.ts';
import {
  DOMAIN_CODES,
  DOMAIN_NAMES,
  FLAG_PRACTICAL_SIGNED,
  FLAG_PROVISIONAL,
  FORMAT_VERSION,
  decodePayload,
  deserialize,
  encodePayload,
  serialize,
  type CredentialPayload,
} from './codec.ts';

/**
 * Issue and verify.
 *
 * Crypto is injected rather than imported. The issuer runs on a server with a
 * Node keystore; the verifier runs in a supervisor's browser at the pit gate
 * with WebCrypto and no network. Both drive this same module, which is the only
 * way the two halves stay honest about agreeing on the format.
 */

export interface Signer {
  keyId: number;
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export interface SignatureVerifier {
  /** false when the signature fails, and when the key id is not in the trust list */
  verify(keyId: number, data: Uint8Array, signature: Uint8Array): Promise<boolean>;
  knows(keyId: number): boolean;
}

export interface IssueOptions {
  /** the worker id already printed on their card — no name, no biometric */
  subjectId: string;
  domain: string;
  /** short by design: an offline verifier cannot check a revocation list */
  validForDays?: number;
  practicalSignedOff?: boolean;
  provisional?: boolean;
  now?: Date;
}

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialError';
  }
}

const MINUTE = 60_000;

function digestOf(variantId: string): number {
  return parseInt(hashString(variantId), 16) >>> 0;
}

export async function issueCredential(
  certification: Certification,
  options: IssueOptions,
  signer: Signer,
): Promise<{ text: string; payload: CredentialPayload; bytes: number }> {
  // The issuer is not a place to be lenient. A credential that can be minted for
  // an ungranted certification is worth exactly as much as the paper one.
  if (!certification.granted) {
    throw new CredentialError(
      `refusing to issue: certification not granted (${certification.reasons.join('; ')})`,
    );
  }

  const domainCode = DOMAIN_CODES[options.domain];
  if (domainCode === undefined) {
    throw new CredentialError(`unknown domain "${options.domain}"`);
  }

  const now = options.now ?? new Date();
  const issuedAtMinutes = Math.floor(now.getTime() / MINUTE);
  const validForDays = options.validForDays ?? 180;

  const scores = certification.vector
    .filter((d): d is typeof d & { worst: number } => d.worst !== null)
    .map((d) => ({ dimension: d.dimension as Dimension, score: d.worst }));

  const payload: CredentialPayload = {
    version: FORMAT_VERSION,
    flags:
      (options.provisional ? FLAG_PROVISIONAL : 0) |
      (options.practicalSignedOff ? FLAG_PRACTICAL_SIGNED : 0),
    keyId: signer.keyId,
    issuedAtMinutes,
    expiresAtMinutes: issuedAtMinutes + validForDays * 24 * 60,
    subjectId: options.subjectId,
    domainCode,
    // the credential carries the worst attempt, not the mean: a safety
    // credential should be worth what the holder can do on their bad day
    scores,
    variantDigests: certification.countedVariantIds.map(digestOf),
  };

  const bytes = encodePayload(payload);
  const signature = await signer.sign(bytes);
  return { text: serialize(bytes, signature), payload, bytes: bytes.length };
}

export interface VerifiedCredential {
  valid: true;
  subjectId: string;
  domain: string;
  scores: { dimension: Dimension; score: number }[];
  variantsPassed: number;
  variantDigests: number[];
  issuedAt: Date;
  expiresAt: Date;
  provisional: boolean;
  practicalSignedOff: boolean;
  /** things a supervisor should be told but which do not invalidate the proof */
  warnings: string[];
}

export interface RejectedCredential {
  valid: false;
  reason: string;
  /** decoded but NOT trusted — never render this to a supervisor as fact */
  untrustedPayload?: CredentialPayload;
}

export type VerificationResult = VerifiedCredential | RejectedCredential;

export async function verifyCredential(
  text: string,
  verifier: SignatureVerifier,
  options: { now?: Date } = {},
): Promise<VerificationResult> {
  let payload: Uint8Array;
  let signature: Uint8Array;
  try {
    ({ payload, signature } = deserialize(text));
  } catch (error) {
    return { valid: false, reason: (error as Error).message };
  }

  let decoded: CredentialPayload;
  try {
    decoded = decodePayload(payload);
  } catch (error) {
    return { valid: false, reason: (error as Error).message };
  }

  if (!verifier.knows(decoded.keyId)) {
    return {
      valid: false,
      reason: `issuer key ${decoded.keyId} is not in this device's trust list`,
      untrustedPayload: decoded,
    };
  }

  const signatureOk = await verifier.verify(decoded.keyId, payload, signature);
  if (!signatureOk) {
    return { valid: false, reason: 'signature does not verify', untrustedPayload: decoded };
  }

  const now = options.now ?? new Date();
  const issuedAt = new Date(decoded.issuedAtMinutes * MINUTE);
  const expiresAt = new Date(decoded.expiresAtMinutes * MINUTE);

  if (now > expiresAt) {
    return {
      valid: false,
      reason: `expired on ${expiresAt.toISOString().slice(0, 10)}`,
      untrustedPayload: decoded,
    };
  }

  const warnings: string[] = [];
  if (now < issuedAt) {
    // Offline verification trusts the scanning device's clock. A credential from
    // the future usually means the clock is wrong, not that the proof is forged.
    warnings.push('issued in the future — check this device\'s clock');
  }
  const daysLeft = Math.floor((expiresAt.getTime() - now.getTime()) / (24 * 60 * MINUTE));
  if (daysLeft <= 30) warnings.push(`expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`);
  if ((decoded.flags & FLAG_PRACTICAL_SIGNED) === 0) {
    warnings.push('supervised live practical not signed off');
  }
  warnings.push('offline check — revocation since issue cannot be seen here');

  return {
    valid: true,
    subjectId: decoded.subjectId,
    domain: DOMAIN_NAMES[decoded.domainCode] ?? `unknown domain ${decoded.domainCode}`,
    scores: decoded.scores,
    variantsPassed: decoded.variantDigests.length,
    variantDigests: decoded.variantDigests,
    issuedAt,
    expiresAt,
    provisional: (decoded.flags & FLAG_PROVISIONAL) !== 0,
    practicalSignedOff: (decoded.flags & FLAG_PRACTICAL_SIGNED) !== 0,
    warnings,
  };
}
