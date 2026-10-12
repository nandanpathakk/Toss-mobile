/**
 * Rainbow design system themes: `light`, `dark`, `lightTinted`, `darkTinted`.
 *
 * Semantic colors are keyed by the snake_case form of their legacy name
 * (`labelSecondary` -> `label_secondary`, `divider20 (Deprecated)` -> `deprecated_divider_20`,
 * see `util/paletteColorMap.ts`). Tinted themes inherit every value they do not
 * override from their scheme, exactly like `getValueForColorMode`.
 */
import { chain as chainTokens, color, deprecatedColor, type ChainName } from './tokens';

export type ThemeName = 'light' | 'dark' | 'lightTinted' | 'darkTinted';
type ThemeScheme = 'light' | 'dark';

type Contextual<Value> = {
  light: Value;
  dark: Value;
  lightTinted?: Value;
  darkTinted?: Value;
};

type BackgroundValue = { color: string; mode: ThemeName };

function resolve<Value>(value: Contextual<Value>, name: ThemeName): Value {
  if (name === 'darkTinted') return value.darkTinted ?? value.dark;
  if (name === 'lightTinted') return value.lightTinted ?? value.light;
  return value[name];
}

function mapResolve<Key extends string, Value>(values: Record<Key, Contextual<Value>>, name: ThemeName): Record<Key, Value> {
  const out = {} as Record<Key, Value>;
  for (const key in values) out[key] = resolve(values[key], name);
  return out;
}

/*
 * Background colors. `mode` is the theme that content drawn on top of the
 * background should use (legacy `BackgroundColorValue.mode`).
 */
const backgroundColors = {
  surface_primary: {
    light: { color: color.white_100, mode: 'light' },
    dark: { color: deprecatedColor.darker, mode: 'dark' },
  },
  surface_primary_elevated: {
    light: { color: color.white_100, mode: 'light' },
    dark: { color: deprecatedColor.darker, mode: 'dark' },
  },
  surface_secondary: {
    light: { color: color.blueGrey_10, mode: 'light' },
    dark: { color: deprecatedColor.darker, mode: 'dark' },
  },
  surface_secondary_elevated: {
    light: { color: color.white_100, mode: 'light' },
    dark: { color: deprecatedColor.dark, mode: 'dark' },
  },
  fill: {
    light: { color: color.grey_30, mode: 'light' },
    dark: { color: color.white_30, mode: 'dark' },
  },
  fill_secondary: {
    light: { color: color.grey_20, mode: 'light' },
    dark: { color: color.white_20, mode: 'dark' },
  },
  fill_tertiary: {
    light: { color: color.grey_20, mode: 'light' },
    dark: { color: 'rgba(245, 248, 255, 0.08)', mode: 'dark' },
  },
  fill_quaternary: {
    light: { color: color.grey_10, mode: 'light' },
    dark: { color: 'rgba(245, 248, 255, 0.04)', mode: 'dark' },
  },
  blue: {
    light: { color: color.blue_60, mode: 'dark' },
    dark: { color: color.blue_50, mode: 'dark' },
  },
  green: {
    light: { color: color.green_60, mode: 'dark' },
    dark: { color: color.green_50, mode: 'dark' },
  },
  red: {
    light: { color: color.red_60, mode: 'dark' },
    dark: { color: color.red_50, mode: 'dark' },
  },
  purple: {
    light: { color: color.purple_60, mode: 'dark' },
    dark: { color: color.purple_50, mode: 'dark' },
  },
  pink: {
    light: { color: color.pink_60, mode: 'dark' },
    dark: { color: color.pink_50, mode: 'dark' },
  },
  orange: {
    light: { color: color.orange_60, mode: 'dark' },
    dark: { color: color.orange_50, mode: 'dark' },
  },
  yellow: {
    light: { color: color.yellow_60, mode: 'light' },
    dark: { color: color.yellow_50, mode: 'light' },
  },
  black: {
    light: { color: '#000000', mode: 'dark' },
    dark: { color: '#000000', mode: 'dark' },
  },
  white: {
    light: { color: '#FFFFFF', mode: 'light' },
    dark: { color: '#FFFFFF', mode: 'light' },
  },
  deprecated_action: {
    dark: { color: deprecatedColor.appleBlueLight, mode: 'darkTinted' },
    light: { color: deprecatedColor.appleBlue, mode: 'darkTinted' },
  },
  deprecated_body: {
    dark: { color: deprecatedColor.blackTint, mode: 'dark' },
    darkTinted: { color: deprecatedColor.blackTint, mode: 'darkTinted' },
    light: { color: deprecatedColor.white, mode: 'light' },
    lightTinted: { color: deprecatedColor.white, mode: 'lightTinted' },
  },
  deprecated_card: {
    dark: { color: deprecatedColor.dark, mode: 'dark' },
    light: { color: deprecatedColor.white, mode: 'light' },
  },
  deprecated_card_backdrop: {
    dark: { color: deprecatedColor.darker, mode: 'dark' },
    light: { color: deprecatedColor.offwhite, mode: 'light' },
  },
  deprecated_swap: {
    dark: { color: deprecatedColor.swapPurple, mode: 'darkTinted' },
    light: { color: deprecatedColor.swapPurple, mode: 'darkTinted' },
  },
} as const satisfies Record<string, Contextual<BackgroundValue>>;

export type BackgroundColorName = keyof typeof backgroundColors;

function backgroundAsForeground(name: BackgroundColorName): Contextual<string> {
  const bg: Contextual<BackgroundValue> = backgroundColors[name];
  return {
    light: bg.light.color,
    dark: bg.dark.color,
    ...(bg.lightTinted && { lightTinted: bg.lightTinted.color }),
    ...(bg.darkTinted && { darkTinted: bg.darkTinted.color }),
  };
}

/*
 * Foreground colors (chain colors live in `tokens.chain` / `theme.chain`).
 */
const foregroundColors = {
  label: { light: color.grey_100, dark: color.white_100 },
  label_secondary: { light: color.grey_80, dark: color.white_80 },
  label_tertiary: { light: color.grey_70, dark: color.white_70 },
  label_quaternary: { light: color.grey_60, dark: color.white_60 },
  label_quinary: { light: color.grey_50, dark: color.white_50 },
  scrim: { light: 'rgba(0, 0, 0, 0.2)', dark: 'rgba(0, 0, 0, 0.4)' },
  scrim_secondary: { light: 'rgba(0, 0, 0, 0.4)', dark: 'rgba(0, 0, 0, 0.6)' },
  scrim_tertiary: { light: 'rgba(0, 0, 0, 0.6)', dark: 'rgba(0, 0, 0, 0.8)' },
  separator: { light: color.grey_20, dark: color.white_20 },
  separator_secondary: { light: color.grey_20, dark: 'rgba(245, 248, 255, 0.06)' },
  separator_tertiary: { light: 'rgba(9, 17, 31, 0.02)', dark: 'rgba(245, 248, 255, 0.02)' },
  button_stroke: { light: 'rgba(0, 0, 0, 0.05)', dark: 'rgba(255, 255, 255, 0.03)' },
  button_stroke_secondary: { light: color.white_20, dark: color.grey_20 },
  shadow_near: { light: color.grey_100, dark: color.grey_100 },
  shadow_far: { dark: color.grey_100, light: '#25292E' },
  deprecated_divider_100: {
    dark: 'rgba(60, 66, 82, 0.6)',
    darkTinted: 'rgba(255, 255, 255, 0.15)',
    light: 'rgba(60, 66, 82, 0.12)',
  },
  deprecated_divider_20: {
    dark: 'rgba(60, 66, 82, 0.025)',
    darkTinted: 'rgba(255, 255, 255, 0.01)',
    light: 'rgba(60, 66, 82, 0.01)',
  },
  deprecated_divider_40: {
    dark: 'rgba(60, 66, 82, 0.0375)',
    darkTinted: 'rgba(255, 255, 255, 0.0375)',
    light: 'rgba(60, 66, 82, 0.015)',
  },
  deprecated_divider_60: {
    dark: 'rgba(60, 66, 82, 0.05)',
    darkTinted: 'rgba(255, 255, 255, 0.05)',
    light: 'rgba(60, 66, 82, 0.02)',
  },
  deprecated_divider_80: {
    dark: 'rgba(60, 66, 82, 0.075)',
    darkTinted: 'rgba(255, 255, 255, 0.075)',
    light: 'rgba(60, 66, 82, 0.03)',
  },
  deprecated_primary: {
    dark: deprecatedColor.sky,
    darkTinted: deprecatedColor.white,
    light: deprecatedColor.greyDark,
    lightTinted: deprecatedColor.greyDark,
  },
  deprecated_secondary: { dark: deprecatedColor.sky, darkTinted: deprecatedColor.white90, light: deprecatedColor.grey },
  deprecated_secondary_06: { dark: deprecatedColor.sky06, darkTinted: deprecatedColor.white06, light: deprecatedColor.grey06 },
  deprecated_secondary_10: { dark: deprecatedColor.sky10, darkTinted: deprecatedColor.white10, light: deprecatedColor.grey10 },
  deprecated_secondary_15: { dark: deprecatedColor.sky15, darkTinted: deprecatedColor.white15, light: deprecatedColor.grey15 },
  deprecated_secondary_20: { dark: deprecatedColor.sky20, darkTinted: deprecatedColor.white20, light: deprecatedColor.grey20 },
  deprecated_secondary_25: { dark: deprecatedColor.sky25, darkTinted: deprecatedColor.white25, light: deprecatedColor.grey25 },
  deprecated_secondary_30: { dark: deprecatedColor.sky30, darkTinted: deprecatedColor.white30, light: deprecatedColor.grey30 },
  deprecated_secondary_40: { dark: deprecatedColor.sky40, darkTinted: deprecatedColor.white40, light: deprecatedColor.grey40 },
  deprecated_secondary_50: { dark: deprecatedColor.sky50, darkTinted: deprecatedColor.white50, light: deprecatedColor.grey50 },
  deprecated_secondary_60: { dark: deprecatedColor.sky60, darkTinted: deprecatedColor.white60, light: deprecatedColor.grey60 },
  deprecated_secondary_70: { dark: deprecatedColor.sky70, darkTinted: deprecatedColor.white70, light: deprecatedColor.grey70 },
  deprecated_secondary_80: { dark: deprecatedColor.sky80, darkTinted: deprecatedColor.white80, light: deprecatedColor.grey80 },
} as const satisfies Record<string, Contextual<string>>;

/** Background names that are also valid foreground colors (legacy `selectBackgroundAsForeground`). */
const backgroundsAsForeground = [
  'blue',
  'green',
  'red',
  'purple',
  'pink',
  'orange',
  'yellow',
  'black',
  'white',
  'fill',
  'fill_secondary',
  'fill_tertiary',
  'fill_quaternary',
  'deprecated_action',
  'deprecated_swap',
] as const satisfies readonly BackgroundColorName[];

type SemanticColorName = BackgroundColorName | keyof typeof foregroundColors;
export type Palette = Record<keyof typeof color | SemanticColorName, string>;

/** Palette names that legacy code could pass as a foreground (text/icon) color. */
export type ForegroundColorName = keyof typeof foregroundColors | (typeof backgroundsAsForeground)[number];

/*
 * Gradients, with the legacy `opacity()` calls already resolved to rgba values.
 */
const lightGradients = {
  apple_blue_tint_to_apple_blue: ['#15B1FE', '#0E76FD'],
  blue_to_green: ['#4764F7', '#23D67F'],
  checkmark_animation: ['#1FC24A10', '#1FC24A10', '#1FC24A00'],
  lighter_grey: ['rgba(236, 241, 245, 0.15)', 'rgba(223, 228, 235, 0.5)'],
  lightest_grey: ['#FFFFFF', '#F2F4F7'],
  lightest_grey_reverse: ['#F2F4F7', '#FFFFFF'],
  light_grey: ['rgba(236, 241, 245, 0.5)', 'rgba(223, 228, 235, 0.5)'],
  light_grey_transparent: ['rgba(60, 66, 82, 0.02)', 'rgba(60, 66, 82, 0.06)'],
  light_grey_white: ['rgba(240, 242, 245, 0.5)', 'rgba(255, 255, 255, 0.5)'],
  off_white: ['#FFFFFF', '#F8F9FA'],
  rainbow: ['#FFB114', '#FF54BB', '#7EA4DE'],
  savings: ['#FFFFFF', '#F7F9FA'],
  search_bar: ['#FCFDFE', '#F0F2F5'],
  send_background: ['#FAFAFA00', '#FAFAFAFF'],
  success: ['#FAFF00', '#2CCC00'],
  success_tint: ['#FFFFF0', '#FCFEFB'],
  swap_purple_tint_to_swap_purple: ['#7D85FF', '#575CFF'],
  transparent_to_apple_blue: ['rgba(14, 118, 253, 0.02)', 'rgba(14, 118, 253, 0.06)'],
  transparent_to_red: ['rgba(250, 66, 60, 0)', 'rgba(250, 66, 60, 0.06)'],
  transparent_to_green: ['rgba(29, 184, 71, 0)', 'rgba(29, 184, 71, 0.06)'],
  transparent_to_light_grey: ['rgba(60, 66, 82, 0)', 'rgba(60, 66, 82, 0.06)'],
  transparent_to_light_orange: ['rgba(255, 166, 77, 0)', 'rgba(255, 166, 77, 0.06)'],
  vivid_rainbow: ['#FFB114', '#FF54BB', '#00F0FF'],
  vivid_rainbow_tint: ['#FFFAF1', '#FFF5FB', '#F0FEFF'],
  warning: ['#FFD963', '#FFB200'],
  warning_tint: ['#FFFDF6', '#FFFBF2'],
  white_80_to_transparent: ['rgba(255, 255, 255, 0.8)', 'rgba(255, 255, 255, 0)'],
  white_button: ['#FFFFFF', '#F7F9FA'],
};

const darkGradients = {
  apple_blue_tint_to_apple_blue: ['#2FC3FF', '#1F87FF'],
  blue_to_green: ['#4764F7', '#23D67F'],
  checkmark_animation: ['#1FC24A10', '#1FC24A10', '#1FC24A00'],
  lighter_grey: ['rgba(31, 34, 42, 0.8)', 'rgba(31, 34, 42, 0.6)'],
  lightest_grey: ['rgba(31, 34, 42, 0.8)', 'rgba(31, 34, 42, 0.3)'],
  lightest_grey_reverse: ['rgba(31, 34, 42, 0.1)', 'rgba(31, 34, 42, 0.8)'],
  light_grey: ['#1F222A', 'rgba(31, 34, 42, 0.8)'],
  light_grey_transparent: ['rgba(224, 232, 255, 0.02)', 'rgba(224, 232, 255, 0.06)'],
  light_grey_white: ['rgba(240, 242, 245, 0.05)', 'rgba(255, 255, 255, 0.01)'],
  off_white: ['#1F222A', '#1F222A'],
  rainbow: ['#FFB114', '#FF54BB', '#7EA4DE'],
  savings: ['#1F222A', '#1F222A'],
  search_bar: ['rgba(31, 34, 42, 0.4)', '#1F222A'],
  send_background: ['#12131A00', '#12131AFF'],
  success: ['#FAFF00', '#2CCC00'],
  success_tint: ['#202118', '#141E18'],
  swap_purple_tint_to_swap_purple: ['#7D85FF', '#575CFF'],
  transparent_to_apple_blue: ['rgba(31, 135, 255, 0.02)', 'rgba(31, 135, 255, 0.06)'],
  transparent_to_red: ['rgba(255, 98, 87, 0)', 'rgba(255, 98, 87, 0.06)'],
  transparent_to_green: ['rgba(62, 207, 91, 0)', 'rgba(62, 207, 91, 0.06)'],
  transparent_to_light_grey: ['rgba(224, 232, 255, 0)', 'rgba(224, 232, 255, 0.06)'],
  transparent_to_light_orange: ['rgba(255, 166, 77, 0)', 'rgba(255, 166, 77, 0.06)'],
  vivid_rainbow: ['#FFB114', '#FF54BB', '#00F0FF'],
  vivid_rainbow_tint: ['#201C19', '#201723', '#112028'],
  warning: ['#FFD963', '#FFB200'],
  warning_tint: ['#201F1E', '#201C18'],
  white_80_to_transparent: ['rgba(255, 255, 255, 0.8)', 'rgba(255, 255, 255, 0)'],
  white_button: ['#404656', 'rgba(64, 70, 86, 0.8)'],
} satisfies Gradients;

type GradientName = keyof typeof lightGradients;
type Gradients = Record<GradientName, readonly string[]>;

/*
 * Chart colors. `up`/`down` come from `features/charts/candlestick/constants.ts`,
 * `grid` and the crosshair colors from the palette.
 */
const chartUp = '#00CC4B';
const chartDown = '#FA5343';

type ThemeAtoms = {
  text: { color: string };
  text_secondary: { color: string };
  text_tertiary: { color: string };
  text_quaternary: { color: string };
  text_quinary: { color: string };
  bg: { backgroundColor: string };
  bg_elevated: { backgroundColor: string };
  bg_secondary: { backgroundColor: string };
  bg_secondary_elevated: { backgroundColor: string };
  bg_fill: { backgroundColor: string };
  bg_fill_secondary: { backgroundColor: string };
  bg_fill_tertiary: { backgroundColor: string };
  bg_fill_quaternary: { backgroundColor: string };
  border: { borderColor: string };
  border_secondary: { borderColor: string };
  border_tertiary: { borderColor: string };
  button_stroke: { borderColor: string };
};

export type Theme = {
  name: ThemeName;
  scheme: ThemeScheme;
  palette: Palette;
  /** For each background color, the theme that content drawn on it should use. */
  backgroundModes: Record<BackgroundColorName, ThemeName>;
  atoms: ThemeAtoms;
  chain: Record<ChainName, string>;
  gradients: Gradients;
  chart: { up: string; down: string; grid: string; crosshairLine: string; crosshairDot: string };
};

export type Themes = Record<ThemeName, Theme>;

export function schemeOf(name: ThemeName): ThemeScheme {
  'worklet';
  return name === 'dark' || name === 'darkTinted' ? 'dark' : 'light';
}

function createTheme(name: ThemeName): Theme {
  const scheme = schemeOf(name);
  const backgrounds = mapResolve<BackgroundColorName, BackgroundValue>(backgroundColors, name);
  const backgroundPalette = {} as Record<BackgroundColorName, string>;
  const backgroundModes = {} as Record<BackgroundColorName, ThemeName>;
  for (const key in backgrounds) {
    const bgKey = key as BackgroundColorName;
    backgroundPalette[bgKey] = backgrounds[bgKey].color;
    backgroundModes[bgKey] = backgrounds[bgKey].mode;
  }
  const foregroundAliases = {} as Record<(typeof backgroundsAsForeground)[number], string>;
  for (const key of backgroundsAsForeground) foregroundAliases[key] = resolve(backgroundAsForeground(key), name);

  const palette: Palette = {
    ...color,
    ...backgroundPalette,
    ...foregroundAliases,
    ...mapResolve<keyof typeof foregroundColors, string>(foregroundColors, name),
  };

  const chain = {} as Record<ChainName, string>;
  for (const key in chainTokens) chain[key as ChainName] = chainTokens[key as ChainName][scheme];

  return {
    name,
    scheme,
    palette,
    backgroundModes,
    atoms: {
      text: { color: palette.label },
      text_secondary: { color: palette.label_secondary },
      text_tertiary: { color: palette.label_tertiary },
      text_quaternary: { color: palette.label_quaternary },
      text_quinary: { color: palette.label_quinary },
      bg: { backgroundColor: palette.surface_primary },
      bg_elevated: { backgroundColor: palette.surface_primary_elevated },
      bg_secondary: { backgroundColor: palette.surface_secondary },
      bg_secondary_elevated: { backgroundColor: palette.surface_secondary_elevated },
      bg_fill: { backgroundColor: palette.fill },
      bg_fill_secondary: { backgroundColor: palette.fill_secondary },
      bg_fill_tertiary: { backgroundColor: palette.fill_tertiary },
      bg_fill_quaternary: { backgroundColor: palette.fill_quaternary },
      border: { borderColor: palette.separator },
      border_secondary: { borderColor: palette.separator_secondary },
      border_tertiary: { borderColor: palette.separator_tertiary },
      button_stroke: { borderColor: palette.button_stroke },
    },
    chain,
    gradients: scheme === 'dark' ? darkGradients : lightGradients,
    chart: {
      up: chartUp,
      down: chartDown,
      grid: palette.separator_secondary,
      crosshairLine: palette.label_quinary,
      crosshairDot: palette.label,
    },
  };
}

function createThemes(): Themes {
  return {
    light: createTheme('light'),
    dark: createTheme('dark'),
    lightTinted: createTheme('lightTinted'),
    darkTinted: createTheme('darkTinted'),
  };
}

export const themes = createThemes();
