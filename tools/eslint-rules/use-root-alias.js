'use strict';

/**
 * use-root-alias
 *
 * Reports module specifiers that climb out of the importing file's directory
 * (`../foo`, `./../foo`) and autofixes them to the root alias (`@/foo`).
 * Same-directory and descending specifiers (`./foo`, `./sub/foo`) are allowed.
 *
 * Aliases are read from tsconfig.json `compilerOptions.paths`:
 * - the wildcard alias (`@/*` -> `./src/*`) gives the root prefix and root dir;
 * - exact aliases inside the root namespace (e.g. `@/swaps` -> `./src/__swaps__`, if declared)
 *   are preferred when the specifier resolves to exactly their target;
 * - a candidate `@/x` that another alias key would capture as a prefix
 *   (babel-plugin-module-resolver matches keys as prefixes, e.g. `@/swaps/...`)
 *   is reported without a fix, because rewriting it would change resolution.
 *
 * Specifiers that resolve outside the root dir (e.g. `../../package.json`
 * from `src/app/root.tsx`) and files outside the root dir are ignored.
 *
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..');

const aliasCache = new Map();

function stripStar(value) {
  return value.replace(/\/\*$/, '');
}

/**
 * @param {string} repoRoot
 * @param {string} tsconfigFile
 */
function loadAliases(repoRoot, tsconfigFile) {
  const tsconfigPath = path.resolve(repoRoot, tsconfigFile);
  const cached = aliasCache.get(tsconfigPath);
  if (cached) return cached;

  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
  const compilerOptions = tsconfig.compilerOptions || {};
  const baseDir = path.resolve(path.dirname(tsconfigPath), compilerOptions.baseUrl || '.');
  const paths = compilerOptions.paths || {};

  let rootPrefix = null;
  let rootDir = null;
  const exactAliases = new Map(); // absolute target -> alias
  const aliasKeys = []; // prefix-matching keys as babel-plugin-module-resolver sees them

  for (const key of Object.keys(paths)) {
    const target = paths[key] && paths[key][0];
    if (!target) continue;
    const isWildcard = key.endsWith('/*') && target.endsWith('/*');
    if (isWildcard && key.startsWith('@/') && rootPrefix === null) {
      rootPrefix = stripStar(key) + '/';
      rootDir = path.resolve(baseDir, stripStar(target));
      continue;
    }
    aliasKeys.push({ key: stripStar(key), target: path.resolve(baseDir, stripStar(target)), isWildcard });
  }

  if (rootPrefix === null) {
    throw new Error(`use-root-alias: no "@/*" wildcard alias found in ${tsconfigPath} compilerOptions.paths`);
  }

  for (const { key, target, isWildcard } of aliasKeys) {
    if (!isWildcard && key.startsWith(rootPrefix)) exactAliases.set(target, key);
  }

  const result = { rootPrefix, rootDir, exactAliases, aliasKeys };
  aliasCache.set(tsconfigPath, result);
  return result;
}

function isRelative(specifier) {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Require the root alias (@/) instead of relative imports that leave the current directory',
    },
    schema: [
      {
        type: 'object',
        properties: {
          repoRoot: { type: 'string' },
          tsconfig: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      useAlias: "Import '{{ specifier }}' leaves the current directory; use '{{ replacement }}' instead.",
      useAliasNoFix:
        "Import '{{ specifier }}' leaves the current directory; use a root alias import (the '{{ replacement }}' form is shadowed by another tsconfig alias, so this cannot be autofixed).",
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
    const { rootPrefix, rootDir, exactAliases, aliasKeys } = loadAliases(repoRoot, options.tsconfig || 'tsconfig.json');

    const filename = context.physicalFilename;
    if (!path.isAbsolute(filename)) return {};
    const fileDir = path.dirname(filename);
    const fileRel = path.relative(rootDir, filename);
    if (fileRel.startsWith('..') || path.isAbsolute(fileRel)) return {};

    const sourceCode = context.sourceCode;

    /** Babel's module-resolver matches alias keys as prefixes; TS matches exact keys exactly. */
    function isShadowed(candidate) {
      return aliasKeys.some(({ key }) => candidate === key || candidate.startsWith(key + '/'));
    }

    function check(literal) {
      if (!literal || literal.type !== 'Literal' || typeof literal.value !== 'string') return;
      const specifier = literal.value;
      if (!isRelative(specifier)) return;

      const target = path.resolve(fileDir, specifier);
      const fromFileDir = path.relative(fileDir, target);
      if (!fromFileDir.startsWith('..') && !path.isAbsolute(fromFileDir)) return; // same dir or descending

      const fromRoot = path.relative(rootDir, target);
      if (fromRoot === '' || fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) return; // outside root

      const trailingSlash = specifier.endsWith('/') ? '/' : '';
      const exact = exactAliases.get(target);
      const replacement = exact ? exact + trailingSlash : rootPrefix + toPosix(fromRoot) + trailingSlash;
      const fixable = Boolean(exact) || !isShadowed(replacement);

      const raw = sourceCode.getText(literal);
      const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : "'";

      context.report({
        node: literal,
        messageId: fixable ? 'useAlias' : 'useAliasNoFix',
        data: { specifier, replacement },
        fix: fixable ? fixer => fixer.replaceText(literal, quote + replacement + quote) : null,
      });
    }

    function checkFirstArg(node) {
      const arg = node.arguments && node.arguments[0];
      if (arg) check(arg);
    }

    return {
      ImportDeclaration: node => check(node.source),
      ExportNamedDeclaration: node => check(node.source),
      ExportAllDeclaration: node => check(node.source),
      ImportExpression: node => check(node.source),
      TSExternalModuleReference: node => check(node.expression),
      TSImportType: node => {
        const arg = node.argument || node.parameter;
        if (arg && arg.type === 'TSLiteralType') check(arg.literal);
        else check(arg);
      },
      CallExpression: node => {
        const { callee } = node;
        if (callee.type === 'Identifier' && callee.name === 'require') {
          checkFirstArg(node);
          return;
        }
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return;
        const object = callee.object;
        if (object.type !== 'Identifier') return;
        if (object.name === 'require' && callee.property.name === 'resolve') checkFirstArg(node);
      },
    };
  },
};
