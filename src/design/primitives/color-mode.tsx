import React, { type ReactNode } from 'react';

import { ThemeProvider, useDesign } from '@/design/context';
import { schemeOf } from '@/design/themes';

import { palettes, type ColorMode } from './palettes';

export type { ColorMode };

/**
 * @description Sets the color mode for nested elements so they can correctly
 * infer whether they are in a dark or light context. The `"dark"` and
 * `"light"` color modes are designed for neutral backgrounds, while the
 * `"darkTinted"` and `"lightTinted"` color modes are designed for tinted
 * backgrounds where foreground elements need to be desaturated.
 *
 * The color mode is the design system theme: this mounts a nested design system `ThemeProvider` with the same name
 * (`ColorMode` and `ThemeName` share values), and `useColorMode()` reads it back.
 */
export function ColorModeProvider({ value: colorMode, children }: { value: ColorMode; children: ReactNode }) {
  return <ThemeProvider theme={colorMode}>{children}</ThemeProvider>;
}

export const useColorMode = () => {
  const { themeName: colorMode } = useDesign();
  return { colorMode, ...palettes[colorMode], isDarkMode: schemeOf(colorMode) === 'dark' };
};
