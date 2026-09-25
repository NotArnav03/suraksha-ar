import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { Window } from 'happy-dom';

/**
 * The daily ninety seconds.
 *
 * Two things matter here and the rest is detail. The set has to be the same for
 * everyone on a site on a given day and different the next one, because a
 * supervisor asking "what was today's third question" at the toolbox talk is
 * the entire delivery mechanism. And it has to stay out of the certificate: the
 * product's whole argument is that competence is a performed procedure, not six
 * answers, and a quiz that quietly fed the competency vector would make that
 * argument a lie.
 */

const window = new Window({ url: 'https://localhost/' });
const globals = globalThis as unknown as Record<string, unknown>;
for (const name of ['window', 'document', 'localStorage', 'HTMLElement', 'Element', 'Node']) {
  Object.defineProperty(globals, name, {
    value: (window as unknown as Record<string, unknown>)[name],
    writable: true,
    configurable: true,
  });
}

const {
  BANK,
  QUESTIONS_PER_DAY,
  QUIZ_SECONDS,
  dayKey,
  doneToday,
  loadQuizRecord,
  optionsFor,
  questionsFor,
  recordQuizRun,
} = await import('../src/quiz/daily.ts');

test('everyone gets the same six questions on the same day, and different ones tomorrow', () => {
  const today = questionsFor('2026-09-25').map((q) => q.id);
  const again = questionsFor('2026-09-25').map((q) => q.id);
  const tomorrow = questionsFor('2026-09-26').map((q) => q.id);

  assert.equal(today.length, QUESTIONS_PER_DAY);
  assert.deepEqual(again, today, 'the same day must produce the same set, on every device');
  assert.notDeepEqual(tomorrow, today, 'a new day must not serve yesterday in the same order');
  assert.equal(new Set(today).size, today.length, 'no question twice in one day');
});

test('a full year of days keeps moving through the bank', () => {
  // The failure this guards is a seed that collapses: every day drawing the
  // same six, which nobody notices until week two and which quietly turns the
  // habit into wallpaper.
  const seen = new Map<string, number>();
  const first = new Date(2026, 0, 1);
  for (let i = 0; i < 365; i++) {
    const date = new Date(first);
    date.setDate(first.getDate() + i);
    for (const question of questionsFor(dayKey(date))) {
      seen.set(question.id, (seen.get(question.id) ?? 0) + 1);
    }
  }
  assert.equal(seen.size, BANK.length, 'every question in the bank should come up over a year');
  const counts = [...seen.values()];
  const spread = Math.max(...counts) / Math.min(...counts);
  assert.ok(spread < 1.6, `the bank should be drawn on fairly evenly, spread was ${spread.toFixed(2)}`);
});

test('the options are shuffled per day, so the right answer moves', () => {
  const question = BANK.find((q) => q.options.length >= 3)!;
  const positions = new Set<number>();
  for (let i = 1; i <= 40; i++) {
    const day = `2026-05-${String(i).padStart(2, '0')}`;
    const options = optionsFor(day, question);
    assert.equal(options.length, question.options.length, 'shuffling must not drop an option');
    assert.equal(options.filter((o) => o.correct).length, 1, 'still exactly one correct option');
    positions.add(options.findIndex((o) => o.correct));
  }
  assert.ok(positions.size > 1, 'the correct answer must not sit in the same slot every day');
});

test('the bank is authored, not half-authored', () => {
  // Loading the module already ran the validator, so this is about content:
  // every question in English and Hindi, and a reason shown after the answer.
  for (const question of BANK) {
    assert.ok(question.stem.hi, `${question.id}: no Hindi stem`);
    assert.ok(question.why.hi, `${question.id}: no Hindi explanation`);
    for (const option of question.options) {
      assert.ok(option.label.hi, `${question.id}: an option has no Hindi label`);
    }
  }
});

test('every pictogram a question asks for is one the icon set actually draws', () => {
  const icons = readFileSync('src/app/ui/icons.ts', 'utf8');
  for (const question of BANK) {
    for (const option of question.options) {
      assert.match(
        icons,
        new RegExp(`['"\`]?${option.icon}['"\`]?\\s*:`),
        `${question.id} asks for the "${option.icon}" pictogram, which icons.ts does not define`,
      );
    }
  }
});

test('no option is marked right or wrong by its own pictogram', () => {
  // Found on a phone: one question showed a tick beside a wrong answer and a
  // hazard triangle beside the right one, because the glyphs had been chosen to
  // illustrate the words. On a screen built for someone who reads slowly, the
  // pictogram is read first and the words second, so a verdict-shaped glyph
  // answers the question before it has been asked.
  for (const question of BANK) {
    for (const option of question.options) {
      assert.ok(
        !['check', 'cross'].includes(option.icon),
        `${question.id}: "${option.label.en}" wears a ${option.icon}, which grades the answer`,
      );
    }
  }
});

test('ninety seconds is enough time to read the questions it hands out', () => {
  // Not a style rule: at six questions the budget is fifteen seconds each, and
  // a stem nobody can read in that time measures reading speed, not recall.
  const longest = BANK.reduce((worst, q) => Math.max(worst, q.stem.en.length), 0);
  const perQuestion = QUIZ_SECONDS / QUESTIONS_PER_DAY;
  assert.ok(perQuestion >= 12, 'fewer than twelve seconds a question is a reading test');
  assert.ok(longest <= 110, `the longest stem is ${longest} characters, too long for ${perQuestion}s`);
});

test('the streak counts consecutive days and a replay does not inflate it', () => {
  window.localStorage.clear();
  let record = recordQuizRun('2026-09-20', 5, 6);
  assert.equal(record.streak, 1);

  record = recordQuizRun('2026-09-21', 6, 6, record);
  assert.equal(record.streak, 2);

  // A second run the same day updates the score and leaves the streak alone.
  record = recordQuizRun('2026-09-21', 4, 6, record);
  assert.equal(record.streak, 2, 'replaying a day must not farm a streak');
  assert.equal(record.lastScore, 4);

  // A missed day starts again, and the best is remembered.
  record = recordQuizRun('2026-09-24', 3, 6, record);
  assert.equal(record.streak, 1);
  assert.equal(record.best, 2);

  assert.equal(doneToday(record, '2026-09-24'), true);
  assert.equal(doneToday(record, '2026-09-25'), false);
});

test('a broken or blocked store loses the streak and nothing else', () => {
  window.localStorage.clear();
  window.localStorage.setItem('suraksha.quiz.v1', '{not json');
  const record = loadQuizRecord();
  assert.equal(record.streak, 0);
  assert.equal(record.lastDay, null);
});

test('nothing in the quiz can reach the thing that certifies', () => {
  // The wall, checked as source rather than as behaviour, because the way this
  // would break is an import someone adds in a hurry.
  const quizFiles = ['src/quiz/daily.ts', 'src/app/quiz.ts'];
  for (const file of quizFiles) {
    const source = readFileSync(file, 'utf8');
    for (const forbidden of ['assess/certify', 'assess/score', 'saveAttempt', 'credential/']) {
      assert.ok(
        !source.includes(forbidden),
        `${file} reaches for ${forbidden}: the daily refresher must not touch certification`,
      );
    }
  }
  // And the other direction: the assessment layer has never heard of it.
  for (const file of readdirSync('src/assess')) {
    const source = readFileSync(join('src/assess', file), 'utf8');
    assert.ok(!source.includes('quiz'), `src/assess/${file} mentions the quiz`);
  }
});

test('the daily key rolls over at the local midnight, not at UTC', () => {
  // A shift starting at 06:00 IST should see the new set, which it would not if
  // the key came from toISOString() on a device east of UTC.
  const lateEvening = new Date(2026, 8, 25, 23, 30);
  const justAfter = new Date(2026, 8, 26, 0, 30);
  assert.equal(dayKey(lateEvening), '2026-09-25');
  assert.equal(dayKey(justAfter), '2026-09-26');
});

// ── the screen ──────────────────────────────────────────────────────────────

const { mountQuiz, quizCallout } = await import('../src/app/quiz.ts');
const { Localizer } = await import('../src/app/ui/i18n.ts');

function mount(language: 'en' | 'hi' | 'sat') {
  window.document.body.innerHTML = '<div id="quiz"></div>';
  const root = window.document.querySelector('#quiz') as unknown as HTMLElement;
  const i18n = new Localizer(language);
  const stop = mountQuiz(root, i18n, { onExit: () => {} });
  return { root, i18n, stop };
}

const options = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.quiz-option')];
const langButton = (root: HTMLElement, code: string) =>
  root.querySelector<HTMLButtonElement>(`.quiz-lang .lang-button[data-code="${code}"]`)!;

test('the day\'s questions can be taken in Santali, picked on the quiz itself', () => {
  window.localStorage.clear();
  const { root, stop } = mount('sat');
  // The picker on the module list is behind this screen and ninety seconds is
  // not long enough to go back for it.
  assert.ok(langButton(root, 'sat').classList.contains('on'));
  const stem = root.querySelector('.quiz-stem')?.textContent ?? '';
  assert.match(stem, /[\u1C50-\u1C7F]/, `the stem should be in Ol Chiki: ${stem}`);
  for (const option of options(root)) {
    assert.match(option.textContent ?? '', /[\u1C50-\u1C7F]/, 'an option is not in Ol Chiki');
  }
  stop();
});

test('switching language mid-question keeps the answer, and does not offer a second go', () => {
  window.localStorage.clear();
  const { root, stop } = mount('sat');
  const before = options(root);
  before[0]!.click();
  assert.ok(root.querySelector('.quiz-verdict'), 'answering should show a verdict');

  langButton(root, 'hi').click();
  const after = options(root);
  assert.equal(after.length, before.length);
  assert.ok(
    after.every((button) => button.disabled),
    'the question was already answered, so a re-render must not re-enable it',
  );
  assert.equal(after.filter((b) => b.classList.contains('right')).length, 1, 'the right answer stays marked');
  assert.match(root.querySelector('.quiz-why')?.textContent ?? '', /[\u0900-\u097F]/, 'the reason should now be Hindi');
  stop();
});

test('a language switch on the result screen does not count as a second run', () => {
  window.localStorage.clear();
  const { root, stop } = mount('hi');
  // Walk the whole set: answer, next, answer, next.
  for (let i = 0; i < QUESTIONS_PER_DAY * 2 + 2; i++) {
    const next = root.querySelector<HTMLButtonElement>('.quiz-next');
    const open = options(root).filter((b) => !b.disabled);
    if (open.length > 0) open[0]!.click();
    else if (next) next.click();
    else break;
  }
  assert.ok(root.querySelector('.quiz-result'), 'the run should have finished');
  const recorded = loadQuizRecord();
  assert.equal(recorded.streak, 1);

  langButton(root, 'sat').click();
  assert.ok(root.querySelector('.quiz-result'), 'the result should redraw, not vanish');
  const after = loadQuizRecord();
  assert.deepEqual(after, recorded, 'redrawing the result must not record the day again');
  stop();
});

test('the call-out says what it is, and what it was once the day is done', () => {
  window.localStorage.clear();
  const i18n = new Localizer('hi');
  const fresh = quizCallout(i18n, () => {});
  assert.ok(!fresh.className.includes('done'));
  assert.ok((fresh.textContent ?? '').length > 0);

  recordQuizRun(dayKey(), 5, 6);
  const done = quizCallout(i18n, () => {});
  assert.ok(done.className.includes('done'), 'after a run today the call-out should go quiet');
  assert.match(done.textContent ?? '', /5/, 'and should report the score it recorded');
});
