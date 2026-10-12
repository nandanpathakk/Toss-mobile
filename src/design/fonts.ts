import { Platform, type TextStyle } from 'react-native';

import { fontWeight as fontWeights } from './tokens';

export type MutableTextStyle = { -readonly [K in keyof TextStyle]: TextStyle[K] };

type FontFace = { fontFamily: string; fontWeight: TextStyle['fontWeight'] };
type Weight = keyof typeof fontWeights;

const isIOS = Platform.OS === 'ios';

function face(iosFamily: string, androidFamily: string, weight: Weight): FontFace {
  return {
    fontFamily: isIOS ? iosFamily : androidFamily,
    fontWeight: isIOS ? fontWeights[weight] : 'normal',
  };
}

/**
 * Font faces, the same values as `fonts` in `design-system/typography/typography.ts`.
 * iOS selects the weight within one family; Android ships one family per weight
 * and must render it with `fontWeight: 'normal'`.
 */
export const fonts = {
  SFProRounded: {
    regular: face('SF Pro Rounded', 'SF-Pro-Rounded-Regular', 'regular'),
    medium: face('SF Pro Rounded', 'SF-Pro-Rounded-Medium', 'medium'),
    semibold: face('SF Pro Rounded', 'SF-Pro-Rounded-Semibold', 'semibold'),
    bold: face('SF Pro Rounded', 'SF-Pro-Rounded-Bold', 'bold'),
    heavy: face('SF Pro Rounded', 'SF-Pro-Rounded-Heavy', 'heavy'),
    black: face('SF Pro Rounded', 'SF-Pro-Rounded-Black', 'black'),
  },
  SFMono: {
    regular: face('SF Mono', 'SF-Mono-Regular', 'regular'),
    medium: face('SF Mono', 'SF-Mono-Medium', 'medium'),
  },
} as const;

export type FontFamilyName = keyof typeof fonts;

const weightByValue: Record<string, Weight> = {
  '400': 'regular',
  'normal': 'regular',
  '500': 'medium',
  '600': 'semibold',
  '700': 'bold',
  'bold': 'bold',
  '800': 'heavy',
  '900': 'black',
};

/**
 * Maps a style's `fontWeight` (atoms use `'400'`...`'900'`) to the matching
 * SF Pro Rounded face, or SF Mono when `family` is `'SFMono'`. Mutates `style`.
 * Weights SF Mono does not ship fall back to its `medium` face at 500+ and
 * `regular` below. A style with an explicit `fontFamily` is left alone.
 */
export function applyFonts(style: MutableTextStyle, family: FontFamilyName = 'SFProRounded'): MutableTextStyle {
  if (style.fontFamily) return style;
  const weight = weightByValue[String(style.fontWeight ?? '400')] ?? 'regular';
  const selected = family === 'SFMono' ? fonts.SFMono[weight === 'regular' ? 'regular' : 'medium'] : fonts.SFProRounded[weight];
  style.fontFamily = selected.fontFamily;
  style.fontWeight = selected.fontWeight;
  return style;
}
