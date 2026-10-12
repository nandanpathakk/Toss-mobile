import React, { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { Appearance, LayoutAnimation, Platform, useColorScheme } from 'react-native';

import { useDarkMode } from 'react-native-dark-mode';
import { ThemeProvider } from 'styled-components';

import { onHandleStatusBar } from '@/app/navigation/on-navigation-state-change';
import { useColorModeTheme } from '@/app/shell/use-color-mode-theme';
import { ThemeProvider as AlfThemeProvider } from '@/design/context';
import { DesignSystemProvider } from '@/design/primitives/design-system-context';
import { StyleThingThemeProvider } from '@/design/styled';
import { darkModeThemeColors, lightModeThemeColors, type Colors } from '@/design/styles/palette';
import { getColorModePref, setColorModePref, useColorModePrefStore } from '@/stores/color-mode';

import { currentColors } from './current-colors';
import { Themes, type ThemesType } from './theme-names';

export interface ThemeContextProps {
  colors: Colors;
  darkScheme: Colors;
  lightScheme: Colors;
  colorScheme: ThemesType | null;
  isDarkMode: boolean;
  setTheme: (scheme: ThemesType) => void;
}

const ThemeContext = createContext<ThemeContextProps>({
  colors: lightModeThemeColors,
  colorScheme: Themes.SYSTEM,
  darkScheme: darkModeThemeColors,
  isDarkMode: false,
  lightScheme: lightModeThemeColors,
  setTheme: () => {},
});

/**
 * The user's color mode preference from `state/preferences/color-mode.ts`, read asynchronously.
 */
const getStoredColorMode = async (): Promise<ThemesType> => getColorModePref().colorMode;

export const isDarkTheme = async () => {
  let currentTheme: ThemesType = await getStoredColorMode();

  if (currentTheme === Themes.SYSTEM) {
    const isSystemDarkMode = Appearance.getColorScheme() === Themes.DARK;
    currentTheme = isSystemDarkMode ? Themes.DARK : Themes.LIGHT;
  }

  return currentTheme === Themes.DARK;
};

export const MainThemeProvider = (props: PropsWithChildren) => {
  // `null` until the preference has been read; the provider renders nothing until then.
  const [isPrefLoaded, setIsPrefLoaded] = useState(false);
  const storedColorMode = useColorModePrefStore(s => s.colorMode);
  const colorScheme: ThemesType | null = isPrefLoaded ? storedColorMode : null;
  // looks like one works on Android and another one on iOS. good.
  const isSystemDarkModeIOS = useDarkMode();
  const isSystemDarkModeAndroid = useColorScheme() === 'dark';
  const isSystemDarkMode = Platform.OS === 'ios' ? isSystemDarkModeIOS : isSystemDarkModeAndroid;

  const colorSchemeSystemAdjusted = useColorModeTheme(colorScheme, isSystemDarkMode);

  // Override default with user preferences
  useEffect(() => {
    const loadUserPref = async () => {
      const userPref = (await getStoredColorMode()) ?? Themes.SYSTEM;
      const userPrefSystemAdjusted = userPref === Themes.SYSTEM ? (isSystemDarkMode ? 'dark' : 'light') : userPref;
      currentColors.theme = userPrefSystemAdjusted;
      currentColors.themedColors = userPrefSystemAdjusted === Themes.DARK ? darkModeThemeColors : lightModeThemeColors;
      setIsPrefLoaded(true);
      onHandleStatusBar();
    };
    loadUserPref();
  }, [isSystemDarkMode]);

  const currentTheme = useMemo(
    () => ({
      colors: colorSchemeSystemAdjusted === 'dark' ? darkModeThemeColors : lightModeThemeColors,
      colorScheme,
      darkScheme: darkModeThemeColors,
      isDarkMode: colorSchemeSystemAdjusted === 'dark',
      lightScheme: lightModeThemeColors,
      // Overrides the isDarkMode value will cause re-render inside the context.
      setTheme: (scheme: ThemesType) => {
        const schemeSystemAdjusted = scheme === Themes.SYSTEM ? (isSystemDarkMode ? 'dark' : 'light') : scheme;
        currentColors.theme = schemeSystemAdjusted;

        currentColors.themedColors = schemeSystemAdjusted === Themes.DARK ? darkModeThemeColors : lightModeThemeColors;
        // Persists the preference and re-renders with the new scheme.
        setColorModePref(scheme);
        onHandleStatusBar();
        LayoutAnimation.configureNext(LayoutAnimation.create(1000, 'easeInEaseOut', 'opacity'));
      },
    }),
    [colorScheme, colorSchemeSystemAdjusted, isSystemDarkMode]
  );

  if (!colorScheme || !colorSchemeSystemAdjusted) {
    return null;
  }

  return (
    <AlfThemeProvider theme={colorSchemeSystemAdjusted}>
      <StyleThingThemeProvider value={currentTheme}>
        <ThemeProvider theme={currentTheme}>
          <ThemeContext.Provider value={currentTheme}>
            <DesignSystemProvider colorMode={currentTheme.isDarkMode ? 'dark' : 'light'}>{props.children}</DesignSystemProvider>
          </ThemeContext.Provider>
        </ThemeProvider>
      </StyleThingThemeProvider>
    </AlfThemeProvider>
  );
};

/**
 * Custom hook to get the legacy theme object.
 * @deprecated use `useTheme` from `@/design`
 */
export const useThemeColors = () => useContext(ThemeContext);

export function withThemeContext<P extends object>(Component: React.ComponentType<P>) {
  return function WrapperComponent(props: Omit<P, keyof ThemeContextProps>) {
    return <ThemeContext.Consumer>{state => <Component {...(props as P)} {...state} />}</ThemeContext.Consumer>;
  };
}
