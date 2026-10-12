import { Platform, type TextStyle } from 'react-native';

import { isNil } from 'lodash';

import { css } from '@/design/styled';

import fonts, { type FontFamily } from './font-tokens';
import colors, { type Colors } from './palette';

type FontWeight = number | string | undefined;

export type TextStyleProps = {
  color?: string;
  theme: { colors: Colors };
  size?: number | string;
  isEmoji?: boolean;
  family?: FontFamily;
  mono?: boolean;
  weight?: FontWeight;
  letterSpacing?: number | string | null;
  lineHeight?: number | string | null;
  opacity?: number | null;
  align?: string | null;
  tabularNums?: boolean;
  uppercase?: boolean;
};

const lookup = (table: Record<string, number | string>, key: number | string) => table[key as string] ?? key;

function capitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function selectBestFontFit(weight: FontWeight) {
  if (weight) {
    if (weight === 900) {
      return 'Heavy';
    }
    if ((weight as number) >= 700) {
      return 'Bold';
    }
    if ((weight as number) >= 500) {
      return 'Semibold';
    }
    return (weight as number) <= 400 ? 'Regular' : capitalizeFirstLetter(weight as string);
  } else {
    return 'Regular';
  }
}
function capitalizeFirstLetterWorklet(string: string) {
  'worklet';
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function selectBestFontFitWorklet(weight: FontWeight) {
  'worklet';
  if (weight) {
    if (weight === 900) {
      return 'Heavy';
    }
    if ((weight as number) >= 700) {
      return 'Bold';
    }
    if ((weight as number) >= 500) {
      return 'Semibold';
    }
    return (weight as number) <= 400 ? 'Regular' : capitalizeFirstLetterWorklet(weight as string);
  } else {
    return 'Regular';
  }
}

function familyFontWithAndroidWidth(weight: FontWeight, family: FontFamily, _mono?: boolean) {
  return `${fonts.family[family]}${Platform.OS === 'android' ? `-${selectBestFontFit(weight)}` : ''}`;
}

export function fontWithWidth(weight: FontWeight, family: FontFamily = 'SFProRounded'): Pick<TextStyle, 'fontFamily' | 'fontWeight'> {
  return {
    fontFamily: familyFontWithAndroidWidth(weight, family),
    // https://github.com/facebook/react-native/issues/18820
    // https://www.youtube.com/watch?v=87rhZTumujw
    ...(Platform.OS === 'ios' ? { fontWeight: weight as TextStyle['fontWeight'] } : { fontWeight: 'normal' as const }),
  };
}

function familyFontWithAndroidWidthWorklet(weight: FontWeight, family: FontFamily) {
  'worklet';
  return `${fonts.family[family]}${Platform.OS === 'android' ? `-${selectBestFontFitWorklet(weight)}` : ''}`;
}

export function fontWithWidthWorklet(
  weight: FontWeight,
  family: FontFamily = 'SFProRounded'
): Pick<TextStyle, 'fontFamily' | 'fontWeight'> {
  'worklet';
  return {
    fontFamily: familyFontWithAndroidWidthWorklet(weight, family),
    // https://github.com/facebook/react-native/issues/18820
    // https://www.youtube.com/watch?v=87rhZTumujw
    ...(Platform.OS === 'ios' ? { fontWeight: weight as TextStyle['fontWeight'] } : { fontWeight: 'normal' as const }),
  };
}

const textCss = css<TextStyleProps>`
  /* Color */
  color: ${({ color, theme }) => colors.get(color, theme.colors) || theme.colors.dark};

  /* Font Family */
  ${({ isEmoji, family = 'SFProRounded', mono, weight }) => {
    const t = isEmoji ? '' : `font-family: ${familyFontWithAndroidWidth(weight, family, mono)};`;
    return t;
  }}

  /* Font Size */
  font-size:  ${({ size = 'medium' }) => (typeof size === 'number' ? size : lookup(fonts.size, size))};

  /* Font Weight */
  ${({ isEmoji, weight = 'regular' }) =>
    isEmoji || isNil(weight) || Platform.OS === 'android' ? '' : `font-weight: ${lookup(fonts.weight, weight as number | string)};`}

  /* Letter Spacing */
  ${({ letterSpacing = 'rounded' }) => (isNil(letterSpacing) ? '' : `letter-spacing: ${lookup(fonts.letterSpacing, letterSpacing)};`)}

  /* Line Height */
  ${({ isEmoji, lineHeight }) =>
    isNil(lineHeight) || (isEmoji && Platform.OS === 'android') ? '' : `line-height: ${lookup(fonts.lineHeight, lineHeight)};`}

  /* Opacity */
  ${({ opacity }) => (isNil(opacity) ? '' : `opacity: ${opacity};`)}

  /* Tabular Numbers */
  ${({ tabularNums }) => (tabularNums ? 'font-variant: tabular-nums;' : '')}

  /* Text Align */
  ${({ align }) => (isNil(align) ? '' : `text-align: ${align};`)}

  /* Uppercase */
  ${({ uppercase }) => (uppercase ? 'text-transform: uppercase;' : '')}

  ${Platform.OS === 'android' ? 'include-font-padding: false;\ntext-align-vertical: center;' : ''}
`;

const textObject = ({
  color,
  theme,
  size = 'medium',
  isEmoji,
  family = 'SFProRounded',
  mono,
  weight,
  letterSpacing = 'rounded',
  lineHeight,
  opacity,
  align,
  tabularNums,
  uppercase,
}: TextStyleProps) => {
  const styles: Record<string, unknown> = {
    color: colors.get(color, theme.colors) || theme.colors.dark,
    fontSize: typeof size === 'number' ? size : lookup(fonts.size, size),
  };

  if (!isEmoji) {
    styles.fontFamily = familyFontWithAndroidWidth(weight, family, mono);
  }

  if (!(isEmoji || isNil(weight) || Platform.OS === 'android')) {
    if (typeof weight === 'undefined') {
      weight = 'regular';
    }

    styles.fontWeight = lookup(fonts.weight, weight as number | string);
  }

  if (!isNil(letterSpacing)) {
    styles.letterSpacing = lookup(fonts.letterSpacing, letterSpacing);
  }

  if (!(isNil(lineHeight) || (isEmoji && Platform.OS === 'android'))) {
    styles.lineHeight = lookup(fonts.lineHeight, lineHeight);
  }

  if (!isNil(opacity)) {
    styles.opacity = opacity;
  }

  if (tabularNums) {
    styles.fontVariant = ['tabular-nums'];
  }

  if (!isNil(align)) {
    styles.textAlign = align;
  }

  if (uppercase) {
    styles.textTransform = 'uppercase';
  }

  if (Platform.OS === 'android') {
    styles.includeFontPadding = false;
    styles.textAlignVertical = 'center';
  }

  return styles;
};

const buildTextStyles = Object.assign(textCss, { object: textObject });

export default buildTextStyles;
