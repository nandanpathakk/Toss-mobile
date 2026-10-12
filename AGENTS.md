# Rainbow

React Native crypto wallet app (iOS & Android). Uses React Navigation, `@storesjs/stores` store creators for state/data, and ethers/viem for blockchain interactions.

## Verification

- **Type check (TS):** `bun run lint:ts`
- **Type check (JS):** `bun run lint:js-types` (checks JS files against an error baseline)
- **Lint (ESLint):** `bun run lint:js`
- **Lint all:** `bun run lint` (format + TS + JS + generated design files)
- **Generated design files:** `bun run lint:design` (fails when `src/design/atoms.ts` or `src/design/capsizeTable.ts` is stale; regenerate with `bun run design:atoms`)
- **Dependency rules + cycles:** `bun run lint:deps` (dependency-cruiser via `tools/deps-check/`: architectural boundaries, plus circular deps checked against a grandfathered per-platform baseline). Net-new cycles fail; removing cycles also fails until you run `bun run lint:deps:baseline:update` and commit the baselines, which keeps them exact. Per-rule policies (grandfathered vs strict) live in `tools/deps-check/policies.ts`.

## Architecture

### State management

New stores use `@storesjs/stores`:

- **`createBaseStore`** -- general-purpose store with optional synchronous MMKV persistence. Use for client state.
- **`createQueryStore`** -- combines data fetching + state in one store. Reactive `$` params auto-refetch when dependencies change. Use for new server/async data.
- **`createDerivedStore`** -- read-only store that composes other stores. Use for computed/aggregated state.

Stores live in `src/stores/` (cross-feature) and in their feature folder.

Legacy systems still in use (do not migrate them as a side effect of other work):

- **React Query** (`src/lib/react-query/` and several stores in `src/stores/`) -- server state caching for transactions and consolidated transactions, favorites, external tokens, featured results, interactions count, token interactions and market stats, rewards, transaction simulation, NFTs and the remaining hook consumers.
- **Global values** (`src/lib/storage/common.ts`, `global-settings.ts`, `contacts.ts`) -- settings and contacts are held in memory and read from/written to these untyped globals.

### Source layout

Role-first, like a small app: each role folder exists once at the top of `src/`, and each feature exists once, in `features/`. File names are kebab-case.

```
src/
├── app/          # Entry (root.tsx), bootstrap, intent handler, error boundary, navigation/ (routes, cool-modals, bottom-sheet), shell/ (tab bar, navbar), platform/ (polyfills)
├── screens/      # App-level screens, one folder each
├── features/     # One folder per feature; its components, hooks, stores and logic sit flat inside (sub-folders only for a sub-flow, never for a role)
├── components/   # Shared UI only (no feature imports): layout/ (Row, Column, Flex…), list/, text/ (styled Text), divider, skeleton, …
├── hooks/        # Shared hooks only
├── lib/          # Shared non-UI code: http, formatting, math, env, logger, storage, locale, react-query (legacy), platform/addys API clients
├── stores/       # Cross-feature stores (@storesjs/stores); stores/internal holds the store plumbing
├── design/       # The design system: tokens, themes, atoms, typography, context at the root; primitives/ (Box, Stack, Inline, Inset, Text, Heading…); styles/ (palette, fonts, borders, shadows, spacing helpers for styled components); theme/ (theme context and colors); styled.tsx (styled-components wrapper)
├── types/  assets/  vendor/
└── graphql/      # Separate package (own bun.lock) for GraphQL codegen
```

### Where new code goes

| You are writing                                                        | Put it in                                                             | Notes                                                                                                                       |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A style, color, spacing or font value                                  | `@/design` atoms and `useTheme()`                                     | Prefer atoms for new code; `design/primitives` and `design/styles` are for existing screens                                 |
| A new design token or theme color                                      | `src/design/tokens.ts` / `themes.ts`                                  | Then `bun run design:atoms`; `bun run lint:design` fails on stale generated files                                           |
| A reusable, feature-agnostic UI component                              | `src/components/<name>.tsx` (or `<name>/` for a multi-file component) | Must not import `features/` or `screens/`                                                                                   |
| A shared hook                                                          | `src/hooks/use-<name>.ts`                                             | Must not import `features/` or `screens/`                                                                                   |
| Text                                                                   | `Text`/`AnimatedText` from `@/components/typography`                  | The design system's primitive `Text` (`PrimitiveText` where both are imported) and `components/text` are the older variants |
| Anything that belongs to one feature (UI, hooks, stores, logic, types) | `src/features/<name>/`                                                | Flat; a sub-folder only groups a sub-flow (e.g. one screen and its pieces)                                                  |
| An app-level screen                                                    | `src/screens/<name>/`                                                 | Feature screens go in their feature                                                                                         |
| A store used across features                                           | `src/stores/`                                                         |                                                                                                                             |
| A persisted key or MMKV id                                             | `src/stores/keys.ts`                                                  | Never change a registered value                                                                                             |
| Shared non-UI code (HTTP, math, formatting)                            | `src/lib/`                                                            | Must not import design, stores, components, hooks, features, screens or app                                                 |
| Deep-link or intent handling                                           | `src/app/use-intent-handler.ts`                                       |                                                                                                                             |
| App startup or registration                                            | `src/app/bootstrap.ts`                                                |                                                                                                                             |
| App chrome (tab bar, navbar)                                           | `src/app/shell/`                                                      |                                                                                                                             |

No `utils/` or `helpers/` folders, and no barrel `index.ts` files that only re-export. Do not add files to a frozen directory (`app/navigation/cool-modals`, `lib/react-query`; `bun run lint:deps` fails).

## Design system

The design system in `src/design/` was ported from Bluesky and adapted to Rainbow's scale. Tailwind-inspired names with underscores. Static atoms (`atoms as a`) are theme-independent; theme atoms, palette and chain colors come from `useTheme()`. Style props take an array of atoms, theme atoms and raw styles.

Order within the array: layout/flexbox (`a.flex_row`), spacing (`a.px_20`), text (`a.text_17`, `a.font_bold`), theme atoms (`t.atoms.text_secondary`), then raw styles (`{color: t.palette.blue_60}`).

```tsx
import { View } from 'react-native';

import { Text } from '@/components/typography';
import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { select } from '@/design/theme-selector';

export function BalanceRow({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={[a.flex_row, a.align_center, a.justify_between, a.px_20, a.py_12, a.gap_8, t.atoms.bg]}>
      <Text style={[a.text_17, a.font_bold, t.atoms.text_secondary]}>{label}</Text>
      <Text
        style={[a.text_17, a.font_heavy, a.tabular_nums, { color: select(t.name, { light: t.palette.blue_60, dark: t.palette.blue_50 }) }]}
      >
        {value}
      </Text>
    </View>
  );
}
```

### Key concepts

- **Import convention:** import from the defining file: `@/design/atoms` (`atoms as a`), `@/design/context` (`useTheme`, `ThemeProvider`), `@/design/theme-selector` (`select`), `@/design/tokens`, `@/design/accent` (`AccentProvider`), `@/design/colors` (`alpha`), `@/design/resolve-color`, `@/design/platform`. Components come from `@/components/`, never from `@/design`.
- **Numeric names:** atoms use Rainbow's px/pt scale, not t-shirt sizes. Spacing `p_20`, `px_16`, `gap_12`, negative `mx_neg_20`; radii `rounded_16`, `rounded_full`; text `text_17`, `text_22` (sizes from `typeHierarchy`, Capsize trim applied by `Text`), `leading_135`/`leading_150`, `font_regular`...`font_black`, `tabular_nums`.
- **Theme atoms:** Rainbow's semantic ladder, not Bluesky's `text_contrast_*`: `t.atoms.text / text_secondary / text_tertiary / text_quaternary / text_quinary`, `bg / bg_elevated / bg_secondary / bg_secondary_elevated / bg_fill*`, `border / border_secondary / border_tertiary`. Legacy names map 1:1 (`labelSecondary` -> `text_secondary`).
- **Themes:** `light`, `dark`, `lightTinted`, `darkTinted`. `select(t.name, {light, dark, lightTinted?, darkTinted?})` picks a per-theme value; tinted themes fall back to their scheme. `t.scheme` is `'light' | 'dark'`.
- **Nested themes:** one nestable `ThemeProvider` (`<ThemeProvider theme="dark">`), and `<AccentProvider color={...}>` mounts the tinted theme for accent-colored surfaces. Do not add another theme context.
- **`StyleSheet.create` only for computed or animated styles.** Static styling is atoms in the style array. Use `StyleSheet.create` (or `useMemo`) when a style is derived from props or measurements, and `useAnimatedStyle` for animated values.
- **Worklet capture rule:** theme values are plain strings and numbers, so read what you need from `t` on the JS thread and capture it; list `t` in the dependency array. Inside worklets use `select` and `resolveColor`, which are worklets. Never call hooks or read context inside a worklet.

```ts
const t = useTheme();
const style = useAnimatedStyle(() => ({ color: resolveColor('label', t) }), [t]);
```

- **Platform helpers:** `ios({...})`, `android({...})`, `platform({ios, android})` return conditional styles inline in the array.
- **Older styling APIs.** `design/primitives` (`Box`, `Stack`, `Inline`, `Inset`, `PrimitiveText`), `design/styles`, `design/styled.tsx` and `useThemeColors` (`design/theme`) are still used by many screens. New code styles with atoms and `useTheme()`; converting an existing screen is a separate, visually verified change.

### Components on the design system

- `Text` (`@/components/Typography`) defaults to `[a.text_17, a.font_regular, t.atoms.text]`, sets `allowFontScaling={false}`, and applies the Capsize trim. Pass `emoji` for text that may contain emoji. Also exports `AnimatedText`.
- `<SFSymbol name="checkmark.circle.fill" />` (`@/components/icons/SFSymbol`).

## Code conventions

- **No barrel exports** -- import directly from source files, not `index.ts`. Barrels defeat tree-shaking, hide circular deps, and trigger cascading module loading. ESLint-enforced with a limited allowlist.
- **Type-only imports** -- use the `type` annotation for type-only imports (ESLint-enforced).
- **TypeScript over JavaScript** -- write all new files in `.ts`/`.tsx`. Remaining JS files are checked against an error baseline (`bun run lint:js-types`) -- don't regress it.

## PR scope

PRs are deliberately narrow. Refactor and migration PRs are behavior-preserving: moves, extractions, and rewires only. Pre-existing flaws in code a PR touches or moves are fixed in separate PRs, never bundled, and behavior changes never ride in a migration PR.

## Reviewing

Hold PRs to the scope contract above, not to the state of the code they touch: flag only what a PR introduces, makes worse, or newly exposes. A severe pre-existing issue may be surfaced, clearly marked as pre-existing and out of scope, without counting against the PR. Don't ask a PR to widen its scope.
