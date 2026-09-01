import type { LocalizedText } from '../../engine/types.ts';
import { resolve } from '../../engine/text.ts';

/**
 * Language and voice.
 *
 * Text is the fallback here, not the primary channel. A worker must be able to
 * finish a module without reading a word, so every prompt and every consequence
 * is spoken, and the interface is built from large targets and icons rather than
 * sentences.
 *
 * Speech synthesis is a stand-in. The languages this actually has to reach —
 * Santali, Ho, Mundari, Kurukh — have no synthetic voice worth using, and the
 * production answer is narration recorded with speakers from the community.
 * `Narration.audio` already carries those clips; this is what fills the gap
 * until they are recorded.
 */

export type LangCode = 'en' | 'hi' | 'sat';

export interface Language {
  code: LangCode;
  /** endonym — a language picker that names languages in English helps nobody */
  name: string;
  /** BCP-47 tag for speech synthesis */
  speech: string;
  /** what to fall back to, in order, when a string is not authored */
  chain: LangCode[];
}

export const LANGUAGES: Language[] = [
  { code: 'hi', name: 'हिन्दी', speech: 'hi-IN', chain: ['hi', 'en'] },
  { code: 'en', name: 'English', speech: 'en-IN', chain: ['en'] },
  { code: 'sat', name: 'ᱥᱟᱱᱛᱟᱲᱤ', speech: 'hi-IN', chain: ['sat', 'hi', 'en'] },
];

const UI: Record<string, LocalizedText> = {
  listen: { en: 'Listen again', hi: 'फिर सुनिए', sat: 'ᱫᱚᱦᱲᱟ ᱟᱲᱟᱝ ᱢᱮ' },
  next: { en: 'Continue', hi: 'आगे बढ़िए', sat: 'ᱟᱭᱳ ᱪᱟᱞᱟᱜ ᱢᱮ' },
  wait: { en: 'Wait', hi: 'रुकिए', sat: 'ᱛᱟᱸᱦᱮᱸᱱ ᱢᱮ' },
  todo: { en: 'Still to do', hi: 'अभी बाकी है', sat: 'ᱦᱚᱭᱚᱜ ᱠᱟᱱᱟ' },
  cancel: { en: 'Cancel', hi: 'रहने दीजिए' },
  restart: { en: 'Drill again', hi: 'फिर से अभ्यास' },
  timeLeft: { en: 'Time left', hi: 'बचा समय' },
  result_pass: { en: 'Passed', hi: 'उत्तीर्ण' },
  result_fail: { en: 'Not passed', hi: 'उत्तीर्ण नहीं' },
  result_fatal: { en: 'Fatal outcome', hi: 'जानलेवा परिणाम' },
  competency: { en: 'Competency', hi: 'दक्षता' },
  credential: { en: 'Certificate', hi: 'प्रमाणपत्र' },
  scanToVerify: { en: 'Scan to verify — works offline', hi: 'जाँचने के लिए स्कैन कीजिए — बिना इंटरनेट' },
  whatWentWrong: { en: 'What went wrong', hi: 'क्या ग़लत हुआ' },
};

export class Localizer {
  #language: Language;
  #voices: SpeechSynthesisVoice[] = [];
  #enabled = true;

  constructor(code: LangCode = 'hi') {
    this.#language = LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0]!;
    if ('speechSynthesis' in window) {
      const load = () => (this.#voices = speechSynthesis.getVoices());
      load();
      speechSynthesis.addEventListener('voiceschanged', load);
    }
  }

  get language(): Language {
    return this.#language;
  }

  get speechEnabled(): boolean {
    return this.#enabled;
  }

  set speechEnabled(value: boolean) {
    this.#enabled = value;
    if (!value) this.stop();
  }

  setLanguage(code: LangCode): void {
    this.#language = LANGUAGES.find((l) => l.code === code) ?? this.#language;
  }

  /** Scenario content. */
  text(text: LocalizedText): string {
    return resolve(text, this.#language.chain);
  }

  /** Interface chrome. */
  ui(key: keyof typeof UI | string): string {
    const entry = UI[key];
    return entry ? resolve(entry, this.#language.chain) : key;
  }

  stop(): void {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  speak(text: string): void {
    if (!this.#enabled || !('speechSynthesis' in window) || text.length === 0) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.#language.speech;
    const voice =
      this.#voices.find((v) => v.lang === this.#language.speech) ??
      this.#voices.find((v) => v.lang.startsWith(this.#language.speech.split('-')[0]!));
    if (voice) utterance.voice = voice;
    utterance.rate = 0.95;
    speechSynthesis.speak(utterance);
  }

  /** True when this device has no voice for the selected language. */
  get voiceMissing(): boolean {
    if (!('speechSynthesis' in window)) return true;
    const prefix = this.#language.speech.split('-')[0]!;
    return !this.#voices.some((v) => v.lang.startsWith(prefix));
  }
}
