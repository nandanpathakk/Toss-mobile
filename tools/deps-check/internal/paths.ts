import { join, resolve } from 'node:path';

// __dirname rather than import.meta: the repo is CommonJS, so tsx runs these
// scripts as CJS, where import.meta is unavailable.
export const ROOT = resolve(__dirname, '..', '..', '..');
export const REPORT_PATH = join(ROOT, 'tools/deps-check/.report.md');
export const COMMENT_PATH = join(ROOT, 'tools/deps-check/.comment.md');
