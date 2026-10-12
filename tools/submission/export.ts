import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

// Export the working tree, including uncommitted files, without copying Git history.
// A fresh destination is mandatory so a failed/old export cannot contaminate it.
const root = process.cwd();
const destination = path.resolve(process.argv[2] ?? 'submission');
if (existsSync(destination)) throw new Error('Destination already exists. Choose a new, empty destination.');
if (destination === root || root.startsWith(destination + path.sep)) throw new Error('Destination must not contain the source repository.');
const selected = new Set<string>();
const excluded =
  /(^|\/)(node_modules|Pods|build|dist|\.git|\.gradle|\.cxx|\.kotlin|xcuserdata|project\.xcworkspace)(\/|$)|\.xcode\.env\.local$|(^|\/)local\.properties$|(^|\/)\.DS_Store$|\.(log|tsbuildinfo|apk|aab|p12|mobileprovision|jks)$/;
function add(file: string) {
  const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
  if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Export path escapes the repository.');
  if (excluded.test(relative) || (/(^|\/)\.env(?:\.|$)/.test(relative) && relative !== '.env.example')) return;
  if (!existsSync(relative)) return;
  const stat = lstatSync(relative);
  if (stat.isSymbolicLink()) throw new Error(`Refusing to export a symlink: ${relative}`);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(relative)) add(path.join(relative, entry));
  } else if (stat.isFile()) selected.add(relative);
}

// TypeScript follows type and runtime imports. Resolve each platform separately.
// Include test roots too: fixture-based tests stay in the submission.
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
for (const platform of ['ios', 'android']) {
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, moduleSuffixes: [`.${platform}`, '.native', ''] });
  for (const source of program.getSourceFiles()) {
    const relative = path.relative(root, source.fileName).split(path.sep).join('/');
    if (relative.startsWith('src/') && !relative.includes('/node_modules/')) add(relative);
  }
}
for (const file of [
  'panta-entry.ts',
  'package.json',
  'bun.lock',
  'bunfig.toml',
  '.npmrc',
  '.node-version',
  '.ruby-version',
  '.xcode-version',
  '.watchmanconfig',
  '.gitignore',
  '.gitattributes',
  '.prettierignore',
  '.prettierrc.js',
  '.env.example',
  'Gemfile',
  'Gemfile.lock',
  'LICENSE',
  'README.md',
  'AGENTS.md',
  'app.config.ts',
  'babel.config.js',
  'metro.config.js',
  'react-native.config.js',
  'eslint.config.mjs',
  'tsconfig.json',
  'tsconfig.configs.json',
  'src/app/platform/global-variables.ts',
  'src/assets/toss',
  'src/design',
  'tools/design-atoms',
  'tools/eslint-rules',
  'tools/deps-check',
  'tools/security',
  'tools/panta-gateway',
  'tools/panta-wallet',
  'tools/submission',
  'docs/submission.md',
])
  add(file);
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
for (const patch of Object.values(manifest.patchedDependencies) as string[]) add(patch);
// Native files are selected from the working tree's Git inventory, never build folders.
const previousManifest = 'submission-manifest.json';
const inventory: string[] = existsSync(previousManifest)
  ? JSON.parse(readFileSync(previousManifest, 'utf8')).files
  : execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0');
for (const file of inventory) {
  if (file.startsWith('android/') || file.startsWith('ios/')) add(file);
}

// Scan in memory; never log secret values. Known test credentials remain valid fixtures.
const secretValues: string[] = [];
if (existsSync('.env.panta-server.local')) {
  for (const line of readFileSync('.env.panta-server.local', 'utf8').split('\n')) {
    const match = line.match(/^\s*[A-Z_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z_]*\s*=\s*(.*?)\s*$/);
    const value = match?.[1]?.replace(/^['"]|['"]$/g, '');
    if (value && value.length >= 16) secretValues.push(value);
  }
}
let bytes = 0;
for (const file of selected) {
  const content = readFileSync(file);
  const text = content.toString('utf8');
  if (secretValues.some(secret => text.includes(secret)) || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
    throw new Error(`Credential material detected in ${file}. Export stopped before copying.`);
  bytes += content.length;
}
mkdirSync(destination, { recursive: true });
for (const file of [...selected].sort()) {
  const target = path.join(destination, file);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(file, target);
}
// These legacy Xcode references still exist in the native project. Generate
// credential-free includes rather than copying ignored local build settings.
for (const variant of ['debug', 'release', 'localrelease', 'staging']) {
  const file = `ios/${variant}.xcconfig`;
  const content = `#include? "Pods/Target Support Files/Pods-Rainbow/Pods-Rainbow.${variant}.xcconfig"\n`;
  writeFileSync(path.join(destination, file), content);
  selected.add(file);
  bytes += Buffer.byteLength(content);
}
writeFileSync(
  path.join(destination, 'submission-manifest.json'),
  JSON.stringify(
    { files: [...selected].sort(), bytes, source: 'Uncommitted working tree; no Git history or server credentials' },
    null,
    2
  ) + '\n'
);
console.log(`Exported ${selected.size} files (${(bytes / 1024 / 1024).toFixed(1)} MB) to ${destination}`);
console.log('No repository was initialized, committed or pushed. See docs/submission.md before publishing.');
