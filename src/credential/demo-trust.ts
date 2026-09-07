/**
 * The demo issuer's key — fixed, not random, and public on purpose.
 *
 * `createDemoIssuer()` used to generate a fresh ECDSA keypair every single
 * session. That was fine as long as nothing outside the tab that issued a
 * credential ever needed to check it — but it means no two devices, and no
 * two sessions on the *same* device, could ever verify each other's
 * credentials. The admin dashboard exists specifically to check credentials
 * issued on other people's phones, so that stopped being viable the moment
 * the dashboard needed real data instead of a mock.
 *
 * This key does not change that security story, it just makes the existing
 * one consistent. Issuing has always happened in the browser here — see
 * `README.md`'s "Known gaps" — which already means anyone can mint their own
 * "valid" credential; a fixed embedded key changes nothing about that. What
 * it buys is a shared trust anchor so `verifyCredential` on a *different*
 * device, not just the one that issued it, can actually check a scan.
 *
 * Real issuance moves this key to a server-side keystore that never ships to
 * a client at all. Until then: never treat a credential signed by this key
 * as proof of anything beyond "the demo app validated this worker's drill
 * performance" — which is exactly what it is.
 */
export const DEMO_KEY_ID = 26820;

/** SPKI, base64 — what both `webVerifier` and `nodeVerifier` expect. */
export const DEMO_PUBLIC_KEY_SPKI =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDtkpgD+GerBQtM9Ljs7WePaYVzN1uLxmCtlBfTqV5ByZABrb08VPErOhieF6/xv6wprUfj+XJ+e4tF3ajZcM6w==';

/** PKCS8, base64 — what WebCrypto's `importKey('pkcs8', ...)` expects. Demo-only: see the module comment. */
export const DEMO_PRIVATE_KEY_PKCS8 =
  'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg0fE+otDpuDn6G+2+Oej0ZgeVoCxxuXZI2jm9ifTXfs6hRANCAAQO2SmAP4Z6sFC0z0uOztZ49phXM3W4vGYK2UF9OpXkHJkAGtvTxU8Ss6GJ4Xr/G/rCmtR+P5cn57i0XdqNlwzr';

/** The trust list both the worker app and the admin dashboard verify against. */
export const DEMO_TRUST_LIST: Record<number, string> = {
  [DEMO_KEY_ID]: DEMO_PUBLIC_KEY_SPKI,
};
