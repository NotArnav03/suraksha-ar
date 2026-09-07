# Building the Android APK

The APK is a **Trusted Web Activity (TWA)**, not a Capacitor/Cordova WebView
wrapper — that choice isn't cosmetic. WebXR `immersive-ar` only works in real
Chrome for Android; a generic WebView does not implement it. A TWA launches
the installed system Chrome in a chrome-less activity, so Tier A gets exactly
the same WebXR support it has in the browser. This also means: **the app
needs a real, live HTTPS URL to wrap** — it isn't a local file build. That's
`https://notarnav03.github.io/suraksha-ar/`, deployed automatically by
`.github/workflows/deploy-pages.yml` on every push to `main`.

## One-time machine setup

1. **JDK 17** and the **Android SDK** (`build-tools`, `platform-tools`,
   `cmdline-tools;latest`), both already present if you've ever used
   `tools/phone.mjs` or Android Studio on this machine.
2. Tell Bubblewrap where they are, once, so it never runs its interactive
   setup wizard: create `~/.bubblewrap/config.json` (Windows:
   `C:\Users\<you>\.bubblewrap\config.json`) —
   ```json
   { "jdkPath": "<path to JDK 17>", "androidSdkPath": "<path to Android SDK>" }
   ```
3. **Windows only:** the Android SDK's `cmdline-tools`-only layout isn't
   recognised by Bubblewrap's older SDK-path check, which still looks for a
   `tools/` or `bin/` folder at the SDK root. Fix once, per machine:
   ```powershell
   New-Item -ItemType Junction -Path "<sdk>\tools" -Target "<sdk>\cmdline-tools\latest"
   ```
4. **Windows only:** `node tools/patch_bubblewrap_windows.mjs` — see
   [Windows-specific bugs](#windows-specific-bugs-fixed-by-toolspatch_bubblewrap_windowsmjs)
   below. Node.js wipes this every `npm install`, so re-run it after every
   fresh install, before building.

## Building

```bash
npm run apk:init     # generates android/ from the live PWA manifest, creates a signing key
```

This prints two passwords the first time it creates a signing key — copy them,
they are **not saved anywhere**:

```bash
export BUBBLEWRAP_KEYSTORE_PASSWORD=...
export BUBBLEWRAP_KEY_PASSWORD=...
npm run apk:build
```

Output: `android/app-release-signed.apk` and `android/app-release-bundle.aab`.
Both are real, installable, signed artifacts — verified against
`aapt2 dump badging` (package id, version, label) and
`aapt2 dump resources` (the embedded `hostName`/`launchUrl` actually point at
the live Pages URL), not just "the build didn't error."

`android/` is gitignored — it's fully regenerated from `twa-manifest.json`
plus the live manifest, and its keystore is a secret that must never be
committed. Re-running `npm run apk:init` reuses an existing keystore rather
than overwriting it.

## Digital Asset Link verification (the URL bar)

Without it, the installed app opens as a Chrome Custom Tab with a visible URL
bar. With it, Chrome verifies the APK's signature against a file the *origin*
serves and drops the URL bar entirely, so the wrapped app looks native.

That file has to live at `https://<host>/.well-known/assetlinks.json` — at
the domain **root**, always, regardless of where the app itself is scoped.
`public/.well-known/assetlinks.json` in this repo (deployed with everything
else) lands at `notarnav03.github.io/suraksha-ar/.well-known/...`, which is
the wrong place — GitHub Pages project sites can't serve anything at the
account's actual root from this repo. The fingerprint is already generated
(`keytool -list -v -keystore android/android.keystore -alias suraksha`) and
the file is ready; it just needs to also be published at
`notarnav03.github.io/.well-known/assetlinks.json`, which lives in the
separate `NotArnav03/NotArnav03.github.io` repo. That's a deliberate,
un-taken step — ask before touching a different repo.

## Windows-specific bugs (fixed by `tools/patch_bubblewrap_windows.mjs`)

Both reproduced directly against `cmd.exe`, independent of any bubblewrap
version — `execFile(cmd, args, {shell:true})` joins `cmd` and `args` into one
string for `cmd.exe` without quoting `cmd` itself:

- `GradleWrapper` invokes a bare `gradlew.bat` (no path qualifier) — that
  fails to resolve under `cmd /d /s /c` on this Node/Windows combination.
  `.\gradlew.bat` resolves correctly.
- `JdkHelper.runJava` (used for `apksigner`) invokes an absolute path to
  `java.exe` — anything under `Program Files` contains a space, so `cmd.exe`
  splits it at the space and reports `'C:\Program' is not recognized`.
  Quoting the path when it contains a space fixes it.

Both live in `node_modules`, so they don't survive `npm install` — that's
exactly why `patch_bubblewrap_windows.mjs` exists as a separate, idempotent
step rather than a one-off manual edit.
