/**
 * The pictograms.
 *
 * Every icon in this app used to be an emoji: a gear for a conveyor, a
 * biohazard trefoil for a coal jam, a wrench for "operate this", a waving hand
 * for "greetings". Emoji are drawn by the handset, so they arrive in whatever
 * house style that vendor chose, at whatever weight, in colours that have
 * nothing to do with this palette, and they mean whatever their designer meant
 * rather than what a mine means. A biohazard sign on a pile of coal is not a
 * stylistic slip; it is the wrong sign.
 *
 * These are drawn here instead, in the visual language a worker already reads
 * on site: the flat, heavy-stroke pictograms of safety signage (ISO 7010 and
 * the boards in any Indian plant), one weight, one colour, inheriting the ink
 * of whatever they sit on. They are deliberately plain. A pictogram on a
 * hazard board is not decoration and does not get a gradient.
 *
 * Stroke, not fill, for everything except the hazard triangle, which is filled
 * because that is how it appears on a real sign and because it must read as a
 * warning across a yard.
 */

export type IconName =
  // what a learner does
  | 'eye'
  | 'hand'
  | 'helmet'
  | 'shackle'
  | 'lock-open'
  | 'lock-closed'
  | 'enter'
  | 'exit'
  | 'signal'
  | 'radio'
  | 'hourglass'
  | 'speech'
  // what a thing is
  | 'opening'
  | 'sign'
  | 'gauge'
  | 'machine'
  | 'worker'
  | 'hazard'
  | 'isolator'
  | 'pullcord'
  | 'tag'
  | 'startstop'
  | 'extinguisher'
  | 'blower'
  | 'crate'
  | 'cylinder'
  | 'rope'
  // the interface itself
  | 'speaker'
  | 'speaker-off'
  | 'question'
  | 'qr'
  | 'phone'
  | 'marker'
  | 'headset'
  | 'camera'
  | 'compass'
  | 'chip'
  | 'shield'
  | 'sun'
  | 'moon'
  | 'contrast'
  | 'check'
  | 'box'
  | 'cross'
  | 'dash'
  | 'swap'
  | 'certificate'
  | 'calendar';

const PATHS: Record<IconName, string> = {
  eye: '<path d="M1.5 12S5.5 5.5 12 5.5 22.5 12 22.5 12 18.5 18.5 12 18.5 1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3.2"/>',
  // a hand on a control, which is what "use" means on a plant floor
  hand: '<path d="M9 11V5.6a1.6 1.6 0 0 1 3.2 0V11"/><path d="M12.2 11V4.4a1.6 1.6 0 0 1 3.2 0V11"/><path d="M15.4 11.4V6.6a1.6 1.6 0 0 1 3.2 0V15a6 6 0 0 1-6 6h-1.2a5 5 0 0 1-3.7-1.7L4 15.2a1.7 1.7 0 0 1 2.5-2.3L9 15.4V9"/>',
  helmet: '<path d="M3.6 16.5a8.4 8.4 0 0 1 16.8 0"/><path d="M8.8 8.6V5.4A1.4 1.4 0 0 1 10.2 4h3.6a1.4 1.4 0 0 1 1.4 1.4v3.2"/><path d="M2 16.5h20"/><path d="M2 19.4h20"/>',
  shackle: '<path d="M7.5 10.5V7.8a4.5 4.5 0 0 1 9 0v2.7"/><rect x="5" y="10.5" width="14" height="9.5" rx="1"/><path d="M12 14v2.6"/>',
  'lock-open': '<rect x="4.5" y="10.5" width="15" height="9.5" rx="1"/><path d="M8 10.5V7.6a4 4 0 0 1 7.8-1.2"/>',
  'lock-closed': '<rect x="4.5" y="10.5" width="15" height="9.5" rx="1"/><path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/>',
  enter: '<path d="M14 3.5h5a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-5"/><path d="M3.5 12h11"/><path d="M10.5 8 14.5 12l-4 4"/>',
  exit: '<path d="M10 3.5H5A1.5 1.5 0 0 0 3.5 5v14A1.5 1.5 0 0 0 5 20.5h5"/><path d="M20.5 12h-11"/><path d="M13.5 8 9.5 12l4 4"/>',
  // an arm raised to call across a noisy yard
  signal: '<path d="M12 21v-7"/><path d="M12 14 8 9.5"/><path d="M12 14l4-4.5"/><circle cx="12" cy="5.5" r="2.4"/><path d="M18.5 4.2a7 7 0 0 1 0 6"/><path d="M5.5 4.2a7 7 0 0 0 0 6"/>',
  radio: '<rect x="7" y="8.5" width="10" height="12" rx="1.2"/><path d="M12 8.5V4.2"/><path d="M12 2.6v1.6"/><path d="M9.6 12.4h4.8"/><path d="M9.6 15.6h4.8"/>',
  hourglass: '<path d="M6.5 3.5h11"/><path d="M6.5 20.5h11"/><path d="M7.5 3.5v3.2L12 11l4.5-4.3V3.5"/><path d="M7.5 20.5v-3.2L12 13l4.5 4.3v3.2"/>',
  speech: '<path d="M20.5 15.5a2 2 0 0 1-2 2H9l-4.5 3.5v-3.5h-1a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2Z"/>',

  opening: '<ellipse cx="12" cy="9" rx="8.5" ry="4"/><path d="M3.5 9v4.5c0 2.2 3.8 4 8.5 4s8.5-1.8 8.5-4V9"/><path d="M7.5 9.5c0 1.2 2 2.2 4.5 2.2s4.5-1 4.5-2.2"/>',
  sign: '<rect x="3.5" y="4" width="17" height="10" rx="1"/><path d="M12 14v6.5"/><path d="M8.5 20.5h7"/><path d="M7.5 8h9"/><path d="M7.5 11h5"/>',
  gauge: '<rect x="4.5" y="2.5" width="15" height="19" rx="1.5"/><rect x="7.5" y="5.5" width="9" height="6" rx="0.6"/><path d="M8 15.5h3"/><path d="M13 15.5h3"/><path d="M8 18.5h3"/><path d="M13 18.5h3"/>',
  // a belt over two drums, seen from the side, with its frame legs
  machine: '<circle cx="6.2" cy="12" r="3.4"/><circle cx="17.8" cy="12" r="3.4"/><path d="M6.2 8.6h11.6"/><path d="M6.2 15.4h11.6"/><path d="M8 18.4v3"/><path d="M16 18.4v3"/><path d="M4 21.4h16"/>',
  // an isolator: a box with a lever thrown to one side
  isolator: '<rect x="4" y="5" width="16" height="14" rx="1"/><circle cx="12" cy="14.5" r="1.4"/><path d="m12 13.1 4-4.6"/><path d="M6.5 19v2.5"/><path d="M17.5 19v2.5"/>',
  // a pull-cord switch: the cord running along the belt to a switch on a post
  pullcord: '<rect x="8.5" y="3.5" width="7" height="6" rx="1"/><path d="M12 9.5v11"/><path d="M2.5 6.5h6"/><path d="M15.5 6.5h6"/><path d="M8 20.5h8"/>',
  // a do-not-operate tag on its wire
  tag: '<path d="M7 5.5h10a1 1 0 0 1 1 1V20l-6-3-6 3V6.5a1 1 0 0 1 1-1Z"/><path d="M12 5.5V2.5"/><path d="M9.5 10h5"/><path d="M9.5 13h5"/>',
  // a start and stop button pair on a panel
  startstop: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="12" r="2.6"/><rect x="14" y="9.4" width="5.2" height="5.2" rx="0.6"/>',
  extinguisher: '<path d="M9 8.5h6v12a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1Z"/><path d="M10.5 8.5V6a1.5 1.5 0 0 1 3 0v2.5"/><path d="M15 7h3l1.5 2"/><path d="M9 12.5h6"/>',
  // a ventilation blower: fan blades in a duct
  blower: '<circle cx="12" cy="12" r="8.5"/><path d="M12 12c0-3.2 1-5.5 2.6-5.5S17 8 15.4 10.2 12 14 12 12Z"/><path d="M12 12c2.8 1.6 4 3.6 3.2 5s-3.2 1-4.6-1.5S10.4 11 12 12Z"/><path d="M12 12c-2.8 1.6-5 1.8-5.8.4S7 9.4 9.8 10.4 13.6 11 12 12Z"/>',
  // the default for plant kit that is not a named machine: a box with a handle
  crate: '<rect x="3.5" y="7.5" width="17" height="12" rx="1"/><path d="M9 7.5V5.5h6v2"/><path d="M3.5 12h17"/>',
  // a breathing set: cylinder, shoulder valve, hose
  cylinder: '<rect x="7.5" y="6" width="7" height="14" rx="3"/><path d="M11 6V3.6"/><path d="M9.4 3.6h3.2"/><path d="M14.5 9.5h2.5a3 3 0 0 1 3 3v4"/>',
  // a retrieval line: rope to a hook
  rope: '<path d="M4 4.5c3.5 0 3.5 4 7 4s3.5-4 7-4"/><path d="M18 8.5v5"/><path d="M18 18.5a2.6 2.6 0 0 1-2.6-2.6c0-1.4 1.2-2.4 2.6-2.4s2.6 1 2.6 2.4"/>',
  worker: '<circle cx="12" cy="6.5" r="3"/><path d="M6.5 5.2a5.8 5.8 0 0 1 11 0"/><path d="M12 9.5v7"/><path d="M12 16.5 8.5 21"/><path d="M12 16.5 15.5 21"/><path d="M6.5 12.5h11"/>',
  hazard:
    '<path d="M12 3.2 22 20H2Z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9v5.2" stroke="var(--on-hazard-ink, #12140f)" stroke-width="2.2"/><circle cx="12" cy="17.2" r="1.15" fill="var(--on-hazard-ink, #12140f)" stroke="none"/>',

  speaker: '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18.2 6.5a8 8 0 0 1 0 11"/>',
  'speaker-off': '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z"/><path d="m16 9.5 5 5"/><path d="m21 9.5-5 5"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.4a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.2-2.6 4"/><circle cx="12" cy="17.4" r="1" fill="currentColor" stroke="none"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3z"/><path d="M20 14v3"/><path d="M14 20h7"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="2"/><path d="M10.5 18.5h3"/>',
  marker: '<rect x="3.5" y="3.5" width="17" height="17"/><rect x="7" y="7" width="4" height="4"/><path d="M13 7h4v4"/><path d="M7 13v4h4"/>',
  headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2.5" y="13.5" width="5" height="6" rx="1.5"/><rect x="16.5" y="13.5" width="5" height="6" rx="1.5"/>',
  camera: '<rect x="2.5" y="6.5" width="19" height="13" rx="1.5"/><circle cx="12" cy="13" r="3.6"/><path d="M8.5 6.5 10 4h4l1.5 2.5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>',
  chip: '<rect x="6.5" y="6.5" width="11" height="11" rx="1"/><path d="M10 3v3.5"/><path d="M14 3v3.5"/><path d="M10 17.5V21"/><path d="M14 17.5V21"/><path d="M3 10h3.5"/><path d="M3 14h3.5"/><path d="M17.5 10H21"/><path d="M17.5 14H21"/>',
  shield: '<path d="M12 2.8 20 6v6.2c0 4.4-3.3 7.6-8 9-4.7-1.4-8-4.6-8-9V6Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4"/><path d="M12 19.1v2.4"/><path d="M2.5 12h2.4"/><path d="M19.1 12h2.4"/><path d="m5.4 5.4 1.7 1.7"/><path d="m16.9 16.9 1.7 1.7"/><path d="m18.6 5.4-1.7 1.7"/><path d="m7.1 16.9-1.7 1.7"/>',
  moon: '<path d="M20 14.5A8.6 8.6 0 0 1 9.5 4a8.6 8.6 0 1 0 10.5 10.5Z"/>',
  contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18Z" fill="currentColor" stroke="none"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  // an unticked box, the way a permit lists what is still outstanding
  box: '<rect x="4.5" y="4.5" width="15" height="15" rx="1"/>',
  cross: '<path d="m5.5 5.5 13 13"/><path d="m18.5 5.5-13 13"/>',
  dash: '<path d="M5 12h14"/>',
  swap: '<path d="M4 8.5h13"/><path d="m13.5 5 3.5 3.5-3.5 3.5"/><path d="M20 15.5H7"/><path d="M10.5 12 7 15.5 10.5 19"/>',
  certificate: '<rect x="3.5" y="3.5" width="17" height="13" rx="1"/><path d="M7 7.5h10"/><path d="M7 10.5h6"/><circle cx="16.5" cy="16.5" r="3.2"/><path d="M14.6 19.2 14 22.5l2.5-1.3 2.5 1.3-.6-3.3"/>',
  // days in a row, for the daily drill: a wall calendar with three marked off
  calendar:
    '<rect x="3.5" y="5.5" width="17" height="15" rx="1"/><path d="M3.5 10h17"/><path d="M8 3.5v4"/><path d="M16 3.5v4"/><path d="M7 13.5h2"/><path d="M11 13.5h2"/><path d="M15 13.5h2"/><path d="M7 17h2"/>',
};

/** The markup, for places that build their DOM as a string. */
export function iconSvg(name: IconName): string {
  return (
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ` +
    `stroke-linecap="round" stroke-linejoin="round" focusable="false">${PATHS[name]}</svg>`
  );
}

/**
 * An icon element. Always `aria-hidden`: every icon in this app sits beside its
 * own label, and a screen reader announcing "eye, look at" helps nobody.
 */
export function icon(name: IconName, extraClass?: string): HTMLSpanElement {
  const span = document.createElement('span');
  // `icon` always stays on: it is what sizes the glyph and makes the svg fill
  // its box. A caller's class adds to it rather than replacing it.
  span.className = extraClass ? `icon ${extraClass}` : 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = iconSvg(name);
  return span;
}
