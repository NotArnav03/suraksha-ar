/**
 * Light or dark, and who decides.
 *
 * The drill is used in a coal yard in daylight and in a training room after
 * dark, by the same worker on the same phone. Dark-on-black is close to
 * unreadable outdoors; paper-white is punishing indoors at night. So the app
 * follows the phone by default — a worker who has already set their handset the
 * way they like it should not have to set it again here — and offers an
 * override for when the phone is wrong about the room.
 *
 * The AR tier is the exception and is handled in CSS, not here: a HUD floating
 * over a camera feed has to stay dark whatever the rest of the app is doing,
 * because it is composited over an image nobody can predict.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

const STORE_KEY = 'suraksha.theme.v1';
const ORDER: ThemeChoice[] = ['system', 'light', 'dark'];

/** What the control shows for each state. Glyphs, because it sits in a bar with no room for words. */
export const THEME_ICON: Record<ThemeChoice, string> = {
  system: '🌗',
  light: '☀️',
  dark: '🌙',
};

function isChoice(value: string | null): value is ThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function loadTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORE_KEY);
    return isChoice(stored) ? stored : 'system';
  } catch {
    // Private windows and storage-blocking browsers. Losing the preference
    // costs a tap, never a working drill — see the same handling in results.ts.
    return 'system';
  }
}

/**
 * `data-theme` on the root element, or nothing at all for `system`.
 *
 * Absence is meaningful: with no attribute the stylesheet's
 * `prefers-color-scheme` block is what answers, which is exactly what "follow
 * the phone" means. Writing `data-theme="light"` for system would pin the app
 * to light on a phone set to dark.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;

  try {
    localStorage.setItem(STORE_KEY, choice);
  } catch {
    /* ignore — see loadTheme */
  }
}

export function nextTheme(choice: ThemeChoice): ThemeChoice {
  return ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]!;
}

/** Resolve to what the learner will actually see, which `system` alone does not tell you. */
export function resolvedTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}
