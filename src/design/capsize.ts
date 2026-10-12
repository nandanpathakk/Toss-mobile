import { PixelRatio, Platform } from 'react-native';

import { capsizeEntries, capsizeIndex, type CapsizeTableEntry } from './capsizeTable';

type TextTrim = { marginTop: number; marginBottom: number };

export type CapsizeOptions = {
  /** Defaults to `Platform.OS`. */
  platform?: typeof Platform.OS;
  /** Defaults to `PixelRatio.getFontScale()`, as in `design-system/typography/typography.ts`. */
  fontScale?: number;
};

/** Key of `capsizeIndex` for a font size, line height (px) and letter spacing. */
function capsizeKey(fontSize: number, lineHeight: number, letterSpacing: number): string {
  return `${fontSize}/${lineHeight}/${letterSpacing}`;
}

/**
 * Finds the `typeHierarchy` entry for resolved text metrics. `entryKey`
 * (`<group>/<name>`) wins when given, for the entries listed in `capsizeAmbiguous`.
 */
export function getCapsizeEntry(
  metrics: { fontSize: number; lineHeight: number; letterSpacing: number } | { entryKey: string }
): CapsizeTableEntry | undefined {
  if ('entryKey' in metrics) return capsizeEntries[metrics.entryKey];
  const entryKey = capsizeIndex[capsizeKey(metrics.fontSize, metrics.lineHeight, metrics.letterSpacing)];
  return entryKey === undefined ? undefined : capsizeEntries[entryKey];
}

/**
 * Turns a table entry into the negative margins that trim text to its cap height
 * and baseline. Same arithmetic as `createTextSize` in
 * `design-system/typography/typography.ts`, including the per-platform
 * `marginCorrection` and pixel rounding.
 */
export function computeTextTrim(entry: CapsizeTableEntry, options: CapsizeOptions = {}): TextTrim {
  const platform = options.platform ?? Platform.OS;
  const fontScale = options.fontScale ?? PixelRatio.getFontScale();
  const marginBottom = PixelRatio.roundToNearestPixel(entry.baselineTrim * entry.fontSize * fontScale);
  const marginTop = PixelRatio.roundToNearestPixel(entry.capHeightTrim * entry.fontSize * fontScale);

  if (platform === 'web') return { marginTop, marginBottom };

  const correction = entry.marginCorrection[platform === 'ios' ? 'ios' : 'android'];
  return {
    marginTop: PixelRatio.roundToNearestPixel(marginTop + correction),
    marginBottom: PixelRatio.roundToNearestPixel(marginBottom - correction),
  };
}
