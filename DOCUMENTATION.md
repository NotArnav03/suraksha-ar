# Suraksha AR: engineering documentation

SIH26041 · AR-Based Vocational Training Simulator for Industrial Safety

This is the handoff document: what exists, where it is, and which constraints
the code is holding that a type checker will not hold for you. `README.md` is
the pitch and the reasoning behind the design; read that first if you want to
know *why*. `docs/UI.md` covers the interface layer specifically.

Verified 2026-09-23. The code has not changed since `caaf242`; anything after it on `main` is documentation.

- `npm test` → **149 passing, 0 failing** (16 files)
- `npm run check` (`tsc --noEmit`) → clean
- `npm run build` → two pages, `index.html` and `admin.html`
- CI: `.github/workflows/deploy-pages.yml` runs tests, typecheck and build on
  every push to `main`, then deploys to GitHub Pages
- Live: https://notarnav03.github.io/suraksha-ar/ and `/admin.html`
- No LICENSE file. Single author to date (`arnav.g1010@gmail.com`, committing as
  both `arnav` and `NotArnav03`).

---

## 1. What this project is

A phone-only AR safety-training simulator that replaces multiple-choice quizzes
with a scored behavioural drill, and replaces the paper certificate with a
signed, offline-verifiable QR credential. Three authored scenarios (JSON) run
through one shared assessment engine and render in two tiers, markerless AR
(Tier A) and flat interactive (Tier B), so the same drill and the same
certificate are available on whatever Android device a worker actually owns.

A marker-tracked middle tier used to sit between them. It was contracted and
never built, and carrying an empty slot in the type made every tier list read as
two thirds finished, so it has been dropped. The flat tier, previously Tier C,
is Tier B now. `?tier=C` is still accepted as an alias, because links and notes
with the old letter are in circulation.

Two framing points that matter when you are deciding what to build next:

**The product is the assessment, not the certificate.** The defensible slot in
the national skilling system is the instrument an NCVET-recognised Assessment
Agency uses, feeding an awarding body that deposits into DigiLocker. The 51-byte
signed QR is not a rival credential; it is the offline verification path that
the Electronic Skill Credential Standard already describes, for the pit-top
where Skill India Digital's online lookup has no signal. `docs/RESEARCH.md` §6.1
has the full ladder, the NOS/PC mapping and the caveats.

**The engine, the assessment and the credential must never know which tier
rendered the input.** Everything in `src/engine`, `src/assess` and
`src/credential` operates on tier-agnostic data (`Action`, `WorldEffect`,
`NodeResult`, `Competency`). Only `src/app/render/*` knows about cameras, meshes
or DOM taps. The boundary is held by the `WorldRenderer` interface and by
convention, not by a build-time firewall, so read §5 before touching a renderer.

## 2. Repository layout

```
src/
  engine/        scenario graph runtime, knows nothing about cameras or meshes
    types.ts        the scenario/node/action data model (start here)
    runtime.ts      DrillSession, the only place a run is scored in fact
    variant.ts      randomised-variant resolution (params, guards, splicing)
    validate.ts     authoring-time schema and referential-integrity checks
    text.ts         localized-string resolution, {{param}} interpolation
    rng.ts          seeded PRNG (mulberry32) and string hashing
    index.ts        the import surface downstream code should use

  assess/        event stream -> competency vector -> certification
    score.ts        DrillSession results -> six-dimension Competency
    certify.ts      Competency[] -> Certification, granted or withheld, with
                    both English reasons and structured ReasonDetails

  credential/    compact signed credential, offline QR verification
    codec.ts        binary payload encode/decode (51 bytes) and QR sizing
    credential.ts   issue/verify, crypto injected via Signer/Verifier
    node-crypto.ts  Node-side ECDSA P-256 signer and verifier (the issuer)
    web-crypto.ts   browser WebCrypto verifier and the demo in-browser issuer
    demo-trust.ts   the fixed demo key pair and trust list, and why it is fixed
    base64url.ts    URL/QR-safe base64

  app/           the worker client
    main.ts         entry: screens, module picker, AR handshake, variant choice
    controller.ts   DrillController, the only thing allowed to touch DrillSession
    tier.ts         capability detection (best tier vs tier actually served)
    results.ts      debrief: errors, rules, competency bars, credential and QR
    quiz.ts         the daily refresher screen and the call-out on the module list
    style.css       the whole design system (see docs/UI.md)
    render/
      contract.ts     WorldRenderer, the tier boundary itself
      tierB.ts        flat 2D renderer (tile grid plus verb sheet)
      tierA.ts        markerless WebXR renderer (three.js)
      overlay-taps.ts tap arbitration inside a WebXR dom-overlay (§5.3)
      verbs.ts        shared verb icons and labels; both tiers must agree
    ui/
      hud.ts          shared prompt/checklist/countdown/consequence banner
      i18n.ts         Localizer, fallback chain, speech, recorded narration
      icons.ts        every pictogram in the product, as inline SVG
      theme.ts        light/dark/system persistence

  admin/         the supervisor's compliance dashboard (no backend)
    main.ts         entry
    dashboard.ts    scan/paste, verify offline, roster table, expiry filters
    store.ts        localStorage roster, dedupe and merge rules
    replay.ts       credential digests -> the exact drills they were earned on
    admin.css       dashboard-only styling on top of the app's tokens

  scenarios/     authored content, one file per domain (§6)
  quiz/          the daily ninety seconds, fenced off from certification (§5.12)
    bank.json       the question bank, localized like a scenario
    daily.ts        validation, the day's deterministic set, the streak
  cli/
    run.ts          headless drill runner: scripts, tracing, certification runs
    credential.ts   end-to-end: drill -> certify -> issue -> scan -> verify

tests/           149 tests, node's built-in runner (§9)
tools/
  phone.mjs       drive a phone's Chrome over USB via adb and CDP (§3)
  translate.mjs   machine-draft missing Santali, for human review (§8)
  narration.mjs   what needs recording, and the manifest for it
  build_apk.mjs, patch_bubblewrap_windows.mjs   the TWA Android build (docs/APK.md)
  make_icon.mjs, make_placeholders.mjs          PWA icons, placeholder assets
public/          PWA manifest, service worker, icons, glTF props
l10n/            ai-santali-drafts.json, sat-review.tsv (the sign-off sheet)
docs/            RESEARCH, CITATIONS, UI, NARRATION, APK, asset specs
```

Everything is native TypeScript run through Node 22.6+'s
`--experimental-strip-types`. **There is no build step for tests or CLI
scripts.** Vite is used only to bundle the two browser pages.

## 3. Prerequisites, setup, and testing on a phone

- Node **22.6.0+** (type stripping). Last verified on v24.13.0.
- `npm install` installs devDependencies (`typescript`, `@types/*`, `vite`,
  `happy-dom`). Runtime dependencies are `three` (Tier A only, dynamically
  imported) and `qrcode`.
- No environment variables are needed for normal development.
  `tools/translate.mjs` wants `BHASHINI_USER_ID` and `BHASHINI_ULCA_API_KEY`
  only if you are regenerating Santali drafts through Bhashini.

```bash
npm install
npm test        # 149 tests, a few seconds
npm run check   # tsc --noEmit
npm run dev     # Vite dev server
npm run build   # production bundle -> dist/
```

### The phone is the target, so test on the phone

Tier A cannot be emulated. There is no WebXR simulator here and Chrome
DevTools' device emulation does not implement `immersive-ar`. Beyond Tier A,
desktop Chrome at 412px catches layout but not legibility in daylight, not
touch target size through a glove, and not what a press feels like.

```bash
npm run build
npx vite preview --port 5199 --strictPort
node tools/phone.mjs setup --port 5199   # adb reverse + forward, lists tabs
node tools/phone.mjs logs                # stream the phone's console
node tools/phone.mjs eval "document.title"
node tools/phone.mjs shot out.png
```

Open `http://localhost:5199` in Chrome **on the phone**, not the laptop's LAN
IP: `adb reverse` makes the phone's own localhost resolve to the laptop's
server, and localhost is a secure context, so WebXR runs with no TLS in the
loop.

Three things that will waste your time otherwise:

- `phone.mjs open <url>` hands the URL to `am start`, and an unescaped `&`
  splits there, so a multi-parameter deep link silently loses everything after
  the first one. Navigate with `phone.mjs eval "location.href='...'"` instead.
- `pickTarget` prefers a tab whose URL contains the forwarded port and
  otherwise takes the first page target, which is frequently a stale or blank
  tab. Close the strays: `curl -s localhost:9222/json` for ids, then
  `curl -s -o /dev/null localhost:9222/json/close/<id>`.
- The service worker is cache-first, so the first load after a deploy serves the
  previous build and the second load picks up the new one.

## 4. How a drill actually runs

1. `main.ts` loads and validates all three scenario JSON files
   (`validateScenario`), detects the tier (`detectTier`), and either shows the
   module picker or skips it when `?scenario=` names one.
2. The learner picks a mode. **Show me** (guided) narrates each step by name.
   **Prove it** (assessment) replaces every instruction with the situation and
   masks the checklist. `DrillOptions.mode` carries the choice into
   `DrillController`.
3. `main.ts` picks the variant: `?seed=N` resolves that exact seed through
   `resolveVariant`, otherwise `distinctVariants` plus `nextVariant()` chooses
   the next one the learner has not passed.
4. A renderer is constructed for the served tier (`TierARenderer` or
   `TierBRenderer`) and handed, with the resolved variant, to a new
   `DrillController`.
5. `DrillController` constructs the `DrillSession` and a `Hud`. It is the
   **only** object permitted to call `session.dispatch()`, `acknowledge()` or
   `tick()`.
6. A renderer turns input (a WebXR `select`, a tile tap plus a verb) into an
   `Action` (`{ verb, target?, value? }`) and calls `controller.act(action)`. It
   never touches the session.
7. `DrillController#apply` takes the `StepResult`, fans `WorldEffect`s out to the
   renderer, updates the shared `Hud`, and notices `session.finished`.
8. On finish, `scoreSession(session, controller.attempted)` produces a
   `Competency` carrying the mode and whether a hint was taken. `saveAttempt()`
   persists it (`localStorage`, `suraksha.attempts.v1`) and `results.ts` renders
   the debrief.
9. The debrief calls `certify()` over all stored attempts. Only unaided
   assessment runs count towards the distinct-variant requirement. If a
   certification is granted it demo-issues a credential in-browser and verifies
   it immediately, which is where the "N signed bytes · QR version M · verified
   offline" line comes from.

The engine, assessment and credential layers are pure functions and classes over
plain data: no DOM, no fetch, no ambient `Date.now()`. That is what lets
`src/cli/*` and `tests/*` drive the identical code paths headlessly.

## 5. Architectural invariants

Constraints the codebase actively holds, several of them naming a real
regression. Breaking one will not necessarily fail a type check.

### 5.1 The tier boundary (`WorldRenderer`)

A renderer decides **how the world looks and how a tap becomes an `Action`**,
and nothing else. Prompt, checklist, countdown and consequence banner are drawn
once, by `Hud`, and every renderer's `feedback()` is a deliberate no-op with a
comment saying so. A renderer that drew its own countdown could quietly give its
learners more time, and two credentials that cost different amounts of time are
not the same credential. Verb wording is centralised in `render/verbs.ts` for
the same reason: if Tier A said "Enter" where Tier B said "Climb in", the tiers
would be asking subtly different questions.

### 5.2 `resolveVariant` rebuilds every node kind field by field

`engine/variant.ts` does not spread-and-patch. Each `case` lists every field it
keeps. The comment there documents the bug that caused: when `observe` nodes
gained `errors`, the `expect` branch resolved them and the `observe` branch
simply did not mention them, so a fatal rule vanished from the resolved graph
with no compile error. **Adding a field to any `ScenarioNode` means adding it to
every relevant branch by hand.** `goal` (§5.8) is the most recent example.

### 5.3 WebXR dual-channel tap arbitration (`render/overlay-taps.ts`)

Inside a `dom-overlay`, one physical tap can arrive as a DOM `click` or as an XR
`select`, and on real Android neither channel is independently reliable: some
builds never fire `click` inside the overlay, and `select` fires reliably but
carries no target element. `OverlayTaps` listens to both, uses
`beforexrselect`/`pointerdown` to name the element the finger was over, and
delivers each physical tap exactly once. This class exists because of debugging
against real hardware; do not simplify it to one listener without a phone in
hand. Related: `tierA.ts#onSelect` keeps a 350ms de-dupe, because some builds
dispatch two `select` events for one tap and a Cancel would close then reopen
the sheet.

### 5.4 The engine never speaks a UI language

`STEP_OUT_OF_ORDER` is raised by the runtime, not authored in JSON, and its
user-facing string lives in the `UI` table in `app/ui/i18n.ts`. Any
runtime-raised message goes the same way, which is what makes a missing third
language impossible for engine-level text.

### 5.5 Text goes through `LocalizedText` and `Localizer`, never an inline ternary

`verbs.ts`'s header names the failure mode: a hardcoded `en ? a : b` at a call
site is how a third language goes missing silently, because a Santali learner
would keep seeing Hindi on that one string and nothing would catch it. The
`sat → hi → en` chain is the only place language selection lives.

The same rule now covers generated prose. `certify()` writes its reasons as
English for the supervisor's dashboard; the learner's debrief renders
`certification.details` (structured `ReasonDetail` values) through `i18n`
instead. Before that, a Hindi debrief printed "below pass mark on
ppe_discipline" verbatim. `tests/app.test.ts` fails if a Hindi debrief carries
an English reason or a raw dimension id.

### 5.6 Speech keys off the script on screen, not the selected language

Because of the fallback chain, a learner who picked Santali is very often
looking at Devanagari. `scriptTag()` in `i18n.ts` inspects what the string is
actually written in, so synthesis does not hand Devanagari to a Santali voice or
Ol Chiki to a Hindi one. `pickVoice()`'s scoring also has to skip Android's
romanized `hi_IN_#Latn` voice, which sits right next to the real one.

### 5.7 Effects and errors carry variant-resolved values

A `set_gas` effect authored as `"{{o2}}"` must be a number by the time a
renderer sees it. `resolveEffects()` coerces and throws if interpolation does
not produce a valid one. Never read `WorldEffect.value` as a string in renderer
code.

### 5.8 Guided teaches, assessment proves, and only one of them certifies

`Competency` extends `Attempted` (`{ mode, hinted }`). `certify()` counts a
variant only when `mode === 'assess' && !hinted`, and says so in its reasons
when it withholds. The gate is in the assessment layer, not the UI, so a new
screen cannot accidentally grant a certificate for a guided run.

Two supporting rules:

- **Assessment mode masks the checklist.** The items render as `—` until a hint
  is taken. They were handing over the answer ("stop the belt", "call the
  control room") on a screen that had just removed the instructions.
- **A `goal` line may not name an action.** It states the situation and the
  objective. `tests/modes.test.ts` rejects a goal containing a UI verb, and
  `validateScenario` rejects a `goal` on a node that is not assessed.

### 5.9 An icon name is a name, not a character

`IconName` values are keys into `PATHS` in `ui/icons.ts`. Assigning one with
`textContent` renders the word. It has shipped twice, both times printing
"contrast" beside the theme label, so `tests/theme.test.ts` now scans the source
and fails if `THEME_ICON[...]` is used anywhere but inside `icon()`. More in
`docs/UI.md`.

### 5.10 A renderer seeds each prop once

Both renderers keep a `#seeded` set. `present()` used to re-add every
non-spawned prop on each step, which quietly undid `despawn`: the standing
helper and the caught helper stood side by side in the conveyor drill on a real
phone, and the desktop never showed it.

### 5.11 The credential's variant digests have to stay recoverable

Each passed variant costs four bytes (a 32-bit FNV-1a digest of the variant id)
rather than its parameters, so the QR stays scannable off a cracked screen.
`admin/replay.ts` makes that trade honest by walking seeds 1..400, sampling each
one's parameters and matching digests, so a supervisor sees `belt C4 · tripped ·
night shift` and can run that identical drill. A digest matching nothing is
reported as unrecognised, not hidden: it means the module was edited after the
credential was issued. If you change how a variant id is built, every issued
credential stops resolving.

### 5.12 The daily quiz cannot reach the thing that certifies

`src/quiz/` is the only place in the product that asks a question instead of
watching a procedure, and the whole argument of the thing is that competence is
a performed procedure rather than six answers. So the wall is explicit: nothing
under `src/quiz/` or `app/quiz.ts` may import `assess/`, `credential/` or
`saveAttempt`, nothing in `src/assess/` may mention the quiz, and
`tests/quiz.test.ts` reads the source and fails if either happens. The screen
tells the learner the same thing in their own language, because a refresher that
looked like an assessment would devalue the one that is.

The day's set is seeded from the local calendar date, not from a random number
and not from UTC: everyone on a site gets the same six questions on the same
day, a shift starting at 06:00 IST gets the new set, and a supervisor can ask
"what was today's third one" and have the crew know.

## 6. The authored scenarios

All three live in `src/scenarios/`, all three declare `requiredVariants: 3`, and
all three put `rescue_restraint` at a pass mark of 100: there is no partial
credit for going in after a casualty before the hazard is controlled.

| | `gas-confined-space` | `fire-explosion` | `machinery-conveyor-loto` |
|---|---|---|---|
| Domain | `gas_leak_confined_space` | `fire_explosion` | `machinery_haulage_loto` |
| Nodes | 21 | 11 | 18 |
| Props | 16 | 9 | 12 |
| Outcomes | pass plus 5 named fatals | pass plus 2 | pass plus 3 |
| Variant params | `gas`, `o2` (15.4-18.9%), `permit_state`, `detector_choice`, `shift` | `ext_layout`, `colleague_offset` | `belt` (C3/C4), `belt_state`, `shift` |
| Languages | en, hi, sat | en, hi, sat | en, hi |

The reachable node count per variant is lower than the total, because
`when`-guarded nodes are spliced out. Re-verify per variant before putting a
number in a deck.

`gas-confined-space` is sited at the pit-top on purpose: non-flameproof
electronics are restricted underground in gassy mines, and induction training is
legally sited at the surface anyway.

`machinery-conveyor-loto` is the one to read if you are learning the data model,
because it exercises the most of it: a `when`-guarded branch on `belt_state`, a
mid-drill `spawn` that replaces the standing helper with the caught one, a fatal
rule for touching a person before the machine is stopped, and a belt number that
varies so a memorised tap sequence isolates the wrong belt.

Citations are pinpointed to specific provisions (CMR 2017 r.104, r.139, r.140,
r.153(2)(b), r.166, r.211, r.243; MVT Rules 1966 r.6, r.28, r.30 and the First
Schedule; OSH Code 2020 s.6(2)(c)), checked against source text, and shown to the
learner on the debrief next to the step each one governs.
`tests/citations.test.ts` rejects any citation without a pinpoint.
`docs/CITATIONS.md` has the verbatim text and the caveats, including that
permit-to-work and the standby person are site procedures rather than
stand-alone regulations, that the CMR 2017 text came from a mirror rather than
the Gazette, and that the Mines Act 1952 was repealed by the OSH Code on
21 November 2025.

To author a new scenario: read `engine/types.ts` top to bottom (it is the whole
data model), then `engine/validate.ts` to see what a broken graph is caught on.
`validateScenario` throws `ScenarioError` with a JSON path per issue; `main.ts`
renders it as a fatal-error screen and `cli/run.ts` prints it.

## 7. Known gaps, and where each one lives

| Gap | Status | Where |
|---|---|---|
| No certified-instructor review | Not started. Procedures come from general practice, not a DGMS-certified sign-off. | content, not code |
| Citations reviewed by a professional | Pinpointed and source-checked, not professionally reviewed | `docs/CITATIONS.md` |
| Santali is complete and entirely unreviewed | Every scenario, the question bank and the interface are authored in Ol Chiki. All 352 lines are machine drafts and none is signed off, so the app now looks finished in a language nobody has checked. Three AR-handshake lines are deliberately left Hindi-only, waiting on a speaker rather than a draft. | `l10n/sat-review.tsv`; the comment above `startingAr` |
| Narration is synthetic | Nothing recorded yet: 133 Hindi lines and 68 Santali across the three drills. The playback path is built and falls back to synthesis, and 15 lines carry a variant placeholder so they stay synthetic by design. | `docs/NARRATION.md`, `node tools/narration.mjs --report` |
| Pass marks are uncalibrated for assessment mode | Tuned against guided prompts. Removing the instructions makes every run harder, especially time-to-first-action. Treat them as a starting point. | `scoring.passMark` in each scenario |
| Per-PC evidence not emitted | NSQF alignment can only be claimed once the credential reports evidence per named performance criterion | `docs/RESEARCH.md` §6.1 |
| Issuance happens in the browser | Demo only, fixed key so another device can verify. A device that signs its own credentials can award itself competence. The verification path is real. | `credential/web-crypto.ts`, `credential/demo-trust.ts` |
| Tier A uses primitive geometry | Shaped, not boxes-per-kind, but still coloured primitives rather than a site twin | `tierA.ts`'s `partsFor()` |
| Tier A on the wider ARCore fleet | Demonstrated working on a real phone; behaviour across budget handsets unmeasured | test with `tools/phone.mjs` |
| Dashboard has no backend | Verifies real credentials, keeps a real roster, but only of what this one device scanned | `admin/store.ts`'s module comment |

## 8. Localization workflow

1. `npm run l10n` reports what is missing across all three scenario files plus
   the hand-written `UI` table in `app/ui/i18n.ts`. It translates nothing.
2. `npm run l10n:draft` calls Bhashini (needs the two env vars), prints drafts,
   writes nothing.
3. `node tools/translate.mjs --dictionary <file.json> --apply` is the offline
   path used for the current coverage: a local `{ "English": "Santali" }` map
   instead of the API. The tool does not care which produced a draft, only that
   every draft is tracked as one.
4. `npm run l10n:apply` writes into the scenario JSON and prints copy-pasteable
   `sat: '...'` lines for `i18n.ts`, which is hand-written source and
   deliberately never auto-edited.
5. **Every string either mode touches is written to `l10n/sat-review.tsv`**
   (path, english, machine_santali, reviewed_by, corrected_santali). That file
   is the deliverable of a translation pass, not the JSON edit. A Santali
   speaker fills in the last two columns per row before any of it is fit to
   train a worker on a lethal procedure. 352 rows exist; none are signed off.

`{{param}}` placeholders are checked to survive the round trip
(`placeholdersSurvived()`); a translation that loses one is skipped with a
warning rather than silently corrupting interpolation.

Three AR-handshake strings are deliberately left un-drafted rather than
machine-translated. See the comment above `startingAr` in `i18n.ts`.

## 9. Tests

132 tests across 15 files, Node's built-in runner, `happy-dom` for the DOM
layers. No mocking framework: fakes are hand-written (injected clocks, fake
voice lists).

| File | Tests | Covers |
|---|---|---|
| `engine.test.ts` | 17 | validation, variant resolution and splicing, the ideal operator through every branch, sequence errors, timeouts via `tick()`, hesitation accounting, observe-node error rules |
| `credential.test.ts` | 16 | base64url, binary codec round trip and rejections, issue/verify, refusal to issue for an ungranted certification, single-byte tamper, unknown issuer, expiry and near-expiry, worst-not-mean, QR ceiling |
| `app.test.ts` | 19 | end-to-end DOM drill flow: pass and named fatal, checklist, spawned props, live language switch, every expected action reachable through the real UI, `.hidden` honoured by the real stylesheet, cross-tier verb agreement, a Hindi debrief carrying no English reasons |
| `assess.test.ts` | 10 | scoring math, fatal flooring, severity weighting, hesitation, null vs zero, contribution traceability, distinct-variant certification, worst-vs-mean |
| `overlay-taps.test.ts` | 9 | dual-channel tap arbitration in isolation |
| `machinery.test.ts` | 8 | the conveyor drill end to end, including the second-victim grab and isolating the wrong belt |
| `tierA-shapes.test.ts` | 8 | geometry construction: a person's feet reach the floor, three distinguishable extinguishers, the sump is an annulus, the conveyor props are not boxes |
| `speech.test.ts` | 7 | script-based voice selection, Ol Chiki vs Devanagari vs romanized Hindi, graceful silence |
| `theme.test.ts` | 7 | light/dark/system semantics, corrupted storage, and the icon-name-as-text guard |
| `narration.test.ts` | 7 | the manifest, clip ids, and that variant-dependent lines stay synthetic |
| `admin.test.ts` | 6 | roster dedupe and merge, a real credential through the real dashboard DOM, garbage rejected, the drills expander |
| `modes.test.ts` | 6 | guided vs assessment behaviour, hinting, and that neither certifies |
| `quiz.test.ts` | 15 | the day's set is stable, moves daily and covers the bank over a year; options shuffle; no option is graded by its own pictogram; the streak survives replays and a broken store; the wall between the quiz and certification; and through the real screen, Santali end to end, a mid-question language switch that keeps the answer, and a result redraw that does not record the day twice |
| `citations.test.ts` | 4 | every citation has a pinpoint and matches the recorded text |
| `l10n.test.ts` | 6 | every declared language resolves every scenario string; fallback chains terminate; and every authored file plus the interface table carries all three languages, with only the three AR lines exempt |
| `replay.test.ts` | 4 | a signed credential turned back into the exact drills it was earned on |

`npm test` should exit `149 pass`, `0 fail`. This suite is the only thing
standing between a scenario-JSON edit and a broken drill on a real phone.

## 10. Where to start for common tasks

- **Add a daily question.** Append to `src/quiz/bank.json`: an id, a domain, a
  localized stem, two or more options with exactly one `correct`, a pictogram
  per option that names the thing rather than grading the answer, and a one-line
  `why` shown after the answer. `daily.ts` validates the bank at load, and the
  day's set redistributes on its own.
- **Add a scenario.** Author JSON next to the others following `Scenario` in
  `engine/types.ts`, validate it, add it to the `MODULES` list in `app/main.ts`
  and the scenario array in `admin/replay.ts`. `DOMAIN_CODES` in
  `credential/codec.ts` already reserves codes for
  `ground_control_and_height` and `electrical_ppe_emergency`.
- **Add a tier.** Implement `WorldRenderer` in a new `render/tier<X>.ts`, add
  its letter to `Tier` in `render/contract.ts` and to `tier.ts`'s `IMPLEMENTED`,
  teach `detectTier` when to choose it, and wire it into `rendererFor()`.
  Nothing in the engine, assessment or credential layers changes; that is the
  point of the boundary. Give it a label and an icon in `main.ts`'s `TIER_LABEL`
  and `TIER_ICON`, which are exhaustive over `Tier`, so the compiler will ask.
- **Move issuance server-side.** `issueCredential` already takes an injected
  `Signer`, and `node-crypto.ts` is the server half, exercised by
  `cli/credential.ts`. The work is a keystore-backed endpoint calling that code,
  a published trust list, and replacing the `createDemoIssuer()` call in
  `results.ts` with a fetch.
- **Emit per-PC evidence.** The blocker on claiming NSQF alignment. Each scored
  node would carry the performance criteria it demonstrates, `scoreResults`
  would aggregate per PC, and the credential or its companion payload would
  report them. See `docs/RESEARCH.md` §6.1 for the exact PC list.
- **Record narration.** `node tools/narration.mjs --report` lists what is
  missing, `--script` prints a recording script, `--manifest --apply` wires the
  clips in. Lines whose words change per variant deliberately stay synthetic.
- **Change the look.** Read `docs/UI.md` first; several rules there exist
  because of a specific bug.

## 11. Submission context

`PPT-BRIEF.md` is the deck content for SIH 2026 problem statement SIH26041. It
describes the pitch. Where a claim there is roadmap rather than shipped, it says
so, but check §7 here before repeating anything from it as built.
