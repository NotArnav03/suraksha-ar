import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateScenario } from '../src/engine/validate.ts';

/**
 * Citation hygiene.
 *
 * Every `cite` is shown to a worker and a supervisor on the debrief, so it has
 * to name a provision someone can look up. These were placeholders once
 * ("DGMS guidance on confined space entry"), and a placeholder that reads like a
 * real reference is worse than no reference at all. docs/CITATIONS.md holds the
 * verbatim text each one was checked against.
 */

const dir = fileURLToPath(new URL('../src/scenarios/', import.meta.url));

// An instrument name followed by a pinpoint: a rule, regulation, section or schedule.
const PINPOINT =
  /^(Coal Mines Regulations 2017, r\.\d+|Mines Vocational Training Rules 1966, (r\.\d+|[A-Z][a-z]+ Schedule)|OSH Code 2020, s\.\d+)/;

async function loadAll() {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  return Promise.all(
    files.map(async (f) => ({ file: f, scenario: validateScenario(JSON.parse(await readFile(dir + f, 'utf8'))) })),
  );
}

function allCites(scenario: Awaited<ReturnType<typeof loadAll>>[number]['scenario']): string[] {
  return [
    ...(scenario.regulations ?? []).map((r) => r.cite),
    ...scenario.nodes.flatMap((n) => (n.cites ?? []).map((r) => r.cite)),
  ];
}

test('every citation names an instrument and a pinpoint, not a vague guidance line', async () => {
  for (const { file, scenario } of await loadAll()) {
    const cites = allCites(scenario);
    assert.ok(cites.length > 0, `${file} cites nothing`);
    for (const cite of cites) {
      assert.match(cite, PINPOINT, `${file}: "${cite}" has no checkable pinpoint`);
      assert.doesNotMatch(cite, /guidance/i, `${file}: "${cite}" cites unnamed guidance`);
    }
  }
});

test('the repealed Mines Act is never cited as the live source of a duty', async () => {
  // The OSH Code 2020 came into force on 21 Nov 2025 and repealed the Mines Act
  // 1952 and the Factories Act 1948. Naming them as history is fine; naming
  // them as the operative law is not.
  for (const { file, scenario } of await loadAll()) {
    for (const cite of allCites(scenario)) {
      assert.doesNotMatch(cite, /^(Mines Act 1952|Factories Act 1948)/, `${file}: "${cite}"`);
    }
  }
});

test('the steps where a mistake kills someone keep their citations', async () => {
  const mustCite: Record<string, string[]> = {
    'gas-confined-space': ['gas_test', 'evacuate', 'rescue_decision'],
    'fire-explosion': ['select_extinguisher', 'don_scsr', 'evacuate'],
    'machinery-conveyor-loto': ['observe_hazards', 'rescue_decision', 'isolate_c3', 'isolate_c4', 'lock_and_tag'],
  };
  for (const { scenario } of await loadAll()) {
    for (const id of mustCite[scenario.id] ?? []) {
      const node = scenario.nodes.find((n) => n.id === id);
      assert.ok(node, `${scenario.id} has no node ${id}`);
      assert.ok(node.cites?.length, `${scenario.id}.${id} lost its citation`);
    }
  }
});

test('every oxygen reading the gas drill can show is actually below the legal floor', async () => {
  // The narration calls the reading "below the safe limit". CMR 2017 r.153(2)(b)
  // sets that limit at not less than 19 per cent oxygen, so a variant showing
  // 19.0 would be telling the learner something false.
  const { scenario } = (await loadAll()).find((s) => s.scenario.id === 'gas-confined-space')!;
  const o2 = scenario.params?.find((p) => p.id === 'o2');
  assert.ok(o2 && 'range' in o2 && o2.range, 'the drill should vary its oxygen reading');
  assert.ok(o2.range.max < 19, `oxygen can reach ${o2.range.max}%, which is not below the 19% floor`);
});
