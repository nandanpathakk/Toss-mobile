import React, { createContext, useContext, useMemo, type PropsWithChildren } from 'react';

import { themes, type Theme, type ThemeName, type Themes } from './themes';

type Design = {
  themeName: ThemeName;
  theme: Theme;
  themes: Themes;
};

const Context = createContext<Design>({
  themeName: 'light',
  theme: themes.light,
  themes,
});
Context.displayName = 'AlfContext';

/**
 * Provides the design system theme. Nestable: an inner provider overrides the theme for
 * its subtree (`<ThemeProvider theme="dark"><QRScanner /></ThemeProvider>`).
 * The root provider gets its name from app state (`state/shell/theme.ts`);
 * `src/design` never reads state itself.
 */
export function ThemeProvider({
  children,
  theme: themeName,
  themesOverride,
}: PropsWithChildren<{
  theme: ThemeName;
  themesOverride?: Partial<Themes>;
}>) {
  const value = useMemo<Design>(() => {
    const merged = themesOverride ? { ...themes, ...themesOverride } : themes;
    return { themeName, theme: merged[themeName], themes: merged };
  }, [themeName, themesOverride]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDesign(): Design {
  return useContext(Context);
}

/** The current theme, or the named theme from the same theme set. */
export function useTheme(theme?: ThemeName): Theme {
  const design = useDesign();
  return useMemo(() => (theme ? design.themes[theme] : design.theme), [theme, design]);
}
