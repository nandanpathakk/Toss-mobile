import { spawnSync } from 'node:child_process';

import { LEGACY_FREEZE_RULE } from './legacyFreeze';
import { ROOT } from './paths';
import { violationKey, type ModuleRef, type Violation } from './violation';

/** old path → new path, for every rename git detects between the merge base and the working tree. */
export type RenameMap = Map<string, string>;

export const DEFAULT_RENAME_BASE = 'origin/develop';

function git(args: string[]): string {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** Parses `git diff -M --name-status -z` output into a rename map; every other status is ignored. */
export function parseNameStatus(output: string): RenameMap {
  const fields = output.split('\0');
  const renames: RenameMap = new Map();
  let i = 0;
  while (i < fields.length && fields[i] !== '') {
    const status = fields[i];
    // R and C records carry two paths; every other status carries one.
    if (status.startsWith('R')) {
      renames.set(fields[i + 1], fields[i + 2]);
    }
    i += status.startsWith('R') || status.startsWith('C') ? 3 : 2;
  }
  return renames;
}

/**
 * Renames between the merge base of HEAD and `baseRef` and the working tree.
 * Only paths git knows about take part: stage a move (`git mv`, or `git add`
 * both sides) before running the update, or git sees a delete plus an
 * untracked file instead of a rename.
 */
export function readRenameMap(baseRef: string): RenameMap {
  const mergeBase = git(['merge-base', 'HEAD', baseRef]).trim();
  return parseNameStatus(git(['diff', '-M', '--name-status', '-z', mergeBase]));
}

/** new path → old path. */
export type InverseRenameMap = Map<string, string>;

export function invertRenames(renames: RenameMap): InverseRenameMap {
  return new Map([...renames].map(([from, to]) => [to, from]));
}

/**
 * Maps a path at its new location back to where it was at the merge base.
 * Files map through the rename map directly. A directory (a feature, a
 * folder) maps when every renamed file under it came from the same old
 * directory; anything else is returned unchanged.
 */
export function renamePathBack(path: string, inverse: InverseRenameMap): string {
  const exact = inverse.get(path);
  if (exact !== undefined) {
    return exact;
  }
  const prefixes = new Set<string>();
  for (const [to, from] of inverse) {
    if (to.startsWith(`${path}/`)) {
      const suffix = to.slice(path.length);
      if (!from.endsWith(suffix)) {
        return path;
      }
      prefixes.add(from.slice(0, from.length - suffix.length));
    }
  }
  return prefixes.size === 1 ? [...prefixes][0] : path;
}

function renameRefsBack(refs: ModuleRef[] | undefined, inverse: InverseRenameMap): ModuleRef[] | undefined {
  return refs?.map(ref => ({ ...ref, name: renamePathBack(ref.name, inverse) }));
}

/** The violation as it would have been keyed before the renames. */
export function renameViolationBack(v: Violation, inverse: InverseRenameMap): Violation {
  const back: Violation = { ...v, from: renamePathBack(v.from, inverse), to: renamePathBack(v.to, inverse) };
  if (v.cycle) {
    back.cycle = renameRefsBack(v.cycle, inverse);
  }
  if (v.via) {
    back.via = renameRefsBack(v.via, inverse);
  }
  return back;
}

/**
 * `--allow-renames`: an addition is accepted only when it pairs with a
 * removal, i.e. mapping its paths back through the renames yields a baseline
 * entry that no longer occurs. Each removal pairs at most once, so a move can
 * re-key an edge but never add one. A legacy-freeze entry is a file, and a
 * file that arrived by rename is not a new file, so it is accepted on the
 * rename alone (moving a file into a frozen dir from outside has no removal
 * to pair with).
 */
export function pairRenames(
  additions: Violation[],
  removed: Violation[],
  renames: RenameMap
): { accepted: Violation[]; unpaired: Violation[] } {
  const inverse = invertRenames(renames);
  const unclaimed = new Set(removed.map(violationKey));
  const accepted: Violation[] = [];
  const unpaired: Violation[] = [];
  for (const addition of additions) {
    const key = violationKey(renameViolationBack(addition, inverse));
    if (key !== violationKey(addition) && unclaimed.has(key)) {
      unclaimed.delete(key);
      accepted.push(addition);
    } else if (addition.rule.name === LEGACY_FREEZE_RULE && inverse.has(addition.from)) {
      accepted.push(addition);
    } else {
      unpaired.push(addition);
    }
  }
  return { accepted, unpaired };
}
