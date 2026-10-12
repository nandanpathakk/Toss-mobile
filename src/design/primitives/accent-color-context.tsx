import React, { useContext, useMemo, type ReactNode } from 'react';

import { AccentContext, resolveAccentThemeName, type Accent } from '@/design/accent';
import { useDesign } from '@/design/context';

import { type BackgroundColorValue } from './palettes';

interface AccentColorProviderProps {
  color: string;
  children: ReactNode;
}

/**
 * @description The accent set by the nearest `AccentColorProvider` (or design system `AccentProvider`),
 * in the legacy `{ color, mode }` shape.
 */
export function useAccentColor(): BackgroundColorValue {
  const accent = useContext(AccentContext);
  const value = useMemo(() => accent && { color: accent.color, mode: accent.themeName }, [accent]);
  if (!value) {
    throw new Error('useAccentColor must be used within an AccentColorProvider');
  }
  return value;
}

/**
 * @description Sets the `"accent"` color for an entire subtree of the app.
 *
 * Provides the design system accent (`useAccent()` from `@/design`) with the same rule as design system `AccentProvider`: an invalid
 * color falls back to the current theme's `blue`, and content on the accent uses `darkTinted` when its contrast
 * with white exceeds 2.125, otherwise `lightTinted`. Unlike `AccentProvider` it does not switch the subtree's
 * theme: legacy content only turns tinted on an accent *background* (`Box background="accent"`, whose
 * `BackgroundProvider` mounts the nested `ThemeProvider`).
 */
export function AccentColorProvider({ color, children }: AccentColorProviderProps) {
  const { theme, themes } = useDesign();
  const value = useMemo<Accent>(() => {
    const { valid, themeName } = resolveAccentThemeName(color);
    return { color: valid ? color : theme.palette.blue, onColor: themes[themeName].palette.label, themeName };
  }, [color, theme.palette.blue, themes]);

  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>;
}
