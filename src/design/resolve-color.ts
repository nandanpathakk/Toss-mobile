import { themes, type ForegroundColorName, type Palette, type Theme } from './themes';
import type { ChainName } from './tokens';

type CustomColor = { custom: string | { light: string; dark: string } };
/** A palette or chain name, `'accent'`, a `{custom}` value, or any raw color string. */
type ResolvableColor = keyof Palette | 'accent' | CustomColor | string;

/**
 * Worklet version of `getColorForTheme`. Palette names resolve against the
 * theme's *scheme* (tinted overrides are ignored), `'accent'` resolves to
 * `accentColor` or the scheme's default blue, `{custom}` values pick by scheme,
 * chain names resolve to `theme.chain`, and any other string is returned as-is.
 */
export function resolveColor(color: ResolvableColor | ForegroundColorName, t: Pick<Theme, 'scheme'>, accentColor?: string | null): string {
  'worklet';
  const palette = themes[t.scheme].palette;
  if (color === 'accent') return accentColor ?? palette.blue;
  if (typeof color === 'object') {
    return typeof color.custom === 'string' ? color.custom : color.custom[t.scheme];
  }
  if (color in palette) return palette[color as keyof Palette];
  const chain = themes[t.scheme].chain;
  if (color in chain) return chain[color as ChainName];
  return color;
}
