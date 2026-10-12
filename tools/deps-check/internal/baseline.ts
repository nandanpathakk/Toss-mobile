import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { deserializeLegacyFreeze, LEGACY_FREEZE_RULE, serializeLegacyFreeze, type LegacyFreezeFile } from './legacyFreeze';
import { ROOT } from './paths';
import { differenceByIdentity, type Violation } from './violation';

/**
 * Platform-agnostic ratchets keep their grandfathered entries in their own
 * reviewable snapshot file instead of the per-platform baselines. Both
 * platform runs read the same file and write identical content to it.
 */
type RatchetFile = {
  rule: string;
  file: string;
  serialize(entries: Violation[]): unknown;
  deserialize(json: unknown): Violation[];
};

export const RATCHET_FILES: RatchetFile[] = [
  {
    rule: LEGACY_FREEZE_RULE,
    file: 'tools/deps-check/legacy-freeze.json',
    serialize: serializeLegacyFreeze,
    deserialize: json => deserializeLegacyFreeze(json as LegacyFreezeFile),
  },
];

const ratchetRules = new Set(RATCHET_FILES.map(ratchet => ratchet.rule));

/** The platform's baseline plus every ratchet snapshot, as one violation list. */
export function readBaseline(platform: string): Violation[] {
  const read = (file: string): unknown => (existsSync(join(ROOT, file)) ? JSON.parse(readFileSync(join(ROOT, file), 'utf8')) : null);
  return assemble(read(baselineFile(platform)) as Violation[] | null, ratchet => read(ratchet.file));
}

/** The platform's baseline (plus ratchet snapshots) as committed at `ref`; null when the baseline is not readable there. */
export function readBaselineAtRef(platform: string, ref: string): Violation[] | null {
  const platformBaseline = readJsonAtRef(baselineFile(platform), ref) as Violation[] | null;
  if (!platformBaseline) {
    return null;
  }
  // A snapshot missing at ref (history before it existed) reads as empty.
  return assemble(platformBaseline, ratchet => readJsonAtRef(ratchet.file, ref));
}

function assemble(platformBaseline: Violation[] | null, readRatchet: (ratchet: RatchetFile) => unknown): Violation[] {
  const entries = (platformBaseline ?? []).filter(entry => !ratchetRules.has(entry.rule.name));
  for (const ratchet of RATCHET_FILES) {
    const json = readRatchet(ratchet);
    if (json) {
      entries.push(...ratchet.deserialize(json));
    }
  }
  return entries;
}

function readJsonAtRef(file: string, ref: string): unknown {
  // Baselines are multi-megabyte; spawnSync's default 1MiB maxBuffer kills git mid-pipe.
  const result = spawnSync('git', ['show', `${ref}:${file}`], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return null;
  }
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    return null;
  }
}

/** Writes the platform baseline, routing ratchet-rule entries to their snapshot files. */
export function writeBaseline(platform: string, entries: Violation[]): void {
  writeJson(
    baselineFile(platform),
    entries.filter(entry => !ratchetRules.has(entry.rule.name))
  );
  for (const ratchet of RATCHET_FILES) {
    writeJson(ratchet.file, ratchet.serialize(entries.filter(entry => entry.rule.name === ratchet.rule)));
  }
}

function writeJson(file: string, json: unknown): void {
  writeFileSync(join(ROOT, file), JSON.stringify(json, null, 2) + '\n');
}

/**
 * Which additions an update may write: none (the default), all of them
 * (`--allow-additions`), or those a predicate accepts given the removals
 * (`--allow-renames`).
 */
export type AdditionPolicy = boolean | ((additions: Violation[], removed: Violation[]) => Violation[]);

export type UpdatePlan = {
  written: Violation[];
  removed: Violation[];
  /** Every occurrence missing from the old baseline. */
  additions: Violation[];
  /** The additions actually written. */
  accepted: Violation[];
};

/**
 * Ratchet plan for one platform's baseline. Removals always apply (banking
 * fixes is never blocked); additions only as `allow` permits. Kept entries
 * are preserved verbatim from the old baseline so the diff shows exactly the
 * removals and the accepted additions.
 */
export function planUpdate(oldBaseline: Violation[], current: Violation[], allow: AdditionPolicy): UpdatePlan {
  const additions = differenceByIdentity(current, oldBaseline);
  const removed = differenceByIdentity(oldBaseline, current);
  if (allow === true) {
    return { written: current, removed, additions, accepted: additions };
  }
  const accepted = allow === false ? [] : allow(additions, removed);
  return { written: [...differenceByIdentity(oldBaseline, removed), ...accepted], removed, additions, accepted };
}

function baselineFile(platform: string): string {
  return `tools/deps-check/baseline.${platform}.json`;
}
