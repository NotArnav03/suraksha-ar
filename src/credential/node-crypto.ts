import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { Signer, SignatureVerifier } from './credential.ts';

/**
 * ECDSA P-256 over SHA-256, raw IEEE P1363 signatures.
 *
 * Ed25519 would be the nicer curve. It is not the right one here: the verifier
 * is a supervisor's browser at a pit gate, often an older mid-range Android,
 * and P-256 has been in WebCrypto everywhere for a decade while Ed25519 arrived
 * only recently. The signature is 64 bytes either way, and IEEE P1363 is exactly
 * the encoding WebCrypto produces and consumes — so the browser verifier needs
 * no conversion shim.
 */

export interface IssuerKey {
  keyId: number;
  privateKeyPem: string;
  /** SPKI DER, base64 — the form WebCrypto's importKey('spki', ...) takes */
  publicKeySpki: string;
}

/** Key ids are the first two bytes of the public key's digest: stable, no registry. */
export function keyIdFor(publicKeySpki: string): number {
  const digest = createHash('sha256').update(publicKeySpki, 'base64').digest();
  return (digest[0]! << 8) | digest[1]!;
}

export function generateIssuerKey(): IssuerKey {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeySpki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return {
    keyId: keyIdFor(publicKeySpki),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeySpki,
  };
}

export function nodeSigner(key: IssuerKey): Signer {
  const privateKey = createPrivateKey(key.privateKeyPem);
  return {
    keyId: key.keyId,
    async sign(data: Uint8Array): Promise<Uint8Array> {
      return new Uint8Array(sign('sha256', data, { key: privateKey, dsaEncoding: 'ieee-p1363' }));
    },
  };
}

/**
 * The trust list is what makes offline verification possible: the verifying
 * device carries the issuers' public keys and needs nothing from the network.
 * Its flip side is that revocation cannot be seen offline, which is why
 * credentials are issued short and the list is refreshed when a device syncs.
 */
export function nodeVerifier(trustList: Record<number, string>): SignatureVerifier {
  const keys = new Map(
    Object.entries(trustList).map(([keyId, spki]) => [
      Number(keyId),
      createPublicKey({
        key: Buffer.from(spki, 'base64'),
        format: 'der',
        type: 'spki',
      }),
    ]),
  );

  return {
    knows: (keyId) => keys.has(keyId),
    async verify(keyId, data, signature): Promise<boolean> {
      const key = keys.get(keyId);
      if (!key) return false;
      try {
        return verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, signature);
      } catch {
        return false;
      }
    },
  };
}
