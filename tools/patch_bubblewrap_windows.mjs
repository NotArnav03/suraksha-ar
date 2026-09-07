#!/usr/bin/env node
// Two real bugs in @bubblewrap/core's Windows process-spawning, both traced
// to the same root cause and reproduced directly against cmd.exe (not
// bubblewrap-specific): `execFile(cmd, args, {shell:true})` on Windows joins
// cmd+args into one string for cmd.exe without quoting `cmd` itself, so
// (a) a bare relative filename like 'gradlew.bat' fails to resolve under
// `cmd /d /s /c`, and (b) an absolute path containing a space (anything under
// 'Program Files', which is where a JDK normally lives) gets split at the
// first space and cmd reports the first fragment as an unrecognized command.
//
// These live in node_modules, so a fresh `npm install` wipes them - this
// script re-applies both, idempotently. Run it once after every install,
// before `node tools/build_apk.mjs` or `npx bubblewrap build`.
//
// Run: node tools/patch_bubblewrap_windows.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

if (process.platform !== 'win32') {
  console.log('Not on Windows - nothing to patch.');
  process.exit(0);
}

const patches = [
  {
    file: 'node_modules/@bubblewrap/core/dist/lib/GradleWrapper.js',
    find: "this.gradleCmd = 'gradlew.bat';",
    replace: "this.gradleCmd = '.\\\\gradlew.bat';",
  },
  {
    file: 'node_modules/@bubblewrap/core/dist/lib/jdk/JdkHelper.js',
    find: 'const runJavaCmd = this.joinPath(this.getJavaHome(), java);\n        return await (0, util_1.executeFile)(runJavaCmd, args, this.getEnv());',
    replace:
      "let runJavaCmd = this.joinPath(this.getJavaHome(), java);\n        // executeFile's shell:true concatenates cmd+args unquoted on Windows,\n        // so an unquoted path under 'Program Files' (a space) gets split into\n        // two tokens and cmd.exe reports \"'C:\\Program' is not recognized\".\n        // Reproduced directly against cmd.exe, independent of this package.\n        if (this.process.platform === 'win32' && runJavaCmd.includes(' ')) {\n            runJavaCmd = `\"${runJavaCmd}\"`;\n        }\n        return await (0, util_1.executeFile)(runJavaCmd, args, this.getEnv());",
  },
];

for (const { file, find, replace } of patches) {
  if (!existsSync(file)) {
    console.log(`skip (not installed): ${file}`);
    continue;
  }
  const contents = readFileSync(file, 'utf8');
  if (contents.includes(replace)) {
    console.log(`already patched: ${file}`);
    continue;
  }
  if (!contents.includes(find)) {
    console.warn(`WARNING: expected text not found in ${file} - @bubblewrap/core may have changed. Skipping; check versions.`);
    continue;
  }
  writeFileSync(file, contents.replace(find, replace));
  console.log(`patched: ${file}`);
}
