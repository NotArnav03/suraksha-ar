# Suraksha AR — SIH26041

AR vocational safety training and **competency verification** for Jharkhand's mining, steel and mica workforce.

The product thesis: the gap in the problem statement is not training delivery, it is that *physical certificates have no comprehension-verification mechanism*. AR is the sensor. The verifiable competency credential is the product.

## Where the code is now

The tier-agnostic **drill engine** is built and tested. Renderers, assessment scoring and the credential are not yet.

```
src/engine/     scenario graph runtime — knows nothing about cameras or meshes
src/scenarios/  authored scenario content (JSON)
src/cli/        headless runner
tests/          15 tests, node's built-in runner
```

## Try it

Node 22.6+ (uses native TypeScript type stripping — no build step, no bundler).

```bash
npm install          # devDependencies only: typescript + @types/node
npm test             # 15 tests
npm run check        # tsc --noEmit

npm run run:correct  # an ideal operator walks the gas/confined-space drill
npm run run:trap     # does everything right, then goes in after the collapsed colleague
npm run run:seeds    # five distinct variants of the same procedure
```

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

## The authored scenario

`gas-confined-space` — cleaning a settling sump at a coal handling plant pit-top. Surface location by design: non-flameproof electronics are restricted underground in gassy mines, and induction training is legally sited at the surface anyway.

Eighteen or nineteen nodes depending on variant, covering permit-to-work, gas testing before entry, purge and re-test, breathing set and retrieval line, standby person, an induced ventilation failure mid-task, and the second-victim rescue decision.

English and Hindi are authored throughout; Santali (Ol Chiki) is present on two nodes only, and `availableLanguages()` reports it as unavailable rather than pretending otherwise.

## Known gaps — read before pitching

- **Every regulation citation in the scenario JSON is a placeholder.** They name the right instruments (Mines Act 1952, Mines Vocational Training Rules 1966, DGMS confined-space guidance) but no clause numbers have been verified. Replace each `cite` with the exact provision, checked against the source, before this is shown as compliant with anything.
- **The scenario has not been reviewed by a certified instructor.** The procedure is drawn from general confined-space practice. It needs sign-off from someone DGMS-certified before it trains anyone.
- **No scoring yet.** `NodeResult` is the input the competency scorer will consume; the scorer, the credential and the offline QR verification are the next build.
- **No renderer yet.** Tier A (WebXR hit-test), Tier B (marker) and Tier C (flat 2D) all attach to `DrillSession` and none exist.
