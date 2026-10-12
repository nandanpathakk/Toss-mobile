import { convertToRGBA, isColor } from 'react-native-reanimated';

/**
 * Applies an alpha to a color. Same output as the legacy
 * `design-system/utils/opacity` helper; non-colors are returned unchanged.
 */
export function alpha(color: string, opacity: number): string {
  'worklet';
  if (isColor(color)) {
    const rgbaColor = convertToRGBA(color);
    return `rgba(${rgbaColor[0] * 255}, ${rgbaColor[1] * 255}, ${rgbaColor[2] * 255}, ${opacity})`;
  }
  return color;
}
