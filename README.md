# Suraksha AR: SIH26041

AR vocational safety training and **competency verification** for Jharkhand's mining, steel and mica workforce.

The product thesis: the gap in the problem statement is not training delivery, it is that *physical certificates have no comprehension-verification mechanism*. AR is the sensor. The verifiable competency credential is the product.

## Where the code is now

The **drill engine**, the **assessment**, the **credential**, the **Tier A + Tier C clients**, an installable **offline PWA shell**, a **Trusted Web Activity Android APK**, and a **web compliance dashboard** are built. Tier B (marker tracking) is contracted but not implemented. Three scenarios are authored, one for each domain SIH26041 names (gas leaks, fire response and machinery hazards): `gas-confined-space`, `fire-explosion` and `machinery-conveyor-loto`, all reachable from an in-app module picker.

Live: **https://notarnav03.github.io/suraksha-ar/** (worker app) and **`/admin.html`** (compliance dashboard), redeployed automatically on every push to `main`.

```
src/engine/      scenario graph runtime, knows nothing about cameras or meshes
src/assess/      event stream -> competency vector -> certification
src/credential/  compact signed credential, offline QR verification
src/app/         the web client: tier detection, shared HUD, module picker, Tier A/C worlds, the drawn pictogram set
src/admin/       compliance dashboard: verifies scanned credentials, recovers the drills behind them, no backend
src/scenarios/   authored scenario content (JSON): gas-confined-space, fire-explosion, machinery-conveyor-loto
src/quiz/        the daily ninety-second refresher: question bank and the day's deterministic set
src/cli/         headless runner and the end-to-end credential demo
public/          PWA manifest, service worker, icons; see docs/APK.md for the Android build
docs/            RESEARCH (the landscape), CITATIONS (the regulation text), UI (the design system), NARRATION, APK
tests/           149 tests, node's built-in runner
```

## Try it

Node 22.6+ (uses native TypeScript type stripping, so no build step and no bundler).

```bash
npm install             # devDependencies only: typescript + @types/node
npm test                # 149 tests
npm run check           # tsc --noEmit

npm run run:correct     # an ideal operator walks the gas/confined-space drill
npm run run:trap        # does everything right, then goes in after the collapsed colleague
npm run run:why         # the same run, with every score traced to the node that caused it
npm run run:seeds       # five distinct variants of the same procedure
npm run run:certify     # four variants, aggregated, credential granted or withheld
npm run run:credential  # the whole loop: drill -> certify -> issue -> scan -> verify offline
npm run run:tamper      # the same loop with one payload byte flipped -> rejected

npm run dev             # the client, on your LAN so a phone can reach it
npm run build           # 69 kB gzipped on first load, + 133 kB three.js only on AR devices
```

Open the dev server's Network URL on an Android phone. Query flags: `?lang=en|hi|sat`, `?seed=N`, `?tier=C`, `?worker=ID`, `?scenario=gas-confined-space|fire-explosion|machinery` (deep-links past the module picker).

Building the Android APK is a separate, one-time-setup process; see `docs/APK.md`.

More: `node --experimental-strip-types src/cli/run.ts --script sniff-test --seed 11 --lang hi --events`

Scripts: `correct`, `second-victim-trap`, `reckless`, `sniff-test`.
Flags: `--seed N`, `--variants N`, `--lang hi,en`, `--step MS`, `--events`.

## The design commitment

**One scenario graph, every tier on one event stream.** `DrillSession.dispatch()` takes the same `Action` shape whether it came from a WebXR raycast on an ARCore phone or a tap on a flat 2D screen. The engine and the assessment see an identical event stream in every tier, which is the only reason a certificate can mean the same thing across a workforce holding wildly different handsets.

Consequences that fall out of that, and which the code actually enforces:

- **Two modes, and only one of them certifies.** *Show me* walks the learner through each step by name, which is the right thing to say the first time someone meets a procedure. *Prove it* replaces every instruction with the situation ("The belt is running, with coal packed at the tail pulley. Make it safe to work on.") and nothing else. A learner who is stuck can ask for the step, which hands it over and marks the run as not counting. Guided and hinted runs teach; only an unaided assessment run earns a certificate, and `certify` enforces that rather than the UI. A test rejects any goal line that names a verb, a tap or an order, because without it the assessment text drifts back into instructions one helpful edit at a time.
- **Assessment is behavioural.** No multiple choice anywhere in the part that certifies. The scored signal is action sequence, time-to-first-correct-action, hesitation latency, coded error class, and recovery after induced failure.
- **The daily ninety seconds is the one exception, and it is walled off.** Six questions, new every day, seeded by the date so a whole crew gets the same set and a supervisor can ask about it at the toolbox talk. It exists because a drill passed in February is half-forgotten by April, and because the slot that reliably exists on a site is the few minutes before the shift. It writes no attempt, `certify()` has never heard of it, and a test fails if either of those stops being true. The screen says so too, in the worker's own language.
- **A competency vector, not a score.** Six dimensions, including `rescue_restraint`, the reflex to climb down after a collapsed colleague, which is what actually kills people in confined spaces. Its pass mark is 100: there is no partial credit for going in.
- **Every wrong action is a named, graded mistake with a stated consequence.** `ErrorRule` carries a stable code, a severity, the dimension it damages, and the narration shown to the learner. A failed run is a debrief, not a red X.
- **Variants are procedurally generated.** Certification requires passing several *distinct* variants (`scoring.requiredVariants`). Seeds are reproducible, so an auditor can replay exactly what a worker faced from the credential alone.
- **Authoring is validated hard.** `validateScenario` checks referential integrity (dangling `next` targets, unbound roles, fatal rules that route nowhere, unreachable nodes) and reports a JSON path an author can act on. Safety officers write these; a broken graph must fail at load, not halfway through a drill.
- **Audio is first-class.** `Narration` carries per-language audio alongside text, because a module must be completable without reading a word.

## The credential

A granted certification issues a **51-byte signed payload**: a 160-character string, QR version 9 at error-correction level M. That size is the whole design constraint: a supervisor scans this off a cracked screen, outdoors, in a coal yard, on a handset that is not new. A JSON-LD verifiable credential is kilobytes, which is a QR so dense it stops scanning under exactly those conditions.

- **ECDSA P-256, raw IEEE P1363 signatures.** Ed25519 is the nicer curve and the wrong one here: the verifier is often an older mid-range Android, and P-256 has been in WebCrypto everywhere for a decade. IEEE P1363 is exactly the encoding WebCrypto produces, so the browser verifier needs no shim.
- **Verification is genuinely offline.** `verifyCredential` takes a trust list and a string. No network, no issuer state.
- **The credential carries the worst attempt, not the mean.** A safety credential should be worth what the holder can do on their bad day.
- **The drills are recoverable from the credential itself.** Each variant costs four bytes, not the parameters, so the QR stays scannable. The dashboard walks the seeds, matches the digests, and shows a supervisor what the worker actually faced (`belt C4 · tripped · night shift`), with a link that runs that identical drill. A digest that matches nothing is reported rather than hidden: it means the module was edited after the credential was issued.
- **Nothing personal on the wire.** The worker id already printed on their card, and the competency. No name, no biometric, no photograph.
- **The issuer refuses to mint for an ungranted certification.** A credential that can be issued without the drill is worth exactly as much as the paper one.
- Credentials are short-lived by design, because an offline verifier cannot see a revocation list. That trade-off is stated in the verifier warnings rather than hidden.

## The client

`DrillController` owns the session and builds the view; a tier owns only how the world is shown and touched. Prompt, checklist, countdown and consequence banner are drawn by one shared `Hud`. A tier that drew its own countdown could quietly give its learners more time, and two credentials that cost different amounts of time are not the same credential.

**Tier A** is markerless WebXR: hit-test a floor plane, tap once to anchor the work site in the learner's own room, then walk to the sump, crouch to look into it, and turn your back on the standby person to read the detector. The drill is performed with the body rather than the thumb, which is what the retention argument actually rests on.

The HUD in Tier A is not a port. It is the same DOM, drawn by the same `Hud`, floating over the camera feed through WebXR's `dom-overlay`: prompt, checklist, countdown and consequence banner are literally the same code Tier B runs. three.js is dynamically imported only after a session is granted, so a phone that cannot run AR never downloads 133 kB it has no use for.

**Tier C is not a consolation prize.** The learner still hunts the hazard among clutter, still picks a verb rather than a right answer, and is assessed on the identical event stream. The verb sheet is load-bearing: you touch the thing, then choose what you do to it, so climbing into a confined space is a deliberate named act and never a stray tap. `WorldEffect`s drive the world: the casualty is genuinely absent from the scene until a `spawn` fires, the blower greys out when it trips, and the alarm reaches a gloved hand through `navigator.vibrate`.

Tier detection reports **two** answers on the start screen: the best tier the device supports, and the tier actually being served. Conflating them is how a pitch ends up claiming AR coverage it does not have.

**The interface is drawn, not borrowed.** Every pictogram is an inline SVG in `src/app/ui/icons.ts`, in the language of safety signage: flat, one weight, inheriting the ink of whatever it sits on. Emoji used to do this job, which meant a gear for a conveyor, a biohazard trefoil for a pile of coal, and a wrench for "operate this control", a vendor's house style standing in for a sign a worker already knows. Objects a drill asks you to find (the isolator, the padlock, the pull cord, the tag) each get their own glyph, because a learner who cannot read the label has nothing else to go on.

The rest of the surface is built to be picked up rather than admired. The ground carries the faint ruled grid of a mine plan; panels are lit from above, with a highlight along the top edge and a hard shadow for the edge plus a soft one for the air beneath. The primary action is built like the button on a starter panel: a lit top face, a darker bottom face, a solid edge underneath and four pixels of real travel, because through a glove a colour change alone reads as nothing having happened. Motion is rationed and all of it does something: the drill's prop grid deals itself out so the scene reads as being set in front of you, the hazard tile pulses five times and then stops, the countdown runs crawling barrier-tape stripes once time is against you, and the certificate lands like a stamp on a permit. Nothing loops forever, and `prefers-reduced-motion` strips all of it except the alarm and the tap receipt, which carry information. `docs/UI.md` is the full design system, including the rules that exist because of a specific bug.

No web fonts, no CDN. The app has to work with the radio off.

## The authored scenarios

`gas-confined-space`: cleaning a settling sump at a coal handling plant pit-top. Surface location by design: non-flameproof electronics are restricted underground in gassy mines, and induction training is legally sited at the surface anyway. Twenty-one authored nodes, fewer reachable in any one variant, covering permit-to-work, gas testing before entry, purge and re-test, breathing set and retrieval line, standby person, an induced ventilation failure mid-task, and the second-victim rescue decision.

`fire-explosion`: an electrical panel fire at the pit-top: hazard recognition, choosing the correct extinguisher class (never water on a live electrical fire), the PASS technique, donning a self-rescuer, and evacuating without re-entering for a collapsed colleague, the same second-victim-restraint reflex `gas-confined-space` measures, in a different domain.

`machinery-conveyor-loto`: a jammed belt conveyor at the coal handling plant. The learner spots the jam and the helper's loose gamchha, stops the belt if it is still running, and then the belt restarts and catches the helper. The fatal reflex is the machinery version of the second-victim one: grabbing a person caught in a machine before the machine is stopped. After that come isolating the *right* belt (the belt number varies, so a memorised tap sequence isolates the wrong one), padlock and tag, a try-start test, first aid, clearing the jam, and handing the belt back. Variants cover belt C3 or C4, running or tripped, and three shifts. Going to the helper before the lock-out does not end the drill, but it withholds the certificate, because rescue restraint has no partial credit.

All three languages are authored everywhere: three scenarios, the daily question bank and the interface, with three deliberate exceptions. `npm run l10n` reports zero missing scenario strings. A test fails if an edit adds an English and a Hindi line and stops there, which is how this would come undone without anyone noticing, because the fallback chain would quietly serve the Hindi.

The Santali is an **AI machine draft**, not a reviewed translation. All 352 lines are recorded in `l10n/sat-review.tsv` against their English source, none is signed off, and none of it is fit to present to a worker as training until a Santali speaker has been through it row by row. The three exceptions are the AR-handshake status lines, deliberately left Hindi-only rather than machine-drafted at all, for the reason given above `startingAr` in `src/app/ui/i18n.ts`: they are waiting on a speaker to write them, not on one to review a guess.

## Known gaps, read before pitching

- **Regulation citations are pinpointed, but not yet reviewed by a professional.** Every `cite` now names a specific provision (Coal Mines Regulations 2017, Mines Vocational Training Rules 1966, OSH Code 2020 s.6), was checked against the source text, and is shown to the learner on the debrief. `docs/CITATIONS.md` records the verbatim text and the caveats: permit-to-work and the standby person are site procedures rather than stand-alone regulations, the CMR 2017 text came from a mirror rather than the Gazette, and the Mines Act 1952 was repealed by the OSH Code on 21 Nov 2025. `tests/citations.test.ts` rejects any citation without a pinpoint.
- **No scenario has been reviewed by a certified instructor.** All three procedures are drawn from general practice, not a DGMS-certified sign-off.
- **The Santali is complete and entirely unreviewed.** 352 lines, all of them machine drafts, none signed off. `l10n/sat-review.tsv` is the sheet a speaker works through. Complete coverage makes this gap easier to miss, not smaller: the app now looks finished in a language nobody has checked.
- **The admin dashboard has no backend.** It verifies real signed credentials and keeps a real roster, but only of whatever this one device has scanned; see the module comment in `src/admin/store.ts` for what a real multi-supervisor deployment still needs.
- **Tier A has been demonstrated working on a real phone at the ISIH presentations.** Behaviour across the wider range of ARCore handsets has not been measured yet.
- **The pass marks were tuned against guided prompts, and assessment mode has not been calibrated.** Removing the instructions makes every run harder, especially time-to-first-action, and nobody has yet run the unaided version with real workers. Treat the current thresholds as a starting point, not a standard, and expect them to move once there is data. There is also a risk in the other direction: a first-time smartphone user may fail a step because the two-tap verb sheet is unfamiliar rather than because the procedure is, which is what the guided run before it exists to prevent.
- **Tier A uses primitive geometry, not models.** People, PPE, structures and the fire extinguishers are built from multiple shaped primitives now (a person reads as a person, an extinguisher reads as an extinguisher, see `src/app/render/tierA.ts`'s `partsFor`), not boxes-per-kind, but they're still coloured geometry, not a site twin. Fixed slots rather than a random scatter is deliberate: two learners in different rooms must walk the same distances or their time-to-first-action numbers stop being comparable.
- **Issuing happens in the browser** in the current demo, signed with a fixed demo key (`src/credential/demo-trust.ts`, chosen deliberately over a random-per-session key so a credential can be verified on a *different* device, see that file's comment), which is a shortcut and a loud one: a device that can sign its own credentials can award itself competence. Real issuance is server-side with a managed keystore, a published trust list and a rotation plan. The *verification* path is real.
- **Speech synthesis is a stand-in for recorded narration.** The languages this has to reach (Santali, Ho, Mundari, Kurukh) have no synthetic voice worth using, and Ol Chiki is never spoken at all rather than being handed to a Devanagari voice. The app now plays a recorded clip wherever one exists and falls back to the synthetic voice everywhere else, so recording is the only step left: see `docs/NARRATION.md` and `node tools/narration.mjs --report`. Nothing has been recorded yet, and lines whose words change per variant deliberately stay synthetic.
