import {
  dayKey,
  doneToday,
  loadQuizRecord,
  optionsFor,
  questionsFor,
  recordQuizRun,
  QUIZ_SECONDS,
  type QuizOption,
  type QuizQuestion,
} from '../quiz/daily.ts';
import { LANGUAGES, type Localizer } from './ui/i18n.ts';
import { icon } from './ui/icons.ts';

/**
 * The ninety-second daily drill.
 *
 * Deliberately the only place in the app that asks a question rather than
 * watching a procedure, and deliberately walled off from the thing that
 * certifies: nothing here writes an attempt, and `certify()` never sees it.
 * It exists because a drill passed in February is a drill half-forgotten by
 * April, and because the one slot that reliably exists on a mine site is the
 * few minutes before the shift, standing at the toolbox talk.
 *
 * Ninety seconds for six questions is fifteen apiece. That is the pace of
 * recall, not of reasoning, which is the point: if a worker has to reason
 * their way to "stop the machine before you touch the man", they have not
 * learned it yet, and the timer is what makes that visible.
 */

interface QuizHooks {
  onExit(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function mountQuiz(root: HTMLElement, i18n: Localizer, hooks: QuizHooks): () => void {
  const day = dayKey();
  const questions = questionsFor(day);
  const total = questions.length;

  let index = 0;
  let score = 0;
  // What was tapped on the question now on screen, so a language switch can
  // redraw the answered state instead of quietly offering a second go at it.
  let chosen: QuizOption | null = null;
  let finished = false;
  let remaining = QUIZ_SECONDS * 1000;

  const head = el('header', 'quiz-head');
  const eyebrow = el('p', 'eyebrow', i18n.ui('quizEyebrow'));
  const counter = el('p', 'quiz-counter');
  head.append(eyebrow, counter);

  /*
   * The language picker again, here, because the one on the module list is
   * behind this screen. Ninety seconds is not long enough to go back for it,
   * and a Santali speaker who opened the day's questions in Hindi should not
   * have to spend a third of their time navigating.
   *
   * Switching mid-run keeps the score, the clock and the question you are on.
   */
  const langRow = el('div', 'lang quiz-lang');
  function paintLanguages(): void {
    langRow.replaceChildren();
    for (const language of LANGUAGES) {
      const button = el('button', `lang-button${language.code === i18n.language.code ? ' on' : ''}`);
      button.dataset.code = language.code;
      button.textContent = language.name;
      button.addEventListener('click', () => {
        if (language.code === i18n.language.code) return;
        i18n.setLanguage(language.code);
        paintLanguages();
        eyebrow.textContent = i18n.ui('quizEyebrow');
        if (finished) showResult(lastRanOut);
        else renderQuestion();
      });
      langRow.append(button);
    }
  }
  paintLanguages();
  head.append(langRow);

  const timer = el('div', 'timer quiz-timer');
  const timerFill = el('div', 'timer-fill');
  timer.append(timerFill);

  const body = el('section', 'quiz-body');
  const foot = el('div', 'quiz-foot');

  root.append(head, timer, body, foot);

  // ── the clock ─────────────────────────────────────────────────────────────
  // One clock for the whole set, not one per question. A worker who is quick on
  // the first five has earned the time to think about the sixth, which is how
  // the shift actually works.
  const started = Date.now();
  const tick = window.setInterval(() => {
    remaining = Math.max(0, QUIZ_SECONDS * 1000 - (Date.now() - started));
    const fraction = remaining / (QUIZ_SECONDS * 1000);
    timerFill.style.width = `${fraction * 100}%`;
    timer.classList.toggle('urgent', fraction < 0.25);
    if (remaining === 0 && !finished) finish(true);
  }, 100);

  function stop(): void {
    window.clearInterval(tick);
  }

  function renderQuestion(): void {
    const question = questions[index];
    if (!question) return finish(false);
    counter.textContent = i18n
      .ui('quizCounter')
      .replace('{{n}}', String(index + 1))
      .replace('{{total}}', String(total));

    body.replaceChildren();
    foot.replaceChildren();

    const stem = el('p', 'quiz-stem', i18n.text(question.stem));
    const listen = el('button', 'ghost quiz-listen');
    listen.append(icon('speaker'));
    listen.setAttribute('aria-label', i18n.ui('listen'));
    listen.addEventListener('click', () => i18n.speak(i18n.text(question.stem)));
    const stemRow = el('div', 'quiz-stem-row');
    stemRow.append(stem, listen);
    body.append(stemRow);

    const list = el('div', 'quiz-options');
    for (const option of optionsFor(day, question)) {
      const button = el('button', 'quiz-option');
      button.append(icon(option.icon), el('span', 'btn-label', i18n.text(option.label)));
      button.addEventListener('click', () => answer(question, option, list));
      list.append(button);
    }
    body.append(list);

    // Redrawn in the new language, still answered.
    if (chosen) paintAnswer(question, chosen, list);
  }

  function answer(question: QuizQuestion, picked: QuizOption, list: HTMLElement): void {
    // One answer per question. Without this a second tap could score twice, and
    // the score is the only number this screen reports.
    if (chosen || finished) return;
    chosen = picked;
    if (picked.correct) score++;
    paintAnswer(question, picked, list);
  }

  /** The answered state, drawn from `chosen` alone so it survives a re-render. */
  function paintAnswer(question: QuizQuestion, picked: QuizOption, list: HTMLElement): void {
    const buttons = [...list.querySelectorAll('button')];
    const shown = optionsFor(day, question);
    buttons.forEach((button, i) => {
      const option = shown[i];
      button.disabled = true;
      // The right answer is always marked, whichever one was tapped. Being told
      // only "wrong" teaches nothing, and this is the teaching half of the app.
      if (option?.correct) button.classList.add('right');
      else if (option === picked) button.classList.add('wrong');
    });

    const verdict = el('p', `quiz-verdict ${picked.correct ? 'right' : 'wrong'}`);
    verdict.append(
      icon(picked.correct ? 'check' : 'cross'),
      el('span', '', i18n.ui(picked.correct ? 'quizRight' : 'quizWrong')),
    );
    const why = el('p', 'quiz-why', i18n.text(question.why));
    body.append(verdict, why);
    if (question.cite) body.append(el('p', 'quiz-cite', question.cite));

    const next = el('button', 'primary quiz-next');
    next.textContent = i18n.ui(index + 1 < total ? 'quizNext' : 'quizFinish');
    next.addEventListener('click', () => {
      index++;
      chosen = null;
      if (index >= total) finish(false);
      else renderQuestion();
    });
    foot.append(next);
    next.focus();
  }

  function finish(ranOut: boolean): void {
    if (finished) return;
    finished = true;
    stop();
    // Recorded once, whatever happens to the screen afterwards: a language
    // switch on the result must not count as a second run of the day.
    recordQuizRun(day, score, total);
    showResult(ranOut);
  }

  let lastRanOut = false;

  function showResult(ranOut: boolean): void {
    lastRanOut = ranOut;
    const record = loadQuizRecord();

    body.replaceChildren();
    foot.replaceChildren();
    timer.hidden = true;
    counter.textContent = '';

    const card = el('section', 'panel quiz-result');
    card.append(el('h2', '', i18n.ui(ranOut ? 'quizTimeUp' : 'quizDoneTitle')));
    card.append(
      el(
        'p',
        'quiz-score',
        i18n.ui('quizScore').replace('{{score}}', String(score)).replace('{{total}}', String(total)),
      ),
    );
    const streak = el('p', 'quiz-streak');
    streak.append(icon('calendar'), el('span', '', i18n.ui('quizStreak').replace('{{days}}', String(record.streak))));
    card.append(streak);
    // Said on the screen, not only in the code: this is a refresher, and a
    // refresher that looked like an assessment would undermine the one that is.
    card.append(el('p', 'reason', i18n.ui('quizNotAssessment')));
    body.append(card);

    const back = el('button', 'primary big', i18n.ui('quizBack'));
    back.addEventListener('click', () => hooks.onExit());
    foot.append(back);
    back.focus();
  }

  renderQuestion();
  return stop;
}

/**
 * The call-out on the module list.
 *
 * It is the brightest thing on the screen on purpose. Everything else there is
 * a twenty-minute commitment; this is the one a worker can finish while the
 * supervisor is still talking, and the habit it builds is the whole reason the
 * drills stay in anyone's hands after induction week.
 */
export function quizCallout(i18n: Localizer, onStart: () => void): HTMLElement {
  const record = loadQuizRecord();
  const done = doneToday(record);

  const button = el('button', `quiz-cta${done ? ' done' : ''}`);
  const left = el('span', 'quiz-cta-text');
  left.append(el('span', 'quiz-cta-title', i18n.ui('quizCta')));
  left.append(
    el(
      'span',
      'quiz-cta-sub',
      done
        ? i18n
            .ui('quizCtaDone')
            .replace('{{score}}', String(record.lastScore))
            .replace('{{total}}', String(record.lastTotal))
        : i18n.ui('quizCtaSub').replace('{{seconds}}', String(QUIZ_SECONDS)),
    ),
  );
  button.append(icon(done ? 'check' : 'hourglass', 'quiz-cta-icon'), left);
  if (record.streak > 0) {
    button.append(el('span', 'quiz-cta-streak', i18n.ui('quizStreakShort').replace('{{days}}', String(record.streak))));
  }
  button.addEventListener('click', onStart);
  return button;
}
