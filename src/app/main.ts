import './style.css';

import scenarioJson from '../scenarios/gas-confined-space.json' with { type: 'json' };

import { scoreSession } from '../assess/score.ts';
import { certify } from '../assess/certify.ts';
import type { ResolvedScenario, Scenario } from '../engine/types.ts';
import { distinctVariants } from '../engine/variant.ts';
import { ScenarioError, validateScenario } from '../engine/validate.ts';
import { DrillController } from './controller.ts';
import { TierCRenderer } from './render/tierC.ts';
import type { Tier, WorldRenderer } from './render/contract.ts';
import { clearAttempts, loadAttempts, renderResults, saveAttempt } from './results.ts';
import { detectTier, IMPLEMENTED, type TierReport } from './tier.ts';
import { Localizer, LANGUAGES, type LangCode } from './ui/i18n.ts';

const app = document.querySelector<HTMLElement>('#app')!;
const params = new URLSearchParams(location.search);
const workerId = params.get('worker') ?? 'JH/CHP/2291';
const forcedTier = (params.get('tier')?.toUpperCase() as Tier | undefined) ?? undefined;

const i18n = new Localizer((params.get('lang') as LangCode) ?? 'hi');

let scenario: Scenario;
try {
  scenario = validateScenario(scenarioJson);
} catch (error) {
  app.innerHTML = '';
  const box = document.createElement('pre');
  box.className = 'fatal-error';
  box.textContent =
    error instanceof ScenarioError
      ? `This scenario cannot be run.\n\n${error.issues.map((i) => `${i.path}\n  ${i.message}`).join('\n\n')}`
      : String(error);
  app.append(box);
  throw error;
}

function rendererFor(tier: Tier): WorldRenderer {
  switch (tier) {
    case 'C':
      return new TierCRenderer(i18n);
    default:
      // Tiers A and B are contracted but not built. Falling back loudly beats
      // mounting a renderer that will show the learner a black screen.
      return new TierCRenderer(i18n);
  }
}

/**
 * Serve the variant the learner has not passed yet, cycling once they all are.
 * Handing back the same drill twice would let memorisation do the work that the
 * whole randomisation scheme exists to prevent.
 */
function nextVariant(): ResolvedScenario {
  const pool = distinctVariants(scenario, Math.max(scenario.scoring.requiredVariants + 2, 5));
  const seed = params.get('seed');
  if (seed !== null) return pool.find((v) => v.seed === Number(seed)) ?? pool[0]!;

  const passed = new Set(
    loadAttempts()
      .filter((a) => a.result === 'pass')
      .map((a) => a.variantId),
  );
  return pool.find((v) => !passed.has(v.variantId)) ?? pool[0]!;
}

// ── screens ─────────────────────────────────────────────────────────────────

function screen(className: string): HTMLElement {
  app.replaceChildren();
  const node = document.createElement('div');
  node.className = `screen ${className}`;
  app.append(node);
  return node;
}

function startScreen(report: TierReport): void {
  const root = screen('start');

  const header = document.createElement('header');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = scenario.domain.replaceAll('_', ' ');
  const title = document.createElement('h1');
  title.textContent = i18n.text(scenario.title);
  const description = document.createElement('p');
  description.className = 'lede';
  description.textContent = i18n.text(scenario.description);
  header.append(eyebrow, title, description);

  const langRow = document.createElement('div');
  langRow.className = 'lang lang-big';
  for (const language of LANGUAGES) {
    const button = document.createElement('button');
    button.className = `lang-button${language.code === i18n.language.code ? ' on' : ''}`;
    button.textContent = language.name;
    button.addEventListener('click', () => {
      i18n.setLanguage(language.code);
      startScreen(report);
    });
    langRow.append(button);
  }

  // The tier report is on the start screen deliberately. "Which tier did this
  // phone get, and why" is the first question anyone asks about this design,
  // and the honest answer belongs where the learner and the assessor both see it.
  const tierBox = document.createElement('section');
  tierBox.className = 'panel tier-report';
  const tierHead = document.createElement('h2');
  tierHead.textContent = `Tier ${report.serving}`;
  if (report.serving !== report.capable) {
    const badge = document.createElement('span');
    badge.className = 'badge warn';
    badge.textContent = `device supports tier ${report.capable}`;
    tierHead.append(' ', badge);
  }
  tierBox.append(tierHead);
  for (const reason of report.reasons) {
    const line = document.createElement('p');
    line.className = 'reason';
    line.textContent = reason;
    tierBox.append(line);
  }
  const caps = document.createElement('ul');
  caps.className = 'caps';
  for (const [name, value] of Object.entries(report.capabilities)) {
    const item = document.createElement('li');
    item.className = value ? 'yes' : 'no';
    item.textContent = `${value ? '✓' : '✗'} ${name.replace(/([A-Z])/g, ' $1').toLowerCase()}`;
    caps.append(item);
  }
  tierBox.append(caps);

  const attempts = loadAttempts();
  const certification = certify(scenario, attempts);
  const progress = document.createElement('p');
  progress.className = 'reason';
  progress.textContent = `${certification.distinctVariantsPassed} of ${certification.requiredVariants} distinct variants passed`;

  const begin = document.createElement('button');
  begin.className = 'primary big';
  begin.textContent = i18n.language.code === 'en' ? 'Begin drill' : 'अभ्यास शुरू कीजिए';
  begin.addEventListener('click', () => drillScreen(report));

  const reset = document.createElement('button');
  reset.className = 'ghost';
  reset.textContent = i18n.language.code === 'en' ? 'Clear progress' : 'प्रगति मिटाइए';
  reset.addEventListener('click', () => {
    clearAttempts();
    startScreen(report);
  });

  root.append(header, langRow, tierBox, progress, begin, reset);
}

function drillScreen(report: TierReport): void {
  const root = screen('drill');
  const world = document.createElement('div');
  world.className = 'world';
  const chrome = document.createElement('div');
  chrome.className = 'chrome';
  root.append(world, chrome);

  const variant = nextVariant();
  const controller = new DrillController(variant, rendererFor(report.serving), i18n, {
    onFinish: (session) => {
      const competency = scoreSession(session);
      const attempts = saveAttempt(competency);
      controller.stop();
      const results = renderResults({
        scenario,
        session,
        competency,
        attempts,
        i18n,
        workerId,
        onRestart: () => startScreen(report),
      });
      screen('results').append(results);
    },
  });

  void controller.start(world, chrome);
}

const report = await detectTier(
  forcedTier && IMPLEMENTED.includes(forcedTier) ? forcedTier : undefined,
);
startScreen(report);
