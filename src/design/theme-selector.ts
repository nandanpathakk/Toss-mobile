import type { ThemeName } from './themes';

type ThemeSelectOptions<T> = {
  light: T;
  dark: T;
  lightTinted?: T;
  darkTinted?: T;
  /** Reserved for a `dim` theme; falls back to `dark`. */
  dim?: T;
};

/**
 * Picks a value for a theme. Tinted themes fall back to their scheme's value
 * and `dim` falls back to `dark`, the same inheritance as `getValueForColorMode`.
 */
export function select<T>(name: ThemeName | 'dim', options: ThemeSelectOptions<T>): T {
  'worklet';
  switch (name) {
    case 'lightTinted':
      return options.lightTinted ?? options.light;
    case 'darkTinted':
      return options.darkTinted ?? options.dark;
    case 'dim':
      return options.dim ?? options.dark;
    case 'dark':
      return options.dark;
    default:
      return options.light;
  }
}
