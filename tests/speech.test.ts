import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pickVoice, scriptTag } from '../src/app/ui/i18n.ts';

/**
 * Santali was never once spoken aloud before this.
 *
 * The language entry asked for a Hindi voice, so Ol Chiki went to a Devanagari
 * front end that cannot pronounce a character of it. The deeper mistake was
 * choosing a voice from the learner's *selection* rather than from what is
 * actually on the screen: the fallback chain means a Santali learner is very
 * often looking at Hindi, and the two need different voices on the same run.
 */
const voice = (lang: string, name = lang): SpeechSynthesisVoice =>
  ({ lang, name, default: false, localService: true, voiceURI: name }) as SpeechSynthesisVoice;

// what a Pixel actually reports, underscores, script suffixes and all
const ANDROID = [
  voice('en_AU'),
  voice('en_IN'),
  voice('en_US'),
  voice('hi_IN'),
  voice('hi_IN_#Latn'),
  voice('sat_IN_#Olck'),
  voice('bn_IN'),
];

test('the script on screen decides the voice, not the language selected', () => {
  assert.equal(scriptTag('ᱥᱮᱴᱞᱤᱝ ᱥᱚᱢᱯ ᱨᱮᱭᱟᱜ'), 'sat');
  assert.equal(scriptTag('सेटलिंग सम्प का मुँह'), 'hi');
  assert.equal(scriptTag('Settling sump opening'), 'en');
});

test('mixed text is spoken as the Indic script it contains', () => {
  // Interpolated parameters arrive in English inside a Hindi sentence.
  assert.equal(scriptTag('यह second शिफ्ट है'), 'hi');
  assert.equal(scriptTag('ᱥᱮᱴᱞᱤᱝ 15.6'), 'sat');
});

test('Ol Chiki gets the Ol Chiki voice', () => {
  const chosen = pickVoice(ANDROID, 'sat');
  assert.equal(chosen?.lang, 'sat_IN_#Olck');
});

test('Devanagari does not get the romanised Hindi voice', () => {
  const chosen = pickVoice(ANDROID, 'hi');
  assert.equal(chosen?.lang, 'hi_IN', 'hi_IN_#Latn spells Hindi in Latin letters');
});

test('English prefers the Indian voice over whatever sorts first', () => {
  const chosen = pickVoice(ANDROID, 'en');
  assert.equal(chosen?.lang, 'en_IN');
});

test('a handset with no Santali voice yields nothing rather than a wrong one', () => {
  const withoutSantali = ANDROID.filter((v) => !v.lang.startsWith('sat'));
  assert.equal(pickVoice(withoutSantali, 'sat'), null, 'silence beats noise on a safety line');
  assert.ok(pickVoice(withoutSantali, 'hi'), 'the other languages are unaffected');
});

test('BCP-47 tags are matched as well as Android underscore tags', () => {
  const bcp = [voice('sat-IN'), voice('hi-IN')];
  assert.equal(pickVoice(bcp, 'sat')?.lang, 'sat-IN');
  assert.equal(pickVoice(bcp, 'hi')?.lang, 'hi-IN');
});
