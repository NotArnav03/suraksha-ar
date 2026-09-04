#!/usr/bin/env node
/**
 * Drive the phone's Chrome over USB, so a Tier A bug can be diagnosed from the
 * device that actually has it.
 *
 * Tier A only exists on real hardware: WebXR cannot be emulated on the desktop,
 * and the failures that matter here are input-routing ones that only appear
 * inside a live dom-overlay. Without this, every iteration costs a human round
 * trip - run it, watch it, describe what happened. This replaces that with the
 * page's own console and a JavaScript evaluator.
 *
 * `reverse` is doing more work than it looks: it makes the laptop's dev server
 * reachable on the phone as http://localhost:<port>, and localhost is a secure
 * context, so WebXR runs with no HTTPS tunnel in the loop at all.
 *
 *   node tools/phone.mjs setup [--port 5199]   forward both sockets, list tabs
 *   node tools/phone.mjs tabs                  what Chrome has open
 *   node tools/phone.mjs logs [--grep re]      stream console + exceptions
 *   node tools/phone.mjs eval "<expression>"   run JS in the page, print result
 *   node tools/phone.mjs shot [file.png]       screenshot the page
 *   node tools/phone.mjs open <url>            navigate the active tab
 *
 * Debugging only - nothing here ships, and nothing in src/ depends on it.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CDP_PORT = 9222;

function adbPath() {
  if (process.env.ADB) return process.env.ADB;
  const local = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local');
  const sdk = join(local, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
  if (existsSync(sdk)) return sdk;
  return 'adb'; // fall back to PATH (also the Linux/macOS case)
}

const ADB = adbPath();

function adb(...args) {
  return execFileSync(ADB, args, { encoding: 'utf8' }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function devices() {
  return adb('devices')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
    });
}

function requireDevice() {
  const list = devices();
  const ready = list.filter((d) => d.state === 'device');
  if (ready.length > 0) return ready[0];

  if (list.some((d) => d.state === 'unauthorized')) {
    fail(
      'The phone is connected but not authorized.\n' +
        'Unlock it and tap "Allow" on the "Allow USB debugging?" prompt, then re-run.',
    );
  }
  fail(
    'No phone visible to adb.\n' +
      '  1. Settings > About phone > tap "Build number" 7 times (enables Developer options)\n' +
      '  2. Settings > System > Developer options > turn on "USB debugging"\n' +
      '  3. Plug in over USB-C, then tap "Allow" on the prompt that appears\n' +
      '  4. If the cable is charge-only, swap it - many USB-C cables carry no data',
  );
}

/** Both directions: the dev server down to the phone, the debugger back up. */
function forward(port) {
  adb('reverse', `tcp:${port}`, `tcp:${port}`);
  adb('forward', `tcp:${CDP_PORT}`, 'localabstract:chrome_devtools_remote');
}

async function targets() {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  } catch {
    fail(
      'Nothing is answering on the debug socket.\n' +
        'Run "node tools/phone.mjs setup" first, and make sure Chrome is open on the phone.',
    );
  }
  const all = await response.json();
  return all.filter((t) => t.type === 'page');
}

/** The drill's tab if it can be identified, otherwise whatever Chrome has focused. */
async function pickTarget(port) {
  const pages = await targets();
  if (pages.length === 0) fail('Chrome has no open tabs on the phone.');
  const mine = pages.find((t) => port && String(t.url).includes(`:${port}`));
  return mine ?? pages[0];
}

class Session {
  #socket;
  #id = 0;
  #pending = new Map();
  #listeners = [];

  static async open(target) {
    const session = new Session();
    await session.connect(target.webSocketDebuggerUrl);
    return session;
  }

  connect(url) {
    this.#socket = new WebSocket(url);
    this.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const entry = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (entry) {
          if (message.error) entry.reject(new Error(message.error.message));
          else entry.resolve(message.result);
        }
        return;
      }
      for (const listener of this.#listeners) listener(message);
    });
    return new Promise((resolve, reject) => {
      this.#socket.addEventListener('open', resolve, { once: true });
      this.#socket.addEventListener('error', () => reject(new Error('CDP connection failed')), {
        once: true,
      });
    });
  }

  send(method, params = {}) {
    const id = ++this.#id;
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
  }

  on(listener) {
    this.#listeners.push(listener);
  }

  close() {
    this.#socket.close();
  }
}

/** CDP hands back a mix of values, previews and bare descriptions. */
function renderArg(arg) {
  if (!arg) return '';
  if (arg.type === 'string') return arg.value;
  if ('value' in arg) return JSON.stringify(arg.value);
  if (arg.preview) {
    const props = (arg.preview.properties ?? []).map((p) => `${p.name}: ${p.value}`).join(', ');
    return `${arg.preview.description ?? arg.className ?? 'Object'}{${props}}`;
  }
  return arg.description ?? arg.className ?? arg.type;
}

function flag(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const command = process.argv[2] ?? 'setup';
const port = Number(flag('port', 5199));

if (command === 'setup') {
  const device = requireDevice();
  forward(port);
  const pages = await targets();
  console.log(`device      ${device.serial}`);
  console.log(`reverse     phone http://localhost:${port} -> this laptop's dev server`);
  console.log(`forward     laptop :${CDP_PORT} -> phone Chrome devtools`);
  console.log(`\n${pages.length} tab(s) open:`);
  for (const page of pages) console.log(`  ${page.title}\n    ${page.url}`);
  console.log(`\nOn the phone, open:  http://localhost:${port}`);
} else if (command === 'tabs') {
  for (const page of await targets()) console.log(`${page.title}\n  ${page.url}\n`);
} else if (command === 'open') {
  const url = process.argv[3];
  if (!url) fail('usage: node tools/phone.mjs open <url>');
  requireDevice();
  forward(port);
  adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url);
  console.log(`opened ${url}`);
} else if (command === 'logs') {
  const grep = flag('grep');
  const pattern = grep ? new RegExp(grep, 'i') : null;
  const target = await pickTarget(port);
  const session = await Session.open(target);

  const emit = (line) => {
    if (!pattern || pattern.test(line)) console.log(line);
  };

  session.on((message) => {
    const { method, params } = message;
    if (method === 'Runtime.consoleAPICalled') {
      emit(`[${params.type}] ${params.args.map(renderArg).join(' ')}`);
    } else if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails;
      const text = details.exception?.description ?? details.text;
      emit(`[error] ${text}  (${details.url ?? '?'}:${details.lineNumber ?? '?'})`);
    } else if (method === 'Log.entryAdded') {
      const entry = params.entry;
      emit(`[${entry.level}] ${entry.text}  (${entry.url ?? '?'})`);
    }
  });

  await session.send('Runtime.enable');
  await session.send('Log.enable');
  console.log(`streaming console from: ${target.url}\n(ctrl-c to stop)\n`);
} else if (command === 'eval') {
  let expression = process.argv[3];
  if (!expression) fail('usage: node tools/phone.mjs eval "<expression>" | eval @file.js');
  // `@file` keeps anything non-trivial out of the shell, where quoting mangles it.
  if (expression.startsWith('@')) expression = readFileSync(expression.slice(1), 'utf8');
  const target = await pickTarget(port);
  const session = await Session.open(target);
  const result = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    console.error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    session.close();
    process.exit(1);
  }
  const value = result.result.value;
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  session.close();
} else if (command === 'shot') {
  const file = process.argv[3] ?? 'phone.png';
  const target = await pickTarget(port);
  const session = await Session.open(target);
  const shot = await session.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`wrote ${file}`);
  session.close();
} else {
  fail(`unknown command "${command}" - see the header of tools/phone.mjs`);
}
