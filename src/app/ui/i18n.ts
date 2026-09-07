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
  { code: 'sat', name: 'ᱥᱟᱱᱛᱟᱲᱤ', speech: 'sat-IN', chain: ['sat', 'hi', 'en'] },
];

const UI: Record<string, LocalizedText> = {
  listen: { en: 'Listen again', hi: 'फिर सुनिए', sat: 'ᱫᱚᱦᱲᱟ ᱟᱲᱟᱝ ᱢᱮ' },
  next: { en: 'Continue', hi: 'आगे बढ़िए', sat: 'ᱟᱭᱳ ᱪᱟᱞᱟᱜ ᱢᱮ' },
  wait: { en: 'Wait', hi: 'रुकिए', sat: 'ᱛᱟᱸᱦᱮᱸᱱ ᱢᱮ' },
  todo: { en: 'Still to do', hi: 'अभी बाकी है', sat: 'ᱦᱚᱭᱚᱜ ᱠᱟᱱᱟ' },
  cancel: { en: 'Cancel', hi: 'रहने दीजिए', sat: 'ᱛᱟᱸᱦᱮᱸᱱ ᱛᱟᱦᱮᱸᱱ ᱢᱮ' },
  restart: { en: 'Drill again', hi: 'फिर से अभ्यास', sat: 'ᱫᱚᱦᱲᱟ ᱟᱹᱣᱟᱛ ᱢᱮ' },
  placeHint: {
    en: 'Point at the ground and tap to place the work site',
    hi: 'ज़मीन पर कैमरा कीजिए और साइट रखने के लिए टैप कीजिए',
    sat: 'ᱟᱛᱟᱨᱮ ᱠᱮᱢᱨᱟ ᱰᱚᱸᱠᱟ ᱢᱮ ᱟᱨ ᱡᱟᱭᱜᱟ ᱡᱟᱦᱟᱸ ᱮᱛᱦᱚᱵᱚᱜ ᱠᱚᱨᱮᱭᱟᱜ ᱴᱮᱯ ᱢᱮ',
  },
  noSurface: {
    en: 'No surface found yet — move the phone slowly over the floor',
    hi: 'अभी सतह नहीं मिली — फ़ोन को धीरे-धीरे फ़र्श पर घुमाइए',
    sat: 'ᱚᱛᱟᱨ ᱵᱟᱭ ᱧᱟᱢ ᱟᱠᱟᱱᱟ — ᱯᱷᱚᱱ ᱠᱚ ᱥᱟᱱᱛ ᱠᱟᱛᱮ ᱟᱛᱟᱨ ᱨᱮ ᱦᱟᱛᱟᱣ ᱢᱮ',
  },
  tapToContinue: {
    en: 'Tap anywhere to continue',
    hi: 'आगे बढ़ने के लिए कहीं भी टैप कीजिए',
    sat: 'ᱟᱭᱳ ᱪᱟᱞᱟᱜ ᱞᱟᱹᱜᱤᱫ ᱡᱟᱦᱟᱸ ᱦᱚᱸ ᱴᱮᱯ ᱢᱮ',
  },
  timeLeft: { en: 'Time left', hi: 'बचा समय' },
  result_pass: { en: 'Passed', hi: 'उत्तीर्ण' },
  result_fail: { en: 'Not passed', hi: 'उत्तीर्ण नहीं' },
  result_fatal: { en: 'Fatal outcome', hi: 'जानलेवा परिणाम' },
  competency: { en: 'Competency', hi: 'दक्षता' },
  credential: { en: 'Certificate', hi: 'प्रमाणपत्र' },
  scanToVerify: { en: 'Scan to verify — works offline', hi: 'जाँचने के लिए स्कैन कीजिए — बिना इंटरनेट' },
  whatWentWrong: { en: 'What went wrong', hi: 'क्या ग़लत हुआ' },
  theme: { en: 'Light or dark', hi: 'उजाला या अंधेरा' },
  // The first thing a new worker reads. Nobody learns while afraid of breaking
  // something, so say plainly that this one is safe to get wrong.
  welcome: {
    en: 'Nothing here is real. Take your time, try things, and find out what goes wrong — that is what this is for.',
    hi: 'यहाँ कुछ भी असली नहीं है। आराम से कीजिए, आज़माइए, और देखिए क्या ग़लत होता है — यही इसका मक़सद है।',
  },
  // The runtime raises STEP_OUT_OF_ORDER itself rather than from the scenario,
  // so its wording belongs here with the rest of the interface copy — the engine
  // stays free of language, and a third language cannot go missing on it.
  outOfOrder: {
    en: 'Right action, wrong moment — something else has to happen first.',
    hi: 'काम सही है, समय ग़लत — इससे पहले कुछ और करना ज़रूरी है।',
  },
  // No `sat` on these three: the fallback chain hands a Santali learner the
  // Hindi line, which is honest, where invented Santali would not be. They are
  // written to be replaced by a speaker, not by a translation engine.
  startingAr: {
    en: 'Starting AR — allow the camera when your phone asks',
    hi: 'AR शुरू हो रहा है — फ़ोन पूछे तो कैमरा चालू करने दीजिए',
  },
  arRefused: {
    en: 'The camera was not allowed — running the same drill in flat mode',
    hi: 'कैमरे की अनुमति नहीं मिली — वही अभ्यास फ्लैट मोड में चल रहा है',
  },
  arTimedOut: {
    en: 'AR did not start on this phone — running the same drill in flat mode',
    hi: 'इस फ़ोन पर AR शुरू नहीं हुआ — वही अभ्यास फ्लैट मोड में चल रहा है',
  },
  droneEyebrow: {
    en: 'Industrial safety · AR drill',
    hi: 'औद्योगिक सुरक्षा · AR अभ्यास',
    sat: 'ᱥᱟᱸᱭᱠᱟᱛ ᱵᱟᱸᱪᱟᱣ · AR ᱟᱹᱣᱟᱛ',
  },
  deviceReadyFor: {
    en: 'This device is ready for',
    hi: 'यह फ़ोन इसके लिए तैयार है',
    sat: 'ᱱᱚᱣᱟ ᱯᱷᱚᱱ ᱱᱚᱶᱟ ᱞᱟᱹᱜᱤᱫ ᱛᱮᱭᱟᱨ ᱢᱮᱱᱟᱜᱼᱟ',
  },
  beginDrill: { en: 'Begin drill', hi: 'अभ्यास शुरू कीजिए', sat: 'ᱟᱹᱣᱟᱛ ᱮᱛᱦᱚᱵ ᱢᱮ' },
  clearProgress: { en: 'Clear progress', hi: 'प्रगति मिटाइए', sat: 'ᱚᱰᱚᱠᱚᱜ ᱢᱮᱴᱟᱣ ᱢᱮ' },
  chooseModule: {
    en: 'Choose a training module',
    hi: 'एक प्रशिक्षण मॉड्यूल चुनिए',
  },
  changeModule: {
    en: 'Change module',
    hi: 'मॉड्यूल बदलिए',
  },
  capableTier: {
    en: '{{tier}} available',
    hi: '{{tier}} उपलब्ध',
    sat: '{{tier}} ᱢᱮᱱᱟᱜᱼᱟ',
  },
  variantsPassed: {
    en: '{{passed}} of {{required}} variants passed',
    hi: '{{required}} में से {{passed}} वेरिएंट पास',
    sat: '{{required}} ᱠᱷᱚᱱ {{passed}} ᱣᱮᱨᱤᱭᱮᱸᱴ ᱯᱟᱥ',
  },
};

/**
 * Which script a string is actually written in.
 *
 * This is not the same question as which language the learner selected, and
 * conflating the two is why Santali was never once spoken aloud. The fallback
 * chain means a learner who picks Santali is very often looking at Hindi, so
 * the selection says `sat` while the screen says Devanagari; and where Santali
 * *is* authored, it is Ol Chiki, which a Hindi voice cannot pronounce at all.
 * The script is the honest signal for how to say what is on the screen.
 */
const OL_CHIKI = /[᱐-᱿]/;
const DEVANAGARI = /[ऀ-ॿ]/;

export function scriptTag(text: string): 'sat' | 'hi' | 'en' {
  if (OL_CHIKI.test(text)) return 'sat';
  if (DEVANAGARI.test(text)) return 'hi';
  return 'en';
}

/** Android reports `sat_IN_#Olck`; BCP-47 wants `sat-IN`. Both reach us. */
function primarySubtag(lang: string): string {
  return lang.toLowerCase().replace(/_/g, '-').split('-')[0] ?? '';
}

function bcp47(lang: string): string {
  const parts = lang.replace(/#.*$/, '').split(/[_-]/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]}-${parts[1]}` : (parts[0] ?? lang);
}

/** `sat_IN_#Olck` -> `in`, `en-IN` -> `in`, `en_US` -> `us`. */
function region(lang: string): string {
  return lang.toLowerCase().replace(/#.*$/, '').split(/[_-]/).filter(Boolean)[1] ?? '';
}

/**
 * Pick the voice that can actually pronounce this script.
 *
 * Android lists romanised variants beside the real ones — `hi_IN_#Latn` is
 * Hindi spelled in Latin letters and is the wrong front end for Devanagari, so
 * a naive "first voice whose language matches" picks it roughly half the time.
 */
export function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  tag: 'sat' | 'hi' | 'en',
): SpeechSynthesisVoice | null {
  const candidates = voices.filter((v) => primarySubtag(v.lang) === tag);
  if (candidates.length === 0) return null;

  const score = (voice: SpeechSynthesisVoice): number => {
    const lang = voice.lang.toLowerCase();
    let points = 0;
    // Ol Chiki is the script this app writes Santali in; a Santali voice for
    // any other script would mispronounce every word.
    if (tag === 'sat' && lang.includes('olck')) points += 4;
    // `hi_IN_#Latn` is Hindi spelled in Latin letters — the wrong front end for
    // Devanagari, and Android lists it right beside the real one.
    if (lang.includes('latn') && tag !== 'en') points -= 4;
    // An Indian English voice says "sump" and "permit" the way the supervisor
    // saying them will. en-AU, which is what sorting alphabetically lands on,
    // does not.
    if (region(voice.lang) === 'in') points += 2;
    return points;
  };

  return [...candidates].sort((a, b) => score(b) - score(a))[0]!;
}

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

  /**
   * Whether this string can be read aloud on this handset.
   *
   * The Listen control asks before offering itself. A button that does nothing
   * is worse than no button on a screen a worker is already unsure of.
   */
  canSpeak(text: string): boolean {
    if (!('speechSynthesis' in window) || text.length === 0) return false;
    return pickVoice(this.#voices, scriptTag(text)) !== null;
  }

  speak(text: string): void {
    if (!this.#enabled || !('speechSynthesis' in window) || text.length === 0) return;

    const tag = scriptTag(text);
    const voice = pickVoice(this.#voices, tag);
    // Ol Chiki handed to a Devanagari voice is not a degraded reading, it is
    // noise — and noise on a safety instruction is worse than silence, because
    // the learner cannot tell it is wrong. Say nothing instead.
    if (!voice) return;

    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = bcp47(voice.lang);
    utterance.voice = voice;
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
