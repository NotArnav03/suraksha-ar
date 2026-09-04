import type { LocalizedText, Verb } from '../../engine/types.ts';

/**
 * Verb wording, shared by every tier.
 *
 * The words a learner reads on the action they are about to take are content,
 * not chrome. If Tier A said "Enter" where Tier C said "Climb in", the two tiers
 * would be asking subtly different questions and their results would stop being
 * comparable — which is the one property this whole architecture exists to hold.
 *
 * `LocalizedText`, not a hardcoded `{en,hi}` pair with an `en ? a : b` check at
 * the call site: that pattern is exactly how a third language goes missing
 * silently — a Santali-selecting learner would have kept seeing Hindi here no
 * matter what they picked, on every single verb, in every tier. Route every
 * verb label through `Localizer.text()` so the fallback chain — sat → hi → en —
 * is the only place language selection logic lives.
 */

export const VERB_ICON: Record<Verb, string> = {
  inspect: '👁',
  use: '🔧',
  wear: '🦺',
  attach: '🔗',
  open: '↥',
  close: '↧',
  enter: '↓',
  exit: '↑',
  signal: '👋',
  report: '📻',
  wait: '⏱',
  answer: '💬',
};

export const VERB_LABEL: Record<Verb, LocalizedText> = {
  inspect: { en: 'Look at', hi: 'देखिए', sat: 'ᱦᱮᱨᱢᱮ' },
  use: { en: 'Use', hi: 'चलाइए', sat: 'ᱵᱮᱵᱷᱟᱨ ᱢᱮ' },
  wear: { en: 'Put on', hi: 'पहनिए', sat: 'ᱮᱰᱟ ᱢᱮ' },
  attach: { en: 'Clip on', hi: 'बाँधिए', sat: 'ᱛᱟᱸᱛᱤ ᱢᱮ' },
  open: { en: 'Open', hi: 'खोलिए', sat: 'ᱜᱤᱫᱨᱟᱹᱭ ᱢᱮ' },
  close: { en: 'Close', hi: 'बंद कीजिए', sat: 'ᱵᱚᱸᱫ ᱢᱮ' },
  enter: { en: 'Climb in', hi: 'अंदर उतरिए', sat: 'ᱨᱮᱭᱟᱜ ᱢᱮ' },
  exit: { en: 'Climb out', hi: 'बाहर निकलिए', sat: 'ᱚᱰᱚᱠ ᱢᱮ' },
  signal: { en: 'Signal', hi: 'इशारा कीजिए', sat: 'ᱥᱮᱱᱚᱛ ᱢᱮ' },
  report: { en: 'Report to', hi: 'सूचना दीजिए', sat: 'ᱠᱷᱚᱵᱚᱨ ᱮᱢ ᱢᱮ' },
  wait: { en: 'Wait', hi: 'रुकिए', sat: 'ᱛᱟᱸᱦᱮᱸᱱ ᱢᱮ' },
  answer: { en: 'Answer', hi: 'उत्तर दीजिए', sat: 'ᱛᱚᱦᱚᱨ ᱮᱢ ᱢᱮ' },
};
