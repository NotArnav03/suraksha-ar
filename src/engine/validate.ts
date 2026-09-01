import { DIMENSIONS, type Dimension, type Scenario, type ScenarioNode } from './types.ts';

/**
 * Authoring-time validation.
 *
 * Scenarios are authored by a mine's own safety officer, not by us, so a broken
 * graph has to fail loudly at load with a path the author can act on — never
 * halfway through a drill on the pit-top. Referential integrity is the point:
 * dangling `next` targets and unbound roles are the mistakes an author actually
 * makes, and they are exactly what a JSON schema alone would let through.
 */

export interface Issue {
  path: string;
  message: string;
}

export class ScenarioError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(
      `Scenario failed validation with ${issues.length} issue(s):\n` +
        issues.map((i) => `  ${i.path}: ${i.message}`).join('\n'),
    );
    this.name = 'ScenarioError';
    this.issues = issues;
  }
}

const TEMPLATE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function templateKeys(input: string): string[] {
  return [...input.matchAll(TEMPLATE)].map((m) => m[1]!);
}

/** Every literal a templated binding could resolve to, given the declared params. */
function possibleValues(template: string, scenario: Scenario): string[] {
  const keys = templateKeys(template);
  if (keys.length === 0) return [template];
  let results = [template];
  for (const key of keys) {
    const param = scenario.params?.find((p) => p.id === key);
    // ranges cannot name a prop, so an unresolvable key is reported elsewhere
    const options = param?.pick?.map(String) ?? [];
    if (options.length === 0) return [];
    results = results.flatMap((partial) =>
      options.map((value) =>
        partial.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value),
      ),
    );
  }
  return results;
}

export function validateScenario(input: unknown): Scenario {
  const issues: Issue[] = [];
  const push = (path: string, message: string) => issues.push({ path, message });

  if (typeof input !== 'object' || input === null) {
    throw new ScenarioError([{ path: '$', message: 'scenario must be an object' }]);
  }
  const scenario = input as Scenario;

  for (const field of ['id', 'version', 'domain', 'start'] as const) {
    if (typeof scenario[field] !== 'string' || scenario[field].length === 0) {
      push(`$.${field}`, 'required non-empty string');
    }
  }
  if (!Array.isArray(scenario.nodes) || scenario.nodes.length === 0) {
    throw new ScenarioError([...issues, { path: '$.nodes', message: 'at least one node required' }]);
  }
  if (!Array.isArray(scenario.props)) push('$.props', 'required array');
  if (typeof scenario.bindings !== 'object' || scenario.bindings === null) {
    push('$.bindings', 'required object mapping role -> prop id');
  }

  const propIds = new Set((scenario.props ?? []).map((p) => p.id));
  const nodeIds = new Set<string>();
  for (const [index, node] of scenario.nodes.entries()) {
    if (typeof node?.id !== 'string' || node.id.length === 0) {
      push(`$.nodes[${index}].id`, 'required non-empty string');
      continue;
    }
    if (nodeIds.has(node.id)) push(`$.nodes[${index}].id`, `duplicate node id "${node.id}"`);
    nodeIds.add(node.id);
  }

  const paramIds = new Set((scenario.params ?? []).map((p) => p.id));
  for (const [index, param] of (scenario.params ?? []).entries()) {
    const hasPick = Array.isArray(param.pick) && param.pick.length > 0;
    const hasRange = param.range != null;
    if (hasPick === hasRange) {
      push(`$.params[${index}]`, 'exactly one of `pick` or `range` is required');
    }
    if (param.weights && param.pick && param.weights.length !== param.pick.length) {
      push(`$.params[${index}].weights`, 'must be parallel to `pick`');
    }
  }

  // roles must resolve to a real prop under every variant the params allow
  const roles = new Set(Object.keys(scenario.bindings ?? {}));
  for (const [role, template] of Object.entries(scenario.bindings ?? {})) {
    for (const key of templateKeys(template)) {
      if (!paramIds.has(key)) {
        push(`$.bindings.${role}`, `references undeclared param "${key}"`);
      }
    }
    const candidates = possibleValues(template, scenario);
    if (candidates.length === 0) {
      push(`$.bindings.${role}`, `template "${template}" cannot resolve to a prop id`);
    }
    for (const candidate of candidates) {
      if (!propIds.has(candidate)) {
        push(`$.bindings.${role}`, `resolves to "${candidate}", which is not a declared prop`);
      }
    }
  }

  const resolvesToProp = (target: string) => roles.has(target) || propIds.has(target);
  const nodeRef = (path: string, ref: string | undefined) => {
    if (ref === undefined) return;
    if (!nodeIds.has(ref)) push(path, `points at unknown node "${ref}"`);
  };
  const dimensionRef = (path: string, dimension: Dimension) => {
    if (!DIMENSIONS.includes(dimension)) push(path, `unknown dimension "${dimension}"`);
  };

  for (const [index, node] of scenario.nodes.entries()) {
    const at = `$.nodes[${index}](${node.id})`;
    const measures = node.kind === 'expect' || node.kind === 'observe';
    if (!Array.isArray(node.dimensions)) {
      push(`${at}.dimensions`, 'required array (may be empty for brief and outcome nodes)');
    } else if (measures && node.dimensions.length === 0) {
      push(`${at}.dimensions`, 'an assessed node must declare at least one dimension');
    } else {
      node.dimensions.forEach((d, i) => dimensionRef(`${at}.dimensions[${i}]`, d));
    }
    if (!node.prompt?.text?.en) push(`${at}.prompt.text.en`, 'English text is required as the fallback');

    for (const [i, param] of Object.entries(node.when ?? {})) {
      if (!paramIds.has(i)) push(`${at}.when.${i}`, `guards on undeclared param (value ${String(param)})`);
    }

    switch (node.kind) {
      case 'brief':
        nodeRef(`${at}.next`, node.next);
        break;

      case 'expect': {
        nodeRef(`${at}.next`, node.next);
        if (!Array.isArray(node.expect) || node.expect.length === 0) {
          push(`${at}.expect`, 'at least one expectation required');
        }
        node.expect?.forEach((expectation, i) => {
          const target = expectation.match?.target;
          if (target && !resolvesToProp(target)) {
            push(`${at}.expect[${i}].match.target`, `"${target}" is neither a role nor a prop id`);
          }
        });
        node.errors?.forEach((rule, i) => {
          const target = rule.match?.target;
          if (target && !resolvesToProp(target)) {
            push(`${at}.errors[${i}].match.target`, `"${target}" is neither a role nor a prop id`);
          }
          dimensionRef(`${at}.errors[${i}].dimension`, rule.dimension);
          nodeRef(`${at}.errors[${i}].goto`, rule.goto);
          if (rule.severity === 'fatal' && !rule.goto) {
            push(`${at}.errors[${i}]`, 'a fatal error must route to an outcome node via `goto`');
          }
        });
        if (node.onTimeout) {
          dimensionRef(`${at}.onTimeout.dimension`, node.onTimeout.dimension);
          nodeRef(`${at}.onTimeout.goto`, node.onTimeout.goto);
        }
        if (node.window && node.window.hesitationMs > node.window.deadlineMs) {
          push(`${at}.window`, 'hesitationMs must not exceed deadlineMs');
        }
        if (node.window && !node.onTimeout) {
          push(`${at}.onTimeout`, 'a node with a deadline must say what happens when it is missed');
        }
        break;
      }

      case 'observe': {
        nodeRef(`${at}.next`, node.next);
        node.targets?.forEach((target, i) => {
          if (!resolvesToProp(target)) {
            push(`${at}.targets[${i}]`, `"${target}" is neither a role nor a prop id`);
          }
        });
        node.distractors?.forEach((target, i) => {
          if (!resolvesToProp(target)) {
            push(`${at}.distractors[${i}]`, `"${target}" is neither a role nor a prop id`);
          }
        });
        if (!(node.minCorrect >= 1) || node.minCorrect > (node.targets?.length ?? 0)) {
          push(`${at}.minCorrect`, 'must be between 1 and targets.length');
        }
        if (node.onTimeout) nodeRef(`${at}.onTimeout.goto`, node.onTimeout.goto);
        break;
      }

      case 'outcome':
        if (!['pass', 'fail', 'fatal'].includes(node.result)) {
          push(`${at}.result`, 'must be pass, fail or fatal');
        }
        break;

      default:
        push(at, `unknown node kind "${(node as ScenarioNode).kind}"`);
    }
  }

  if (scenario.start && !nodeIds.has(scenario.start)) {
    push('$.start', `points at unknown node "${scenario.start}"`);
  }

  // reachability — an unreachable node is dead content the author thinks is live
  const reachable = new Set<string>();
  const byId = new Map(scenario.nodes.map((n) => [n.id, n]));
  const queue = [scenario.start];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (!id || reachable.has(id) || !byId.has(id)) continue;
    reachable.add(id);
    const node = byId.get(id)!;
    if (node.kind !== 'outcome') queue.push(node.next);
    if (node.kind === 'expect') {
      node.errors?.forEach((rule) => rule.goto && queue.push(rule.goto));
      if (node.onTimeout?.goto) queue.push(node.onTimeout.goto);
    }
    if (node.kind === 'observe' && node.onTimeout?.goto) queue.push(node.onTimeout.goto);
  }
  for (const node of scenario.nodes) {
    if (!reachable.has(node.id)) {
      push(`$.nodes(${node.id})`, 'unreachable from start');
    }
  }

  const hasTerminal = scenario.nodes.some((n) => n.kind === 'outcome' && reachable.has(n.id));
  if (!hasTerminal) push('$.nodes', 'no reachable outcome node — the scenario can never end');

  if (issues.length > 0) throw new ScenarioError(issues);
  return scenario;
}
