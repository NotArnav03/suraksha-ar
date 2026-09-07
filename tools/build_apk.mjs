#!/usr/bin/env node
// Generates and builds the Android APK: a Trusted Web Activity wrapping the
// deployed PWA, via @bubblewrap/core directly rather than the interactive
// `bubblewrap init` wizard — this needs to run unattended (CI, or a teammate
// who has never touched Bubblewrap before), so every answer that wizard would
// ask for is a fixed choice below instead.
//
// A TWA (not a Capacitor/Cordova WebView wrapper) is the right shape here
// specifically because it launches the installed system Chrome to render the
// page: WebXR immersive-ar only works in real Chrome for Android, not in a
// generic WebView.
//
// Prerequisites (see docs/APK.md): a JDK 17 and the Android SDK build-tools,
// both already configured once via `~/.bubblewrap/config.json` (see the repo
// README for how that file is created — it's machine-local, never committed).
//
// Run: node tools/build_apk.mjs
// Then: cd android && npx bubblewrap build
//   (BUBBLEWRAP_KEYSTORE_PASSWORD / BUBBLEWRAP_KEY_PASSWORD are printed below
//   on first run and must be exported before that build step.)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { Config, ConsoleLog, JdkHelper, KeyTool, TwaGenerator, TwaManifest } from '@bubblewrap/core';

const MANIFEST_URL = process.env.PWA_MANIFEST_URL ?? 'https://notarnav03.github.io/suraksha-ar/manifest.webmanifest';
const TARGET_DIR = join(process.cwd(), 'android');
const PACKAGE_ID = 'com.suraksha.ar';
const KEY_ALIAS = 'suraksha';

async function main() {
  await mkdir(TARGET_DIR, { recursive: true });

  console.log(`Fetching ${MANIFEST_URL} ...`);
  const twaManifest = await TwaManifest.fromWebManifest(MANIFEST_URL);

  twaManifest.packageId = PACKAGE_ID;
  twaManifest.launcherName = 'Suraksha AR'; // <=12 chars, the launcher-icon label limit
  twaManifest.generatorApp = 'suraksha-ar-build-apk';
  twaManifest.signingKey = { path: join(TARGET_DIR, 'android.keystore'), alias: KEY_ALIAS };

  const manifestPath = join(TARGET_DIR, 'twa-manifest.json');
  await twaManifest.saveToFile(manifestPath);
  console.log(`Wrote ${manifestPath}`);
  console.log(`  host: ${twaManifest.host}`);
  console.log(`  startUrl: ${twaManifest.startUrl}`);
  console.log(`  packageId: ${twaManifest.packageId}`);

  console.log('Generating the Android Studio project (this fetches launcher icon assets) ...');
  const generator = new TwaGenerator();
  await generator.createTwaProject(TARGET_DIR, twaManifest, new ConsoleLog('generate'), () => {});

  // Mirrors `generateManifestChecksumFile` in bubblewrap's own CLI: `build`
  // only re-runs the (interactive) project-update step when this is missing
  // or stale, so writing it now is what keeps the actual build step below
  // fully unattended.
  const manifestContents = await readFile(manifestPath);
  const checksum = createHash('sha1').update(manifestContents).digest('hex');
  await writeFile(join(TARGET_DIR, 'manifest-checksum.txt'), checksum);

  const configPath = join(homedir(), '.bubblewrap', 'config.json');
  const config = await Config.loadConfig(configPath);
  if (!config) {
    throw new Error(
      `No Bubblewrap config at ${configPath} - run 'npx bubblewrap doctor' once interactively first ` +
        `(or write {"jdkPath":"...","androidSdkPath":"..."} by hand) so this script knows where the JDK and Android SDK are.`,
    );
  }

  if (existsSync(twaManifest.signingKey.path)) {
    console.log(`Signing key already exists at ${twaManifest.signingKey.path} - not overwriting.`);
    console.log('If BUBBLEWRAP_KEYSTORE_PASSWORD / BUBBLEWRAP_KEY_PASSWORD are not still set in your');
    console.log('shell from when that key was created, `bubblewrap build` will prompt for them.');
  } else {
    const keystorePassword = randomBytes(12).toString('base64url');
    const keyPassword = keystorePassword; // one secret to track, not two
    const jdkHelper = new JdkHelper(process, config);
    const keyTool = new KeyTool(jdkHelper);
    console.log('Generating a signing key (self-signed, for this build only - not a Play Store key) ...');
    await keyTool.createSigningKey({
      path: twaManifest.signingKey.path,
      alias: KEY_ALIAS,
      password: keystorePassword,
      keypassword: keyPassword,
      fullName: 'Suraksha AR',
      organizationalUnit: 'Engineering',
      organization: 'Suraksha AR - SIH26041',
      country: 'IN',
    });
    console.log('\nSigning key created. This password is NOT saved anywhere - copy it now:');
    console.log(`  BUBBLEWRAP_KEYSTORE_PASSWORD=${keystorePassword}`);
    console.log(`  BUBBLEWRAP_KEY_PASSWORD=${keyPassword}`);
    console.log('\nExport both, then run the actual build:');
    console.log('  cd android && npx bubblewrap build');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
