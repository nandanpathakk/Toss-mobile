import { spawnSync } from 'node:child_process';

import { ROOT } from './paths';
import type { Violation } from './violation';

export const LEGACY_FREEZE_RULE = 'legacy-freeze';

/**
 * Legacy directories whose code belongs in lib/, design/, stores/ or features/.
 * They are frozen: the files in them today are grandfathered in
 * legacy-freeze.json, and any new file fails the check. Files leave by moving
 * or deleting, which ratchets the snapshot down.
 */
export const FROZEN_DIRS = ['src/app/navigation/cool-modals', 'src/lib/react-query'] as const;

/** The frozen directory a path lives in, or null. */
export function frozenDirOf(path: string): string | null {
  return FROZEN_DIRS.find(dir => path.startsWith(`${dir}/`)) ?? null;
}

/** One violation per file in a frozen directory; identity is the file itself. */
export function legacyFreezeViolations(files: string[]): Violation[] {
  return files
    .filter(file => frozenDirOf(file) !== null)
    .sort()
    .map(fileViolation);
}

function fileViolation(file: string): Violation {
  return { from: file, to: file, rule: { name: LEGACY_FREEZE_RULE } };
}

/** Tracked plus untracked-but-not-ignored files under the frozen directories. */
export function listFrozenFiles(): string[] {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...FROZEN_DIRS], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }
  // --cached lists a file deleted from the working tree but not yet from the index; it is gone.
  const deleted = spawnSync('git', ['ls-files', '--deleted', '-z', '--', ...FROZEN_DIRS], { cwd: ROOT, encoding: 'utf8' });
  const gone = new Set(deleted.stdout.split('\0').filter(Boolean));
  return [...new Set(result.stdout.split('\0').filter(Boolean))].filter(file => !gone.has(file));
}

/** legacy-freeze.json shape: frozen directory → the files it may contain, sorted. */
export type LegacyFreezeFile = Record<string, string[]>;

export function serializeLegacyFreeze(entries: Violation[]): LegacyFreezeFile {
  const byDir: LegacyFreezeFile = {};
  for (const file of entries.map(entry => entry.from).sort()) {
    const dir = frozenDirOf(file) ?? file;
    (byDir[dir] ??= []).push(file);
  }
  return Object.fromEntries(
    Object.keys(byDir)
      .sort()
      .map(dir => [dir, byDir[dir]])
  );
}

export function deserializeLegacyFreeze(json: LegacyFreezeFile): Violation[] {
  return Object.values(json).flat().map(fileViolation);
}
