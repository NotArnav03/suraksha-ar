# SIH26041: Idea PPT content

**Suraksha AR: an AR safety drill that scores what a worker does, and a certificate that can be checked with no network**

Physical safety certificates have no comprehension-verification mechanism. This
product's job is not "AR training". It is turning a phone-camera drill into a
scored record of performed behaviour, and binding that score into a
cryptographically signed credential a supervisor can check at a gate with the
radio off.

Use the official SIH2026 template (`SIH2026-IDEA-Presentation-Format (1).pptx`).
Everything below is the content for its six slides, in order. Diagrams are
described where they belong; build them as clean flow diagrams and trees, not
screenshots.

Every claim here is either implemented or explicitly flagged as roadmap.
`DOCUMENTATION.md` §7 is the gap list; `docs/RESEARCH.md` §3 is the evidence
audit. Read both before a Q&A.

---

## Slide 1: Title

- **Problem Statement ID**: SIH26041
- **Problem Statement Title**: AR-Based Vocational Training Simulator for Industrial Safety
- **Theme**: *(exact wording from the SIH portal listing for PS26041)*
- **PS Category**: Software
- **Team ID / Team Name**: *(from the portal)*

---

## Slide 2: Proposed Solution

### Detailed explanation of the proposed solution

- A phone-only AR simulator, no headset. Each authored scenario runs in two
  renderer tiers off one engine, markerless AR on a phone that supports it and a
  flat interactive world on one that does not, so it works on any Android 10+
  handset a worker already owns.
- The learner performs the procedure: checks the permit, tests the atmosphere,
  isolates the belt, decides whether to go in after a colleague. No multiple
  choice anywhere in the product.
- **Two modes, and only one of them certifies.** *Show me* names each step, which
  is the right thing to do the first time someone meets a procedure. *Prove it*
  gives the situation and nothing else. A learner who is stuck can ask for the
  step, which hands it over and marks the run as not counting.
- Every action is scored into a six-dimension competency vector and, once
  several distinct randomised variants have been passed unaided, issued as a
  51-byte signed credential that verifies offline.

### How it addresses the problem

- **The assessment gap.** A completion record says a worker attended. This
  measures action sequence, time to first correct action, hesitation, coded
  error class and recovery after an induced failure, so the certificate says
  what they can do.
- **The verification gap.** Today's paper card cannot be checked at a gate.
  This one is checked by cryptography, on the supervisor's own phone, with
  **zero network connectivity**, in milliseconds.
- **The proxy-certification gap.** Certification needs several *distinct*
  procedurally randomised variants, so memorising one run earns nothing, and an
  auditor can recover from the credential itself exactly which drills were
  passed and re-run them.
- **The access gap.** Voice-first, Hindi throughout, Santali (Ol Chiki) in two of
  three scenarios, and a completion path that needs no reading.

### Innovation and uniqueness

- One scenario graph, every tier on the same event stream, so a credential
  means the same thing across a workforce holding mismatched handsets. Every headset
  vendor solves the opposite problem: maximum fidelity for one device class.
- **`rescue_restraint` is a named zero-tolerance dimension**, not a line item
  inside a pass mark. Going in after a collapsed colleague before the hazard is
  controlled is the reflex that turns one casualty into two, and it has a pass
  mark of 100.
- Nobody occupies this quadrant. Training simulators produce completion records;
  credential platforms cannot author or score a drill.

### Diagram: the empty quadrant

Two axes. Horizontal: *is the credential verifiable offline by cryptography?*
Vertical: *is the assessment performed behaviour, or attendance and a quiz?*

- Top left: contractor-compliance platforms, card schemes.
- Top right: DigiLocker, Skill India Digital, Open Badges.
- Bottom left: VR and AR training vendors, including VRMS at IIT (ISM) Dhanbad.
- **Bottom right: empty. Suraksha AR.**

This is the strongest single slide in the deck. It positions against the
state-backed VR effort 40 km from the problem without disparaging it.

---

## Slide 3: Technical Approach

### Technologies used

- **Client**: WebXR plus three.js for markerless AR, DOM for the universal flat
  tier. One shared TypeScript engine and event model drives both. Installable
  PWA, plus a Trusted Web Activity Android APK.
- **Content**: scenarios are authored as JSON graphs (branching steps, timers, a
  graded error taxonomy, per-step regulation citations) and validated at load
  for referential integrity, so a safety officer can author without code and a
  broken graph fails immediately rather than halfway through a drill.
- **Assessment**: a six-dimension competency vector; the credential carries the
  worst attempt rather than the mean, because a safety credential should be
  worth what the holder can do on their bad day.
- **Credential**: ECDSA P-256 over a 51-byte binary payload, IEEE P1363
  signatures, rendered as a QR version 9 at error-correction level M, verified in
  any browser through WebCrypto with no network and no issuer lookup.
- **Not yet built**: crew-dashboard sync and peer content distribution are
  roadmap. The dashboard today verifies real credentials on one device.

### Methodology

- A scenario is a graph of Brief, Observe, Expect and Outcome nodes, each citing
  the provision it enforces (Coal Mines Regulations 2017, Mines Vocational
  Training Rules 1966, OSH Code 2020 s.6).
- The runtime is tier-agnostic: every renderer emits an identical Action,
  Verdict, Event stream, so a drill scores the same way on any tier.
- A seeded variant generator randomises the hazard, the equipment state, the
  readings and the shift, so no two certification attempts are identical and
  every one of them is reproducible from its seed.

### Diagram: tiered rendering

**Scenario Graph** fans out to **Tier A, markerless AR** and **Tier B, flat
interactive**, and both converge on **Competency Engine**, then **Signed
Credential**. The point of the diagram is the convergence: two ways to see the
world, one way to be assessed.

### Diagram: the decision tree, from the real drill

Use the actual conveyor lock-out graph rather than a generic flowchart:

**Brief: jammed belt** → **Spot the hazards** *(live belt, loose gamchha)* →
**Stop the belt** → *[the belt restarts and catches the helper]* → **Rescue
decision**, branching into **FATAL: grabbed him before isolating** and the
correct path → **Isolate the right belt** *(the belt number varies by variant)*
→ **Lock, tag, try-start test** → **First aid, clear the jam, hand back** →
**PASS**.

The fatal branch is the most important box in the deck. Make it red.

---

## Slide 4: Feasibility and Viability

### Feasibility

- Runs on hardware workers already carry. No capital cost, no device to issue or
  maintain, no headset to book.
- Digitises an obligation that already exists in law. The Mines Vocational
  Training Rules 1966 mandate initial and refresher training; the Occupational
  Safety, Health and Working Conditions Code 2020, in force from 21 November
  2025, carries the employer's duty to provide it (s.6(2)(c)). No new process to
  sell to a site: same training slot, same trainer, a better instrument.
- Built on mature open technology, WebXR, three.js and standard ECDSA, with no
  proprietary licensing risk.
- **It already runs.** Three scenarios, both modes, offline verification, an
  auditor replay path and a supervisor dashboard are built and deployed, tested
  on real Android hardware.

### The route to national recognition

Position it correctly and this is not a rival credential. The Skill Council for
Mining Sector writes the standards; NCVET recognises Awarding Bodies and,
separately, **Assessment Agencies**. This product is the instrument an
Assessment Agency uses, feeding an awarding body that deposits into DigiLocker.

The Electronic Skill Credential Standard (MSDE/DGT, 2019) already specifies an
offline QR path that embeds the signature for verification without the cloud,
which is exactly what the 51-byte payload does. Skill India Digital's QR resolves
to a live page; a pit-top in Jharkhand frequently has no signal. **The national
system verifies where there is signal. This verifies where there is not.**

### Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Budget phones lack ARCore | High | Three tiers, same event stream, same certificate on any of them |
| No signal at the worksite | High | Offline PWA, and verification that never touches the network |
| Low literacy, first-time smartphone users | High | Voice-first, drawn safety pictograms, a guided mode before any assessed run |
| Proxy or fraudulent certification | Medium | Several distinct randomised variants required; guided and hinted runs never count; every passed variant recoverable and replayable from the credential |
| A device that signs its own credentials | High, and currently open | Issuance is in-browser in the demo and must move server-side to a managed keystore with a published trust list. The verification path is already real. |

Naming the last one before a judge does is the difference between a team that
knows what it built and a team that does not.

---

## Slide 5: Impact and Benefits

### Impact on the target audience

- Directly targets the cohort the problem statement names: newly recruited
  workers, many of them in an industrial setting for the first time, in their
  first thirty days, which is when the fatality risk is concentrated.
- Gives a worker a portable, employer-independent proof of competence. For many
  it will be the first verifiable digital credential of any kind they hold.
- Targets a specific killer rather than safety in general. The rescue chain, one
  person down and a second going in unprotected, recurs incident after incident
  in Indian confined-space deaths, and it is the one reflex this product refuses
  to give partial credit for.

### Benefits

- **Social**: training and certification in the worker's own language, with a
  path that requires no reading.
- **Economic**: fewer lost-time incidents, lower audit and compliance overhead,
  no training-centre downtime, no hardware to buy.
- **Environmental**: fewer uncontrolled releases and equipment-failure incidents
  from better-drilled emergency response.

### Diagram: what the certificate says

Two cards side by side.

**Today**: a paper card. *Name. Course. Date. Signature.* Underneath: "proves
attendance. Cannot be checked at the gate."

**This**: a QR. *Worker ID. Domain. Six-dimension competency vector, worst
attempt. Three distinct variants passed. Expiry.* Underneath: "checked by
cryptography in milliseconds, with the radio off."

Use this rather than a retention curve. The commonly quoted "under 20% recall in
a week" traces to Ebbinghaus in 1885, on nonsense syllables, in a lab, with no
mining-workforce study behind it, and the AR literature does not currently
support a retention claim for AR specifically (Gong et al., *Safety Science* 178,
2024: no significant difference against traditional training on knowledge
acquisition). Leading on a figure a knowledgeable judge can dismantle costs more
than it gains. The honest framing is stronger and is the one this product is
actually built on: **AR is the cheapest instrument that turns a safety
assessment from a quiz into a performance, on hardware the workforce already
owns.**

---

## Slide 6: Research and References

**Regulation and mandate**
- Occupational Safety, Health and Working Conditions Code 2020, s.6(2)(c),
  in force 21 November 2025, repealing the Mines Act 1952
- Mines Vocational Training Rules 1966 (r.6, r.28, r.30, First Schedule)
- Coal Mines Regulations 2017 (r.104, r.139, r.140, r.153, r.166, r.211, r.243)
- Metalliferous Mines Regulations 1961
- Jharkhand OSH and Working Conditions Rules (draft, 2025)
- DGMS circulars and Annual Statistics of Mines
- Digital Personal Data Protection Act 2023

**Skilling and credentialing**
- Skill Council for Mining Sector, QP MIN/Q3203 and NOS MIN/N1702 to N1704
- NCVET Assessment Agency recognition, and the micro-credential guidelines (2023)
- Electronic Skill Credential Standard v1.0 (MSDE/DGT, 2019), offline QR mode
- DigiLocker and Skill India Digital Hub

**Evidence, technology and method**
- Scorgie et al., *Safety Science* 171 (2024) 106372: systematic review, VR
  outperforms traditional safety training
- Gong, Lu, Lovreglio, Lv and Chi, *Safety Science* 178 (2024) 106624: AR has a
  positive overall effect but no significant advantage on knowledge acquisition;
  cite this honestly rather than around it
- Kirkpatrick four-level training evaluation
- NIOSH confined-space rescuer fatality data
- W3C Verifiable Credentials, Open Badges v2
- Google ARCore and the WebXR Device API
