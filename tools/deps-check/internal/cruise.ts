import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CruisedModule } from './featureGraph';
import { ROOT } from './paths';
import type { Violation } from './violation';

export type CruiseSummary = {
  violations: Violation[];
  ruleSetUsed?: { forbidden?: { name: string }[] };
};

/** One platform's cruise: the unioned summary plus the source graph's modules, for graph-level checks. */
export type CruiseResult = CruiseSummary & { sourceModules: CruisedModule[] };

type CruiseOutput = { summary: CruiseSummary; modules: CruisedModule[] };

/**
 * The graphs dependency-cruiser.cjs exports, selected by DEPCRUISE_GRAPH. Each
 * rule lives on exactly one graph, so unioning the summaries loses nothing and
 * double-counts nothing.
 */
export const GRAPHS = ['runtime', 'source'] as const;
export type Graph = (typeof GRAPHS)[number];

const TMP = mkdtempSync(join(tmpdir(), 'deps-check-'));
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));

/**
 * Cruise every graph for one platform and return the union: the raw violation
 * list plus the rule set used, and the source graph's modules (the input of
 * the feature-level cycle check, which type coupling counts towards). The
 * cruise is baseline-agnostic; all baseline matching happens downstream by
 * identity (see classify.ts).
 */
export function cruise(platform: string): CruiseResult {
  const outputs = GRAPHS.map(graph => ({ graph, output: cruiseGraph(platform, graph) }));
  return {
    violations: outputs.flatMap(({ output }) => output.summary.violations),
    ruleSetUsed: { forbidden: outputs.flatMap(({ output }) => output.summary.ruleSetUsed?.forbidden ?? []) },
    sourceModules: outputs.find(({ graph }) => graph === 'source')?.output.modules ?? [],
  };
}

function cruiseGraph(platform: string, graph: Graph): CruiseOutput {
  const out = join(TMP, `cruise-${platform}-${graph}.json`);
  const cliArgs = [
    'panta-entry.ts',
    '--config',
    'tools/deps-check/dependency-cruiser.cjs',
    '--output-type',
    'json',
    '--output-to',
    out,
    '--progress',
    'none',
  ];
  const res = spawnSync(join(ROOT, 'node_modules/.bin/depcruise'), cliArgs, {
    cwd: ROOT,
    env: { ...process.env, DEPCRUISE_PLATFORM: platform, DEPCRUISE_GRAPH: graph },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // depcruise exits with the violation count; only a missing result file is fatal.
  if (!existsSync(out)) {
    console.error(res.stderr?.toString() ?? '');
    throw new Error(`depcruise produced no output for ${platform}/${graph} (exit ${res.status})`);
  }
  return JSON.parse(readFileSync(out, 'utf8')) as CruiseOutput;
}
