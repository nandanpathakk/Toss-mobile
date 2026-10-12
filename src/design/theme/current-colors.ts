import type { Colors } from '@/design/styles/palette';

interface CurrentColors {
  theme: 'dark' | 'light';
  themedColors: Colors | null;
}

/**
 * Mutable snapshot of the resolved root theme for code outside React (navigation presets, the
 * status bar handler). Written by `styles/colors.ts` at module load (the light palette) and by
 * `MainThemeProvider` once the preference has loaded, when the device appearance changes and on
 * `setTheme`. Module-level reads (e.g. `nativeStackDefaultConfig`) capture whatever it held when
 * their module was evaluated.
 */
export const currentColors: CurrentColors = {
  theme: 'light',
  themedColors: null,
};
