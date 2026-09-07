# Suraksha AR — Engineering Documentation

SIH26041 · AR-Based Vocational Training Simulator for Industrial Safety

This file is the handoff document: everything a collaborator needs to pick up this
codebase with no prior context. `README.md` is the pitch and the design philosophy
(read it first — it explains *why* the code is shaped this way). This file is the
map of *what exists, where, and how it fits together*, plus the state of the repo
as of this writing.

Last verified: 2026-09-08, against commit `2014a9b` on `main`. **Sections 1-11
below predate a large amount of what's in the repo now** (a second scenario,
the module picker, the offline PWA shell, the Android APK, the admin
dashboard, reshaped Tier A geometry, and full-but-unreviewed Santali
scenario coverage) — they haven't been rewritten yet to match. `README.md`
is current on all of that; this section and the numbers immediately below
are current, the numbered sections after are not.
- `npm test` → **91/91 passing** (10 test files, up from 8 — `admin.test.ts`
  and `tierA-shapes.test.ts` are new).
- `npm run check` (`tsc --noEmit`) → clean.
- `npm run build` → succeeds, two pages now (`index.html` + `admin.html`,
  `vite.config.ts`'s `rollupOptions.input`).
- CI exists now: `.github/workflows/deploy-pages.yml` runs the full test
  suite, typecheck and build on every push to `main`, then deploys to GitHub
  Pages — this replaces the "no CI" note this doc used to carry.
- No LICENSE file in the repo.
- Single author to date (`arnav.g1010@gmail.com`, committing as both `arnav`
  and `NotArnav03`).

---

## 1. What this project is

A phone-only AR safety-training simulator that replaces multiple-choice quizzes
with a scored, behavioural drill, and replaces paper certificates with a signed,
offline-verifiable QR credential. One authored scenario (JSON) runs through a
shared assessment engine and renders in up to three "tiers" (markerless AR /
marker-tracked AR / flat 2D), so the same drill and the same certificate are
available on whatever Android device a worker actually owns.

The product thesis, restated for engineering purposes: **the engine, the
assessment, and the credential must never know which tier rendered the input.**
Everything in `src/engine`, `src/assess`, and `src/credential` operates on
tier-agnostic data (`Action`, `WorldEffect`, `NodeResult`, `Competency`). Only
`src/app/render/*` knows about cameras, meshes, or DOM taps. This boundary is
enforced by convention and by the `WorldRenderer` interface, not by a build-time
firewall — see [Architectural invariants](#5-architectural-invariants-read-before-changing-anything)
before touching any of the three renderer files.

## 2. Repository layout

```
src/
  engine/       scenario graph runtime — knows nothing about cameras or meshes
    types.ts       the scenario/node/action data model (start here)
    runtime.ts      DrillSession — the only place a run is scored-in-fact
    variant.ts      randomised-variant resolution (params, guards, splicing)
    validate.ts     authoring-time schema + referential-integrity checks
    text.ts         localized-string resolution, {{param}} interpolation
    rng.ts          seeded PRNG (mulberry32) + string hashing
    index.ts        the only import surface downstream code should use

  assess/        event stream -> competency vector -> certification
    score.ts        DrillSession results -> six-dimension Competency
    certify.ts      Competency[] -> Certification (granted / withheld)

  credential/    compact signed credential, offline QR verification
    codec.ts        binary payload encode/decode (~90 bytes) + QR sizing
    credential.ts   issue/verify logic, crypto injected via Signer/Verifier
    node-crypto.ts  Node-side ECDSA P-256 signer + verifier (the issuer)
    web-crypto.ts   Browser-side WebCrypto verifier + demo in-browser issuer
    base64url.ts    URL/QR-safe base64 codec

  app/           the web client: tier detection, shared HUD, per-tier world
    main.ts         entry point — screens, AR handshake, variant selection
    controller.ts   DrillController — the only thing allowed to touch DrillSession
    tier.ts         capability detection (best tier vs. tier actually served)
    results.ts      debrief screen: error list, competency bars, credential/QR
    render/
      contract.ts     WorldRenderer interface — the tier boundary itself
      tierC.ts        flat 2D renderer (grid of tiles + verb sheet)
      tierA.ts        markerless WebXR renderer (three.js)
      overlay-taps.ts tap arbitration inside a WebXR dom-overlay (see §5.3)
      verbs.ts        shared verb icons/labels (both tiers must agree)
    ui/
      hud.ts          shared prompt/checklist/countdown/consequence banner
      i18n.ts         Localizer — text fallback chain + speech synthesis
      theme.ts        light/dark/system theme persistence

  scenarios/
    gas-confined-space.json   the one authored scenario (see §6)

  cli/
    run.ts          headless drill runner — scripts, tracing, certification runs
    credential.ts   end-to-end demo: drill -> certify -> issue -> scan -> verify

tests/           82 tests, node's built-in test runner (node --experimental-strip-types)
tools/
  phone.mjs       drive a phone's Chrome over USB via adb + CDP (Tier A debugging)
  translate.mjs   machine-draft missing Santali strings via Bhashini, for human review
l10n/            (created on demand by translate.mjs) sat-review.tsv sign-off sheet
```

Everything is native TypeScript run via Node 22.6+'s `--experimental-strip-types`
— **there is no build step for tests or CLI scripts.** Vite is used only to bundle
the browser client (`npm run dev` / `npm run build`).

## 3. Prerequisites and setup

- Node **22.6.0+** (type-stripping requirement — check with `node -v`; this repo
  was last verified against v24.13.0).
- `npm install` — devDependencies only (`typescript`, `@types/*`, `vite`,
  `happy-dom` for DOM tests). Runtime dependencies are `three` (Tier A) and
  `qrcode` (credential QR rendering).
- No environment variables are required for normal development. `tools/translate.mjs`
  needs `BHASHINI_USER_ID` / `BHASHINI_ULCA_API_KEY` (free registration at
  bhashini.gov.in) — only if you're regenerating draft Santali translations.

```bash
npm install
npm test              # 82 tests, a few seconds
npm run check         # tsc --noEmit
npm run dev           # Vite dev server; open the LAN URL on a phone to test tiers
npm run build         # production bundle -> dist/
```

CLI demos (see README.md for the full list) — useful for understanding the engine
without touching the UI at all:

```bash
node --experimental-strip-types src/cli/run.ts --script correct --events
node --experimental-strip-types src/cli/credential.ts --tamper
```

### Testing on an actual phone (Tier A)

Tier A (WebXR) **cannot be emulated on desktop** — there is no WebXR simulator in
this project, and Chrome DevTools' device emulation does not implement
`immersive-ar` sessions. You need a real ARCore-capable Android phone.

```bash
npm run dev                 # start the Vite dev server
npm run phone                # adb reverse/forward, lists open tabs on the phone
# open http://localhost:5199 in Chrome ON THE PHONE (not the laptop's LAN IP —
# adb reverse makes the phone's own "localhost" resolve to the laptop's server,
# which matters because WebXR requires a secure context and localhost qualifies
# without a TLS certificate)
npm run phone:logs           # stream the phone's console back to your terminal
npm run phone:eval "document.title"   # run arbitrary JS in the page and see the result
```

`tools/phone.mjs` talks to the phone over `adb` (must be on `PATH` or discoverable
under the Android SDK's `platform-tools`) and Chrome's remote-debugging protocol
over a forwarded port (9222). It has no effect on the shipped app — debugging only.

## 4. How a drill actually runs — the request/response shape

This is the part that's easiest to get wrong when extending the app, so it's
worth internalizing before editing `controller.ts` or either renderer.

1. `main.ts` loads and validates `scenarios/gas-confined-space.json`
   (`validateScenario`), detects the tier (`detectTier`), and picks the next
   unpassed variant (`distinctVariants` + `nextVariant()`).
2. `main.ts` constructs a renderer for the served tier (`TierARenderer` /
   `TierCRenderer`; Tier B is contracted in `render/contract.ts` but has no
   implementation — see §7) and hands it, plus the resolved variant, to a new
   `DrillController`.
3. `DrillController` constructs the actual `DrillSession` (`engine/runtime.ts`)
   and a `Hud`. It is the **only** object in the app permitted to call
   `session.dispatch()` / `session.acknowledge()` / `session.tick()`.
4. Each render tier turns user input (a WebXR `select`, a DOM tap on a tile+verb
   sheet) into an `Action` (`{ verb, target?, value? }`) and calls
   `controller.act(action)`. It never touches the session directly.
5. `DrillController#apply` takes the `StepResult` the session returns, fans
   `WorldEffect`s out to the renderer, updates the shared `Hud` (prompt,
   checklist, countdown, consequence banner — identical DOM in every tier), and
   detects `session.finished`.
6. On finish, `main.ts`'s `onFinish` hook calls `scoreSession()` (→ `Competency`),
   persists it via `saveAttempt()` (browser `localStorage`, key
   `suraksha.attempts.v1`), and renders the debrief (`results.ts`).
7. The debrief calls `certify()` against **all** locally stored attempts. If a
   certification is granted, it demo-issues a credential in-browser
   (`createDemoIssuer` + `issueCredential`) and immediately verifies it
   (`verifyCredential`) to render the "N signed bytes · QR version M · verified
   offline" line.

The engine/assessment/credential layers are pure functions/classes over plain
data — no DOM, no fetch, no `Date.now()` unless injected. That's what makes
`src/cli/*` and `tests/*` able to drive the exact same code paths headlessly.

## 5. Architectural invariants — read before changing anything

These are constraints the codebase actively enforces (with comments explaining
*why*, and in a few cases a regression the comment is naming). Breaking one won't
necessarily fail a type check.

### 5.1 The tier boundary (`WorldRenderer`)

A renderer (`tierA.ts` / `tierC.ts`) may only decide **how the world looks and how
a tap becomes an `Action`**. Prompt text, checklist, countdown, and the
consequence banner are drawn exactly once, by the shared `Hud` class
(`app/ui/hud.ts`), and every renderer's `feedback()` method is a deliberate no-op
with a comment saying so. If a renderer ever draws its own countdown or banner,
two learners on different tiers can end up assessed on different amounts of time
for what's supposed to be the same competency — this is called out explicitly in
both `tierA.ts` and `tierC.ts`.

Corollary: verb wording (`render/verbs.ts`) is centralized for the same reason —
if Tier A said "Enter" where Tier C said "Climb in", the tiers would be asking
subtly different questions.

### 5.2 `resolveVariant` rebuilds every node kind field-by-field (`engine/variant.ts`)

`resolveVariant` does not spread-and-patch a node; each `case 'expect':` /
`case 'observe':` etc. explicitly lists every field it keeps. The comment at
`variant.ts:154-160` documents a real bug this caused: when `observe` nodes
gained `errors`, the `expect` branch resolved them but the `observe` branch simply
didn't mention them, so a fatal error rule was silently dropped from the resolved
graph with no compile error. **If you add a field to any `ScenarioNode` variant,
you must add it to every relevant branch of `resolveVariant` by hand** — there is
no structural-sharing shortcut here, on purpose (see the `resolvedErrors` helper
that now shares the observe/expect error-resolution logic specifically to prevent
this from recurring).

### 5.3 WebXR dual-channel tap arbitration (`render/overlay-taps.ts`)

Inside a WebXR `dom-overlay`, one physical tap on a button can arrive via the
ordinary DOM `click` *or* the XR `select` event — and on real Android hardware,
neither channel is independently reliable (some builds never fire `click` inside
the overlay; `select` fires reliably but carries no target element). `OverlayTaps`
listens to both, uses `beforexrselect`/`pointerdown` to name the element the
finger was over, and delivers each physical tap exactly once via whichever
channel wins the race. **This class only exists because of debugging done with
`tools/phone.mjs` against real hardware** — do not "simplify" it back to a single
listener without a phone in hand to verify against.

Related, narrower fix in `tierA.ts#onSelect`: some Android/Chrome builds dispatch
more than one `select` event for a single physical tap; a 350ms de-dupe guard
prevents a Cancel-tap from closing then immediately reopening the same sheet.

### 5.4 The engine never speaks a UI language

`STEP_OUT_OF_ORDER` (the "right action, wrong moment" case) is raised by the
runtime itself, not authored in the scenario JSON, and its user-facing string
lives in `app/ui/i18n.ts`'s `UI` table rather than as scenario content. Any
runtime-raised message must go through the same path — this is what keeps a
missing third-language string from being possible for engine-level messages (they
can only be missing for authored content, which `l10n.test.ts` checks).

### 5.5 Text always goes through `LocalizedText` + `Localizer`, never an inline ternary

`verbs.ts`'s header comment documents the actual failure mode: a hardcoded
`en ? a : b` check at a call site is "exactly how a third language goes missing
silently" — a Santali-selecting learner would keep seeing Hindi no matter what
they picked, on every string written that way, and nothing would catch it. Every
piece of learner-facing text is a `LocalizedText` resolved through
`Localizer.text()`/`Localizer.ui()`, so the `sat → hi → en` fallback chain is the
only place language-selection logic exists.

### 5.6 Speech voice selection keys off the *script on screen*, not the selected language code

`i18n.ts`'s `scriptTag()` exists because the fallback chain means a learner who
picks Santali is very often looking at Hindi (Devanagari) text on screen, not Ol
Chiki — so speech synthesis has to look at what script the string is actually
written in, not which language was selected, or it mispronounces (or the app
tries to hand Devanagari text to a Santali voice). See `pickVoice()`'s scoring:
Android lists a romanized `hi_IN_#Latn` voice right next to the real Devanagari
one, and picks Ol Chiki-tagged Santali voices ahead of others when available.

### 5.7 Effects and errors carry variant-resolved values, not authored templates

A `set_gas` effect's `value` may be authored as `"{{o2}}"` and must be a resolved
number by the time it reaches a renderer; `resolveEffects()` in `variant.ts`
does this coercion and throws if interpolation doesn't produce a valid number.
Never read `WorldEffect.value` as a string in renderer code.

## 6. The authored scenario (`gas-confined-space.json`)

- **21 nodes** (README says "eighteen or nineteen depending on variant" — that
  was accurate for a prior version; re-verify the exact reachable count per
  variant if this number matters for a claim you're making, since `when`-guarded
  nodes are spliced out per variant).
- **5 variant params**: `gas` (H2S / CO / methane, picked), `o2` (15.4–19.2%,
  0.1 step, sampled), `permit_state` (valid/expired/absent), `detector_choice`
  (primary vs. spare instrument), `shift` (first/second/night).
- **Scoring**: `requiredVariants: 3`; per-dimension pass marks —
  `hazard_recognition` 70, `procedure_sequence` 75, `time_criticality` 65,
  `ppe_discipline` 80, `communication` 70, **`rescue_restraint` 100** (zero
  partial credit for entering a confined space after a collapsed colleague).
- **16 props**, spanning `structure`/`ppe`/`instrument`/`equipment`/`person`/
  `signage`/`hazard` kinds.
- **Languages authored**: `en`, `hi` throughout; `sat` (Santali, Ol Chiki script)
  now covers every scenario string in both `gas-confined-space` and
  `fire-explosion` (was 2 of ~86 as of this doc's last full pass) — but it is
  an **AI machine draft** written by `tools/translate.mjs --dictionary`
  (a local-dictionary alternative to the Bhashini path, for when Bhashini
  credentials aren't available), not a reviewed translation. Every line is
  also recorded in `l10n/sat-review.tsv` against its English source; treat
  none of it as authoritative until a Santali speaker signs off each row —
  same requirement this section always stated, just now applying to the
  full scenario text rather than four sentences of it. See §8.
- **Five fatal outcome branches** (`outcome_fatal_entry`, `_survey`, `_atmosphere`,
  `_gas`, `_rescue`) alongside `outcome_pass` — each names a specific way to die
  in this scenario, which is the point: a failed run is a named, specific debrief.
- **Regulation citations are placeholders.** `regulations` currently reads
  `["Mines Act 1952 — duty to maintain a safe working environment", "Mines
  Vocational Training Rules 1966 — initial training, confined space module",
  "DGMS guidance on confined space entry, gas testing and standby persons"]` —
  correct instruments named, but **no clause numbers have been verified.** Do
  not present this scenario as regulation-compliant until each `cite` is checked
  against source and a certified instructor has reviewed the procedure itself
  (both gaps are also called out in `README.md`'s "Known gaps" section — nothing
  has changed on this front since that was written).

To author a new scenario or extend this one: read `engine/types.ts` top to
bottom first (it's ~250 lines and is the entire data model), then
`engine/validate.ts` to see exactly what a broken graph will be caught on before
it ever reaches a learner. `validateScenario` throws `ScenarioError` with a
JSON-path per issue — both `main.ts` (renders it as a fatal-error screen) and
`cli/run.ts` (prints it to the terminal) handle this the same way.

## 7. Known gaps and their exact status

This list is maintained in `README.md` too ("Known gaps — read before pitching");
this version adds where in the code each gap actually lives, for anyone about to
work on one.

| Gap | Status | Where |
|---|---|---|
| Regulation citations unverified | Placeholder `cite` strings only | `src/scenarios/gas-confined-space.json` → `regulations` and per-node `cites` |
| No certified-instructor review of the procedure | Not started | content review, not code |
| Tier A never run on real ARCore hardware | Type-checks and builds; unproven | `src/app/render/tierA.ts`; test with `tools/phone.mjs` |
| Tier A uses primitive geometry, not models | Shaped now (a person is head+torso+limbs, extinguishers are colour/shape-distinguished), still coloured geometry not a site twin | `tierA.ts` `partsFor()` (was `geometryFor()`, one primitive per kind — see `tests/tierA-shapes.test.ts`) |
| Tier B (marker tracking) not implemented | Contracted, falls back loudly | `Tier` type in `render/contract.ts` includes `'B'`; `tier.ts`'s `IMPLEMENTED` array is `['A', 'C']` only; `main.ts`'s `rendererFor()` always serves Tier C when asked for B |
| Credential issuance happens in-browser | Demo-only, explicitly named as such; now signed with a fixed key (not random per-session) so a *different* device can verify it | `src/credential/web-crypto.ts`'s `createDemoIssuer` + `src/credential/demo-trust.ts` — real issuance needs a server-side keystore, a published trust list, and key rotation, none of which exist yet |
| Santali narration is speech-synthesized, not recorded | Stand-in | `app/ui/i18n.ts`'s `Localizer.speak()`; `Narration.audio` field already exists in `engine/types.ts` to carry real clips whenever they're recorded |
| Santali translation is an unreviewed AI draft | Full scenario coverage (both scenarios), zero human review | `tools/translate.mjs --dictionary l10n/ai-santali-drafts.json --apply` generated it; a `l10n/sat-review.tsv` sign-off sheet tracks every line; **nothing it writes is authoritative until a Santali speaker signs off each line** — enforced by process, not by code. Three AR-handshake UI strings were deliberately left un-drafted, not just unreviewed — see the comment above `startingAr` in `i18n.ts` |
| Digital Asset Link verification for the APK not published | Fingerprint ready, needs publishing at a domain root outside this repo | `public/.well-known/assetlinks.json`; see `docs/APK.md` |
| Admin dashboard has no backend/sync across devices | By design for now — reads only what this device scanned | `src/admin/store.ts`'s module comment |

## 8. Localization workflow, concretely

1. `npm run l10n` — reports what's missing across **both** scenario JSON files
   (`gas-confined-space.json`, `fire-explosion.json`) plus the hand-written
   `UI` table in `app/ui/i18n.ts`, translates nothing. As of this writing:
   0 scenario strings missing, 3 interface strings missing (deliberately —
   see below).
2. `npm run l10n:draft` — calls Bhashini (needs `BHASHINI_USER_ID` /
   `BHASHINI_ULCA_API_KEY` env vars, free registration), prints drafts, writes
   nothing to source.
3. **`node tools/translate.mjs --dictionary <file.json> --apply`** — the
   alternative path used to actually fill the gap: no Bhashini credentials
   were available, so this reads a local `{ "English text": "Santali text" }`
   map instead of calling the API. Same output either way — the tool doesn't
   care whether Bhashini or a dictionary produced the draft, only that every
   draft is tracked as one (step 4). `l10n/ai-santali-drafts.json` is the
   dictionary actually used for the current coverage.
4. `npm run l10n:apply` (or the `--dictionary` form above) writes into each
   scenario JSON directly and prints copy-pasteable `sat: '...'` lines for
   `i18n.ts` (hand-written source, deliberately never auto-edited, to avoid
   destroying comments/formatting there).
5. **Every string either mode touches is also written to `l10n/sat-review.tsv`**
   (columns: path, english, machine_santali, reviewed_by, corrected_santali) —
   this file is the actual deliverable of a translation pass, not the JSON edit.
   A Santali speaker fills in `reviewed_by`/`corrected_santali` per row before
   any of it should be treated as fit to train a worker on a lethal procedure.
   This file now exists with 138 rows (full scenario coverage across both
   files, minus the 3 deliberately-skipped UI strings) — **none of them are
   signed off yet.** Getting a Santali speaker through this sheet is the next
   concrete step, not writing more Santali.

`{{param}}` placeholders (e.g. `{{gas}}`) are checked to survive the translation
round-trip (`placeholdersSurvived()`); any translation that loses one is skipped
with a warning rather than silently corrupting interpolation.

## 9. Tests

91 tests across 10 files, using Node's built-in test runner
(`node --experimental-strip-types --test tests/**/*.test.ts`) with `happy-dom`
providing a DOM for the app-layer tests. No mocking framework — fakes are
hand-written (e.g. injected clocks, fake `SpeechSynthesisVoice` lists).

| File | Tests | Covers |
|---|---|---|
| `engine.test.ts` | 17 | validation (dangling refs, unrouted fatals), variant resolution/splicing/distinctness, the ideal-operator completing every branch, sequence errors, timeouts firing via `tick()` with no input, hesitation vs. error accounting, observe-node error rules (the "entering during survey is fatal, not a spotted hazard" fix) |
| `assess.test.ts` | 10 | scoring math: full credit, fatal flooring a dimension, severity-weighted deductions, hesitation penalties, null (no-evidence) vs. zero, contribution traceability, certification's distinct-variant requirement, fail-then-pass still counting, worst-vs-mean aggregation |
| `credential.test.ts` | 20 | base64url round-trips and rejection, binary codec round-trip/truncation/oversize rejection, full issue→verify loop, refusal to issue for an ungranted certification, single-byte tamper detection, unknown-issuer rejection, expiry rejection, near-expiry warnings, worst-attempt (not mean) carried into the credential, QR size ceiling, malformed-input handling |
| `app.test.ts` | 14 | end-to-end DOM-level drill flow via happy-dom: reaching a pass, reaching a named fatal outcome, checklist behavior, spawned-prop visibility, live language switching, every scenario-expected action being reachable through the actual UI, `.hidden` actually hiding per the real stylesheet, cross-tier verb-label consistency, receipt-without-verdict feedback, out-of-order step visibility |
| `overlay-taps.test.ts` | 9 | the dual-channel WebXR tap arbitration in isolation — click-only, select-only, both orders, stale aims, genuinely separate taps, dispose |
| `speech.test.ts` | 7 | script-based (not language-based) voice selection, Ol Chiki vs. Devanagari vs. romanized-Hindi disambiguation, Indian-English preference, graceful silence when no matching voice exists |
| `theme.test.ts` | 6 | system/light/dark persistence, `data-theme` attribute semantics, corrupted-storage fallback |
| `l10n.test.ts` | 4 | every declared language resolves every scenario string, fallback chains terminate in something authored, Santali falls through Hindi before English |
| `admin.test.ts` | 5 | roster store dedup/merge-keeps-newer logic in isolation, plus end-to-end through the real dashboard DOM: paste a credential issued via `createDemoIssuer` → click "Verify & add" → row appears in the table; garbage input rejected, not silently added. Caught a real bug pre-merge: `verifyAndAdd` set the success message then immediately called `render()`, which wiped it before it could be seen |
| `tierA-shapes.test.ts` | 4 | the one corner of the render layer with no prior coverage (WebXR/WebGL can't run under happy-dom, but geometry construction needs neither) — every prop kind builds sane, non-degenerate geometry; a person's feet actually reach the floor; the three extinguishers are genuinely distinguishable by part count and colour, not just by id string |

Run `npm test` — it should exit clean with `82 pass`, `0 fail`. If it doesn't,
that's a regression worth chasing before anything else, since this suite is the
only thing standing between a scenario-JSON edit and a broken drill on a real
phone.

## 10. Extending this codebase — where to start for common tasks

- **Add a new scenario (new domain, e.g. fire/explosion or LOTO):** author a new
  JSON file next to `gas-confined-space.json` following `engine/types.ts`'s
  `Scenario` shape; validate it with `validateScenario` before wiring it into
  `main.ts`. `DOMAIN_CODES` in `credential/codec.ts` already reserves codes for
  `fire_explosion`, `ground_control_and_height`, `machinery_haulage_loto`, and
  `electrical_ppe_emergency` — the credential format anticipates more domains
  than currently exist content for.
- **Implement Tier B (marker tracking):** implement `WorldRenderer` in a new
  `render/tierB.ts` (same contract Tier A/C already satisfy), add `'B'` to
  `tier.ts`'s `IMPLEMENTED` array, and wire it into `main.ts`'s `rendererFor()`.
  Nothing in the engine/assessment/credential layers needs to change — that's
  the entire point of the tier boundary.
- **Move credential issuance server-side:** `src/credential/credential.ts`'s
  `issueCredential` already takes an injected `Signer`; `node-crypto.ts`'s
  `nodeSigner`/`generateIssuerKey` are the server-side half already written and
  exercised by `cli/credential.ts`. The work is standing up a keystore-backed
  HTTP endpoint that calls this existing code, publishing its public key as a
  trust list, and replacing `results.ts`'s `createDemoIssuer()` call with a
  fetch to that endpoint.
- **Record real narration audio:** `Narration.audio` (`engine/types.ts`) already
  carries a `Record<string, string>` of language code → audio asset id per
  narratable line; nothing consumes it yet (`Localizer.speak()` always uses
  speech synthesis). Wiring it up is an `app/ui/i18n.ts` change plus an asset
  pipeline decision, not an engine change.
- **Verify/replace regulation citations:** edit `regulations` and per-node
  `cites` fields directly in `gas-confined-space.json`; no code changes needed.
  This is content work, ideally done by someone with access to the actual DGMS
  text, and should happen before this is shown to anyone as compliant with
  anything (see §7).

## 11. Project/submission context

`PPT-BRIEF.md` and `Suraksha_AR_SIH26041 V2.pptx` are Smart India Hackathon 2026
submission materials (problem statement SIH26041, "AR-Based Vocational Training
Simulator for Industrial Safety"). They describe the pitch, not the codebase —
useful for understanding what's being promised to judges, but check this document
and `README.md`'s "Known gaps" section before assuming a claim in the deck is
fully implemented (e.g. the deck's backend-sync and Wi-Fi-Direct-distribution
ideas are not present in the code at all; they're roadmap, not shipped).
