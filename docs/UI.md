# The interface

Why the app looks the way it does, and what the rules are before you change it.

Everything here lives in two files: `src/app/style.css` (tokens, surfaces, motion)
and `src/app/ui/icons.ts` (every pictogram in the product). The dashboard reuses
the same tokens through `src/admin/admin.css`.

## Who it is drawn for

A scratched budget phone, outdoors, in daylight, held in a gloved hand, by
someone who may be reading slowly and may be using a smartphone for the first
time this month. That single sentence decides most of what follows: no thin
type, no hairline borders, no low-contrast grey-on-grey, nothing smaller than a
thumb (`--tap: 60px`), and no web font, because a font that arrives from a CDN
is a font that does not arrive at the pit-top.

## Colour

Concrete, ink and safety yellow: the colours of the place this runs in, rather
than a product palette.

Two palettes, one set of names. Light is declared on bare `:root` and is the
fallback. Dark is applied twice, by `prefers-color-scheme` (guarded with
`:root:not([data-theme="light"])` so a manual light choice still wins) and by an
explicit `data-theme="dark"`. **Every colour must have its definition in the
light block.** A colour defined only inside a media query is a colour that
vanishes when the query does not match.

| Token group | What it is for |
|---|---|
| `--bg`, `--bg-2`, `--panel`, `--panel-2` | the ground and the surfaces standing on it |
| `--ink`, `--ink-2`, `--ink-3` | body text, secondary text, small print |
| `--hazard-solid`, `--hazard-hi`, `--hazard-lo`, `--hazard-edge` | the four faces of the safety-yellow button |
| `--hazard`, `--hazard-ink`, `--hazard-dim` | yellow as a border, as text, as a wash |
| `--go`, `--crit`, `--warn`, and their `-dim` washes | verdicts |
| `--grid-line`, `--hi-line`, `--glow` | the plan grid, the lit top edge, ambient light |

Two rules that have already been broken once each:

- **Yellow is a fill, never small text.** `#f2b202` on white measures under 3:1.
  Type that needs to be yellow uses `--hazard-ink`, which is a darker amber.
- **The AR overlay pins its own dark palette** regardless of the learner's theme
  (`.ar-active` in `style.css`). It is composited over a live camera image
  nobody can predict, and a paper-white panel over a bright yard is both
  unreadable and blinding. This is the one place the theme choice does not
  apply, and the reason is physics rather than preference.

## Surfaces

The ground is not a flat fill. `body` carries a faint ruled grid (the ruling of
a mine plan), a warm amber wash at the top right and a cool green one at the
bottom left, all at very low opacity and `background-attachment: fixed`.

Anything raised off that ground is lit from above: a gradient from `--panel`
down to `--panel-2`, a 1px `--hi-line` highlight along the top edge, and two
shadows, a hard 1-3px offset for the edge and a soft blur for the air
underneath. The hard offset is what makes a surface read as folded steel rather
than a sticker; the blur is what stops the screen reading as one sheet.

Corners: `--radius: 8px` for controls, `--radius-lg: 12px` for panels, tiles and
cards. Deliberately between a stamped plate and a bubble. Earlier passes tried
both 999px pills (generic) and 3px squares (austere); neither survived review.

## The primary button

There is one on any given screen and it is built like the button on a starter
panel: a lit top face, a darker bottom face, a solid `--hazard-edge` underneath,
and 4px of real travel on `:active`. Through a glove, a colour change alone
reads as nothing having happened, so the press has to move.

`.primary.big` also sweeps a highlight across itself three times, starting 1.4s
after the screen settles. It is the only motion in the app that exists purely to
be noticed: someone who has opened the app and stopped needs something telling
them where to go. Three passes, not infinite, because a screen that never
settles costs battery on the handset this is aimed at.

## Pictograms

Every icon is an inline SVG in `src/app/ui/icons.ts` (47 of them), drawn in the
language of safety signage: flat, one stroke weight, `currentColor` so it
inherits the ink of whatever it sits on, and no colour of its own except where a
hazard demands red.

This replaced emoji, which meant a gear for a conveyor, a biohazard trefoil for
a pile of coal and a wrench for "operate this control": a vendor's house style
standing in for a sign a worker already knows. Objects a drill asks you to find
get their own glyph rather than a per-kind fallback (`PROP_ICON` in
`render/tierB.ts` maps the isolator, padlock, pull cord, tag, self-rescuer and
the rest), because a learner who cannot read the label has nothing else to go
on.

**An icon name is a name, not a character.** `IconName` values are keys into
`PATHS`; assigning one with `textContent` prints the literal word. That has
shipped twice, both times putting "contrast" next to the theme label, and
`tests/theme.test.ts` now fails if any `THEME_ICON[...]` lookup is used anywhere
except inside `icon()`.

`icon(name, extraClass)` always includes the base `icon` class. An earlier
version replaced it with `extraClass`, so `.cap-icon.icon { ... }` never matched
and the capability ticks were invisible.

A pictogram sits *beside* its label, never instead of it. The label is what a
worker acts on; the sign is what they recognise across the yard.

## Motion

Sixteen keyframes, each with a job. Nothing loops forever.

| Animation | Where | What it is for |
|---|---|---|
| `rise-in` | each child of `.start`, staggered 20-350ms | the screen assembles top-down instead of arriving at once |
| `screen-in` | any `.screen` | the screen change is a movement, not a cut |
| `sheen` | `.primary.big`, three passes | catches someone who has opened the app and stopped |
| `tile-in` | `.tile`, staggered to 270ms | the scene is dealt out in front of you |
| `hazard-breathe` | `.tile:has(.kind-hazard)`, five pulses | the one thing trying to hurt somebody is the eye's first stop |
| `barber` | `.timer.urgent .timer-fill` | crawling barrier-tape stripes; a bar that only changes colour gets missed |
| `alarm` | `.world.alarm-critical` | the alarm state, which is information |
| `input-pulse` | after every action | a receipt that the tap arrived, identical for every verdict |
| `tick-in` | a checklist item going done | the only reward in the drill |
| `banner-in` | the consequence banner | it has to read as arriving, not as having always been there |
| `sheet-up`, `fade-in` | the verb sheet | a sheet comes up from the edge it is attached to |
| `readout-shift` | the gas readout changing state | the number moved because the world did |
| `rise` | `.outcome.pass` | earned, so it is allowed to be pleased; the failure states are not |
| `stamp` | the certificate QR | it lands like a stamp on a permit, because that is what it is |
| `spin` | the AR handshake | a wait that can take seconds must not look like a crash |
| `cta-call` | the daily-drill button, six pulses | the one element allowed to ask for attention rather than wait for it |

**The input receipt is deliberately identical for every verdict.** It reports
that the tap arrived, never whether it was the right tap. A renderer that made
the correct tap feel different would be answering the question the drill exists
to ask.

`prefers-reduced-motion: reduce` strips all of it. The two things that survive
are the alarm's colour and border weight, and the input receipt as a static bar,
because both carry information rather than polish.

## The one control that shouts

`.quiz-cta`, the daily ninety seconds at the top of the module list, is the only
element in the app permitted to ask for attention. Everything else on that
screen is a twenty-minute commitment; this is the thing a worker can finish
while the supervisor is still talking, so it has to read as an invitation from
across a changing room. It wears the full push-button treatment, a barrier-tape
stripe down its leading edge, a sheen that sweeps four times and a halo that
pulses six.

Then it stops. A control that never settles is one people learn to stop seeing,
and it costs battery for the whole shift. Once the day's run is done the button
goes quiet on its own: panel-coloured, green edge, a tick, and the score it just
recorded.

An option in the quiz never wears a tick or a cross. Those glyphs were chosen
once to illustrate the words ("made the area safe") and on a phone they read as
the verdict, marking a wrong answer correct before the question had been asked.
Colour carries the verdict, and only after an answer is given.

## Layout rules worth knowing

- **`button:has(> .icon:not(.module-watermark))`** centres a pictogram with its
  label. The exclusion exists because the ghosted glyph on a module card is
  absolutely positioned decoration, and without it the card became a flex row
  with its heading beside its own description.
- **`.verb` overrides that centring back to `flex-start`**, or verb labels in the
  sheet centre themselves and stop scanning as a list.
- **The floating Wait button is anchored to the HUD** (`bottom: calc(100% + 12px)`
  on a `position: relative` `.hud`), not to the viewport. Pinned at 50% of the
  screen it landed on whatever the panel was showing: on a phone it covered the
  first line of the prompt and the listen button underneath it.
- **`.sheet` sets `display` on `:not([hidden])`, never unconditionally.** An
  author-stylesheet `display` beats the browser's built-in `[hidden]` rule
  regardless of specificity, because origin is checked first. Setting it
  unconditionally made `sheet.hidden = true` a silent no-op, which is why Cancel
  never closed the sheet.

## Checking a change

There is no visual regression suite. What exists:

- `tests/app.test.ts` asserts that `.hidden` actually hides, using the real
  stylesheet, and that the DOM the HUD builds is the same across tiers.
- `tests/theme.test.ts` guards the icon-name-as-text mistake and the
  light/dark/system semantics.
- Everything else is eyes on a phone: `npm run build`, `npx vite preview --port
  5199`, then `node tools/phone.mjs setup --port 5199` and work through the
  module picker, a drill, the verb sheet, a fatal banner and the certificate, in
  Hindi, in both themes. Desktop Chrome at 412px catches layout but not
  legibility in daylight and not what a press feels like.
