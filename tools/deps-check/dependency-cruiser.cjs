/**
 * Architectural dependency rules, enforced in CI.
 *
 * Deterministic, hard-fail boundaries on import edges: a violation fails the
 * build. This is the home for any dependency invariant we want enforced
 * statically — e.g. domain/layer boundaries (ui/data/core), keeping the
 * framework module self-contained, no cross-feature imports, and the like. Add
 * to the relevant graph's rules as the architecture grows; each rule's
 * `comment` says what it protects.
 *
 * Two graphs, selected by DEPCRUISE_GRAPH, because the rules ask two different
 * questions of the code. Every rule belongs to exactly one graph
 * (tools/deps-check/config.test.ts holds that); tools/deps-check runs both per
 * platform and unions the results.
 *
 * - `runtime`: what actually executes. Each file is compiled to JavaScript and
 *   the imports are read off the result, so anything TypeScript erases (type
 *   imports, imports only used as types) is not an edge. That is what makes it
 *   the right graph for cycles: a cycle here is one the bundle really has.
 *   Resolution follows into node_modules so rules about edges originating
 *   inside dependencies can see them. The TypeScript parser is not enabled on
 *   this graph: much of React Native is Flow-typed, which TypeScript does not
 *   parse (dependency-cruiser 18.0.0 also crashes on the malformed statements
 *   TypeScript hands back for Flow-only syntax).
 *
 * - `source`: what the code says. First-party files are read straight from the
 *   TypeScript AST (`tsPreCompilationDeps: true`), so `import type` edges are
 *   in the graph tagged `type-only`. Layer and boundary rules live here because
 *   type coupling across a boundary is a violation too, and it is invisible on
 *   the runtime graph. node_modules are recorded as leaves, not followed. Never
 *   put a cycle rule on this graph: type edges and DFS path selection make its
 *   notion of a "runtime cycle" unsound.
 *
 * Platform resolution: dependency-cruiser builds one graph per run, resolving
 * each platform-split import (foo.ios / foo.android) to a single variant, while
 * Metro builds a separate graph per platform when bundling. A forbidden edge
 * living only in an .android file is therefore invisible to a run that resolved
 * the .ios variant, and vice versa. To cover both, tools/deps-check runs each
 * graph once per platform (DEPCRUISE_PLATFORM=ios|android); the platform only
 * changes the extension order below, and the union of the runs sees every edge
 * that can ship on either platform.
 */

const PLATFORM = process.env.DEPCRUISE_PLATFORM === 'android' ? 'android' : 'ios';
const GRAPH = process.env.DEPCRUISE_GRAPH ?? 'runtime';

// React Native / Metro extension order for the active platform: the platform
// variant, then the shared-native variant, then the plain file. Only one
// platform's variant is listed per run (Metro never falls back across platforms),
// so the ios and android runs cleanly partition platform-split files.
const BASE_EXTENSIONS = ['js', 'jsx', 'ts', 'tsx'];
const extensions = [...BASE_EXTENSIONS.flatMap(ext => [`.${PLATFORM}.${ext}`, `.native.${ext}`, `.${ext}`]), '.json'];

// Capability-sensitive native modules that nothing else should import: secure
// storage (keychain), clipboard, and media. Extend as the boundary set grows.
const RESTRICTED_PACKAGES = ['react-native-keychain', '@react-native-clipboard/clipboard', 'react-native-video'];

const escapeRegExp = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const restrictedImportRules = RESTRICTED_PACKAGES.map(pkg => {
  const pkgPath = `node_modules/${escapeRegExp(pkg)}/`;
  return {
    name: `no-untrusted-import-of-${pkg.replace(/[^a-zA-Z0-9]+/g, '-')}`,
    severity: 'error',
    comment: `Only "${pkg}" itself (and our own app code) may import "${pkg}"; no other third-party package may. Keeps the import surface of a capability-sensitive native module locked down so a stray or compromised dependency cannot quietly reach into it.`,
    from: { path: 'node_modules/', pathNot: pkgPath },
    to: { path: pkgPath },
  };
});

const runtimeRules = [
  {
    name: 'no-circular',
    severity: 'error',
    comment:
      "No net-new circular dependency between first-party modules. Cycles cause hard-to-debug 'undefined on import' crashes (often only in release builds) and make module load order fragile. Existing cycles are grandfathered per platform in baseline.{ios,android}.json (enforced by tools/deps-check), so only net-new cycles fail. Removing a cycle also fails until the baseline is ratcheted to match (run `bun run lint:deps:baseline:update` and commit), so baselines stay exact. Both endpoints are scoped to first-party code (node_modules cycles are not ours to fix).",
    from: { pathNot: 'node_modules' },
    to: { circular: true, pathNot: 'node_modules' },
  },
  {
    name: 'no-dep-into-app-source',
    severity: 'error',
    comment:
      "A third-party package must not import any of the app's own first-party files. Dependencies should point outward, not reach back into our code: an inward edge couples a library to our internals (usually a fork or patch gone wrong) and inverts the dependency graph.",
    from: { path: '^node_modules/' },
    // pathNot drops node_modules targets, incl. nested workspaces like src/graphql/node_modules/*.
    to: { dependencyTypes: ['local'], pathNot: 'node_modules/' },
  },
  ...restrictedImportRules,
];

// Feature tiers. Foundation features are the domain the product features build
// on; they never reach up into a product feature. Every feature not listed here
// is product tier.
const FOUNDATION_FEATURES = ['address', 'currency', 'network', 'config', 'wallet', 'token', 'gas', 'transactions', 'funding', 'assets'];

// Legacy engines and directories that new code must not use. Each group backs a
// `no-new-legacy-*` ratchet rule: every edge into the group from outside it is
// grandfathered in the baseline, and a new one fails. Edges inside a group
// are the group's own wiring, not new usage, and are left out; new files in a
// legacy directory are caught by the legacy-freeze ratchet instead.
const LEGACY_STATE = {
  src: '^src/lib/react-query/',
  packages: '^node_modules/(recoil|react-redux|@tanstack/[^/]+|zustand)/',
};
const LEGACY_NAVIGATION = {
  src: '^src/app/navigation/(cool-modals/|(routes|config|effects)\\.|bottom-sheet/)',
  packages: '^node_modules/@react-navigation/stack/',
};
const LEGACY_LISTS = {
  packages: '^node_modules/(recyclerlistview|@shopify/flash-list|@legendapp/list)/',
};

// The base layers everything else builds on.
const BASE_LAYERS = '^src/(lib/(env|logger|storage|locale)|app/platform)/';

const anyOf = (...patterns) => patterns.filter(Boolean).join('|');

const sourceRules = [
  {
    name: 'nothing-imports-app',
    severity: 'error',
    comment:
      'The composition root (src/app/root.tsx, bootstrap, application setup, intents, error boundary) wires features, providers and navigation together; only app/ itself may import it. Navigation, shell and platform live under app/ too and stay importable.',
    from: { pathNot: '^(src/app/|index\\.js$|panta-entry\\.ts$)' },
    to: { path: '^src/app/(?!navigation/|shell/|platform/)' },
  },
  {
    name: 'vendor-imports-nothing-first-party',
    severity: 'error',
    comment:
      'A vendored library imports only npm packages and itself: never app code, and never another vendored library. Vendored code is a fork we intend to keep diffable against upstream.',
    from: { path: '^src/vendor/([^/]+)/' },
    to: { path: '^src/', pathNot: '^src/vendor/$1/' },
  },
  {
    name: 'design-is-a-leaf',
    severity: 'error',
    comment:
      'src/design/ is the design system: tokens, atoms, themes and the hooks that read them. It imports only lib/ and app/platform, never app state, components or features. Anything higher (stores, components, features) would make every styled file depend on app logic and hide cycles behind the @/design imports.',
    from: { path: '^src/design/' },
    to: { path: '^src/', pathNot: '^src/(design|lib|app/platform)/' },
  },
  {
    name: 'base-layers-are-leaves',
    severity: 'error',
    comment:
      'lib/env, lib/logger, lib/storage, lib/locale and app/platform are the base layers every other layer builds on. They import nothing from design, stores, components, hooks, features, screens or the rest of app/.',
    from: { path: BASE_LAYERS },
    to: { path: '^src/(design|stores|components|hooks|features|screens)/|^src/app/(?!platform/)' },
  },
  {
    name: 'lib-is-app-agnostic',
    severity: 'error',
    comment:
      'lib/ holds shared non-UI code: HTTP, formatting, math, storage, logging. It never imports the design system, stores, components, hooks, features, screens or app/; code that needs those belongs in a feature.',
    from: { path: '^src/lib/' },
    to: { path: '^src/(design|stores|components|hooks|features|screens|app)/' },
  },
  {
    name: 'state-does-not-import-ui',
    severity: 'error',
    comment:
      'src/stores/ is cross-feature state. It never imports rendering code: components, hooks, screens, the shell, or a feature component (.tsx).',
    from: { path: '^src/stores/' },
    to: { path: '^src/(components|hooks|screens|app/shell)/|^src/features/.+\\.tsx$' },
  },
  {
    name: 'components-are-feature-agnostic',
    severity: 'error',
    comment:
      'src/components/ holds shared UI. A component that imports a feature, a screen or the shell is feature code; it moves into that feature.',
    from: { path: '^src/components/' },
    to: { path: '^src/(features|screens|app/shell)/' },
  },
  {
    name: 'hooks-are-feature-agnostic',
    severity: 'error',
    comment: 'src/hooks/ holds shared hooks. A hook that imports a feature or a screen is feature code; it moves into that feature.',
    from: { path: '^src/hooks/' },
    to: { path: '^src/(features|screens)/' },
  },
  {
    name: 'foundation-features-do-not-import-product',
    severity: 'error',
    comment: `Foundation features (${FOUNDATION_FEATURES.join(', ')}) are the domain the product features build on. A foundation feature importing a product feature inverts that. Move the shared piece down into the foundation feature (or lib/) instead.`,
    from: { path: `^src/features/(${FOUNDATION_FEATURES.join('|')})/` },
    to: { path: '^src/features/[^/]+/', pathNot: `^src/features/(${FOUNDATION_FEATURES.join('|')})/` },
  },
  {
    name: 'no-new-legacy-state-imports',
    severity: 'error',
    comment:
      'Legacy state ratchet: lib/react-query, @tanstack, react-redux, recoil and zustand are frozen. Existing imports are grandfathered; new state is a @storesjs/stores store.',
    from: { pathNot: anyOf('^node_modules/', LEGACY_STATE.src) },
    to: { path: anyOf(LEGACY_STATE.src, LEGACY_STATE.packages) },
  },
  {
    name: 'no-new-legacy-navigation-imports',
    severity: 'error',
    comment:
      'Legacy navigation ratchet: cool-modals, the routes/config/effects/bottom-sheet navigation modules and @react-navigation/stack are frozen. Existing imports are grandfathered; new screens register on the native-stack navigator.',
    from: { pathNot: anyOf('^node_modules/', LEGACY_NAVIGATION.src) },
    to: { path: anyOf(LEGACY_NAVIGATION.src, LEGACY_NAVIGATION.packages) },
  },
  {
    name: 'no-new-legacy-list-imports',
    severity: 'error',
    comment:
      'Legacy list ratchet: recyclerlistview, FlashList and direct @legendapp/list imports are frozen. Existing imports are grandfathered; new lists use src/components/list/.',
    from: { pathNot: '^node_modules/|^src/components/list/' },
    to: { path: LEGACY_LISTS.packages },
  },
];

const sharedOptions = {
  tsConfig: { fileName: 'tsconfig.json' },
  // Keep package paths as node_modules/<pkg>/... even when node_modules is a
  // symlink (git worktrees share one install). Resolving it to its real path
  // would rename every package edge (../other-checkout/node_modules/...), so
  // the ^node_modules/ rules would miss them and baseline identities would
  // drift. The install itself contains no package symlinks, so CI resolves
  // exactly as before.
  preserveSymlinks: true,
  enhancedResolveOptions: {
    extensions,
    mainFields: ['react-native', 'browser', 'module', 'main'],
  },
};

/** @type {Record<string, import('dependency-cruiser').IConfiguration>} */
const graphs = {
  runtime: {
    forbidden: runtimeRules,
    options: {
      ...sharedOptions,
      // Follow into node_modules so import edges that originate inside
      // dependencies are visible; only skip caches/binaries.
      doNotFollow: { path: 'node_modules/\\.(cache|bin)/' },
    },
  },
  source: {
    forbidden: sourceRules,
    options: {
      ...sharedOptions,
      tsPreCompilationDeps: true,
      doNotFollow: { path: 'node_modules' },
      enhancedResolveOptions: {
        ...sharedOptions.enhancedResolveOptions,
        // Type imports may land on a declaration file. Listed last so a
        // sibling .ts/.js still wins; without it the edge is unresolved and
        // the layer rules never see it.
        extensions: [...extensions, '.d.ts'],
      },
    },
  },
};

if (!graphs[GRAPH]) {
  throw new Error(`Unknown DEPCRUISE_GRAPH "${GRAPH}"; expected one of ${Object.keys(graphs).join(', ')}`);
}

module.exports = graphs[GRAPH];
