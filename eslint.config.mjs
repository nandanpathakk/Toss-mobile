import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as babelParse } from '@babel/parser';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import { fixupPluginRules } from '@eslint/compat';
import js from '@eslint/js';
import astParser from 'ast-parser';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import-x';
import jest from 'eslint-plugin-jest';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';
import yml from 'eslint-plugin-yml';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import rainbowLocal from './tools/eslint-rules/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const data = fs.readFileSync(path.resolve(__dirname, './src/app/platform/global-variables.ts'), 'utf8');

// syntax in globalVariables.js's imports is not supported here
const globalVars = astParser
  .parse(babelParse(data, { sourceType: 'module', plugins: ['typescript'] }))
  .program.body.find(e => e.nodeType === 'ExportDefaultDeclaration')
  .declaration.properties.map(e => e.key.name)
  .reduce(
    (acc, variable) => {
      acc[variable] = true;
      return acc;
    },
    {
      __DEV__: true,
    }
  );

// `rainbow-local/use-root-alias` applies to all first-party source.
const useRootAliasEnforcedFiles = ['src/**/*.{js,jsx,ts,tsx}'];

// Files that get the JS/TS rule set. The GraphQL documents get only the GraphQL rules: under eslintrc they
// also inherited the JS rules, which have nothing to visit in a GraphQL AST, and typescript-eslint's rules
// refuse to run without its parser.
const CODE_FILES = ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'];
const GRAPHQL_FILES = ['src/graphql/**/*.graphql'];

/**
 * @param {import('eslint').Linter.Config[]} configs
 * @returns {import('eslint').Linter.Config[]}
 */
const forCodeFiles = configs => configs.map(config => ({ ...config, files: config.files ?? CODE_FILES }));

// @graphql-eslint/eslint-plugin is a dependency of the src/graphql package (installed by `bun run setup`),
// so resolve it from there. Without it the GraphQL documents cannot be parsed, so they are skipped.
const graphqlRequire = createRequire(path.resolve(__dirname, 'src/graphql/package.json'));
/** @type {any} */
let graphqlPlugin = null;
try {
  graphqlPlugin = graphqlRequire('@graphql-eslint/eslint-plugin');
} catch {
  console.warn('eslint: @graphql-eslint/eslint-plugin is not installed in src/graphql; skipping *.graphql files.');
}

export default defineConfig([
  // Translated from .eslintignore. ESLint 8 also ignored dotfiles and dot-directories by default.
  globalIgnores([
    '**/.*',
    'patches/reanimated/*',
    'ios/**',
    'android/**',
    '**/node_modules/**',
    'coverage-ts/**',
    '**/out/',
    'eslint.config.mjs',
    '**/babel.config.js',
    '**/metro.config.js',
    '**/__generated__',
    '**/__generated__/**',
    '**/coverage',
    '**/coverage/**',
    '**/rainbow-scripts',
    '**/rainbow-scripts/**',
    'src/features/positions/generated/**',
    ...(graphqlPlugin ? [] : GRAPHQL_FILES),
  ]),

  {
    // ESLint 8 did not report unused disable directives unless asked to.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },

  // --- Shared base config (formerly eslint-config-rainbow 4.3.0) ---
  {
    files: CODE_FILES,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: __dirname,
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.es2021,
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        ...globalVars,
      },
    },
    plugins: {
      'eslint-comments': eslintComments,
      'import': importPlugin,
      'react-hooks': reactHooks,
      'unused-imports': unusedImports,
      'rainbow-local': rainbowLocal,
    },
    settings: {
      'react': { version: 'detect' },
      // The shared config enables eslint-plugin-jest, which needs a version when jest is not installed.
      'jest': { version: 29 },
      'import-x/resolver': {
        'typescript': true,
        'node': true,
        'babel-module': true,
      },
      'import-x/extensions': ['.ts', '.tsx', '.js', '.jsx'],
      'import-x/external-module-folders': ['node_modules', 'node_modules/@types'],
      'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
    },
  },
  ...forCodeFiles([js.configs.recommended]),
  ...forCodeFiles(tseslint.configs.recommended),
  ...forCodeFiles([{ ...react.configs.flat.recommended, plugins: { react: fixupPluginRules(react) } }]),
  ...forCodeFiles([jest.configs['flat/recommended']]),
  ...forCodeFiles([prettierConfig]),

  // The presets above changed between the plugin versions eslint-config-rainbow 4.3.0 pinned (ESLint 8,
  // typescript-eslint 5, eslint-plugin-jest 26) and the current ones. These entries restore the rule set
  // the shared config produced, so the ESLint 10 migration does not change what is reported.
  {
    files: CODE_FILES,
    rules: {
      // Dropped from eslint:recommended in ESLint 9. ESLint 9 also changed its default to allow
      // block-scoped functions; the ESLint 8 behavior disallowed them.
      'no-inner-declarations': ['error', 'functions', { blockScopedFunctions: 'disallow' }],
      // ESLint 9 changed the default to 'allExceptWhileTrue'; ESLint 8 checked all loops.
      'no-constant-condition': ['error', { checkLoops: 'all' }],
      // ESLint 10 reports `globalThis` shadowing by default; ESLint 8 did not.
      'no-shadow-restricted-names': ['error', { reportGlobalThis: false }],
      // Added to eslint:recommended in ESLint 9/10.
      'no-constant-binary-expression': 'off',
      'no-empty-static-block': 'off',
      'no-unassigned-vars': 'off',
      'no-unused-private-class-members': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',

      // Moved out of typescript-eslint's recommended config in v6.
      '@typescript-eslint/adjacent-overload-signatures': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // typescript-eslint 5 recommended reported unused vars as warnings, and ESLint 8's no-unused-vars
      // (whose options it reuses) defaulted caughtErrors to 'none'; ESLint 9 changed it to 'all'.
      '@typescript-eslint/no-unused-vars': ['warn', { caughtErrors: 'none' }],
      // Added to typescript-eslint's recommended config in v6-v8. no-require-imports replaces
      // no-var-requires, which stays on at 'warn' below. no-empty-object-type, no-unsafe-function-type
      // and no-wrapper-object-types replace ban-types and no-empty-interface, so they stay on.
      '@typescript-eslint/no-duplicate-enum-values': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-declaration-merging': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',

      // Added to eslint-plugin-jest's recommended config after v26.
      'jest/no-alias-methods': 'off',
    },
  },
  {
    // typescript-eslint 5's eslint-recommended overrides kept these on for TypeScript files and turned
    // valid-typeof off; v8 flips all three.
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: {
      'no-class-assign': 'error',
      'no-with': 'error',
      'valid-typeof': 'off',
    },
  },

  {
    files: CODE_FILES,
    rules: {
      // eslint-plugin-eslint-comments recommended
      'eslint-comments/disable-enable-pair': ['error', { allowWholeFile: true }],
      'eslint-comments/no-aggregating-enable': 'error',
      'eslint-comments/no-duplicate-disable': 'error',
      'eslint-comments/no-unlimited-disable': 'error',
      'eslint-comments/no-unused-enable': 'error',

      // eslint-plugin-import recommended (+ typescript)
      'import/no-unresolved': 'error',
      'import/export': 'error',

      // eslint-plugin-react-hooks recommended
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      'prefer-object-spread': 'error',
      'no-duplicate-imports': 'error',
      'no-multi-assign': 'error',
      'no-prototype-builtins': 'warn', // this one is probably fine
      'no-irregular-whitespace': 'warn', // not a big deal most of the time
      'spaced-comment': 'warn',
      'no-var': 'warn',
      'prefer-const': 'warn',
      'prefer-rest-params': 'warn',
      'prefer-spread': 'warn',
      'no-async-promise-executor': 'warn',
      'no-await-in-loop': 'warn',
      'no-promise-executor-return': 'warn',
      'require-atomic-updates': 'warn',
      'default-param-last': 'warn',
      'no-param-reassign': 'warn',
      'no-plusplus': ['warn', { allowForLoopAfterthoughts: true }],
      'no-nested-ternary': 'warn',
      'no-unneeded-ternary': 'warn',

      'import/no-default-export': 'warn',

      '@typescript-eslint/ban-ts-comment': ['warn', { 'ts-expect-error': 'allow-with-description' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-inferrable-types': 'warn',
      '@typescript-eslint/no-empty-function': 'warn',
      '@typescript-eslint/no-var-requires': 'warn',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'warn',

      'react/jsx-props-no-spreading': 'warn',
      'react/prop-types': 'off',
      'react/display-name': 'warn',
    },
  },

  // --- Repo config ---
  {
    files: CODE_FILES,
    rules: {
      'no-duplicate-imports': 'off',
      'import/no-duplicates': 'error',
      'unused-imports/no-unused-imports': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
          disallowTypeAnnotations: false,
        },
      ],
      'no-restricted-imports': [
        'warn',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['StatusBar'],
              message: 'Use SystemBars from "react-native-edge-to-edge" instead.',
            },
          ],
          patterns: [
            {
              group: ['@react-navigation/core'],
              message: 'You probably want to use @/navigation instead, to ensure that all of our customizations are applied.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          // Import `Platform` directly from 'react-native' so platform shaking can constant-fold `Platform.OS`
          // checks at build time. Re-imports from wrapper modules break the optimization (https://docs.expo.dev/guides/tree-shaking/#platform-shaking).
          selector: "ImportDeclaration[source.value!='react-native'] > ImportSpecifier[imported.name='Platform'][local.name='Platform']",
          message: "Import `Platform` directly from 'react-native'. Re-importing from a wrapper breaks platform shaking optimization.",
        },
      ],
      'no-await-in-loop': 'off',
      'no-nested-ternary': 'off',
      'react/react-in-jsx-scope': 'off',
      'react-hooks/exhaustive-deps': [
        'warn',
        {
          additionalHooks:
            '(useDeepCompareEffect|useDeepCompareCallback|useDeepCompareMemo|useDeepCompareImperativeHandle|useDeepCompareLayoutEffect|useChangeEffect)',
        },
      ],
    },
  },

  ...yml.configs.standard,
  {
    files: ['**/*.yml', '**/*.yaml'],
    rules: {
      // currently we use single quotes for yaml files
      'yml/quotes': ['warn', { prefer: 'single', avoidEscape: false }],
      // we also put scalars in quotes
      'yml/plain-scalar': 'off',
      // Added to eslint-plugin-yml's standard config after v1.
      'yml/block-mapping-colon-indicator-newline': 'off',
      'yml/no-multiple-empty-lines': 'off',
      'yml/no-trailing-spaces': 'off',
      'yml/no-trailing-zeros': 'off',
    },
  },

  {
    files: useRootAliasEnforcedFiles,
    ignores: ['**/*.yml', '**/*.yaml', ...GRAPHQL_FILES, 'src/vendor/**', 'src/graphql/**'],
    rules: {
      'rainbow-local/use-root-alias': 'error',
    },
  },
  {
    // An index file may hold a component's own code, but never re-export other modules.
    files: ['**/index.ts', '**/index.tsx', '**/index.js'],
    ignores: ['src/vendor/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportNamedDeclaration[source], ExportAllDeclaration',
          message: 'Barrel files (index.ts) are not allowed. Export directly from source files instead of re-exporting.',
        },
      ],
    },
  },

  // --- GraphQL documents (formerly src/graphql/.eslintrc.js) ---
  ...(graphqlPlugin
    ? [
        {
          files: GRAPHQL_FILES,
          languageOptions: { parser: graphqlPlugin.parser },
          plugins: { '@graphql-eslint': graphqlPlugin },
          rules: {
            '@graphql-eslint/description-style': 'error',
            '@graphql-eslint/naming-convention': [
              'error',
              {
                OperationDefinition: {
                  style: 'camelCase',
                },
              },
            ],
            // Renamed from no-case-insensitive-enum-values-duplicates in @graphql-eslint/eslint-plugin 4.
            '@graphql-eslint/unique-enum-value-names': 'error',
            '@graphql-eslint/no-hashtag-description': 'error',
            '@graphql-eslint/no-typename-prefix': 'error',
            '@graphql-eslint/require-deprecation-reason': 'error',
            '@graphql-eslint/require-description': ['error', { types: true, DirectiveDefinition: true }],
          },
        },
      ]
    : []),
]);
