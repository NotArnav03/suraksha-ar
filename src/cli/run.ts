/**
 * Headless drill runner.
 *
 * The engine has no renderer yet, so this is how we see it work — and it stays
 * useful afterwards, because a run that can be replayed with no camera and no
 * phone is a run an auditor can reproduce from the credential alone.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DrillSession } from '../engine/runtime.ts';
import type { DrillEvent, NodeResult } from '../engine/runtime.ts';
import { resolve as resolveText } from '../engine/text.ts';
import type { Action, ResolvedScenario, Scenario, ScenarioNode } from '../engine/types.ts';
import { distinctVariants, resolveVariant } from '../engine/variant.ts';
import { ScenarioError, validateScenario } from '../engine/validate.ts';
import { certify } from '../assess/certify.ts';
import { scoreSession, type Competency } from '../assess/score.ts';

const SCENARIO_PATH = fileURLToPath(
  new URL('../scenarios/gas-confined-space.json', import.meta.url),
);

// ── terminal dressing ───────────────────────────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (useColor ? `[${code}m${s}[0m` : s);
const dim = c('2');
const bold = c('1');
const red = c('31');
const green = c('32');
const yellow = c('33');
const blue = c('36');
const magenta = c('35');

const VERDICT_MARK: Record<string, (s: string) => string> = {
  correct: green,
  wrong: red,
  out_of_order: yellow,
  ignored: dim,
  distractor: yellow,
  noop: dim,
};

// ── args ────────────────────────────────────────────────────────────────────
interface Args {
  script: string;
  seed: number;
  variants: number;
  lang: string[];
  stepMs: number;
  events: boolean;
  attempts: number;
  why: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const langs = get('--lang')?.split(',') ?? ['en'];
  return {
    script: get('--script') ?? 'correct',
    seed: Number(get('--seed') ?? 7),
    variants: Number(get('--variants') ?? 0),
    lang: [...langs, 'hi', 'en'],
    stepMs: Number(get('--step') ?? 3000),
    events: argv.includes('--events'),
    attempts: Number(get('--attempts') ?? 0),
    why: argv.includes('--why'),
  };
}

// ── the ideal-operator policy ───────────────────────────────────────────────
/**
 * Derives a correct playthrough from the graph rather than hard-coding one.
 * If an author adds a step, this follows it — so a passing run in CI proves the
 * authored scenario is completable, not that our fixture matches our fixture.
 */
function idealAction(session: DrillSession): Action | 'acknowledge' | null {
  const node = session.node;
  if (node.kind === 'brief') return 'acknowledge';

  if (node.kind === 'expect') {
    const next = session.pending[0];
    if (!next) return null;
    const { verb, target, value } = next.match;
    return {
      verb: verb ?? 'inspect',
      ...(target !== undefined ? { target } : {}),
      ...(value !== undefined ? { value } : {}),
    };
  }

  if (node.kind === 'observe') {
    const remaining = node.targets.find(
      (role) => !session.observed.has(session.resolveTarget(role)),
    );
    return remaining ? { verb: 'inspect', target: remaining } : null;
  }

  return null;
}

type Deviation = (session: DrillSession) => Action | null;

/**
 * Scripts are built per run rather than shared, because a deviation that must
 * happen *once* needs somewhere to remember it already did. A stateless
 * predicate on node id re-fires every tick and spins forever on any mistake the
 * runtime does not consume — which is every non-fatal one.
 */
function once(when: (session: DrillSession) => boolean, action: Action): () => Deviation {
  return () => {
    let fired = false;
    return (session) => {
      if (fired || !when(session)) return null;
      fired = true;
      return action;
    };
  };
}

const SCRIPTS: Record<string, { label: string; build: () => Deviation }> = {
  correct: {
    label: 'Ideal operator — every step, in order, without hesitating',
    build: () => () => null,
  },
  'second-victim-trap': {
    label: 'Does everything right, then goes in after the collapsed colleague',
    build: once((s) => s.node.id === 'rescue_decision', { verb: 'enter', target: 'sump' }),
  },
  reckless: {
    label: 'Climbs in on the verbal order, the way an unoriented recruit does',
    build: once((s) => s.node.id === 'check_permit', { verb: 'enter', target: 'sump' }),
  },
  'sniff-test': {
    label: 'Uses their nose instead of the detector, then recovers and passes',
    build: once((s) => s.node.id === 'gas_test', { verb: 'inspect', target: 'sump' }),
  },
};

// ── rendering ───────────────────────────────────────────────────────────────
function describeAction(action: Action): string {
  return action.target ? `${action.verb} ${action.target}` : action.verb;
}

function nodeHeader(node: ScenarioNode, lang: string[]): string {
  const kind = dim(node.kind.padEnd(7));
  const dims = node.dimensions.length > 0 ? dim(` [${node.dimensions.join(', ')}]`) : '';
  return `\n${blue('▸')} ${bold(node.id.padEnd(20))} ${kind}${dims}\n  ${resolveText(node.prompt.text, lang)}`;
}

function printResults(results: NodeResult[]): void {
  const assessed = results.filter((r) => r.kind === 'expect' || r.kind === 'observe');
  if (assessed.length === 0) return;

  console.log(`\n${bold('Node results')}`);
  console.log(
    dim('  node                 ok    ttfc     hesit  errors'),
  );
  for (const result of assessed) {
    const ok = result.satisfied ? green(' yes ') : red(' no  ');
    const ttfc =
      result.timeToFirstCorrectMs === null
        ? dim('   —  ')
        : `${(result.timeToFirstCorrectMs / 1000).toFixed(1)}s`.padStart(6);
    const hesit = result.hesitations > 0 ? yellow(String(result.hesitations).padStart(5)) : dim('    0');
    const errors =
      result.errors.length === 0
        ? dim('—')
        : result.errors
            .map((e) => (e.severity === 'fatal' ? red(e.code) : yellow(e.code)))
            .join(', ');
    console.log(`  ${result.nodeId.padEnd(20)}${ok}${ttfc}  ${hesit}  ${errors}`);
  }
}

function printSummary(session: DrillSession, lang: string[]): void {
  const node = session.node;
  const outcome = session.outcome ?? 'incomplete';
  const paint = outcome === 'pass' ? green : red;
  console.log(`\n${paint(bold(`OUTCOME  ${outcome.toUpperCase()}`))}`);
  if (node.kind === 'outcome') {
    console.log(`  ${resolveText(node.summary.text, lang)}`);
  }

  const errors = session.events.filter(
    (e): e is Extract<DrillEvent, { type: 'error' | 'timeout' }> =>
      e.type === 'error' || e.type === 'timeout',
  );
  if (errors.length > 0) {
    console.log(`\n${bold('Error taxonomy raised')}`);
    for (const error of errors) {
      const paintCode = error.severity === 'fatal' ? red : yellow;
      console.log(
        `  ${paintCode(error.code.padEnd(30))} ${dim(error.severity.padEnd(6))} ${dim(error.dimension)}`,
      );
    }
  }
}

function printVariants(scenario: Scenario, count: number): void {
  console.log(bold(`\n${count} distinct variants — the same procedure, never the same run\n`));
  const variants = distinctVariants(scenario, count);
  for (const variant of variants) {
    const params = Object.entries(variant.params)
      .map(([key, value]) => `${dim(key)}=${value}`)
      .join('  ');
    const branch = variant.nodes.some((n) => n.id === 'permit_absent')
      ? 'permit absent'
      : variant.nodes.some((n) => n.id === 'permit_expired')
        ? 'permit expired'
        : 'permit valid';
    console.log(
      `  ${magenta(variant.variantId)}  ${dim(`seed ${String(variant.seed).padStart(3)}`)}  ${dim(`(${variant.nodes.length} nodes, ${branch})`)}`,
    );
    console.log(`    ${params}\n`);
  }
}


// ── competency rendering ────────────────────────────────────────────────────
const BAR_WIDTH = 18;

function bar(score: number | null, passed: boolean | null): string {
  if (score === null) return dim('·'.repeat(BAR_WIDTH));
  const filled = Math.round((score / 100) * BAR_WIDTH);
  const paint = passed === false ? red : passed === true ? green : yellow;
  return paint('█'.repeat(filled)) + dim('░'.repeat(BAR_WIDTH - filled));
}

function printCompetency(competency: Competency, why: boolean): void {
  const paint =
    competency.result === 'pass' ? green : competency.result === 'fatal' ? red : yellow;
  console.log(
    `
${bold('Competency vector')}  ${dim('— six dimensions, never one number')}`,
  );

  for (const d of competency.vector) {
    const score = d.score === null ? dim('  —') : String(d.score).padStart(3);
    const mark = d.passMark === null ? dim('    ') : dim(`≥${String(d.passMark).padStart(3)}`);
    const tick =
      d.passed === null ? dim('·') : d.passed ? green('✓') : red('✗');
    const note = d.floored
      ? red(' floored by a fatal error')
      : d.evidence === 0
        ? dim(' no evidence in this variant')
        : dim(` ${d.evidence} node${d.evidence === 1 ? '' : 's'}`);
    console.log(
      `  ${d.dimension.padEnd(20)} ${bar(d.score, d.passed)} ${score}  ${mark} ${tick}${note}`,
    );
  }

  const latency = competency.latency;
  console.log(
    dim(
      `
  median time to first correct action  ${
        latency.medianTimeToFirstCorrectMs === null
          ? '—'
          : `${(latency.medianTimeToFirstCorrectMs / 1000).toFixed(1)}s`
      }` +
        `   hesitations ${latency.hesitations}` +
        `   nodes satisfied ${competency.nodes.satisfied}/${competency.nodes.assessed}`,
    ),
  );

  console.log(`
  ${paint(bold(`RESULT  ${competency.result.toUpperCase()}`))}`);
  if (competency.shortfalls.length > 0) {
    console.log(`  ${dim('short of the mark on')} ${competency.shortfalls.join(', ')}`);
  }

  if (why) {
    console.log(`
${bold('Why')} ${dim('— every score traces to named nodes')}`);
    for (const contribution of competency.contributions) {
      if (contribution.earned === contribution.weight) continue; // full credit needs no explanation
      const penalties = contribution.penalties
        .map((p) => `${p.reason} -${p.amount}`)
        .join(', ');
      console.log(
        `  ${contribution.nodeId.padEnd(20)} ${dim(contribution.dimension.padEnd(20))} ` +
          `${String(contribution.earned).padStart(5)}/${contribution.weight}  ${yellow(penalties || 'node not satisfied')}`,
      );
    }
  }
}

// ── one drill, start to finish ──────────────────────────────────────────────
function runDrill(
  variant: ResolvedScenario,
  script: { label: string; build: () => Deviation },
  args: Args,
  trace: boolean,
): { session: DrillSession; competency: Competency } {
  const deviate = script.build();
  let clock = 0;
  const session = new DrillSession(variant, { now: () => clock });

  let seenNode = '';
  let guard = 0;
  while (!session.finished && guard++ < 200) {
    if (trace && session.node.id !== seenNode) {
      seenNode = session.node.id;
      console.log(nodeHeader(session.node, args.lang));
    }

    const move = deviate(session) ?? idealAction(session);
    if (move === null) break;

    clock += args.stepMs;
    const step = move === 'acknowledge' ? session.acknowledge() : session.dispatch(move);

    if (!trace) continue;
    const paint = VERDICT_MARK[step.verdict] ?? dim;
    if (move !== 'acknowledge') {
      console.log(`    ${paint('•')} ${describeAction(move).padEnd(28)} ${paint(step.verdict)}`);
    }
    if (step.consequence) {
      console.log(`      ${red('↳')} ${resolveText(step.consequence.text, args.lang)}`);
    }
    for (const effect of step.effects) {
      console.log(`      ${dim(`↳ world: ${JSON.stringify(effect)}`)}`);
    }
  }

  return { session, competency: scoreSession(session) };
}

function printCertification(scenario: Scenario, args: Args, script: { label: string; build: () => Deviation }): void {
  console.log(
    `${bold('CERTIFICATION RUN')}  ${dim(`${args.attempts} distinct variants · script "${args.script}"`)}
`,
  );

  const variants = distinctVariants(scenario, args.attempts);
  const results: Competency[] = [];

  for (const variant of variants) {
    const { competency } = runDrill(variant, script, args, false);
    results.push(competency);
    const paint =
      competency.result === 'pass' ? green : competency.result === 'fatal' ? red : yellow;
    const weak = competency.shortfalls.length > 0 ? dim(` short on ${competency.shortfalls.join(', ')}`) : '';
    const fatal = competency.fatalErrors.map((e) => red(e.code)).join(', ');
    console.log(
      `  ${magenta(competency.variantId)}  ${paint(competency.result.toUpperCase().padEnd(5))}` +
        `  ${dim(`permit=${String(variant.params.permit_state).padEnd(7)} gas=${variant.params.gas}`)}${weak}${fatal ? '  ' + fatal : ''}`,
    );
  }

  const certification = certify(scenario, results);
  const paint = certification.granted ? green : red;
  console.log(`
${bold('Aggregate across counted variants')}`);
  for (const d of certification.vector) {
    const mean = d.mean === null ? dim('  —') : String(d.mean).padStart(3);
    const worst = d.worst === null ? dim('  —') : String(d.worst).padStart(3);
    const ok = d.mean !== null && d.passMark !== null && d.worst !== null && d.worst >= d.passMark;
    console.log(
      `  ${d.dimension.padEnd(20)} ${bar(d.worst, ok)} ${dim('mean')} ${mean}  ${dim('worst')} ${worst}  ${
        d.passMark === null ? dim('    ') : dim(`≥${d.passMark}`)
      }`,
    );
  }

  console.log(
    `
  ${paint(bold(certification.granted ? 'CREDENTIAL GRANTED' : 'CREDENTIAL WITHHELD'))}` +
      `  ${dim(`${certification.distinctVariantsPassed}/${certification.requiredVariants} distinct variants passed`)}`,
  );
  for (const reason of certification.reasons) console.log(`    ${dim('·')} ${reason}`);
  if (certification.weakest) {
    const { dimension, mean } = certification.weakest;
    const paintWeak = mean === 100 ? dim : yellow;
    console.log(
      `    ${dim('·')} weakest dimension: ${paintWeak(`${dimension} (${mean})`)}` +
        dim(mean === 100 ? ' — nothing to target' : ' — target of the next micro-drill'),
    );
  }
}

// ── main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let scenario: Scenario;
  try {
    scenario = validateScenario(JSON.parse(await readFile(SCENARIO_PATH, 'utf8')));
  } catch (error) {
    if (error instanceof ScenarioError) {
      console.error(red(bold('Scenario failed validation — this is what an author would see:')));
      for (const issue of error.issues) {
        console.error(`  ${yellow(issue.path)}  ${issue.message}`);
      }
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (args.variants > 0) {
    printVariants(scenario, args.variants);
    return;
  }

  const script = SCRIPTS[args.script];
  if (!script) {
    console.error(`Unknown script "${args.script}". Try: ${Object.keys(SCRIPTS).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  if (args.attempts > 0) {
    printCertification(scenario, args, script);
    return;
  }

  const variant: ResolvedScenario = resolveVariant(scenario, args.seed);
  console.log(
    `${bold('SCENARIO')}  ${variant.id} v${variant.version}  ${dim(variant.domain)}
` +
      `${bold('VARIANT ')}  ${magenta(variant.variantId)}  ${dim(`seed ${variant.seed}`)}
` +
      `${bold('PARAMS  ')}  ${Object.entries(variant.params).map(([k, v]) => `${dim(k)}=${v}`).join('  ')}
` +
      `${bold('SCRIPT  ')}  ${args.script} — ${dim(script.label)}`,
  );

  const { session, competency } = runDrill(variant, script, args, true);

  printResults(session.results);
  printSummary(session, args.lang);
  printCompetency(competency, args.why);

  if (args.events) {
    console.log(`
${bold('Event stream')} ${dim(`(${session.events.length} events — this is what the assessment consumes)`)}`);
    for (const event of session.events) {
      console.log(dim(`  ${String(event.t).padStart(6)}ms  ${JSON.stringify(event)}`));
    }
  }
}

await main();
