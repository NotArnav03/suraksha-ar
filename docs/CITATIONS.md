# Citation ledger

Every `cite` in `src/scenarios/*.json` is listed here with the text it was checked against.
`tests/citations.test.ts` rejects any citation without an instrument and a pinpoint, and any
citation that names the repealed Mines Act or Factories Act as the source of a live duty.

Checked 2026-09-16. This is a record of what the text says, not legal advice. None of it has been
reviewed by a DGMS-certified instructor yet.

## Sources and their status

| Instrument | Status | Text used |
|---|---|---|
| Occupational Safety, Health and Working Conditions Code 2020 | **In force from 21 Nov 2025.** Repealed 13 Acts, including the Mines Act 1952 and the Factories Act 1948 | Section 6 via [Indian Kanoon](https://indiankanoon.org/doc/180454708/) |
| Coal Mines Regulations 2017 | Made under the Mines Act 1952; continued during the OSH Code transition until OSH regulations replace it | Gazette text as reproduced at [dgms.net](https://www.dgms.net/Coal%20Mines%20Regulation%202017.pdf). **dgms.net is not the official DGMS domain: check each clause against the Gazette before relying on it** |
| Mines Vocational Training Rules 1966 | Same as above: continued during the transition | [dgms.gov.in](https://dgms.gov.in/writereaddata/UploadFile/MineVocational966.pdf) |

The OSH transition wording ("the relevant provisions of the existing labour Acts and their
respective rules, regulations ... will continue to remain in force") comes from secondary reporting
of the government notification. Pinpoint the notification itself before a formal submission.

## Scenario-level citations (both drills)

**OSH Code 2020, s.6(2)(c).** Among the employer's duties "in respect of factory, mines ...":
> "the provision of such information, instruction, training and supervision as are necessary to
> ensure the health and safety of all employees at work"

This is the duty the whole product exists to discharge, and it is why the old "Mines Act 1952"
citation had to go.

## gas-confined-space

| Node | Citation | Verbatim text |
|---|---|---|
| scenario | MVT Rules 1966, r.6(1) and First Schedule | "Every person proposed to be employed in mine on the surface or in opencast workings ... shall, before he is employed, undergo a course of technical and gallery training as specified in the First Schedule" |
| scenario | CMR 2017, r.166 | Heading: "Precautions against inflammable and noxious gases" |
| `observe_hazards` | CMR 2017, r.104(1)(a) | "identify the hazards to health and safety of the persons employed at the mine to which they may be exposed while at work" |
| `observe_hazards` | MVT Rules 1966, First Schedule | 5th day: "Visit: What's wrong." |
| `check_permit` | CMR 2017, r.104(5)(e) | The Safety Management Plan "shall contain ... (e) standard operating procedures" |
| `gas_test` | CMR 2017, r.166(5)-(6) | "(5) No person shall be re-admitted into the place where the gas was detected until a competent person has examined the place and has reported that the place is free from gas. (6) Every examination ... shall be made with a flame safety lamp or a suitable detector approved by the Chief Inspector and, in the case of noxious gas, also with suitable means of detecting carbon monoxide gas" |
| `ventilate` | CMR 2017, r.166(3) | "(a) all persons shall be withdrawn from the place; (b) the place shall be immediately fenced off ... and the competent person in charge shall, without delay, take steps to remove the gas by improving the ventilation" |
| `don_ppe` | CMR 2017, r.104(2)(d)(i) | "in so far as the risk remains, (i) provide for personal protective equipment" |
| `post_standby` | CMR 2017, r.104(5)(e) | As for `check_permit` |
| `evacuate` | CMR 2017, r.166(3)(a) | "all persons shall be withdrawn from the place" |
| `rescue_decision` | CMR 2017, r.166(3)(b) and (5) | "the place shall be immediately fenced off so as to prevent persons inadvertently entering the same" and the r.166(5) text above |

**Caveats**

- **Permit-to-work and the standby person are not stand-alone regulations.** The only explicit
  "work permit" in CMR 2017 is r.131(9), and it covers working at height. Both steps are therefore
  cited as site procedures under the Safety Management Plan, and the citation says so.
- **The old "use and care of protective equipment" citation was wrong for this worker.** That
  phrase comes from the MVT Rules' *Fifth* Schedule, which is the course for timber mistries.
- **r.166(2)** ("shall not brush or waft it out, but shall immediately withdraw from the place and
  shall inform his superior official") fits `evacuate` even better, but it is limited to
  *inflammable* gas, and this drill's gas varies by variant. r.166(3) covers inflammable and
  noxious gas alike, so that is the one cited.
- **The drill is set at a surface sump in a coal handling plant.** r.166 applies to "any place in a
  mine". Whether a particular coal handling plant falls inside the statutory definition of a mine
  depends on the facts of the site.
- **The oxygen reading has to respect CMR 2017 r.153(2)(b)**: air where people work or pass must
  not contain "less than 19 per cent. of oxygen". The drill tells the learner the reading is
  "below the safe limit", but the variant range used to reach 19.2%, so some variants showed a
  reading that is legally acceptable. The range now stops at 18.9%, and a test enforces it.
- **Nothing in CMR 2017 says "do not attempt a rescue".** The restraint the drill scores rests on
  the fencing-off and no-re-entry duties in r.166(3)(b) and (5), which is what the citation says.

## fire-explosion

| Node | Citation | Verbatim text |
|---|---|---|
| scenario | CMR 2017, r.139-140 | Headings: "Equipment for fire-fighting", "Organisation for fire fighting" |
| scenario | CMR 2017, r.243 | Heading: "Use, supply and maintenance of self-rescuer" |
| `hazard_ignition` | CMR 2017, r.104(1)(a) | As above |
| `select_extinguisher` | CMR 2017, r.139(2)-(3) | "(2) Soda-acid type extinguishers or water shall not be used for fighting oil or electrical fires. (3) Foam type extinguishers shall not be used for fighting electrical fires." |
| `induced_failure` | CMR 2017, r.139(2) | As above |
| `apply_pass` | CMR 2017, r.140(3) | "Adequate number of persons, including all operators of plants, machinery and heavy earth moving machineries, shall be trained in the use of fire-extinguishers and in fire fighting" |
| `don_scsr` | CMR 2017, r.243(1) and (3)(c) | "(1) No person shall go into, work or be permitted to go into or work belowground in any mine unless he is provided with and carries with him a self-rescuer ... (3) ... (c) ensure that every person who may be required to use self-rescuer ... undergoes a course of training in the use of self-rescuer" |
| `evacuate` | CMR 2017, r.140(4) | "frame standing orders containing the procedures that may be adopted in giving warnings of fire, timely withdrawal of personnel from the mine and for the conduct of fire fighting operation" |

**Caveats**

- **The self-rescuer duty in r.243(1) is a belowground requirement, but this drill is set at the
  pit-top.** The citation says so ("drilled here as a reflex"). If a reviewer objects, move the
  scene underground or drop the step.
- **"PASS" is the drill's own name for its extinguisher sequence, not a regulatory term.** The
  citation is to the training duty in r.140(3), not to the technique.

## machinery-conveyor-loto

| Node | Citation | Verbatim text |
|---|---|---|
| scenario | CMR 2017, r.211 | Heading: "Precautions regarding moving parts of machinery" |
| scenario | CMR 2017, r.104 | Heading: "Safety management plan" |
| `observe_hazards` | CMR 2017, r.104(1)(a) | As above |
| `observe_hazards` | CMR 2017, r.211(6) | "No person in close proximity to moving machinery shall wear, or be permitted to wear, loose outer clothing." |
| `stop_belt`, `clear_jam` | CMR 2017, r.211(4) | "No person shall, or shall be allowed to repair, adjust, clean or lubricate machinery in motion where there is risk of injury." |
| `rescue_decision` | CMR 2017, r.211(4) and r.104(5)(e) | As above |
| `isolate_c3`, `isolate_c4`, `lock_and_tag`, `try_start`, `restore` | CMR 2017, r.104(5)(e) | The Safety Management Plan "shall contain ... (e) standard operating procedures" |
| `free_helper` | MVT Rules 1966, First Schedule | "Training in First aid" is listed on the 1st, 3rd, 4th and 5th days of the course |

**Caveats**

- **Nothing in CMR 2017 uses the words lock-out or tag-out.** Isolation, locking, tagging and the
  try-start test are cited as site procedures under r.104(5)(e), and each citation names the
  procedure in brackets so nobody reads it as a clause. The closest statutory wording is r.59(3)
  and (5), which require cutting and loading machine drivers to prevent "the mechanism being
  inadvertently put into motion". That rule covers those machines only, so it is not cited here.
- **r.97(1)(e) requires pull-cord switches along roadway conveyors, but r.97 is about belowground
  roadways.** This drill is set at a surface coal handling plant, so r.97 is not cited, even though
  the pull cord is the same device.
- **Opening the wrong isolator is a major error, not a fatal one.** The learner has not touched
  anything yet, and the step only completes once the correct isolator is opened. The try-start
  step exists because a lock on the wrong isolator looks the same as a lock on the right one.
- **The drill does not claim a statutory basis for "never grab a caught person".** Its basis is
  r.211(4) (no work on machinery in motion) plus the belt having already restarted once in the
  story. A reviewer from a certified training centre should confirm the emergency sequence
  (stop, call, isolate, then free) matches the site's own procedure.

## For the factory modules still to come

Steel plants and mica processing units are factories, not mines. Their citations belong to the
draft **Occupational Safety, Health and Working Conditions (Jharkhand) Rules 2025** (copy in
`research/`), not to CMR 2017. See `docs/RESEARCH.md` section 2.3.
