import { defineConfig } from 'vite';

export default defineConfig({
  // The engine, assessment and credential all live outside the app directory
  // and are imported directly — there is no separate build of the core, so the
  // web client and the Node CLI can never be running different logic.
  build: { target: 'es2022', outDir: 'dist' },
  // Relative, not '/': this build has to work identically whether it's served
  // from a domain root or a subpath (a GitHub Pages project site is exactly
  // that), and a relative base makes the same `dist/` artifact correct in
  // both without a second build. The manifest, service worker and its shell
  // list all made the matching relative-path choice for the same reason.
  base: './',
  server: {
    // Tier A needs WebXR, which needs a secure context. Binding to the LAN so a
    // phone can reach the dev server is the whole point of testing this on real
    // hardware, so the host has to be open.
    host: true,
    // Fixed, and refuses to drift. `adb reverse` (see tools/phone.mjs) pins one
    // port on the phone to one port here; if Vite quietly moved to the next
    // free port because something else held this one, the phone would sit on a
    // dead tunnel with no indication why. Failing to start is the honest result.
    port: 5199,
    strictPort: true,
    // A quick tunnel (trycloudflare.com) fronts this with HTTPS for the WebXR
    // secure-context requirement; Vite refuses unrecognized Host headers by
    // default, so the tunnel's hostname has to be allowed explicitly.
    allowedHosts: ['.trycloudflare.com'],
  },
});
