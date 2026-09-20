# Suraksha AR: problem research and competitive landscape

Compiled 2026-09-12. Every claim below is either sourced to a link at the bottom or explicitly
marked as unverified. Where the pitch deck and the evidence disagree, the evidence is recorded
here and the deck should be corrected, not the other way round.

---

## 1. What SIH26041 actually asks for

**Problem statement**: SIH26041, *AR-Based Vocational Training Simulator for Industrial Safety in
Jharkhand's Mining and Manufacturing Sector*. Submitted by the Government of Jharkhand. Theme:
Smart Education. Category: Software.

The background text makes five factual claims:

1. Jharkhand leads India's mineral production, with coal, steel and mica operations employing
   hundreds of thousands of workers, many of them young tribal recruits with no industrial exposure.
2. Classroom safety instruction shows "retention rates below 20% after one week".
3. Live drills disrupt operations; VR simulators are inaccessible to smaller operations and
   contract workers.
4. DGMS recorded 48 fatal mine accidents in Jharkhand in 2022-23, many involving workers with
   less than 30 days of orientation.
5. The Factories Act 1948 and Mines Act 1952 mandate periodic safety certification, yet "no
   standardised digital training platform exists in regional languages".

The expected solution is explicit and unusually prescriptive: an Android APK (Android 10+, no
external headset), interactive AR covering fire response, gas leak protocols and machinery
hazards, assessment, **QR-based certificate generation and verification**, Hindi and Santali
localisation, offline functionality, a web admin dashboard, a demo video and a public repo.

Two observations worth carrying into any pitch:

- The problem author wrote "certificate generation **and verification**". Most teams read that as
  "print a QR". It is the only line in the statement that describes a trust problem rather than a
  content-delivery problem, and it is the line this project is built around.
- Claim 4 is the one to be careful with. Nationally, DGMS reported 24 fatal accidents in coal mines
  in 2022 and 38 in 2023. A single state reaching 48 fatal *accidents* over those two years is only
  plausible if the figure aggregates coal plus metalliferous, or counts fatalities rather than
  accidents. Jharkhand did record the highest number of fatal accidents of any state in both 2022
  and 2023, so the direction is right and the number needs a citation before it goes on a slide.

---

## 2. The problem, decomposed

The statement bundles five different failures. They have different causes, different owners and
different fixes, and conflating them is how a demo ends up solving the easy one.

### 2.1 Exposure: the risk is concentrated in the people the training system reaches last

- India recorded 226 deaths in coal and lignite mines over 2020-2024 (53, 51, 28, 41, 53 by year).
  In 2024 alone: 38 fatal accidents in coal mines (40 fatalities), 32 in metalliferous mines
  (31 fatalities), 1 in oil mines.
- Contractor status is a strong independent predictor of severity. In a 1998-2007 US mining
  cohort, the univariate odds of an accident being fatal rather than non-fatal were **2.8 times
  higher for contractors than for operators**, and fatality was associated with contractor status,
  less experience at the current mine, and occurrence more than eight hours into the shift.
- Indian work on preventable accidents in coal mining reaches the same conclusion by a different
  route: subcontracted workers get weaker training, weaker accountability and weaker oversight
  than permanent employees.
- Inexperience compounds it. A large majority of mining incidents involve workers with under five
  years of experience.

So the fatality risk sits with contract and new workers at smaller operators. That is precisely
the population that headset VR programmes, which are procured centrally by large PSUs and run at
fixed training centres, structurally do not reach. This is the strongest argument in the whole
project and it is an argument about **distribution**, not about rendering.

### 2.2 The specific reflex that kills: the rescue chain

The engine models `rescue_restraint` as a zero-tolerance competency dimension with a pass mark of
100. The evidence base for treating it that way:

- NIOSH's 1986 confined-space alert concluded that **more than 60% of confined space fatalities
  are would-be rescuers**. Later studies have found lower ratios, so quote it as the origin of the
  design rule rather than as a current measured rate. OSHA's weaker but safer version: when
  multiple deaths occur during a confined-space rescue, most of the dead are would-be rescuers.
- The Indian evidence is not mining data, it is sanitation data, and it is overwhelming.
  Government figures tabled in the Lok Sabha record **498 deaths in sewer and septic tank cleaning
  between 1 January 2019 and 30 June 2026**; other compilations put it at 622 since 2017, roughly
  one death every five days across 21 states and union territories.
- The mechanism recurs incident by incident. Odisha, May 2026: one worker collapsed in an
  under-construction septic tank and **six died in total** as others entered one after another.
  Greater Noida, July 2026: a worker entered to rescue a colleague, both died. Tamil Nadu, 2019:
  four dead in the same chain. Pune: four dead by suffocation, the three who followed the first
  man in were already dead when pulled out.

That is the single best-evidenced behavioural claim in the project: the fatal act is not failing
to know the procedure, it is a specific, predictable, humane impulse under time pressure. A
multiple-choice question cannot detect it. A timed simulated decision can.

### 2.3 Delivery: the legal obligation already exists and is already being digitised

- The **Mines Vocational Training Rules 1966**, framed under the Mines Act 1952, require initial
  general and job-specific training (theory, gallery training and on-the-job practical), special
  training for underground work, gassy mines, timber and explosives, and refresher training,
  including after any absence of a year or more. Progress goes into training logbooks and a
  Certificate of Training is issued.
- **DGMS Circular 03 of 2024**, issued after 53 vehicle accidents at Indian mining sites, mandates
  induction, refresher **and simulator-based** operator training for tyre-fitted machines. The
  regulator has already put simulator training inside a compliance instrument. This is the hook
  for a regulation-aligned product and it is far more useful than a generic "Mines Act 1952"
  citation.
- DGMS operates online statutory certificate verification pages on dgms.gov.in. Their scope
  (statutory competency certificates for managers, surveyors, gas testers, versus MVT worker
  certificates) needs checking directly; the site refused connections during this research.

The obligation is not the gap. Delivery quality and evidence of comprehension are the gap.

**The problem statement covers two legal regimes, not one.** Mines fall under central rules and
DGMS. The steel plants and mica *processing* units the brief also names are factories, and in
Jharkhand those fall under the draft **Occupational Safety, Health and Working Conditions
(Jharkhand) Rules 2025** (Labour, Employment, Training and Skill Development Department, made under
section 135 of the OSH Code 2020, 301 pages, copy in `research/`). Rule 21 on safety officers says
outright that it applies "except mines". What that draft asks for, as it bears on this project:

- **Training obligations are scattered by hazard, not set out in one place**: periodic training in
  using and caring for PPE, required training topics for silica dust, and emergency action plans
  where "all personnel shall be properly trained" and training "should be followed by periodic
  emergency action drills".
- **It already asks for evidence of comprehension, and the evidence it accepts is a signature.**
  In the hazardous-process schedule, workers must give an undertaking within one month of joining
  that they have "read the contents of the cautionary notices and instructions, understood them
  and would abide by them".
- **Its fitness-to-work certificate is the manager's opinion.** Form XXVI: "Certified that the
  young persons mentioned above have been fully instructed by me ... and has received sufficient
  training ... and that in my opinion he is fit to be employed". Form XXV is a register of trained
  workers with a free-text column for "details of training". This is the verification gap in the
  state's own drafting.
- **Language**: manual registers go "in English and Hindi or the language understood by a majority
  of the persons employed"; notices must be in the language most workers understand, and in some
  schedules in the local language as well. Santali is not named anywhere, but the
  majority-language test is the legal hook for it.
- **Records can be electronic**: the draft defines "electronically" to include uploading to the
  designated portal, and requires the register of workers to be kept "in bound register &
  electronically".

For steel and mica processing modules, cite this draft (noting that it is a draft), not the Mines
Act. The separate *Jharkhand Minerals (Prevention of Illegal Mining, Transportation and Storage)
Amendment Rules 2026* in `research/` deals with registering mineral dealers, JIMMS transport
challans and compounding fees. It has nothing to say about safety training.

### 2.4 Assessment: the actual hole in the market

Kirkpatrick's four levels are the standard frame and they make the problem precise:

- Multiple-choice and written tests measure **Level 2, learning**, and only the cognitive part.
  For procedural and interpersonal skills the recommended instruments are skill demonstrations,
  role play and simulation.
- **Level 3, behaviour**, requires observing the person after training, in the job. It is the
  level everybody claims and almost nobody measures, because observer-based assessment is accurate
  and the least cost-effective option available.

A drill scored on action sequence, time to first correct action, hesitation latency, coded error
class and recovery after induced failure sits between Level 2 and Level 3: it is simulated
performance, not on-the-job behaviour. Say exactly that. It is a much stronger claim than the
vague "behavioural" and it survives a knowledgeable question.

### 2.5 Verification: paper proves attendance, not competence, and cannot be checked

- Verification today means phoning the training provider. It is slow, manual and skipped under
  time pressure.
- Falsification is documented in exactly this sector. WorkSafe Mines Safety in Western Australia
  found falsified certificates **and falsified trainer credentials** in the mining emergency
  response sector. In New York construction, reporting during the 2017 boom found sites where up
  to 50% of workers held fake safety cards, against 30 construction deaths in 2015-17.
- Nothing in the Indian mining training chain currently produces a credential that a supervisor at
  a gate can check, offline, in seconds, without trusting the piece of paper in front of them.

### 2.6 Access: language, literacy, connectivity, handset

- Jharkhand's literacy rate is around 66%, below the national average. SC and ST communities are
  heavily over-represented in the mica workforce relative to their district populations.
- India is 92-95% Android, and low-end devices in the $100-200 band were the largest single
  segment of the Indian smartphone market in 2025 at roughly 30.5%. Designing for ARCore-only is
  designing for the phones the target cohort is least likely to own, which is what forces the
  tiered renderer.
- WebXR ships in Chrome 79+, Edge, Opera, Samsung Internet 12+ and the Quest browser, and not in
  Firefox or iOS Safari. On Android it depends on Google Play Services for AR being present and
  updatable, which needs a network at least once.
- There is no usable synthetic voice for Santali, Ho, Mundari or Kurukh. Any claim of voice-first
  delivery in those languages implies recorded human narration, not TTS. The repo is already
  honest about this.

---

## 3. What the evidence actually supports (and where the deck overclaims)

This section exists so nobody gets caught out in a Q&A.

| Claim commonly made | What the literature says |
|---|---|
| "Classroom retention drops below 20% in a week" | Traceable to the Ebbinghaus forgetting curve (1885, nonsense syllables, lab). Secondary sources put one-week retention at 23-25%. There is no mining-workforce study behind the figure. Cite it as a general memory result or drop the precision. |
| "VR/AR training beats classroom" | For **VR**, supported: Scorgie et al., *Safety Science* 171 (2024) 106372, systematic review of 52 articles (2013-2021), VR outperforms traditional training; a related meta-analysis of 16 studies and 61 effect sizes reports d = 0.495 (95% CI 0.367 to 0.623). Publication bias is flagged. |
| "AR training beats classroom" | **Not supported for knowledge acquisition.** Gong, Lu, Lovreglio, Lv and Chi, *Safety Science* 178 (2024) 106624, reviewed 37 papers (2014 to Feb 2024): AR has a significant positive overall effect on safety training, but **no significant difference against traditional training on knowledge acquisition**, and only three studies measured retention at all (1-2 weeks), too few for a retention meta-analysis. The authors attribute much of AR's measured benefit to engagement and novelty. |
| "AR improves retention" | One good randomised comparison supports it in the fire domain: video see-through AR fire safety training beat video training on knowledge retention, long-term self-efficacy and instruction quality (*Safety Science*, 2024). One study, one domain. |
| "4x faster, 275% more confident" | PwC's enterprise study across 12 US locations. Widely quoted, vendor-adjacent, attribute it explicitly. |

**The honest version of the pitch**: AR is not being claimed as a better teacher than a good
instructor. AR is the cheapest instrument that turns a safety assessment from a quiz into a
performance, on hardware the workforce already owns. The evidence for that framing is Kirkpatrick,
not a VR effect size, and it does not depend on the AR literature resolving.

---

## 4. Existing solutions

Five distinct markets touch this problem. None of them spans it.

### 4.0 VRMS at IIT (ISM) Dhanbad: the state-backed anchor, 40 km from the problem

Inaugurated **23 December 2025** by the Union Minister of Coal and Mines, alongside a Centre of
Excellence under the National Critical Minerals Mission. This is the single most relevant existing
solution found: same state, same domain, and it explicitly claims assessment and certification.

**Confirmed from the PIB release, the Bharat Innovates project listing and local reporting:**

- A **Virtual Reality Mine Simulator (VRMS)**, sited in the Mining Engineering Department at IIT
  (ISM) Dhanbad, billed as India's first VR-based mine simulator for coal mining safety and
  productivity.
- Built by IIT (ISM) with **Coal India Limited and its subsidiaries NCL, ECL and CMPDIL**. CMPDIL's
  involvement is the tell for "real mine data": it holds the survey and mine-plan data.
- A **360-degree immersive virtual reality theatre**, driven by real mine data. The inauguration demo
  ran a **Jharia underground mine** and the **Nigahi opencast mine** (NCL, Singrauli), so the content
  is site-specific digital twins rather than generic environments.
- **More than 20 training modules**, covering heavy equipment operation and critical safety SOPs,
  across both underground and opencast.
- Offers **"scenario based assessment and certification" for all levels of employees, from operators
  to senior managers**, and is *expected* to cut training time by about half.
- Listed current users: **IIT (ISM), Coal India Limited and DGMS**. Listed target organisations: all
  seven CIL coal subsidiaries (ECL, BCCL, CCL, WCL, SECL, NCL, MCL) plus CMPDI and DGMS.
- Project contact: Prof. Dheeraj Kumar, Deputy Director of IIT (ISM) and Project Director of TEXMiN,
  the institute's DST-funded technology innovation hub (`dheeraj@iitism.ac.in`). Showcased
  internationally at Bharat Innovates 2026 in Nice.

**Not public anywhere found:** capital cost, throughput per year, whether trainees wear headsets or
sit in a projection theatre, the software stack, what the assessment actually scores, whether the
"certification" carries any standing under the Mines Vocational Training Rules, and whether the
certificate is a digital artifact at all, let alone a verifiable one. The halving of training time
is a projection, not a measured result.

**How it reads structurally.** VRMS is a *destination*: one room, in Dhanbad, with a per-installation
scaling plan of one facility per company or institute. Its content authority is exactly what this
project lacks (CMPDIL mine data, DGMS as a listed user, real Jharia and Nigahi geometry). Its
distribution is exactly what this project has (any Android handset a contract worker already owns).
On the two axes in section 5 it sits in the same cell as every other simulator vendor: performed
behaviour, no offline-verifiable credential. Nothing in any source suggests the certificate leaves
the institution's own system.

Three consequences worth acting on:

1. **It validates the thesis rather than pre-empting it.** A Ministry of Coal facility now advertises
   scenario-based assessment and certification as the point of the simulator. That is the strongest
   third-party endorsement available for "the assessment is the product", and it should be cited as
   such.
2. **It narrows one stock claim.** "No standardised digital training platform exists in regional
   languages" is the problem statement's line, and at the top of the market it is now less true. The
   honest version is that the immersive layer terminates at HEMM operators and executives inside PSU
   facilities, and the last mile to contract labour at small operators is still classroom, gallery
   and paper.
3. **It is a partner shape, not only a competitor shape.** They have assessment with regulatory
   proximity and no portable proof; this project has portable offline proof and no regulatory
   proximity. TEXMiN is a Section 8 company with an explicit technology-translation mandate and a
   published contact.

Two supporting facts from the Ministry of Coal Annual Report 2025-26, chapter 14, which are worth
knowing before claiming novelty or scarcity:

- VR now appears as routine equipment in CIL subsidiaries' safety measures, listed flatly as
  "Virtual Reality (VR) Training module has been introduced" alongside HEMM simulator training for
  dumper, dragline, shovel and dozer operators. Together with MCL's Rs 6.5 crore CHRP programme,
  that makes at least three state-backed immersive training efforts running concurrently.
- NLC India's Group Vocational Training Centre at Neyveli reports, for Jan to Nov 2025, **2,768
  contract workers** given basic or initial training against **5 regular employees**, plus 1,535
  contract workers in refresher training. VTCs are overwhelmingly a contract-labour pipeline. The
  immersive layer is not: it goes to the people operating expensive machines. That gap between the
  two pipelines is the market.

### 4.1 Enterprise headset VR, India

| Who | What | Scale / evidence |
|---|---|---|
| CHRP-India + Mahanadi Coalfields (Coal India subsidiary) | India's largest VR safety deployment. Modules: blasting, mine inspection, electrical safety, working at height, HEMM operation, traffic simulation, engine and transmission maintenance | Won on GeM competitive bidding; 17,000 workforce target by 2026; roughly Rs 6.5 crore budget; claims 17,000+ professionals trained, deployed inside live coal and ore mines |
| VizExperts | DGMS-aligned VR blasting training, digital twins mapped to site SOPs and DGMS circulars | NTPC Mining Limited |
| Simulanis | 200+ XR learning modules across VR, desktop and mobile, strong EHS catalogue | Indian enterprise clients across manufacturing, oil and gas, pharma |
| AutoVRse | VRseBuilder, enterprise VR authoring and device management with analytics | 200+ XR projects over 10+ years |
| Exxar | VR for coal mining safety and operational readiness | India |
| Tata Steel + Steel Sim VR + Varjo | High-fidelity crane operator training | Tata Steel |

Global equivalents: Strivr (2M+ VR sessions, Walmart 17,000+ headsets), PIXO VR, Interplay
Learning (skilled trades), Transfr (workforce development plus credentialing), Humulo.

**Where this category stops.** Headset programmes carry hardware capex, charging, updates and
hygiene logistics, roughly 0.5 FTE of support per 50 headsets in use, and about 40% lower
utilisation without that staffing. Throughput is one learner per headset at a time. First-time
users get motion sickness. All of that pushes the model towards centralised training centres run
by large operators for permanent staff, which is the opposite end of the workforce from the one
carrying the fatality risk. The SIH problem statement names this gap directly: "VR simulators
remain inaccessible to smaller operations and contract workers".

### 4.2 Handheld AR training (the closest direct comparables)

- **Senar** (France, founded 2017) is the closest commercial analogue: an AR training platform for
  phones and tablets, life-size scenario simulators, ready-made collections plus custom builds,
  targeting manufacturing, construction and healthcare. Marketing claims retention gains above
  80%. Pricing on request. No credential layer, no Indian language coverage.
- **TrainAR** (Blattgerste, Behrends, Pfeiffer, 2023) is the closest open-source analogue: a Unity
  editor extension with visual-scripting authoring for procedural handheld AR training on Android
  and iOS, with a didactic framework and usability evaluations totalling n = 317. It is a strong
  authoring tool. It produces per-training APKs, and it has no assessment-to-credential pipeline.
- **PTC Vuforia, Scope AR, Taqtile** deliver AR work instructions and remote guidance rather than
  assessed training.
- Academic prototypes: vSLAM-based mobile AR workplace safety training (*Digital*, 2025); an AR
  physical-ergonomics training trial for manual handling workers (NCT06993298).

**Where this category stops.** None of them issues a verifiable credential. Training and
credentialing are two separate industries with two separate buyers.

### 4.3 Public-sector and free tools

NIOSH publishes serious mine safety training technology at no cost: the **VR Mine Rescue Training
platform** (scenario editor, simulation, director, spectator and debrief modules), the **Mine
Emergency Escape Training (MEET)** software released for trainers to download, and EXAMiner for
hazard recognition. High quality, US regulation, English, desktop and headset, not phone AR. Worth
studying for the debrief-module design in particular, which is the part most commercial products
skip and which this project's error taxonomy is trying to do.

### 4.4 Credential infrastructure

| System | What it does | Why it does not close this gap |
|---|---|---|
| **Skill India Digital Hub** (launched 13 Sep 2023) | National DPI for skilling. Aadhaar-linked, NCVET-aligned certificates issued into DigiLocker, QR-based portable CV, linked to NCS, e-Shram and Bhashini (22 languages) | Attests course completion, not demonstrated performance. QR resolution is an online lookup. |
| **DigiLocker** | Government document wallet and issuer registry | Same: proves a document was issued, says nothing about competence, and needs the network |
| **MOSIP Inji stack** (Inji Certify, Inji Wallet, Inji Verify) | Open-source VC issuance (OpenID4VCI), a wallet supporting offline share, W3C VC Data Model, OpenID4VP, ISO 18013-5 mDL and SD-JWT, and QR plus cryptographic-proof verification. MOSIP is explicitly expanding Inji beyond identity into education, employment and trade credentials | This is the most likely long-term home for an Indian mining competency credential. It is infrastructure, not content: it will never author or score the drill |
| **DIVOC / CoWIN** | India's proven national precedent for a signed QR credential with genuinely offline verification, JWS payload, built for low-connectivity regions | Direct precedent for this project's design, at population scale. Worth citing as prior art rather than treating as a competitor |
| **Open Badges 3.0 / W3C VC** | 1EdTech standard aligned with the W3C VC Data Model; credential lives with the holder and is signed at issuance. QR embedding is moving to CBOR/CWT (IANA claim 169) to shrink payloads | Kilobyte-scale payloads. A dense QR is exactly what fails on a cracked screen in a coal yard, which is why this project uses 51 bytes and gives up interoperability to get it |
| **Blockchain certificate vendors** (VerifyEd, BCdiploma, TrueOriginal) | SHA-256 hash anchored on chain, QR or link verification, tamper-evident | Verification is an online lookup, and the semantics are still "this certificate was issued" |
| **LER ecosystem** (Velocity Network, Europass, 1EdTech CLR, Credential Engine) | Portable learning and employment records in wallets | Same limitation, plus no presence in Indian industrial safety |

### 4.5 Workforce compliance and site access (the buyer this product eventually competes with)

- **Avetta/Pegasus**: worker competency management, inductions, LMS, supplier prequalification and
  site access, used by 100+ hiring clients including BHP, Lendlease and Otis to manage 3.5 million
  workers across 70,000 suppliers. Damstra, Rapid Global and Cm3 occupy the same space.
- **Safety passport schemes**: CCNSG (ECITB, running since 1993, two-day course plus a knowledge
  test, card valid three years, standard in UK power, steel, oil, gas and chemicals), Ireland's
  Safe Pass, UK CSCS, and Australia's **Standard 11** surface mining induction (photo ID induction
  card valid five years against RIIWHS201D and related units).

**The most interesting piece of prior art in this whole document** is Standard 11's structure:
theory course, then a partial-completion card, then an **on-site verification workbook** that must
be completed and returned within six months before the full card issues. That is an explicit
admission by a mature regulator that a classroom pass is not competence, and their fix is paper
and a six-month lag. This project's fix is a scored drill and a signature. That comparison belongs
in the deck.

---

## 5. The white space

Plot every category above on two axes: does the assessment measure performed behaviour, and is the
resulting credential machine-verifiable without a network.

```
                     credential offline-verifiable by cryptography
                              no                     yes
                    +----------------------+----------------------+
  assessment is     |  Avetta/Pegasus      |  DigiLocker / SIDH    |
  attendance or     |  CCNSG, Safe Pass    |  MOSIP Inji           |
  a knowledge test  |  CSCS, Standard 11   |  DIVOC / CoWIN        |
                    |  blockchain certs    |  Open Badges 3.0      |
                    +----------------------+----------------------+
  assessment is     |  VRMS (IIT ISM)      |                       |
  performed         |  CHRP/MCL, Simulanis |                       |
  behaviour in a    |  AutoVRse, VizExperts|        EMPTY          |
  simulation        |  Strivr, Transfr     |    <-- Suraksha AR    |
                    |  Senar, TrainAR      |                       |
                    |  NIOSH VR-MRT        |                       |
                    +----------------------+----------------------+
```

The top-right quadrant is full of infrastructure that cannot author or score a drill. The
bottom-left is full of training products whose output is a completion record. Nobody occupies the
bottom-right, because it requires caring about two different problems at once.

### What is genuinely differentiated

1. **A scored competency vector bound into an offline-verifiable signed credential.** No training
   vendor found in this research issues one, and no credential platform found produces the score.
2. **`rescue_restraint` as a named zero-tolerance dimension.** Supported by NIOSH's rescuer figure
   and, far more powerfully for an Indian audience, by 498 documented sewer and septic tank deaths
   since 2019 with the rescue chain recurring incident after incident.
3. **Seeded procedural variants, several distinct passes required, replayable by an auditor from
   the credential alone.** This is the anti-proxy-certification mechanism, and it is the answer to
   the fake-card problem that phoning a training provider does not solve.
4. **One scenario graph, three renderers, one event stream.** This is what makes a credential mean
   the same thing across a workforce holding mismatched handsets. Every headset vendor solves the
   opposite problem: maximum fidelity for one device class.
5. **Santali (Ol Chiki) coverage at all**, with the machine-draft status recorded honestly and a
   review file per string. No competitor in this landscape offers a tribal-language path.

### What is table stakes and will be matched

Phone AR rendering, JSON-authored scenarios, an offline PWA shell, a web dashboard, Hindi. CHRP,
Simulanis, AutoVRse and VizExperts all have the engineering capacity to add a phone tier inside a
quarter if a PSU tender asks for one. What they cannot copy quickly is the assessment-to-credential
design, because it is a product thesis rather than a feature.

---

## 6. Risks, and what to do next

**Positioning risks**

- Do not pitch "AR teaches better than classroom". The 2024 AR meta-analysis found no significant
  advantage for knowledge acquisition and could not meta-analyse retention at all. Pitch AR as the
  cheapest available instrument for behavioural assessment.
- Do not present "<20% retention in a week" as a mining finding. It is Ebbinghaus.
- Describe the assessment as simulated performance (between Kirkpatrick 2 and 3), not as
  on-the-job behaviour.

**Product risks already tracked in the README** (regulation citations are placeholders, no
instructor sign-off, Santali unreviewed, Tier A never run on hardware, browser-side issuing,
Tier B unbuilt). Two of these now have a clearer route:

- Regulation citations: anchor to **DGMS Circular 03 of 2024** for the simulator-training mandate
  and to the specific MVT Rules 1966 chapters (persons to be trained, general vocational training,
  refresher training, certificates) rather than to "Mines Act 1952" in the abstract.
- Browser-side issuing: the target architecture already exists in Indian public infrastructure.
  Server-side issuance modelled on DIVOC's signed-payload approach, or directly on MOSIP Inji
  Certify, replaces the demo key with something a regulator can accept.

**The single highest-leverage addition**: emit a standards-compliant credential (W3C VC / Open
Badges 3.0, issuable into DigiLocker or an Inji wallet) **alongside** the 51-byte QR, not instead
of it. The compact payload stays the offline gate-scan path; the standard payload makes the
credential portable into Skill India Digital and NCVET recognition. That converts the two largest
adjacent systems from competitors into distribution.

### 6.1 Where this sits in the national skilling system

Checked 2026-09-20. This is the positioning, with the parts that are verified separated from the
parts that are not, because the difference is what a knowledgeable judge will probe.

**The ladder, in order.** The Skill Council for Mining Sector (SCMS), promoted by FIMI and
authorised by MSDE on 17 March 2015, writes the National Occupational Standards and Qualification
Packs. NCVET recognises **Awarding Bodies** and, separately, **Assessment Agencies**; an AA is
recognised state-wise and is the entity authorised to assess candidates against an NSQC-approved
qualification. An awarding body onboards AAs from that pool.

So this product is not an issuer and should never be pitched as one. Its slot is **the instrument
an Assessment Agency uses**, feeding an awarding body that deposits into DigiLocker.

**The mapping is real.** From SCMS qualification pack MIN/Q3203 (NSQC approved, 2023), the safety
NOS are MIN/N1702 (underground metalliferous), **MIN/N1703 (opencast, including the Mine Vocational
Training Rule)** and MIN/N1704 (underground coal). Since the drills are set at the pit-top,
MIN/N1703 is the primary mapping. Performance criteria our drills already exercise, verbatim from
the pack:

- **PC3** "undertake 'The Take-5 (Personal Risk Assessment)' before commencement of any work" — the
  hazard-spotting node in all three drills
- **PC33** "identify six directional hazards at workplace and take decisions accordingly"
- **PC27** "ensure positive isolation near the work place if applicable" — the conveyor lock-out
  drill, almost word for word
- **PC10** "operate various types of fire extinguishers to control different types of fire" — fire
- **PC14** "use self-rescue apparatus appropriately when required" — fire
- **PC1** firedamp, whitedamp, blackdamp and **PC24** "follow laid out SOP in case of alarm signal
  for leakage of inflammable gases" — gas and confined space
- **PC25** reporting unsafe acts, **PC26** communication, **PC28** PPE, **PC8** first aid

**NCVET's micro-credential guidelines (2023)** are a better fit than a full Qualification Pack: a
90-second drill is a micro-credential against named PCs, not a job-role qualification.

**The honest caveat on mapping.** Performance criteria are can-do statements. Our six-dimension
vector does not decompose into them automatically, so putting PC codes in the scenario JSON is a
label unless the credential also reports per-PC evidence. Claim NSQF alignment only once that
output exists.

**Offline verification is already in the national standard.** The Electronic Skill Credential
Standard (ESCS v1.0, MSDE/DGT, June 2019, built on Open Badges v2 and JSON-LD) treats the QR code
as an "offline-to-online bridge" and specifies two paths: fetch the signed JSON-LD from a URI, or,
where the credential cannot be reached in the cloud, embed `@id`, `hash`, `key_id` and
`signatureValue` in the QR and **verify the signature offline**. That is what the 51-byte payload
already does, which reframes it: not a rival credential, an implementation of the offline mode the
standard describes. It also fixes the demo's weakest point, because the signing key belongs to the
awarding body rather than the handset.

**The caveat on ESCS.** It is a 2019 specification still being rolled out, and through DGT:
new e-certificate formats apply to Craftsmen Training Scheme trainees from the 2025 admission year.
There is no evidence that mining-sector credentials use it. Treat it as the direction of travel and
a strong precedent, not as a system we can plug into today. Build the ESCS-shaped payload when a
partner holds the signing key, not before.

**Why offline still matters.** Skill India Digital Hub's QR resolves to a live NSDC verification
page. That is an online lookup, and a pit-top in Jharkhand frequently has no network. The claim to
make is narrow and true: *the national system verifies where there is signal; this verifies where
there is not.*

**Open questions worth an hour each**

1. Exact DGMS state-wise fatal accident figures for Jharkhand 2022 and 2023, from the DGMS
   statistics portal or a parliamentary answer, to replace the unverified 48.
2. Scope of dgms.gov.in online statutory certificate verification: does it cover MVT worker
   certificates or only statutory competency certificates?
3. Whether Coal India or any subsidiary has digitised MVT training records and Form D issuance,
   which would determine whether this credential plugs into an existing register or creates one.
4. Standard 11's on-site verification workbook contents, as a design reference for what a
   regulator considers adequate field verification of competence.
5. Whether NCVET has published a qualification pack for mining safety that a competency vector
   could be mapped onto, which is the route to national recognition.

---

## Sources

**Problem statement and Indian mining safety**
- SIH 2026 problem statement SIH26041: https://zaidsayyed.in/tools/sih-problem-statements/sih26041
- DGMS accident statistics 2023-2024: https://x.com/DGMS1902/status/1904533032713040057
- Coal and lignite mine deaths 2020-2024 (Rajya Sabha): https://www.etvbharat.com/en/!bharat/parliament-coal-and-mines-deaths-lignite-rajya-sabha-enn25031704125
- FACTLY, tracking fatal and serious accidents in India's mines: https://factly.in/tracking-fatal-and-serious-accidents-in-indias-mines/
- Dataful, state-wise serious coal mine accidents: https://insights.dataful.in/articles/telangana-accounted-for-nearly-two-thirds-of-serious-coal-mine-accidents
- DGMS fatality information portal: https://dgms.gov.in/UserView/index?mid=1289
- Factors associated with fatal mining injuries among contractors and operators: https://pubmed.ncbi.nlm.nih.gov/24164762/
- Preventable accidents in Indian coal mining, socio-technical alignment: https://www.researchsquare.com/article/rs-7529003/v1
- Occupational health and safety in Jharkhand mining: https://www.academia.edu/27920454/Issues_of_Occupational_Health_and_Safety_Due_to_Mining_Industry_in_Jharkhand
- Jharkhand sustainable mica policy framework: https://responsible-mica-initiative.com/wp-content/uploads/2020/07/Jharkhand-Sustainable-Mica-Policy-Framework-and-Vision-July-15-2020-FINAL.pdf

**Regulation**
- Mines Vocational Training Rules 1966 (DGMS): https://dgms.gov.in/writereaddata/UploadFile/MineVocational966.pdf
- DGMS Circular 03 of 2024, TTM safety and simulator-based training: https://www.onlineminingexam.com/blog/dgms-tech-soma-circular-no-03-of-2024
- DGMS online statutory certificate verification: https://www.dgms.gov.in/UserView/index?mid=1612

**Confined space and the rescue chain**
- NIOSH confined space rescuer statistics: https://ohsonline.com/articles/2018/08/01/we-must-change-the-statistics-of-confined-space-injuries-and-fatalities.aspx
- Confined space incident statistics, NIOSH fatality data: https://www.velsafe.com/insights/confined-space-incidents-general-industry-statistics/
- India sewer death crisis, Lok Sabha figures: https://www.outlookindia.com/national/indias-sewer-death-crisis-why-fatalities-dont-count-as-manual-scavenging
- Six killed in septic tank, Odisha, May 2026: https://english.news.cn/20260526/9b9f9aa3b9e346f696c7868c4b3273f0/c.html
- Sanitation worker deaths compilation: https://ismatimes.com/india-sanitation-worker-deaths/

**Training effectiveness evidence**
- Scorgie et al., VR for safety training, systematic review and meta-analysis, Safety Science 171 (2024) 106372: https://www.sciencedirect.com/science/article/pii/S0925753523003144
- Gong, Lu, Lovreglio, Lv, Chi, AR in safety training, systematic review and meta-analysis, Safety Science 178 (2024) 106624: https://www.sciencedirect.com/science/article/abs/pii/S0925753524002145
- Summary of the AR meta-analysis findings and gaps: https://safetyinsights.org/2024/08/11/applications-and-effectiveness-of-augmented-reality-in-safety-training-a-systematic-literature-review-and-meta-analysis/
- Video see-through AR fire safety training vs VR and video, Safety Science 2024: https://www.sciencedirect.com/science/article/pii/S0925753524003047
- vSLAM-based mobile AR workplace safety training, Digital 2025: https://doi.org/10.3390/digital5010008
- Kirkpatrick Level 3 and the limits of quizzes: https://www.kirkpatrickpartners.com/blog/training-strategy-mistake-2-misapplying-kirkpatricks-level-3-behavior/
- Ebbinghaus forgetting curve background: https://training.safetyculture.com/blog/ebbinghaus-forgetting-curve/

**Existing solutions: training**
- PIB, Union Minister inaugurates Centre of Excellence and Virtual Reality Mine Simulator at IIT (ISM) Dhanbad, 23 Dec 2025: https://www.pib.gov.in/PressReleasePage.aspx?PRID=2207948
- VRMS project listing, users and target organisations, Bharat Innovates: https://bharatinnovates.in/academia/33
- Prabhat Khabar (Hindi), Jharia underground and Nigahi opencast demo, NCL/ECL/CMPDIL partners: https://www.prabhatkhabar.com/state/jharkhand/dhanbad/centre-of-excellence-inaugurated-at-iit
- Prof. Dheeraj Kumar, IIT (ISM) faculty profile: https://www.iitism.ac.in/faculty-details?faculty=dheeraj
- TEXMiN, IIT (ISM) technology innovation hub: https://texmin.in/
- Ministry of Coal Annual Report 2025-26, chapter 14, Safety in Coal Mines (VR and simulator training, VTC throughput, CIL accident tables): https://coal.nic.in/sites/default/files/2026-02/chap14AnnualReport2026en.pdf
- CHRP-India and Mahanadi Coalfields, 17,000 workforce, Rs 6.5 crore: https://www.thestatesman.com/business/mcl-to-impart-virtual-reality-based-safety-operational-training-to-17000-workforce-1503198005.html
- CHRP-India deployment release: https://www.openpr.com/news/4487442/chrp-india-pioneers-india-s-largest-vr-safety-training
- VizExperts, DGMS-aligned VR blasting training: https://vizexperts.com/blog/dgms-vr-blasting-training-indian-mines
- Simulanis XR content library: https://www.simulanis.com/XR-content
- AutoVRse enterprise VR training: https://www.autovrse.com/
- Exxar, VR for coal mining safety: https://exxar.co/blog/enhancing-safety-operational-readiness-in-coal-mining-with-vr-based-training/
- Tata Steel, Steel Sim VR and Varjo: https://varjo.com/case-studies/shaping-the-future-of-steel-production-training-tata-steels-pioneering-use-of-vr-with-steel-sim-vr-and-varjo
- TCS, Indian mining sector adopting immersive technologies: https://www.tcs.com/what-we-do/industries/energy-resources-utilities/white-paper/indian-mining-sector-adopting-immersive-technologies
- Senar, AR safety training on phones: https://www.senar.io/
- TrainAR open-source handheld AR authoring: https://github.com/jblattgerste/TrainAR and https://jblattgerste.github.io/TrainAR/
- NIOSH VR Mine Rescue Training platform: https://www.cdc.gov/niosh/mining/tools/vr-mrt.html
- NIOSH Mine Emergency Escape Training software: https://www.cdc.gov/niosh/bulletin/2016/mine-escape-tech.html
- Transfr and NCCER pilot outcomes: https://transfrinc.com/resources/efficacy-studies/nccer-transfr-vr-training-pilot-shows-measurable-improvement-in-student-outcomes/
- VR deployment logistics and support ratios: https://www.raum.app/enterprise-vr-training/

**Existing solutions: credentials and compliance**
- NCVET, recognition of Awarding Bodies and Assessment Agencies: https://ncvet.gov.in/recognition-of-ab-aa/
- NCVET guidelines for NOS and micro-credentials (2023): https://ncvet.gov.in/wp-content/uploads/2023/07/Guidelines-for-Development-Approval-Usage-of-National-Occupational-Standards-NOS-Micro-Credentials-MC.pdf
- Skill Council for Mining Sector: https://www.skillcms.in/
- SCMS qualification pack MIN/Q3203 with the MIN/N1702-1704 safety NOS and their performance criteria: https://nqr.gov.in/sites/default/files/MIN_Q3203_v2.0%20Mine%20Mechanic-Fitter%20-%20NSQC%20Approved%20-%2001.04.2023.pdf
- Electronic Skill Credential Standard v1.0 (MSDE/DGT, June 2019), including offline QR signature verification: https://bharatskills.gov.in/pdf/ESCS/Electronic_Skill_Credential_Standard_v1.0.pdf
- DGT, new e-certificate formats for CTS trainees from the 2025 admission year: https://www.dgt.gov.in/en/node/4277
- Skill India Digital Hub: https://www.skillindiadigital.gov.in/about-us
- MOSIP Inji credentialing stack: https://www.biometricupdate.com/202609/mosip-broadens-inji-beyond-digital-id-into-open-credentialing-platform
- Inji wallet overview (offline share, W3C VC, ISO 18013-5): https://docs.mosip.io/inji/inji-wallet/inji-mobile/overview
- DIVOC native certificate specification and offline verification: https://divoc.digit.org/platform/divocs-verifiable-certificate-features-2.0/divocs-native-covid-19-certificate-specification
- Open Badges 3.0 and the W3C VC alignment: https://www.imsglobal.org/spec/ob/v3p0/cert
- CBOR/CWT QR embedding for VCs (IANA claim 169): https://github.com/inji/inji-certify/issues/491
- Avetta acquisition of Pegasus, worker competency management at scale: https://www.avetta.com/company-news/avetta-agrees-to-acquire-pegasus-to-accelerate-global-growth-in-worker-management-software-industry
- CCNSG safety passport scheme (ECITB): https://www.ecitb.org.uk/professional-development/ccnsg/
- Standard 11 mining induction and the on-site verification workbook: https://www.pinnaclesafety.com.au/courses/plant-and/mining-induction-standard-11-compliant/nsw
- Falsified qualifications in the mining sector (WorkSafe): https://myosh.com/blog/2022/02/16/falsified-qualifications-identified-in-mining-sector/
- Fake safety cards in construction: https://www.thesafetymag.com/ca/topics/technology/can-you-spot-the-fake-credentials/184131

**Access and devices**
- India smartphone market, low-end share and Android dominance: https://www.imarcgroup.com/india-smartphone-market
- ARCore supported devices: https://developers.google.com/ar/devices
- WebXR browser support: https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API
- e-Shram, 31.89 crore registered unorganised workers, Bhashini multilingual access: https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=2086193
