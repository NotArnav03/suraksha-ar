import { defineConfig } from 'vite';

export default defineConfig({
  // The engine, assessment and credential all live outside the app directory
  // and are imported directly — there is no separate build of the core, so the
  // web client and the Node CLI can never be running different logic.
  build: { target: 'es2022', outDir: 'dist' },
  server: {
    // Tier A needs WebXR, which needs a secure context. Binding to the LAN so a
    // phone can reach the dev server is the whole point of testing this on real
    // hardware, so the host has to be open.
    host: true,
  },
});
