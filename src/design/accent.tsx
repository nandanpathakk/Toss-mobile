import { createContext, useContext, useMemo } from 'react';

import chroma from 'chroma-js';

import { useDesign } from './context';
import type { ThemeName } from './themes';

/** Contrast against white above which an accent is dark enough for white content. */
const ACCENT_CONTRAST_THRESHOLD = 2.125;

export type Accent = {
  color: string;
  /** Label color for content drawn on the accent (the tinted theme's `label`). */
  onColor: string;
  /**
   * The theme for content drawn on the accent: the tinted theme an
   * `AccentProvider` mounts, or the default accent's background mode.
   */
  themeName: ThemeName;
};

/**
 * The nearest accent, or `null` outside any accent provider. Exported for the
 * legacy `AccentColorProvider`, which sets the accent without switching the theme.
 */
export const AccentContext = createContext<Accent | null>(null);
AccentContext.displayName = 'AlfAccentContext';

/**
 * Same rule as the legacy `AccentColorProvider`: an invalid color falls back
 * to the current theme's `blue`; content uses `darkTinted` when the accent's
 * contrast with white exceeds 2.125, otherwise `lightTinted`.
 */
export function resolveAccentThemeName(color: string): { valid: boolean; themeName: 'lightTinted' | 'darkTinted' } {
  const valid = chroma.valid(color);
  return {
    valid,
    themeName: valid && chroma.contrast(color, '#fff') > ACCENT_CONTRAST_THRESHOLD ? 'darkTinted' : 'lightTinted',
  };
}

/**
 * The nearest accent. Outside an `AccentProvider` this is the current theme's
 * default accent (`blue`), as `getDefaultAccentColorForColorMode` did.
 */
export function useAccent(): Accent {
  const accent = useContext(AccentContext);
  const design = useDesign();
  return useMemo<Accent>(() => {
    if (accent) return accent;
    const themeName = design.theme.backgroundModes.blue;
    return { color: design.theme.palette.blue, onColor: design.themes[themeName].palette.label, themeName };
  }, [accent, design]);
}
