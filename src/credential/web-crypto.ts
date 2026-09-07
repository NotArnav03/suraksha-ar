import { fromBase64url } from './base64url.ts';
import type { Signer, SignatureVerifier } from './credential.ts';
import { DEMO_KEY_ID, DEMO_PRIVATE_KEY_PKCS8, DEMO_PUBLIC_KEY_SPKI } from './demo-trust.ts';

/**
 * The browser half of the credential.
 *
 * This is the file that has to work at the pit gate: a supervisor's phone, no
 * network, a scanned string and a bundled trust list. It shares `codec.ts` and
 * `credential.ts` with the Node issuer, so the two ends cannot drift apart —
 * only the key handling differs, and P-256 with IEEE P1363 signatures is what
 * WebCrypto produces natively, so there is no conversion shim to get wrong.
 */

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

function keyMaterial(spkiBase64: string): ArrayBuffer {
  const bytes = fromBase64url(spkiBase64);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Verification only. This is the capability a supervisor's device should have —
 * it can check a credential and can never mint one.
 */
export function webVerifier(trustList: Record<number, string>): SignatureVerifier {
  const imported = new Map<number, Promise<CryptoKey>>();
  for (const [keyId, spki] of Object.entries(trustList)) {
    imported.set(
      Number(keyId),
      crypto.subtle.importKey('spki', keyMaterial(spki), ALGORITHM, false, ['verify']),
    );
  }

  return {
    knows: (keyId) => imported.has(keyId),
    async verify(keyId, data, signature): Promise<boolean> {
      const pending = imported.get(keyId);
      if (!pending) return false;
      try {
        const key = await pending;
        return await crypto.subtle.verify(SIGN_PARAMS, key, signature as BufferSource, data as BufferSource);
      } catch {
        return false;
      }
    },
  };
}

export interface DemoIssuer {
  signer: Signer;
  keyId: number;
  publicKeySpki: string;
}

/**
 * An in-browser issuer, for the demo only.
 *
 * Real issuance belongs on a server with a managed keystore: a device that can
 * sign its own credentials can award itself competence, which is precisely the
 * failure this whole project exists to fix. Kept here so the end-to-end loop is
 * visible without standing up a backend, and named so it cannot be mistaken for
 * the real thing.
 *
 * Signs with the fixed key in `demo-trust.ts`, not a fresh random one — see
 * that file for why: a random per-session key meant no other device (the
 * admin dashboard, a supervisor's phone, even the same browser reopened)
 * could ever verify what this issued.
 */
export async function createDemoIssuer(): Promise<DemoIssuer> {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    keyMaterial(DEMO_PRIVATE_KEY_PKCS8),
    ALGORITHM,
    false,
    ['sign'],
  );

  return {
    keyId: DEMO_KEY_ID,
    publicKeySpki: DEMO_PUBLIC_KEY_SPKI,
    signer: {
      keyId: DEMO_KEY_ID,
      async sign(data: Uint8Array): Promise<Uint8Array> {
        const signature = await crypto.subtle.sign(SIGN_PARAMS, privateKey, data as BufferSource);
        return new Uint8Array(signature);
      },
    },
  };
}
