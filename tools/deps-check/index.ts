#!/usr/bin/env tsx
/**
 * Dependency-rule gate over dependency-cruiser, with a per-rule policy layer.
 *
 * Rules live in dependency-cruiser.cjs; what a violation of each rule means
 * (grandfathered vs strict) is declared in ./policies.ts. Baseline diffing is
 * identity-based (a cycle is matched by rule + module set, rotation-
 * insensitive), so removing five violations never buys room for a new one.
 *
 * dependency-cruiser resolves one platform per run (foo.ios / foo.android),
 * so every check runs once per platform; the union of the two runs sees every
 * edge that can ship on either platform. Each platform run cruises both graphs
 * declared in dependency-cruiser.cjs (runtime, source) and unions
 * their violations; see internal/cruise.ts.
 *
 * Besides the dependency-cruiser rules, two checks are computed here and
 * judged by the same policies and baselines: `no-feature-cycle` (feature-level
 * SCCs over the source graph, internal/featureGraph.ts) and `legacy-freeze` (no
 * new files in frozen legacy directories, snapshot in legacy-freeze.json).
 *
 * Usage:
 *   bun run lint:deps                                     # check (CI + local)
 *   bun run lint:deps:baseline:update                     # ratchet baselines down
 *   bun run lint:deps:baseline:update --allow-additions   # deliberately grandfather
 *   bun run lint:deps:baseline:update --allow-renames[=<ref>]
 *       # pure-move PRs: re-key entries whose paths moved. An addition is
 *       # accepted only if it pairs with a removal under the renames git
 *       # detects (`git diff -M`) between the merge base with <ref>
 *       # (default origin/develop) and the working tree.
 *
 * Output: human-readable terminal report; .report.md (always, for the CI
 * step summary); .comment.md (when the check fails OR this change touched
 * the baselines — banked fixes and grandfathered additions stay visible on
 * green runs; consumed by the sticky PR comment step); GitHub error
 * annotations on new violations when running in Actions.
 *
 * Exit codes: 0 clean; 1 violations (new, strict, or fixed-but-unratcheted);
 * 2 configuration error.
 */
import { rmSync, writeFileSync } from 'node:fs';

import { planUpdate, readBaseline, writeBaseline } from './internal/baseline';
import { classifyPlatform } from './internal/classify';
import { cruise, type CruiseSummary } from './internal/cruise';
import { computeBaselineDelta } from './internal/delta';
import { featureCycleViolations } from './internal/featureGraph';
import { legacyFreezeViolations, listFrozenFiles } from './internal/legacyFreeze';
import { COMMENT_PATH, REPORT_PATH } from './internal/paths';
import { DEFAULT_RENAME_BASE, pairRenames, readRenameMap } from './internal/renames';
import { renderAnnotations } from './internal/render/annotations';
import { renderMarkdown } from './internal/render/markdown';
import { renderTerminal } from './internal/render/terminal';
import { buildReport } from './internal/report';
import { describeViolation, type Violation } from './internal/violation';
import { CUSTOM_RULES, policyFor, unknownPolicyRules } from './policies';

const platforms = ['ios', 'android'];

const args = process.argv.slice(2);
const updateBaseline = args.includes('--update-baseline');
const allowAdditions = args.includes('--allow-additions');
const renamesArg = args.find(arg => arg === '--allow-renames' || arg.startsWith('--allow-renames='));
const renameBase = renamesArg?.includes('=') ? renamesArg.slice('--allow-renames='.length) : DEFAULT_RENAME_BASE;

if (allowAdditions && renamesArg) {
  console.error('✖ --allow-additions and --allow-renames are exclusive: --allow-additions already accepts every addition.');
  process.exit(2);
}

/** A policy naming a rule that does not exist is a typo or a missed rename; fail loudly. */
function validatePolicies(summary: CruiseSummary): void {
  const known = new Set([...(summary.ruleSetUsed?.forbidden ?? []).map(rule => rule.name), ...CUSTOM_RULES]);
  const unknown = unknownPolicyRules(known);
  if (unknown.length > 0) {
    console.error(`✖ tools/deps-check/policies.ts references rules missing from dependency-cruiser.cjs: ${unknown.join(', ')}`);
    process.exit(2);
  }
}

/** The platform-agnostic snapshot checks, computed once per run. */
let snapshotViolations: Violation[] | undefined;
function snapshotChecks(): Violation[] {
  snapshotViolations ??= legacyFreezeViolations(listFrozenFiles());
  return snapshotViolations;
}

/** Every violation on one platform: the dependency-cruiser rules plus the checks computed here. */
function collect(platform: string): Violation[] {
  const result = cruise(platform);
  validatePolicies(result);
  return [...result.violations, ...featureCycleViolations(result.sourceModules), ...snapshotChecks()];
}

function runUpdate(): void {
  const renames = renamesArg ? readRenameMap(renameBase) : null;
  for (const platform of platforms) {
    const current = collect(platform).filter(v => policyFor(v.rule.name).mode === 'baseline');
    const allow = renames
      ? (additions: Violation[], removed: Violation[]) => pairRenames(additions, removed, renames).accepted
      : allowAdditions;
    const { written, removed, additions, accepted } = planUpdate(readBaseline(platform), current, allow);
    writeBaseline(platform, written);
    console.log(`✔ ${platform}: baseline written (${written.length} entries; ${removed.length} removed, ${accepted.length} added)`);

    const rejected = additions.length - accepted.length;
    if (rejected > 0) {
      const acceptedSet = new Set(accepted);
      const why = renames ? ` (no rename since the merge base with ${renameBase} pairs them with a removal)` : '';
      console.warn(`⚠ ${platform}: ${rejected} new violation${rejected === 1 ? '' : 's'} left out of the baseline${why}:`);
      for (const v of additions.filter(addition => !acceptedSet.has(addition))) {
        console.warn(`    ${v.rule.name}: ${describeViolation(v)}`);
      }
      console.warn('  The check keeps failing until these are fixed, or grandfathered with --allow-additions.');
    }
  }
  process.exit(0);
}

function runCheck(): void {
  rmSync(REPORT_PATH, { force: true });
  rmSync(COMMENT_PATH, { force: true });

  const results = platforms.map(platform => classifyPlatform(platform, readBaseline(platform), collect(platform)));
  const report = buildReport(results, computeBaselineDelta(platforms));

  console.log(renderTerminal(report));
  if (process.env.GITHUB_ACTIONS) {
    for (const line of renderAnnotations(report)) {
      console.log(line);
    }
  }
  const markdown = renderMarkdown(report);
  writeFileSync(REPORT_PATH, markdown);

  if (report.failed || report.banked.length > 0 || report.grandfathered.length > 0) {
    writeFileSync(COMMENT_PATH, markdown);
  }

  process.exit(report.failed ? 1 : 0);
}

if (updateBaseline) {
  runUpdate();
} else {
  runCheck();
}
