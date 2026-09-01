import type { Verb } from '../../engine/types.ts';

/**
 * Verb wording, shared by every tier.
 *
 * The words a learner reads on the action they are about to take are content,
 * not chrome. If Tier A said "Enter" where Tier C said "Climb in", the two tiers
 * would be asking subtly different questions and their results would stop being
 * comparable — which is the one property this whole architecture exists to hold.
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

export const VERB_LABEL: Record<Verb, { en: string; hi: string }> = {
  inspect: { en: 'Look at', hi: 'देखिए' },
  use: { en: 'Use', hi: 'चलाइए' },
  wear: { en: 'Put on', hi: 'पहनिए' },
  attach: { en: 'Clip on', hi: 'बाँधिए' },
  open: { en: 'Open', hi: 'खोलिए' },
  close: { en: 'Close', hi: 'बंद कीजिए' },
  enter: { en: 'Climb in', hi: 'अंदर उतरिए' },
  exit: { en: 'Climb out', hi: 'बाहर निकलिए' },
  signal: { en: 'Signal', hi: 'इशारा कीजिए' },
  report: { en: 'Report to', hi: 'सूचना दीजिए' },
  wait: { en: 'Wait', hi: 'रुकिए' },
  answer: { en: 'Answer', hi: 'उत्तर दीजिए' },
};
