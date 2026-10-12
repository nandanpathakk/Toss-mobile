import { FEATURE_CYCLE_RULE } from './internal/featureGraph';
import { LEGACY_FREEZE_RULE } from './internal/legacyFreeze';

/**
 * Per-rule policies for the dependency graph gate.
 *
 * Every rule in dependency-cruiser.cjs gets its violations judged by one of
 * two modes:
 *
 * - `baseline`: violations are grandfathered. Pre-existing ones live in
 *   baseline.{ios,android}.json and are ignored,
 *   net-new ones fail CI, and fixed ones also fail until the baseline is
 *   ratcheted down (`bun run lint:deps:baseline:update`), so baselines stay exact
 *   and staleness on a PR always belongs to that PR. Deliberate additions
 *   require `--allow-additions` and show up as baseline growth in the PR diff.
 *
 * - `strict`: nothing is tolerated. Any violation fails CI, and baseline
 *   entries for the rule are themselves an error, so strict rules can never
 *   be grandfathered by accident.
 *
 * Rules not listed here default to `strict`, so a new rule is never silently
 * baselinable. Adding a grandfathered category is one `baseline` entry here;
 * `label` and `hint` drive the failure message.
 */
export type Policy = {
  mode: 'baseline' | 'strict';
  label: string;
  /** Shown under failures as the suggested remedy. */
  hint?: string;
};

const POLICIES: Record<string, Policy> = {
  'no-circular': {
    mode: 'baseline',
    label: 'Circular dependencies',
    hint: 'Fix the cycle (usually: extract the shared piece into its own module).',
  },
  'no-dep-into-app-source': { mode: 'strict', label: 'Third-party package importing app code' },

  // Architecture boundaries. The rest
  // grandfather their existing edges and flip to strict once their baseline
  // reaches zero.
  'base-layers-are-leaves': {
    mode: 'baseline',
    label: 'Base layer importing a higher layer',
    hint: 'env, platform, logger, storage and locale import nothing above them; pass the dependency in, or move the code up.',
  },
  'lib-is-app-agnostic': {
    mode: 'baseline',
    label: 'lib importing app code',
    hint: 'lib/ is app-agnostic; move the app-specific piece into a feature or components/.',
  },
  'state-does-not-import-ui': {
    mode: 'baseline',
    label: 'State importing UI',
    hint: 'Move the UI concern into a ui/ hook, or the shared type into core/.',
  },
  'components-are-feature-agnostic': {
    mode: 'baseline',
    label: 'Shared component importing a feature',
    hint: "Move the component into the feature's ui/, or pass the feature data in as props.",
  },
  'hooks-are-feature-agnostic': {
    mode: 'baseline',
    label: 'Shared hook importing a feature',
    hint: 'Move the hook into the feature, or pass the feature data in as arguments.',
  },
  'design-is-a-leaf': {
    mode: 'baseline',
    label: 'Design system importing app code',
    hint: 'design/ imports only lib/ and app/platform; pass app data in as props.',
  },
  'foundation-features-do-not-import-product': {
    mode: 'baseline',
    label: 'Foundation feature importing a product feature',
    hint: 'Move the shared piece down into the foundation feature or lib/.',
  },
  [FEATURE_CYCLE_RULE]: {
    mode: 'baseline',
    label: 'Feature cycle',
    hint: 'Features on a cycle import each other (directly or through others); move the shared piece into one of them, a foundation feature, or lib/.',
  },

  // Legacy ratchets: existing edges stay grandfathered; new ones fail.
  'no-new-legacy-state-imports': {
    mode: 'baseline',
    label: 'New legacy state import',
    hint: 'Use a @storesjs/stores store in src/state/ or a feature data/ layer instead of redux, react-query, recoil or zustand.',
  },
  'no-new-legacy-navigation-imports': {
    mode: 'baseline',
    label: 'New legacy navigation import',
    hint: 'Register the screen on the native-stack navigator instead of cool-modals, the legacy route config or @react-navigation/stack.',
  },
  'no-new-legacy-list-imports': {
    mode: 'baseline',
    label: 'New legacy list import',
    hint: 'Render lists through src/components/List/ instead of recyclerlistview, FlashList or @legendapp/list directly.',
  },
  [LEGACY_FREEZE_RULE]: {
    mode: 'baseline',
    label: 'New file in a frozen legacy directory',
    hint: 'Frozen directories (tools/deps-check/internal/legacyFreeze.ts) only shrink; put the file in its target home (lib/, design/, stores/ or a feature).',
  },
};

/**
 * Rules computed by tools/deps-check itself rather than declared in
 * dependency-cruiser.cjs. They are judged by the same policies and baselines.
 */
export const CUSTOM_RULES = [FEATURE_CYCLE_RULE, LEGACY_FREEZE_RULE];

export function policyFor(ruleName: string): Policy {
  return POLICIES[ruleName] ?? { mode: 'strict', label: ruleName };
}

export function unknownPolicyRules(ruleNames: Set<string>): string[] {
  return Object.keys(POLICIES).filter(name => !ruleNames.has(name));
}
