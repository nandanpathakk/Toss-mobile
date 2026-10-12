import { mapValues } from 'lodash';

import { select } from '@/design/theme-selector';
import { themes, type BackgroundColorName, type ForegroundColorName, type Theme } from '@/design/themes';
import * as tokens from '@/design/tokens';
import { type ChainName, type ColorToken } from '@/design/tokens';

/*
 * Every value in this file is read from design system (`src/design/tokens.ts` and `src/design/themes.ts`);
 * this module only keeps the legacy names and shapes for the `design-system` API.
 */

type LegacyRampName<Key extends string> = Key extends `${infer Name}_${infer Step}` ? `${Name}${Step}` : Key;

/** The design system color ramps under their legacy names: `blue_60` -> `blue60`, `blueGrey_10` -> `blueGrey10`. */
export const globalColors = Object.fromEntries(Object.entries(tokens.color).map(([key, value]) => [key.replace('_', ''), value])) as {
  [Key in ColorToken as LegacyRampName<Key>]: string;
};
export type ColorMode = 'light' | 'lightTinted' | 'dark' | 'darkTinted';

export type ContextualColorValue<Value> = {
  light: Value;
  lightTinted?: Value;
  dark: Value;
  darkTinted?: Value;
};

export type BackgroundColor =
  | 'surfacePrimary'
  | 'surfacePrimaryElevated'
  | 'surfaceSecondary'
  | 'surfaceSecondaryElevated'
  | 'fill'
  | 'fillSecondary'
  | 'fillTertiary'
  | 'fillQuaternary'
  | 'blue'
  | 'green'
  | 'red'
  | 'purple'
  | 'pink'
  | 'orange'
  | 'yellow'
  | 'black'
  | 'white'
  | 'body (Deprecated)'
  | 'action (Deprecated)'
  | 'swap (Deprecated)'
  | 'card (Deprecated)'
  | 'cardBackdrop (Deprecated)';

export type BackgroundColorValue = {
  color: string;
  mode: ColorMode;
};

/** Legacy background color name -> design system palette key. */
const backgroundColorKeys = {
  'surfacePrimary': 'surface_primary',
  'surfacePrimaryElevated': 'surface_primary_elevated',
  'surfaceSecondary': 'surface_secondary',
  'surfaceSecondaryElevated': 'surface_secondary_elevated',
  'fill': 'fill',
  'fillSecondary': 'fill_secondary',
  'fillTertiary': 'fill_tertiary',
  'fillQuaternary': 'fill_quaternary',
  'blue': 'blue',
  'green': 'green',
  'red': 'red',
  'purple': 'purple',
  'pink': 'pink',
  'orange': 'orange',
  'yellow': 'yellow',
  'black': 'black',
  'white': 'white',
  'action (Deprecated)': 'deprecated_action',
  'body (Deprecated)': 'deprecated_body',
  'card (Deprecated)': 'deprecated_card',
  'cardBackdrop (Deprecated)': 'deprecated_card_backdrop',
  'swap (Deprecated)': 'deprecated_swap',
} as const satisfies Record<BackgroundColor, BackgroundColorName>;

export type ForegroundColor =
  | 'label'
  | 'labelSecondary'
  | 'labelTertiary'
  | 'labelQuaternary'
  | 'labelQuinary'
  | 'blue'
  | 'green'
  | 'red'
  | 'purple'
  | 'pink'
  | 'orange'
  | 'yellow'
  | 'black'
  | 'white'
  | 'fill'
  | 'fillSecondary'
  | 'fillTertiary'
  | 'fillQuaternary'
  | 'scrim'
  | 'scrimSecondary'
  | 'scrimTertiary'
  | 'separator'
  | 'separatorSecondary'
  | 'separatorTertiary'
  | 'buttonStroke'
  | 'buttonStrokeSecondary'
  | 'shadowNear'
  | 'shadowFar'
  | 'action (Deprecated)'
  | 'divider20 (Deprecated)'
  | 'divider40 (Deprecated)'
  | 'divider60 (Deprecated)'
  | 'divider80 (Deprecated)'
  | 'divider100 (Deprecated)'
  | 'primary (Deprecated)'
  | 'secondary (Deprecated)'
  | 'secondary06 (Deprecated)'
  | 'secondary10 (Deprecated)'
  | 'secondary15 (Deprecated)'
  | 'secondary20 (Deprecated)'
  | 'secondary25 (Deprecated)'
  | 'secondary30 (Deprecated)'
  | 'secondary40 (Deprecated)'
  | 'secondary50 (Deprecated)'
  | 'secondary60 (Deprecated)'
  | 'secondary70 (Deprecated)'
  | 'secondary80 (Deprecated)'
  | 'swap (Deprecated)'
  | 'mainnet'
  | 'arbitrum'
  | 'optimism'
  | 'polygon'
  | 'base'
  | 'zora'
  | 'bsc'
  | 'avalanche'
  | 'blast'
  | 'degen';

/** Legacy foreground color name -> design system palette key (or chain name). Plain data, so worklets can capture it. */
const foregroundColorKeys = {
  'label': 'label',
  'labelSecondary': 'label_secondary',
  'labelTertiary': 'label_tertiary',
  'labelQuaternary': 'label_quaternary',
  'labelQuinary': 'label_quinary',
  'blue': 'blue',
  'green': 'green',
  'red': 'red',
  'purple': 'purple',
  'pink': 'pink',
  'orange': 'orange',
  'yellow': 'yellow',
  'black': 'black',
  'white': 'white',
  'fill': 'fill',
  'fillSecondary': 'fill_secondary',
  'fillTertiary': 'fill_tertiary',
  'fillQuaternary': 'fill_quaternary',
  'scrim': 'scrim',
  'scrimSecondary': 'scrim_secondary',
  'scrimTertiary': 'scrim_tertiary',
  'separator': 'separator',
  'separatorSecondary': 'separator_secondary',
  'separatorTertiary': 'separator_tertiary',
  'buttonStroke': 'button_stroke',
  'buttonStrokeSecondary': 'button_stroke_secondary',
  'action (Deprecated)': 'deprecated_action',
  'divider100 (Deprecated)': 'deprecated_divider_100',
  'divider20 (Deprecated)': 'deprecated_divider_20',
  'divider40 (Deprecated)': 'deprecated_divider_40',
  'divider60 (Deprecated)': 'deprecated_divider_60',
  'divider80 (Deprecated)': 'deprecated_divider_80',
  'primary (Deprecated)': 'deprecated_primary',
  'secondary (Deprecated)': 'deprecated_secondary',
  'secondary06 (Deprecated)': 'deprecated_secondary_06',
  'secondary10 (Deprecated)': 'deprecated_secondary_10',
  'secondary15 (Deprecated)': 'deprecated_secondary_15',
  'secondary20 (Deprecated)': 'deprecated_secondary_20',
  'secondary25 (Deprecated)': 'deprecated_secondary_25',
  'secondary30 (Deprecated)': 'deprecated_secondary_30',
  'secondary40 (Deprecated)': 'deprecated_secondary_40',
  'secondary50 (Deprecated)': 'deprecated_secondary_50',
  'secondary60 (Deprecated)': 'deprecated_secondary_60',
  'secondary70 (Deprecated)': 'deprecated_secondary_70',
  'secondary80 (Deprecated)': 'deprecated_secondary_80',
  'shadowNear': 'shadow_near',
  'shadowFar': 'shadow_far',
  'swap (Deprecated)': 'deprecated_swap',
  'mainnet': 'mainnet',
  'arbitrum': 'arbitrum',
  'optimism': 'optimism',
  'polygon': 'polygon',
  'base': 'base',
  'zora': 'zora',
  'bsc': 'bsc',
  'avalanche': 'avalanche',
  'blast': 'blast',
  'degen': 'degen',
} as const satisfies Record<ForegroundColor, ForegroundColorName | ChainName>;

export function isBackgroundColor(color: string): color is BackgroundColor {
  return color in backgroundColorKeys;
}

export function isForegroundColor(color: string): color is ForegroundColor {
  'worklet';
  return color in foregroundColorKeys;
}

/** The design system key a legacy foreground color name resolves through (see `resolveColor`). */
export function toThemeForegroundKey(color: ForegroundColor): ForegroundColorName | ChainName {
  'worklet';
  return foregroundColorKeys[color];
}

/** A legacy background color in an design system theme: its color and the theme content drawn on it uses. */
export function resolveBackgroundColor(color: BackgroundColor, theme: Theme): BackgroundColorValue {
  const key = backgroundColorKeys[color];
  return { color: theme.palette[key], mode: theme.backgroundModes[key] };
}

/** A legacy foreground color in an design system theme (tinted overrides included). */
export function resolveForegroundColor(color: ForegroundColor, theme: Theme): string {
  const key = foregroundColorKeys[color];
  return key in theme.chain ? theme.chain[key as ChainName] : theme.palette[key as ForegroundColorName];
}

function contextual<Value>(valueForTheme: (theme: Theme) => Value): Required<ContextualColorValue<Value>> {
  return {
    light: valueForTheme(themes.light),
    lightTinted: valueForTheme(themes.lightTinted),
    dark: valueForTheme(themes.dark),
    darkTinted: valueForTheme(themes.darkTinted),
  };
}

export const foregroundColors: Record<ForegroundColor, ContextualColorValue<string>> = mapValues(foregroundColorKeys, (_key, name) =>
  contextual(theme => resolveForegroundColor(name as ForegroundColor, theme))
);

/**
 * @description Accepts an object with values defined for each color mode and
 * resolves the value based on the requested color mode. This is useful because
 * some color modes can inherit from others, e.g. `"dark"` and `"darkTinted"`.
 * Delegates to design system `select`.
 */
export function getValueForColorMode<Value>(value: Value | ContextualColorValue<Value>, colorMode: ColorMode): Value {
  'worklet';
  if (typeof value === 'object' && value !== null && 'light' in value) {
    return select(colorMode, value);
  }

  return value;
}

type Palette = {
  backgroundColors: Record<BackgroundColor, BackgroundColorValue>;
  foregroundColors: Record<ForegroundColor, string>;
};

function createPalette(theme: Theme): Palette {
  return {
    backgroundColors: mapValues(backgroundColorKeys, (_key, name) => resolveBackgroundColor(name as BackgroundColor, theme)),
    foregroundColors: mapValues(foregroundColorKeys, (_key, name) => resolveForegroundColor(name as ForegroundColor, theme)),
  };
}

export const palettes: Record<ColorMode, Palette> = {
  dark: createPalette(themes.dark),
  darkTinted: createPalette(themes.darkTinted),
  light: createPalette(themes.light),
  lightTinted: createPalette(themes.lightTinted),
};

function selectForegroundColors<SelectedColors extends readonly (ForegroundColor | 'accent')[]>(...colors: SelectedColors): SelectedColors {
  return colors;
}

export const textColors = selectForegroundColors(
  'accent',
  'label',
  'labelSecondary',
  'labelTertiary',
  'labelQuaternary',
  'labelQuinary',
  'blue',
  'green',
  'red',
  'purple',
  'pink',
  'orange',
  'yellow',
  'black',
  'white',
  'action (Deprecated)',
  'primary (Deprecated)',
  'secondary (Deprecated)',
  'secondary10 (Deprecated)',
  'secondary20 (Deprecated)',
  'secondary25 (Deprecated)',
  'secondary30 (Deprecated)',
  'secondary40 (Deprecated)',
  'secondary50 (Deprecated)',
  'secondary60 (Deprecated)',
  'secondary70 (Deprecated)',
  'secondary80 (Deprecated)',
  'mainnet',
  'arbitrum',
  'optimism',
  'polygon',
  'base',
  'zora',
  'bsc',
  'avalanche',
  'blast',
  'degen'
);
export type TextColor = (typeof textColors)[number];

export const shadowColors = selectForegroundColors('accent', 'blue', 'green', 'red', 'purple', 'pink', 'orange', 'yellow');
export type ShadowColor = (typeof shadowColors)[number];

const separatorColors = selectForegroundColors(
  'separator',
  'separatorSecondary',
  'separatorTertiary',
  'divider20 (Deprecated)',
  'divider40 (Deprecated)',
  'divider60 (Deprecated)',
  'divider80 (Deprecated)',
  'divider100 (Deprecated)'
);
export type SeparatorColor = (typeof separatorColors)[number];
