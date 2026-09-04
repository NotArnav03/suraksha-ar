# SIH26041 — Idea PPT content

**Suraksha AR — AR Safety Training with a Verifiable Competency Certificate**

Physical safety certificates today have no comprehension-verification mechanism. This product's job is not "AR training" — it's turning a phone-camera drill into a cryptographically signed, offline-verifiable proof that a specific worker can actually perform a specific safety procedure.

Use the official SIH2026 template (`SIH2026-IDEA-Presentation-Format (1).pptx`). Everything below is the content for its six slides, in order. Diagrams are described wherever they belong — build them as clean flow diagrams / trees, not screenshots.

---

## Slide 1 — Title

- **Problem Statement ID**: SIH26041
- **Problem Statement Title**: AR-Based Vocational Training Simulator for Industrial Safety
- **Theme**: *(exact wording from the SIH portal listing for PS26041)*
- **PS Category**: Software
- **Team ID / Team Name**: *(from the portal)*

---

## Slide 2 — Proposed Solution

### Detailed explanation of the proposed solution

- Phone-only AR simulator — no headset. One authored scenario runs in three renderer tiers (markerless AR, marker-tracked AR, flat 2D) so it works on any Android 10+ handset a worker actually owns.
- The learner performs the real procedure — checking a permit, testing for gas, wearing PPE, deciding whether to attempt a rescue — inside a re-creation of their own worksite, not a multiple-choice quiz.
- Every action is scored into a six-dimension competency vector and turned into a signed, offline-verifiable digital certificate.

### How it addresses the problem

- Fixes the retention collapse: classroom training drops under 20% recall in a week. Spaced 90-second AR micro-drills are pushed into the daily pre-shift toolbox talk instead.
- Fixes the verification gap: today's paper certificates prove nothing. This certificate is cryptographically signed and scan-verifiable with **zero network connectivity**.
- Fixes the access gap: fully voice-first, in Hindi plus the region's tribal languages, with a zero-text completion path for low-literacy workers.

### Innovation and uniqueness of the solution

- One scenario graph, three renderers — the same assessment and the same certificate regardless of which tier a phone runs.
- The killer reflex — rushing to rescue a collapsed colleague without protection — is modelled as its own zero-tolerance competency dimension, not buried inside a pass/fail score.
- Certification requires passing several procedurally randomised variants of the same drill, so memorising one run earns nothing.

### Diagram — the certification loop

A left-to-right cycle of five steps, looping back on itself:

**Induction Briefing → AR Scenario Drill → Competency Vector Scored → Signed Credential Issued → Daily Micro-Drill** — then loops back into another AR Scenario Drill. Mark "Signed Credential Issued" as the payoff moment. Add a small side note near the end: *"Decay Alert → triggers re-drill."*

---

## Slide 3 — Technical Approach

### Technologies to be used

- **Client**: WebXR + three.js for markerless AR; image-marker tracking as a fallback tier; Canvas/DOM for the universal flat tier — one shared TypeScript engine and event model drives all three.
- **Content**: scenarios are authored as JSON graphs — branching steps, timers, a graded error taxonomy — editable by a certified safety officer with no code.
- **Credential**: ECDSA P-256 signed compact binary payload (~50 bytes) encoded as a QR code, verifiable offline in any browser via WebCrypto.
- **Backend**: lightweight sync for crew dashboards and retention analytics; content distributes over Wi-Fi Direct where signal is poor.

### Methodology and process for implementation

- A scenario is a graph of Brief → Observe → Expect → Outcome nodes, each citing the exact regulation it enforces.
- The runtime is tier-agnostic: every renderer emits an identical Action → Verdict → Event stream, so a drill run on any tier scores exactly the same way.
- A seeded variant generator randomises hazard type, permit state, and readings, so no two certification attempts are identical.

### Diagram — tiered rendering architecture

A fan-out-then-converge flow:

**Scenario Graph** → fans out to three parallel renderers: **Tier A — Markerless AR**, **Tier B — Marker AR**, **Tier C — Flat 2D** → all three converge into **Competency Engine** → **Signed Credential**.

### Diagram — scenario decision tree

A top-to-bottom branching tree, using the actual structure of the authored gas/confined-space drill, to show real depth rather than a generic flowchart:

**Brief: Task Assigned** → **Observe Hazards** → **Check Permit** *(branches: Valid / Expired / Absent)* → **Test · Ventilate · PPE · Standby** → **Entry** → **Evacuate** *(triggered by an induced equipment failure)* → **Rescue Decision**, which branches into two colored outcomes: **PASS** and **FATAL: Second-Victim Entry**. The fatal branch — going in after a collapsed colleague without protection — is the single most important box in the deck; make it visually stand out (red).

---

## Slide 4 — Feasibility and Viability

### Analysis of the feasibility of the idea

- Runs on hardware workers already carry — zero new capital cost, zero new device to issue or maintain.
- Digitises a training obligation mines are already legally required to run under the Mines Vocational Training Rules, 1966 — no new process to sell to a site.
- Built on mature, open technology (WebXR, three.js, standard ECDSA signing) — no proprietary licensing risk.

### Potential challenges and risks / Strategies for overcoming these challenges

Key risks are handset diversity, connectivity, and language coverage — each has a specific mitigation built into the architecture:

| Risk | Severity | Mitigation |
|---|---|---|
| Budget phones lack ARCore | High | Tiered rendering — same certificate on any tier |
| No signal at the worksite | High | Offline content pack, works with zero network |
| Low literacy / first-time smartphone users | High | Zero-text, voice-first, icon-driven interaction |
| Fraudulent/proxy certification | Medium | Randomised variants + signed credential + on-device liveness check |

### Diagram — why it's feasible

A simple 3-step flow: **Legal mandate already exists** (Mines Vocational Training Rules, 1966) → **We digitise the existing obligation** → **Same training slot, same trainer, new tool**.

---

## Slide 5 — Impact and Benefits

### Potential impact on the target audience

- Directly targets the highest-risk cohort named in the problem statement: newly recruited workers, many first-time in an industrial setting, within their first 30 days.
- Gives every worker a portable, employer-independent proof of competency — many will hold a verifiable digital credential of any kind for the first time.

### Benefits of the solution

- **Social**: training and certification delivered in the worker's own language, with a zero-literacy-required path.
- **Economic**: fewer lost-time incidents, lower audit/compliance overhead, less training-centre downtime.
- **Environmental**: fewer uncontrolled releases and equipment-failure incidents from better-drilled emergency responses.

### Diagram — retention curve

A two-line chart, x-axis = Day 0 / Day 1 / Day 7 / Day 30, y-axis = Recall %.

- **Classroom training**: starts ~95%, decays steeply to under 20% by Day 7, flattens near 10% by Day 30.
- **AR + micro-drill**: starts ~95%, gets a small boost back up at each of Day 1 and Day 7 (a micro-drill refresh event), staying above ~75% through Day 30.

This directly answers the problem statement's own cited statistic — under 20% retention at seven days — so it should be the most visually prominent element on this slide.

---

## Slide 6 — Research and References

**Regulation & mandate**
- Mines Act, 1952 and Mines Rules, 1955
- Mines Vocational Training Rules, 1966
- Coal Mines Regulations, 2017 / Metalliferous Mines Regulations, 1961
- DGMS circulars and Annual Statistics of Mines
- Digital Personal Data Protection Act, 2023

**Evidence, technology & method**
- Peer-reviewed AR/VR safety-training effectiveness and hazard-recognition transfer studies
- Ebbinghaus retention research and spaced-repetition scheduling
- Kirkpatrick four-level training evaluation model
- Google ARCore / WebXR Device API documentation
- W3C Verifiable Credentials; India's DigiLocker credentialing stack
