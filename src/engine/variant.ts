import { hashString, makeRng, pick, pickNumber } from './rng.ts';
import { interpolate, interpolateNarration, interpolateText } from './text.ts';
import type {
  ErrorRule,
  Expectation,
  ResolvedScenario,
  Scenario,
  ScenarioNode,
  TimeoutRule,
  WorldEffect,
} from './types.ts';
import { validateScenario } from './validate.ts';

/**
 * Variant resolution.
 *
 * Certification requires passing several *distinct* variants, so a learner never
 * sees the same run twice and memorising one sequence is worthless. Only the
 * surface changes — which gas, which reading, whether the permit is valid,
 * whether the ventilation holds. The procedure being assessed is constant, which
 * is the whole point: only the underlying competency generalises.
 */

export function sampleParams(scenario: Scenario, seed: number): Record<string, string | number> {
  const rng = makeRng(seed);
  const params: Record<string, string | number> = {};
  for (const param of scenario.params ?? []) {
    if (param.pick && param.pick.length > 0) {
      params[param.id] = pick(rng, param.pick, param.weights);
    } else if (param.range) {
      params[param.id] = pickNumber(
        rng,
        param.range.min,
        param.range.max,
        param.range.step ?? 1,
        param.range.precision ?? 0,
      );
    }
  }
  return params;
}

function guardPasses(
  node: ScenarioNode,
  params: Record<string, string | number>,
): boolean {
  if (!node.when) return true;
  return Object.entries(node.when).every(([key, expected]) => params[key] === expected);
}

/**
 * Effects carry variant values too — the detector has to read the oxygen level
 * this run actually sampled, not a figure baked in at authoring time.
 */
function resolveEffects(
  effects: WorldEffect[] | undefined,
  params: Record<string, string | number>,
): WorldEffect[] | undefined {
  if (!effects) return undefined;
  return effects.map((effect) => {
    if (effect.type !== 'set_gas' || typeof effect.value !== 'string') return effect;
    const raw = interpolate(effect.value, params);
    const value = Number(raw);
    if (Number.isNaN(value)) {
      throw new Error(`set_gas value "${effect.value}" resolved to "${raw}", which is not a number`);
    }
    return { ...effect, value };
  });
}

function resolveErrorRule(rule: ErrorRule, params: Record<string, string | number>): ErrorRule {
  const effects = resolveEffects(rule.effects, params);
  return {
    ...rule,
    match: { ...rule.match },
    consequence: interpolateNarration(rule.consequence, params),
    ...(effects ? { effects } : {}),
  };
}

function resolveTimeout(rule: TimeoutRule, params: Record<string, string | number>): TimeoutRule {
  const effects = resolveEffects(rule.effects, params);
  return {
    ...rule,
    consequence: interpolateNarration(rule.consequence, params),
    ...(effects ? { effects } : {}),
  };
}

function resolveExpectation(
  expectation: Expectation,
  params: Record<string, string | number>,
): Expectation {
  return {
    match: { ...expectation.match },
    label: interpolateText(expectation.label, params),
  };
}

/**
 * Nodes whose guard fails are spliced out of the graph rather than deleted, so
 * every reference to them follows through to whatever came next. That lets an
 * author add an optional beat without rewiring the surrounding chain by hand.
 */
function buildRedirects(
  nodes: ScenarioNode[],
  keep: Set<string>,
): Map<string, string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const redirects = new Map<string, string>();
  for (const node of nodes) {
    if (keep.has(node.id)) continue;
    if (node.kind === 'outcome') {
      throw new Error(
        `Scenario node "${node.id}" is an outcome guarded by \`when\` — an outcome cannot be spliced out.`,
      );
    }
    let target: string = node.next;
    const seen = new Set<string>([node.id]);
    while (!keep.has(target)) {
      if (seen.has(target)) {
        throw new Error(`Guarded nodes form a cycle with no live exit at "${node.id}".`);
      }
      seen.add(target);
      const nextNode = byId.get(target);
      if (!nextNode || nextNode.kind === 'outcome') break;
      target = nextNode.next;
    }
    redirects.set(node.id, target);
  }
  return redirects;
}

export function resolveVariant(scenario: Scenario, seed: number): ResolvedScenario {
  const params = sampleParams(scenario, seed);
  const live = scenario.nodes.filter((node) => guardPasses(node, params));
  const keep = new Set(live.map((n) => n.id));
  const redirects = buildRedirects(scenario.nodes, keep);
  const redirect = (id: string): string => redirects.get(id) ?? id;

  const nodes: ScenarioNode[] = live.map((node) => {
    const base = {
      id: node.id,
      prompt: interpolateNarration(node.prompt, params),
      dimensions: node.dimensions,
      ...(node.weight !== undefined ? { weight: node.weight } : {}),
      ...(node.cites ? { cites: node.cites } : {}),
      ...(() => {
        const effects = resolveEffects(node.effects, params);
        return effects ? { effects } : {};
      })(),
    };

    /**
     * Every node kind rebuilds itself field by field, which means anything not
     * named here is silently dropped. That is how observe nodes lost their
     * error rules the moment they gained them: the expect case resolved them,
     * the observe case simply did not mention them, and nothing failed until a
     * fatal rule quietly stopped existing in the resolved graph. One helper, so
     * the next kind to carry rules cannot drift the same way.
     */
    const resolvedErrors = (rules: ErrorRule[] | undefined) =>
      rules
        ? {
            errors: rules.map((rule) => {
              const resolved = resolveErrorRule(rule, params);
              return resolved.goto ? { ...resolved, goto: redirect(resolved.goto) } : resolved;
            }),
          }
        : {};

    switch (node.kind) {
      case 'brief':
        return { ...base, kind: 'brief', next: redirect(node.next) };
      case 'expect':
        return {
          ...base,
          kind: 'expect',
          ordered: node.ordered,
          expect: node.expect.map((e) => resolveExpectation(e, params)),
          ...(node.window ? { window: node.window } : {}),
          ...resolvedErrors(node.errors),
          ...(node.onTimeout
            ? {
                onTimeout: (() => {
                  const resolved = resolveTimeout(node.onTimeout, params);
                  return resolved.goto ? { ...resolved, goto: redirect(resolved.goto) } : resolved;
                })(),
              }
            : {}),
          next: redirect(node.next),
        };
      case 'observe':
        return {
          ...base,
          kind: 'observe',
          targets: node.targets,
          minCorrect: node.minCorrect,
          ...(node.distractors ? { distractors: node.distractors } : {}),
          ...(node.window ? { window: node.window } : {}),
          ...resolvedErrors(node.errors),
          ...(node.onTimeout
            ? {
                onTimeout: (() => {
                  const resolved = resolveTimeout(node.onTimeout, params);
                  return resolved.goto ? { ...resolved, goto: redirect(resolved.goto) } : resolved;
                })(),
              }
            : {}),
          next: redirect(node.next),
        };
      case 'outcome':
        return {
          ...base,
          kind: 'outcome',
          result: node.result,
          summary: interpolateNarration(node.summary, params),
        };
    }
  });

  const bindings: Record<string, string> = {};
  for (const [role, template] of Object.entries(scenario.bindings)) {
    bindings[role] = interpolate(template, params);
  }

  const signature = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  const resolved: ResolvedScenario = {
    id: scenario.id,
    version: scenario.version,
    domain: scenario.domain,
    title: interpolateText(scenario.title, params),
    description: interpolateText(scenario.description, params),
    languages: scenario.languages,
    ...(scenario.regulations ? { regulations: scenario.regulations } : {}),
    props: scenario.props,
    bindings,
    start: redirect(scenario.start),
    nodes,
    scoring: scenario.scoring,
    variantId: `${scenario.id}@${hashString(`${scenario.id}|${signature}`)}`,
    seed,
    params,
  };

  // A spliced graph is a new graph. Re-check it rather than trusting the splice.
  validateScenario({ ...resolved, params: [] } as unknown as Scenario);
  return resolved;
}

/**
 * Distinct variants for a certification attempt. Two seeds that happen to sample
 * identical parameters are the same drill wearing a different number, so they are
 * de-duplicated by variantId rather than by seed.
 */
export function distinctVariants(
  scenario: Scenario,
  count: number,
  startSeed = 1,
  maxAttempts = 500,
): ResolvedScenario[] {
  const found = new Map<string, ResolvedScenario>();
  for (let seed = startSeed; seed < startSeed + maxAttempts && found.size < count; seed++) {
    const variant = resolveVariant(scenario, seed);
    if (!found.has(variant.variantId)) found.set(variant.variantId, variant);
  }
  if (found.size < count) {
    throw new Error(
      `Only ${found.size} distinct variants exist for "${scenario.id}" but ${count} were requested — widen the params.`,
    );
  }
  return [...found.values()];
}
