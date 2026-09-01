import type { LocalizedText, Narration } from './types.ts';

/**
 * Language resolution with an explicit fallback chain. A missing Santali string
 * must degrade to Hindi before it degrades to English — the fallback order is a
 * content decision, so callers pass it rather than inheriting a default.
 */
export function resolve(text: LocalizedText, chain: string[]): string {
  for (const lang of chain) {
    const value = text[lang];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return text.en;
}

/** `{{param}}` interpolation against a resolved variant's parameter bag. */
export function interpolate(input: string, params: Record<string, string | number>): string {
  return input.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, key: string) => {
    const value = params[key];
    return value === undefined ? whole : String(value);
  });
}

export function interpolateText(
  text: LocalizedText,
  params: Record<string, string | number>,
): LocalizedText {
  const out: Record<string, string> = {};
  for (const [lang, value] of Object.entries(text)) {
    out[lang] = interpolate(value, params);
  }
  return out as LocalizedText;
}

export function interpolateNarration(
  narration: Narration,
  params: Record<string, string | number>,
): Narration {
  return narration.audio
    ? { text: interpolateText(narration.text, params), audio: narration.audio }
    : { text: interpolateText(narration.text, params) };
}

/** Languages a scenario can actually be delivered in, given what is authored. */
export function availableLanguages(texts: LocalizedText[]): string[] {
  if (texts.length === 0) return ['en'];
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const [lang, value] of Object.entries(text)) {
      if (typeof value === 'string' && value.length > 0) {
        counts.set(lang, (counts.get(lang) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count === texts.length)
    .map(([lang]) => lang)
    .sort();
}
