import { type SharedValue } from 'react-native-reanimated';

import { useAccent } from '@/design/accent';
import { useTheme } from '@/design/context';
import { resolveColor } from '@/design/resolve-color';
import { schemeOf } from '@/design/themes';

import {
  getValueForColorMode,
  isForegroundColor,
  resolveForegroundColor,
  toThemeForegroundKey,
  type BackgroundColorValue,
  type ColorMode,
  type ContextualColorValue,
  type ForegroundColor,
  type TextColor,
} from './palettes';

export type CustomColor<Value extends string = string> = {
  custom: Value | ContextualColorValue<Value>;
};

type ForegroundColorOrAccent = ForegroundColor | 'accent';

/**
 * @description Given an array of colors, resolves the foreground color for the current color mode
 * (the current design system theme) and the current accent (design system `useAccent()`).
 */
export function useForegroundColors(
  colors: (ForegroundColorOrAccent | ContextualColorValue<ForegroundColorOrAccent> | CustomColor)[]
): string[] {
  const theme = useTheme();
  const accent = useAccent();

  return colors.map(color => {
    if (color === 'accent') {
      return accent.color;
    }

    if (typeof color === 'object') {
      if ('custom' in color) {
        return getValueForColorMode(color.custom, theme.name);
      }

      const colorForColorMode = getValueForColorMode(color, theme.name);

      return colorForColorMode === 'accent' ? accent.color : resolveForegroundColor(colorForColorMode, theme);
    }

    return resolveForegroundColor(color, theme);
  });
}

/**
 * @description Resolves the foreground color for the current color mode.
 */
export function useForegroundColor(color: ForegroundColor | 'accent' | CustomColor): string {
  return useForegroundColors([color])[0];
}

/**
 * Worklet-safe color resolution for a color mode. Delegates to design system `resolveColor`: legacy foreground names
 * resolve against the mode's scheme (tinted overrides are ignored), `'accent'` resolves to
 * `accentColor` or the scheme's default blue, `{custom}` values pick by scheme, and any other value is
 * returned as-is.
 */
export function getColorForTheme(
  color: ForegroundColor | TextColor | CustomColor | string | 'accent' | SharedValue<TextColor> | SharedValue<string>,
  colorMode: ColorMode,
  accentColor?: BackgroundColorValue | null
): string {
  'worklet';
  const colorValue = typeof color === 'object' && 'value' in color ? color.value : color;
  const theme = { scheme: schemeOf(colorMode) };

  if (colorValue === 'accent') return resolveColor('accent', theme, accentColor?.color);
  if (typeof colorValue === 'object') {
    // Only `{custom}` objects resolve; any other object is passed through untouched.
    return 'custom' in colorValue ? resolveColor(colorValue, theme) : colorValue;
  }
  // Only legacy foreground names map onto design system keys; every other string (hex, rgba, design system key names) stays raw.
  return isForegroundColor(colorValue) ? resolveColor(toThemeForegroundKey(colorValue), theme) : colorValue;
}
