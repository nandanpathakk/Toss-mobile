import { themes, type Themes } from './themes';
import { panta } from './tokens';

/** Scoped override using the existing theme context, without changing Rainbow screens. */
export const pantaThemes: Partial<Themes> = {
  dark: {
    ...themes.dark,
    palette: {
      ...themes.dark.palette,
      surface_primary: panta.background,
      surface_primary_elevated: panta.surface,
      label: panta.text,
      label_secondary: panta.secondary,
      separator_secondary: panta.border,
    },
    atoms: {
      ...themes.dark.atoms,
      bg: { backgroundColor: panta.background },
      bg_elevated: { backgroundColor: panta.surface },
      text: { color: panta.text },
      text_secondary: { color: panta.secondary },
      border_secondary: { borderColor: panta.border },
    },
  },
};
