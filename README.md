# Suraksha AR — SIH26041

AR vocational safety training and **competency verification** for Jharkhand's mining, steel and mica workforce.

The product thesis: the gap in the problem statement is not training delivery, it is that *physical certificates have no comprehension-verification mechanism*. AR is the sensor. The verifiable competency credential is the product.

## Where the code is now

The **drill engine**, the **assessment**, the **credential** and the **Tier A + Tier C clients** are built. Tier B (marker tracking) is contracted but not implemented.

```
src/engine/      scenario graph runtime — knows nothing about cameras or meshes
src/assess/      event stream -> competency vector -> certification
src/credential/  compact signed credential, offline QR verification
src/app/         the web client: tier detection, shared HUD, Tier C world
src/scenarios/   authored scenario content (JSON)
src/cli/         headless runner and the end-to-end credential demo
tests/           48 tests, node's built-in runner
```

## Try it

Node 22.6+ (uses native TypeScript type stripping — no build step, no bundler).

```bash
npm install             # devDependencies only: typescript + @types/node
npm test                # 48 tests
npm run check           # tsc --noEmit

npm run run:correct     # an ideal operator walks the gas/confined-space drill
npm run run:trap        # does everything right, then goes in after the collapsed colleague
npm run run:why         # the same run, with every score traced to the node that caused it
npm run run:seeds       # five distinct variants of the same procedure
npm run run:certify     # four variants, aggregated, credential granted or withheld
npm run run:credential  # the whole loop: drill -> certify -> issue -> scan -> verify offline
npm run run:tamper      # the same loop with one payload byte flipped -> rejected

npm run dev             # the client, on your LAN so a phone can reach it
npm run build           # 35 kB gzipped, + 134 kB three.js only on AR devices
```

Open the dev server's Network URL on an Android phone. Query flags: `?lang=en|hi|sat`, `?seed=N`, `?tier=C`, `?worker=ID`.

More: `node --experimental-strip-types src/cli/run.ts --script sniff-test --seed 11 --lang hi --events`

Scripts: `correct`, `second-victim-trap`, `reckless`, `sniff-test`.
Flags: `--seed N`, `--variants N`, `--lang hi,en`, `--step MS`, `--events`.

## The design commitment

**One scenario graph, three renderers.** `DrillSession.dispatch()` takes the same `Action` shape whether it came from a WebXR raycast on an ARCore phone, a marker-tracked overlay, or a tap on a flat 2D screen. The engine and the assessment see an identical event stream in every tier — which is the only reason a certificate can mean the same thing across a workforce holding wildly different handsets.

Consequences that fall out of that, and which the code actually enforces:

- **Assessment is behavioural.** No multiple choice anywhere. The scored signal is action sequence, time-to-first-correct-action, hesitation latency, coded error class, and recovery after induced failure.
- **A competency vector, not a score.** Six dimensions, including `rescue_restraint` — the reflex to climb down after a collapsed colleague, which is what actually kills people in confined spaces. Its pass mark is 100: there is no partial credit for going in.
- **Every wrong action is a named, graded mistake with a stated consequence.** `ErrorRule` carries a stable code, a severity, the dimension it damages, and the narration shown to the learner. A failed run is a debrief, not a red X.
- **Variants are procedurally generated.** Certification requires passing several *distinct* variants (`scoring.requiredVariants`). Seeds are reproducible, so an auditor can replay exactly what a worker faced from the credential alone.
- **Authoring is validated hard.** `validateScenario` checks referential integrity — dangling `next` targets, unbound roles, fatal rules that route nowhere, unreachable nodes — and reports a JSON path an author can act on. Safety officers write these; a broken graph must fail at load, not halfway through a drill.
- **Audio is first-class.** `Narration` carries per-language audio alongside text, because a module must be completable without reading a word.

## The credential

A granted certification issues a **51-byte signed payload** — a 160-character string, QR version 9 at error-correction level M. That size is the whole design constraint: a supervisor scans this off a cracked screen, outdoors, in a coal yard, on a handset that is not new. A JSON-LD verifiable credential is kilobytes, which is a QR so dense it stops scanning under exactly those conditions.

- **ECDSA P-256, raw IEEE P1363 signatures.** Ed25519 is the nicer curve and the wrong one here: the verifier is often an older mid-range Android, and P-256 has been in WebCrypto everywhere for a decade. IEEE P1363 is exactly the encoding WebCrypto produces, so the browser verifier needs no shim.
- **Verification is genuinely offline.** `verifyCredential` takes a trust list and a string. No network, no issuer state.
- **The credential carries the worst attempt, not the mean.** A safety credential should be worth what the holder can do on their bad day.
- **Nothing personal on the wire.** The worker id already printed on their card, and the competency. No name, no biometric, no photograph.
- **The issuer refuses to mint for an ungranted certification** — a credential that can be issued without the drill is worth exactly as much as the paper one.
- Credentials are short-lived by design, because an offline verifier cannot see a revocation list. That trade-off is stated in the verifier warnings rather than hidden.

## The client

`DrillController` owns the session and builds the view; a tier owns only how the world is shown and touched. Prompt, checklist, countdown and consequence banner are drawn by one shared `Hud` — a tier that drew its own countdown could quietly give its learners more time, and two credentials that cost different amounts of time are not the same credential.

**Tier A** is markerless WebXR: hit-test a floor plane, tap once to anchor the work site in the learner's own room, then walk to the sump, crouch to look into it, and turn your back on the standby person to read the detector. The drill is performed with the body rather than the thumb, which is what the retention argument actually rests on.

The HUD in Tier A is not a port. It is the same DOM, drawn by the same `Hud`, floating over the camera feed through WebXR's `dom-overlay` — prompt, checklist, countdown and consequence banner are literally the same code Tier C runs. three.js is dynamically imported only after a session is granted, so a phone that cannot run AR never downloads 134 kB it has no use for.

**Tier C is not a consolation prize.** The learner still hunts the hazard among clutter, still picks a verb rather than a right answer, and is assessed on the identical event stream. The verb sheet is load-bearing: you touch the thing, then choose what you do to it, so climbing into a confined space is a deliberate named act and never a stray tap. `WorldEffect`s drive the world — the casualty is genuinely absent from the scene until a `spawn` fires, the blower greys out when it trips, and the alarm reaches a gloved hand through `navigator.vibrate`.

Tier detection reports **two** answers on the start screen: the best tier the device supports, and the tier actually being served. Conflating them is how a pitch ends up claiming AR coverage it does not have.

No web fonts, no CDN. The app has to work with the radio off.

## The authored scenario

`gas-confined-space` — cleaning a settling sump at a coal handling plant pit-top. Surface location by design: non-flameproof electronics are restricted underground in gassy mines, and induction training is legally sited at the surface anyway.

Eighteen or nineteen nodes depending on variant, covering permit-to-work, gas testing before entry, purge and re-test, breathing set and retrieval line, standby person, an induced ventilation failure mid-task, and the second-victim rescue decision.

English and Hindi are authored throughout; Santali (Ol Chiki) is present on two nodes only, and `availableLanguages()` reports it as unavailable rather than pretending otherwise.

## Known gaps — read before pitching

- **Every regulation citation in the scenario JSON is a placeholder.** They name the right instruments (Mines Act 1952, Mines Vocational Training Rules 1966, DGMS confined-space guidance) but no clause numbers have been verified. Replace each `cite` with the exact provision, checked against the source, before this is shown as compliant with anything.
- **The scenario has not been reviewed by a certified instructor.** The procedure is drawn from general confined-space practice. It needs sign-off from someone DGMS-certified before it trains anyone.
- **Tier A has never run on real hardware.** It is written against the WebXR hit-test and dom-overlay specs and it type-checks and builds, but no ARCore device has executed it in this repo. Treat it as unproven until it has been on a phone.
- **Tier A uses primitive geometry, not models.** Coloured boxes and capsules with canvas labels, arranged on a fixed arc. Fixed slots rather than a random scatter is deliberate — two learners in different rooms must walk the same distances or their time-to-first-action numbers stop being comparable — but this is placeholder art, not a site twin.
- **Tier B (marker tracking) is not built.** It is contracted in `render/contract.ts`; the app falls back to Tier C loudly rather than mounting a renderer that would show a black screen.
- **Issuing happens in the browser** in the current demo, which is a shortcut and a loud one: a device that can sign its own credentials can award itself competence. Real issuance is server-side with a managed keystore, a published trust list and a rotation plan. The *verification* path is real.
- **Speech synthesis is a stand-in for recorded narration.** The languages this has to reach — Santali, Ho, Mundari, Kurukh — have no synthetic voice worth using. `Narration.audio` already carries the clips; they have not been recorded.
