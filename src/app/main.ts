import './style.css';

import gasScenarioJson from '../scenarios/gas-confined-space.json' with { type: 'json' };
import fireScenarioJson from '../scenarios/fire-explosion.json' with { type: 'json' };

import { scoreSession } from '../assess/score.ts';
import { certify } from '../assess/certify.ts';
import type { LocalizedText, ResolvedScenario, Scenario } from '../engine/types.ts';
import { distinctVariants } from '../engine/variant.ts';
import { ScenarioError, validateScenario } from '../engine/validate.ts';
import { DrillSession } from '../engine/runtime.ts';
import { DrillController } from './controller.ts';
import { TierCRenderer } from './render/tierC.ts';
import type { Tier, WorldRenderer } from './render/contract.ts';
import { clearAttempts, loadAttempts, renderResults, saveAttempt } from './results.ts';
import { detectTier, IMPLEMENTED, type TierReport } from './tier.ts';
import { Localizer, LANGUAGES, type LangCode } from './ui/i18n.ts';
import { applyTheme, loadTheme, nextTheme, THEME_ICON, type ThemeChoice } from './ui/theme.ts';

const app = document.querySelector<HTMLElement>('#app')!;
const params = new URLSearchParams(location.search);
const workerId = params.get('worker') ?? 'JH/CHP/2291';
const forcedTier = (params.get('tier')?.toUpperCase() as Tier | undefined) ?? undefined;

const i18n = new Localizer((params.get('lang') as LangCode) ?? 'hi');

// Before the first screen is built: a flash of the wrong palette is the sort of
// thing that reads as a broken app on a slow handset.
let theme: ThemeChoice = loadTheme();
applyTheme(theme);

const SCENARIOS: Record<string, unknown> = {
  'gas-confined-space': gasScenarioJson,
  'gas_leak_confined_space': gasScenarioJson,
  'fire-explosion': fireScenarioJson,
  'fire_explosion': fireScenarioJson,
  'fire': fireScenarioJson,
};

/**
 * Every authored module, validated independently. A broken graph in one
 * scenario must not take the whole app down — the learner should still be
 * able to pick the module that *does* load, and the picker should say
 * plainly which one failed rather than pretending it isn't there.
 */
const MODULES: { key: string; scenario: Scenario }[] = [];
const MODULE_ERRORS: { key: string; error: unknown }[] = [];
for (const [key, json] of [
  ['gas-confined-space', gasScenarioJson],
  ['fire-explosion', fireScenarioJson],
] as const) {
  try {
    MODULES.push({ key, scenario: validateScenario(json) });
  } catch (error) {
    MODULE_ERRORS.push({ key, error });
  }
}

if (MODULES.length === 0) {
  app.innerHTML = '';
  const box = document.createElement('pre');
  box.className = 'fatal-error';
  box.textContent = MODULE_ERRORS.map(({ key, error }) =>
    error instanceof ScenarioError
      ? `${key} cannot be run.\n\n${error.issues.map((i) => `${i.path}\n  ${i.message}`).join('\n\n')}`
      : `${key}: ${String(error)}`,
  ).join('\n\n');
  app.append(box);
  throw new Error('no scenario module validated');
}

const scenarioKey = (params.get('scenario') ?? '').toLowerCase();
const requested: { key: string; scenario: Scenario } | undefined = Object.hasOwn(SCENARIOS, scenarioKey)
  ? MODULES.find((m) => SCENARIOS[m.key] === SCENARIOS[scenarioKey])
  : undefined;

// A module named explicitly in the URL (deep-linking a demo, re-running a
// specific drill) skips the picker outright. Otherwise the learner chooses.
let scenario: Scenario = requested?.scenario ?? MODULES[0]!.scenario;
const skipPicker = requested !== undefined;

/**
 * How long the AR handshake gets before the drill goes ahead without it.
 *
 * Generous, because it covers a camera prompt a learner has to read and answer
 * on a phone they may not own. Finite, because it must.
 */
const AR_HANDSHAKE_TIMEOUT_MS = 12_000;

type ArAttempt =
  | { session: XRSession; reason: null }
  | { session: null; reason: 'unsupported' | 'refused' | 'timeout' };

/**
 * Ask for the AR session from inside the tap that started the drill.
 *
 * WebXR requires a user gesture, and this has to resolve *before* the session
 * exists so a refusal falls back cleanly to Tier C instead of stranding the
 * learner mid-drill with no world. `dom-overlay` is what keeps the HUD shared:
 * the same DOM the flat tier draws floats over the camera feed.
 *
 * A refusal rejects, which was always handled. A request that never settles at
 * all was not: observed on a Pixel 9 whose previous session had been killed
 * without being ended, `requestSession` simply never resolved, and because the
 * drill screen is built before this is awaited, the learner sat looking at an
 * empty black rectangle with no message, no spinner and no way back. Nothing
 * about a promise obliges it to settle, so the timeout is the only honest
 * defence: a learner who gets the flat drill is served, one who gets an empty
 * screen is abandoned.
 */
async function requestArSession(overlay: HTMLElement): Promise<ArAttempt> {
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr) return { session: null, reason: 'unsupported' };

  let refused = false;
  const request = xr
    .requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'light-estimation'],
      domOverlay: { root: overlay },
    })
    .catch(() => {
      refused = true;
      return null;
    });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), AR_HANDSHAKE_TIMEOUT_MS);
  });

  const session = await Promise.race([request, expiry]);
  clearTimeout(timer);
  if (session) return { session, reason: null };

  // The request may still be alive. If it hands back a session after the drill
  // has already started flat, end it — a live camera nobody is looking through
  // is a battery drain and a privacy indicator the learner cannot explain.
  void request.then((late) => void late?.end().catch(() => undefined));

  return { session: null, reason: refused ? 'refused' : 'timeout' };
}

async function rendererFor(
  tier: Tier,
  overlay: HTMLElement,
  onSessionEnd: () => void,
): Promise<{ renderer: WorldRenderer; note: string | null }> {
  if (tier === 'A') {
    const attempt = await requestArSession(overlay);
    if (attempt.session) {
      // three.js is ~160 kB gzipped and useless to a phone that cannot run AR,
      // so it is only fetched once a session has actually been granted.
      const { TierARenderer } = await import('./render/tierA.ts');
      return {
        renderer: new TierARenderer(i18n, { session: attempt.session, overlay, onSessionEnd }),
        note: null,
      };
    }
    // Say which of the two happened. "Refused" when the learner said no is
    // true; "refused" when the phone never answered is a lie that sends someone
    // hunting through permission settings that were never the problem.
    return {
      renderer: new TierCRenderer(i18n),
      note: i18n.ui(attempt.reason === 'timeout' ? 'arTimedOut' : 'arRefused'),
    };
  }
  // Tier B is contracted but not built. Falling back loudly beats mounting a
  // renderer that would show the learner a black screen.
  return { renderer: new TierCRenderer(i18n), note: null };
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

const TIER_LABEL: Record<Tier, LocalizedText> = {
  A: { en: 'Markerless AR', hi: 'मार्करलेस AR', sat: 'ᱢᱟᱨᱠᱚᱨᱞᱮᱥ AR' },
  B: { en: 'Marker-tracked AR', hi: 'मार्कर AR', sat: 'ᱢᱟᱨᱠᱚᱨ AR' },
  C: { en: 'Flat interactive', hi: 'फ्लैट मोड', sat: 'ᱯᱷᱞᱮᱴ ᱢᱳᱰ' },
};

const CAPABILITY_LABEL: Record<string, LocalizedText & { icon: string }> = {
  webxrImmersiveAr: { en: 'Markerless AR', hi: 'मार्करलेस AR', sat: 'ᱢᱟᱨᱠᱚᱨᱞᱮᱥ AR', icon: '🕶️' },
  camera: { en: 'Camera', hi: 'कैमरा', sat: 'ᱠᱮᱢᱨᱟ', icon: '📷' },
  deviceOrientation: { en: 'Motion sensors', hi: 'मोशन सेंसर', sat: 'ᱪᱟᱞᱟᱣ ᱥᱮᱸᱥᱚᱨ', icon: '🧭' },
  webgl: { en: '3D graphics', hi: '3D ग्राफ़िक्स', sat: '3D ᱪᱤᱛᱟᱹᱨ', icon: '🎮' },
  secureContext: { en: 'Secure connection', hi: 'सुरक्षित कनेक्शन', sat: 'ᱨᱚᱠᱷᱟ ᱠᱟᱱᱮᱠᱥᱚᱱ', icon: '🔒' },
};

/** Which module to drill. Skipped when `?scenario=` names one explicitly. */
function moduleScreen(report: TierReport): void {
  const root = screen('start module-picker');

  const hero = document.createElement('header');
  hero.className = 'hero';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = i18n.ui('droneEyebrow');
  const title = document.createElement('h1');
  title.textContent = i18n.ui('chooseModule');
  hero.append(eyebrow, title);

  const langRow = document.createElement('div');
  langRow.className = 'lang lang-big';
  for (const language of LANGUAGES) {
    const button = document.createElement('button');
    button.className = `lang-button${language.code === i18n.language.code ? ' on' : ''}`;
    button.textContent = language.name;
    button.addEventListener('click', () => {
      i18n.setLanguage(language.code);
      moduleScreen(report);
    });
    langRow.append(button);
  }

  const list = document.createElement('div');
  list.className = 'module-list';
  for (const module of MODULES) {
    const card = document.createElement('button');
    card.className = 'panel module-card';
    const cardTitle = document.createElement('h2');
    cardTitle.textContent = i18n.text(module.scenario.title);
    const cardDesc = document.createElement('p');
    cardDesc.className = 'lede';
    cardDesc.textContent = i18n.text(module.scenario.description);
    card.append(cardTitle, cardDesc);
    card.addEventListener('click', () => {
      scenario = module.scenario;
      startScreen(report);
    });
    list.append(card);
  }
  if (MODULE_ERRORS.length > 0) {
    const note = document.createElement('p');
    note.className = 'reason';
    note.textContent = `${MODULE_ERRORS.length} module(s) failed to load and are not shown: ${MODULE_ERRORS.map((m) => m.key).join(', ')}`;
    list.append(note);
  }

  root.append(hero, langRow, list);
}

function startScreen(report: TierReport): void {
  const root = screen('start');

  const hero = document.createElement('header');
  hero.className = 'hero';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = i18n.ui('droneEyebrow');
  const title = document.createElement('h1');
  title.textContent = i18n.text(scenario.title);
  const description = document.createElement('p');
  description.className = 'lede';
  description.textContent = i18n.text(scenario.description);
  hero.append(eyebrow, title, description);

  // Said before anything else is asked of them. A first-week recruit who thinks
  // they can break something will not experiment, and experimenting is the
  // entire method here.
  const welcome = document.createElement('div');
  welcome.className = 'welcome';
  const welcomeIcon = document.createElement('span');
  welcomeIcon.className = 'welcome-icon';
  welcomeIcon.textContent = '👋';
  const welcomeText = document.createElement('p');
  welcomeText.textContent = i18n.ui('welcome');
  welcome.append(welcomeIcon, welcomeText);

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

  // "Which tier did this phone get, and why" is the first question anyone asks
  // about this design, so the honest answer stays on the start screen — dressed
  // as a readiness card, not a capability dump.
  const tierBox = document.createElement('section');
  tierBox.className = 'panel tier-report';

  const tierHead = document.createElement('div');
  tierHead.className = 'tier-head';
  const tierIcon = document.createElement('span');
  tierIcon.className = 'tier-icon';
  tierIcon.textContent = report.serving === 'A' ? '🕶️' : report.serving === 'B' ? '🎯' : '📱';
  const tierNames = document.createElement('div');
  const tierEyebrow = document.createElement('p');
  tierEyebrow.className = 'tier-eyebrow';
  tierEyebrow.textContent = i18n.ui('deviceReadyFor');
  const tierName = document.createElement('h2');
  tierName.textContent = i18n.text(TIER_LABEL[report.serving]);
  tierNames.append(tierEyebrow, tierName);
  tierHead.append(tierIcon, tierNames);
  if (report.serving !== report.capable) {
    const badge = document.createElement('span');
    badge.className = 'badge warn';
    badge.textContent = i18n.ui('capableTier').replace('{{tier}}', i18n.text(TIER_LABEL[report.capable]));
    tierHead.append(badge);
  }
  tierBox.append(tierHead);

  const caps = document.createElement('ul');
  caps.className = 'caps';
  for (const [name, value] of Object.entries(report.capabilities)) {
    const meta = CAPABILITY_LABEL[name];
    const item = document.createElement('li');
    item.className = value ? 'yes' : 'no';
    const icon = document.createElement('span');
    icon.className = 'cap-icon';
    icon.textContent = meta?.icon ?? '•';
    const label = document.createElement('span');
    label.className = 'cap-label';
    label.textContent = meta ? i18n.text(meta) : name;
    const tick = document.createElement('span');
    tick.className = 'cap-tick';
    tick.textContent = value ? '✓' : '—';
    item.append(icon, label, tick);
    caps.append(item);
  }
  tierBox.append(caps);

  const attempts = loadAttempts();
  const certification = certify(scenario, attempts);
  const progress = document.createElement('div');
  progress.className = 'panel progress-card';
  const progressLabel = document.createElement('p');
  progressLabel.className = 'progress-label';
  progressLabel.textContent = i18n
    .ui('variantsPassed')
    .replace('{{passed}}', String(certification.distinctVariantsPassed))
    .replace('{{required}}', String(certification.requiredVariants));
  const pips = document.createElement('div');
  pips.className = 'pips';
  for (let i = 0; i < certification.requiredVariants; i++) {
    const pip = document.createElement('span');
    pip.className = i < certification.distinctVariantsPassed ? 'pip on' : 'pip';
    pips.append(pip);
  }
  progress.append(progressLabel, pips);

  const actions = document.createElement('div');
  actions.className = 'start-actions';
  const begin = document.createElement('button');
  begin.className = 'primary big';
  begin.textContent = i18n.ui('beginDrill');
  begin.addEventListener('click', () => void drillScreen(report));

  const reset = document.createElement('button');
  reset.className = 'ghost';
  reset.textContent = i18n.ui('clearProgress');
  reset.addEventListener('click', () => {
    clearAttempts();
    startScreen(report);
  });
  actions.append(begin, reset);

  const prefs = document.createElement('div');
  prefs.className = 'prefs';
  const themeButton = document.createElement('button');
  themeButton.className = 'lang-button';
  themeButton.textContent = `${THEME_ICON[theme]}  ${i18n.ui('theme')}`;
  themeButton.addEventListener('click', () => {
    theme = nextTheme(theme);
    applyTheme(theme);
    themeButton.textContent = `${THEME_ICON[theme]}  ${i18n.ui('theme')}`;
  });
  prefs.append(themeButton);

  // Deep-linking a specific module via `?scenario=` is a fixed choice for that
  // session; switching only makes sense when the learner picked one themselves.
  if (MODULES.length > 1 && !skipPicker) {
    const switchModule = document.createElement('button');
    switchModule.className = 'lang-button';
    switchModule.textContent = `🔀  ${i18n.ui('changeModule')}`;
    switchModule.addEventListener('click', () => moduleScreen(report));
    prefs.append(switchModule);
  }

  root.append(hero, welcome, langRow, tierBox, progress, actions, prefs);
}

async function drillScreen(report: TierReport): Promise<void> {
  const root = screen('drill');
  const world = document.createElement('div');
  world.className = 'world';
  const chrome = document.createElement('div');
  chrome.className = 'chrome';
  root.append(world, chrome);

  // Building the screen, then awaiting the AR handshake, leaves this rectangle
  // empty for as long as the handshake takes. Tell the learner what is being
  // waited on rather than showing them nothing.
  let waiting: HTMLElement | null = null;
  if (report.serving === 'A') {
    waiting = document.createElement('p');
    waiting.className = 'reason starting';
    waiting.textContent = i18n.ui('startingAr');
    chrome.append(waiting);
  }

  let controller: DrillController | null = null;
  // The WebXR dom-overlay root must NOT contain the presenting canvas — `world`
  // holds that canvas, and the overlay spec's normal-DOM-event guarantee is only
  // reliable for content outside the surface the browser is actively compositing
  // as the XR view. Pass `chrome` (sibling of `world`), never `root`.
  const { renderer, note } = await rendererFor(report.serving, chrome, () => {
    // The learner backed out of AR with the system gesture. Ending the drill is
    // the honest response: a half-finished run must not be scored as a run.
    controller?.stop();
    startScreen(report);
  });

  waiting?.remove();

  if (note) {
    root.classList.add('ar-refused');
    const line = document.createElement('p');
    line.className = 'reason ar-note';
    line.textContent = note;
    chrome.append(line);
  }
  if (renderer.tier === 'A') root.classList.add('ar-active');

  const variant = nextVariant();
  controller = new DrillController(variant, renderer, i18n, {
    onFinish: (session) => {
      const competency = scoreSession(session);
      const attempts = saveAttempt(competency);
      controller?.stop();
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

/**
 * `?demo=credential` — jump straight to an issued certificate.
 *
 * Three distinct variants have to be *passed* before a credential exists, which
 * is correct but makes the QR expensive to reach on stage. This seeds those
 * three attempts by actually running the engine headlessly, at full speed, with
 * a policy that reads each node's own expectations — so the credential on
 * screen is genuinely earned and genuinely signed, not a mock. It shortens the
 * path to the certificate; it does not fake one.
 */
function playIdeal(variant: ResolvedScenario): DrillSession {
  let clock = 0;
  const session = new DrillSession(variant, { now: () => clock });
  let guard = 0;
  while (!session.finished && guard++ < 200) {
    clock += 2500;
    const node = session.node;
    if (node.kind === 'brief') {
      session.acknowledge();
    } else if (node.kind === 'expect') {
      const next = session.pending[0];
      if (!next) break;
      const { verb, target } = next.match;
      session.dispatch({ verb: verb ?? 'inspect', ...(target ? { target } : {}) });
    } else if (node.kind === 'observe') {
      const remaining = node.targets.find((r) => !session.observed.has(session.resolveTarget(r)));
      if (!remaining) break;
      session.dispatch({ verb: 'inspect', target: remaining });
    } else {
      break;
    }
  }
  return session;
}

function credentialDemoScreen(report: TierReport): void {
  clearAttempts();
  const variants = distinctVariants(scenario, scenario.scoring.requiredVariants);

  let last: DrillSession | null = null;
  let attempts = loadAttempts();
  for (const variant of variants) {
    const session = playIdeal(variant);
    attempts = saveAttempt(scoreSession(session));
    last = session;
  }
  if (!last) throw new Error('credential demo seeded no attempts');

  const results = renderResults({
    scenario,
    session: last,
    competency: scoreSession(last),
    attempts,
    i18n,
    workerId,
    onRestart: () => startScreen(report),
  });
  screen('results').append(results);
}

const report = await detectTier(
  forcedTier && IMPLEMENTED.includes(forcedTier) ? forcedTier : undefined,
);

if (params.get('demo') === 'credential') {
  credentialDemoScreen(report);
} else if (MODULES.length > 1 && !skipPicker) {
  moduleScreen(report);
} else {
  startScreen(report);
}
