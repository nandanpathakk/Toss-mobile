import React, { useMemo, type JSX } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

import { useAccent } from '@/design/accent';
import { ThemeProvider, useTheme } from '@/design/context';

import { isBackgroundColor, resolveBackgroundColor, type BackgroundColor, type BackgroundColorValue } from './palettes';

type BackgroundProviderProps = {
  color: BackgroundColor | 'accent' | string;
  children: ({
    backgroundColor,
    backgroundStyle,
  }: {
    backgroundColor: ViewStyle['backgroundColor'];
    backgroundStyle: StyleProp<ViewStyle>;
  }) => JSX.Element;
  style?: StyleProp<ViewStyle>;
};

/**
 * @description Allows third-party elements to be rendered with a standard
 * background color via a render prop, while also mounting a nested design system
 * `ThemeProvider` (the color mode) so that nested elements can correctly infer
 * whether they are in a dark or light context. The `style` object containing
 * the `backgroundColor` value is memoized and passed to the render function.
 */
export function BackgroundProvider({ color, children, style: styleProp }: BackgroundProviderProps) {
  const theme = useTheme();
  const accent = useAccent();

  const background = useMemo<BackgroundColorValue>(() => {
    if (color === 'accent') return { color: accent.color, mode: accent.themeName };
    if (isBackgroundColor(color)) return resolveBackgroundColor(color, theme);
    return { color, mode: theme.name };
  }, [accent, color, theme]);

  const style = useMemo(
    () => [{ backgroundColor: background.color }, ...(Array.isArray(styleProp) ? styleProp : [styleProp])],
    [background, styleProp]
  );

  const child = children({
    backgroundColor: background.color,
    backgroundStyle: style,
  });

  return <ThemeProvider theme={background.mode}>{child}</ThemeProvider>;
}

export function useBackgroundColor(color: string): string;
export function useBackgroundColor(color: BackgroundColor): BackgroundColor;
export function useBackgroundColor(color: BackgroundColor | string): BackgroundColor | string {
  const theme = useTheme();
  const accent = useAccent();

  const backgroundColor = useMemo(() => {
    if (color === 'accent') return accent.color;
    return isBackgroundColor(color) ? resolveBackgroundColor(color, theme).color : color;
  }, [accent.color, color, theme]);

  return backgroundColor;
}
