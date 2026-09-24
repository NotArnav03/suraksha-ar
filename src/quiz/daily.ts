import bankJson from './bank.json' with { type: 'json' };

import { hashString, makeRng } from '../engine/rng.ts';
import type { IconName } from '../app/ui/icons.ts';
import type { LocalizedText } from '../engine/types.ts';

/**
 * The daily ninety seconds.
 *
 * This is the one place in the product where a worker is asked a question
 * instead of made to perform the procedure, and it is deliberately fenced off
 * from everything that certifies. A drill is the assessment; this is the thing
 * that keeps the drill from fading between shifts, sized to fit in the gap at
 * the start of a toolbox talk. It never writes an attempt, never touches the
 * competency vector, and `certify()` has no idea it exists. If that ever stops
 * being true, the certificate stops meaning "can do" and starts meaning
 * "answered six questions", which is the exact failure this whole product was
 * built to argue against.
 *
 * Everyone on a site gets the same six questions on the same day, because the
 * set is seeded by the calendar date rather than by a random number: a
 * supervisor can then ask "what was today's third one" at the toolbox talk and
 * have the crew know what they are talking about. Midnight rolls it over.
 */

export interface QuizOption {
  icon: IconName;
  label: LocalizedText;
  correct?: boolean;
}

export interface QuizQuestion {
  id: string;
  domain: string;
  /** the provision behind the answer, where there is a clean one */
  cite?: string;
  stem: LocalizedText;
  options: QuizOption[];
  /** one line, shown after answering, whether the answer was right or wrong */
  why: LocalizedText;
}

/** Six questions, ninety seconds. Fifteen seconds each is the pace of recall, not of reasoning. */
export const QUESTIONS_PER_DAY = 6;
export const QUIZ_SECONDS = 90;

function isLocalized(value: unknown): value is LocalizedText {
  return Boolean(value) && typeof (value as LocalizedText).en === 'string';
}

/**
 * Validated at module load, like a scenario is.
 *
 * A question with two correct answers or none is not a rendering bug, it is a
 * question that teaches the wrong reflex, and the cheapest moment to catch it
 * is before the page has drawn anything.
 */
function validate(raw: unknown): QuizQuestion[] {
  const bank = raw as { questions?: unknown };
  if (!Array.isArray(bank.questions) || bank.questions.length === 0) {
    throw new Error('quiz bank: no questions');
  }
  const seen = new Set<string>();
  return bank.questions.map((entry, index) => {
    const question = entry as QuizQuestion;
    const where = `quiz bank question ${index} (${question?.id ?? 'no id'})`;
    if (!question.id) throw new Error(`${where}: missing id`);
    if (seen.has(question.id)) throw new Error(`${where}: duplicate id`);
    seen.add(question.id);
    if (!isLocalized(question.stem)) throw new Error(`${where}: stem needs English`);
    if (!isLocalized(question.why)) throw new Error(`${where}: why needs English`);
    if (!Array.isArray(question.options) || question.options.length < 2) {
      throw new Error(`${where}: needs at least two options`);
    }
    const correct = question.options.filter((option) => option.correct === true);
    if (correct.length !== 1) {
      throw new Error(`${where}: needs exactly one correct option, found ${correct.length}`);
    }
    for (const option of question.options) {
      if (!isLocalized(option.label)) throw new Error(`${where}: an option has no English label`);
      if (!option.icon) throw new Error(`${where}: an option has no pictogram`);
    }
    return question;
  });
}

export const BANK: QuizQuestion[] = validate(bankJson);

/** `2026-09-25`, in the worker's own timezone, because their midnight is the one that matters. */
export function dayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Today's set: the same six for everyone, a different six tomorrow.
 *
 * Partial Fisher-Yates over a copy of the bank, seeded from the date, so the
 * selection and the order both move day to day and no question can appear
 * twice in one set.
 */
export function questionsFor(day: string, bank: QuizQuestion[] = BANK): QuizQuestion[] {
  const pool = [...bank];
  const random = makeRng(parseInt(hashString(`quiz|${day}`), 16) >>> 0);
  const take = Math.min(QUESTIONS_PER_DAY, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, take);
}

/** The options in a per-day order too, so the right answer is not always in the same place. */
export function optionsFor(day: string, question: QuizQuestion): QuizOption[] {
  const options = [...question.options];
  const random = makeRng(parseInt(hashString(`quiz|${day}|${question.id}`), 16) >>> 0);
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [options[i], options[j]] = [options[j]!, options[i]!];
  }
  return options;
}

// ── the streak ──────────────────────────────────────────────────────────────

const STORE_KEY = 'suraksha.quiz.v1';

export interface QuizRecord {
  /** the last day the quiz was finished, as a dayKey */
  lastDay: string | null;
  lastScore: number;
  lastTotal: number;
  /** consecutive days finished, broken by a missed day */
  streak: number;
  best: number;
}

const EMPTY: QuizRecord = { lastDay: null, lastScore: 0, lastTotal: 0, streak: 0, best: 0 };

export function loadQuizRecord(): QuizRecord {
  try {
    const stored = localStorage.getItem(STORE_KEY);
    if (!stored) return { ...EMPTY };
    const parsed = JSON.parse(stored) as Partial<QuizRecord>;
    return {
      lastDay: typeof parsed.lastDay === 'string' ? parsed.lastDay : null,
      lastScore: Number(parsed.lastScore) || 0,
      lastTotal: Number(parsed.lastTotal) || 0,
      streak: Number(parsed.streak) || 0,
      best: Number(parsed.best) || 0,
    };
  } catch {
    // Private windows, cleared storage. Losing a streak costs nothing that
    // matters; the same handling as every other preference in this app.
    return { ...EMPTY };
  }
}

function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() - 1);
  return dayKey(date);
}

/**
 * Record a finished run.
 *
 * Finishing is what counts, not scoring well: the point is that the crew opens
 * it every morning. A second run on the same day updates the score and leaves
 * the streak alone, so nobody can farm a streak by replaying.
 */
export function recordQuizRun(day: string, score: number, total: number, from = loadQuizRecord()): QuizRecord {
  const streak =
    from.lastDay === day ? from.streak : from.lastDay === previousDay(day) ? from.streak + 1 : 1;
  const next: QuizRecord = {
    lastDay: day,
    lastScore: score,
    lastTotal: total,
    streak,
    best: Math.max(from.best, streak),
  };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* ignore, see loadQuizRecord */
  }
  return next;
}

export function doneToday(record: QuizRecord, day: string = dayKey()): boolean {
  return record.lastDay === day;
}
