/**
 * Theme-independent design tokens for Rainbow design system.
 *
 * Every value here is a plain string or number so it can be captured in
 * worklets and passed to Skia.
 *
 * `src/design` is a leaf: nothing in this directory imports from the rest of `src/`.
 */

/** Toss / The Turn identity. Shared by the scoped app theme and brand components. */
export const tossBrand = {
  field: '#241D31',
  ivory: '#F4F1EA',
  accent: '#B8A3F5',
} as const;

/** Prediction-market UI roles. Internal Panta names preserve existing integrations. */
export const panta = {
  background: '#0B0D0F',
  surface: '#17191D',
  elevated: '#1D2026',
  text: tossBrand.ivory,
  secondary: '#979BA5',
  border: '#FFFFFF12',
  yes: '#8AE8B1',
  yesBackground: '#8AE8B110',
  no: '#F49D9F',
  noBackground: '#F49D9F10',
  accent: tossBrand.accent,
  accentBackground: '#B8A3F510',
  resolution: '#DFC36F',
  resolutionBackground: '#DFC36F12',
  scrim: '#00000099',
  cryptoArtwork: ['#392E26', '#1A191B'],
  scienceArtwork: ['#322A48', '#191922'],
  worldArtwork: ['#24394D', '#181A21'],
} as const;

/** Native Panta detail surfaces share one geometry and interaction scale. */
export const pantaLayout = {
  pageInset: 20,
  sectionGap: 28,
  cardRadius: 20,
  iconTarget: 44,
  disclosureMinHeight: 80,
} as const;

/**
 * Spacing scale. Atoms use numeric suffixes: `a.p_20`, `a.gap_12`.
 * Deprecated legacy values (1, 5, 15, 19, 30, 34, 42) are intentionally absent;
 * call sites that still use them keep a raw number.
 */
export const space = {
  _0: 0,
  _2: 2,
  _3: 3,
  _4: 4,
  _6: 6,
  _8: 8,
  _10: 10,
  _12: 12,
  _16: 16,
  _20: 20,
  _24: 24,
  _28: 28,
  _32: 32,
  _36: 36,
  _44: 44,
  _52: 52,
  _60: 60,
  _72: 72,
  _80: 80,
  _104: 104,
} as const;

/**
 * Font sizes, one per `typeHierarchy.text` "pt" entry. Each size's default
 * line height and letter spacing come from that entry (see `atoms.ts`).
 */
export const fontSize = {
  _10: 10,
  _11: 11,
  _12: 12,
  _13: 13,
  _15: 15,
  _17: 17,
  _20: 20,
  _22: 22,
  _26: 26,
  _30: 30,
  _34: 34,
  _44: 44,
  _54: 54,
  _64: 64,
  _76: 76,
} as const;

/**
 * Relative line heights. A `lineHeight` at or below 3 is treated as a
 * multiplier of `fontSize` by `normalizeTextStyles`, matching the
 * `'13pt / 135%'` style entries in `typeHierarchy`.
 */
export const lineHeight = {
  _135: 1.35,
  _150: 1.5,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
  black: '900',
} as const;

export type FontWeightToken = keyof typeof fontWeight;

export const borderRadius = {
  _0: 0,
  _2: 2,
  _4: 4,
  _6: 6,
  _8: 8,
  _10: 10,
  _12: 12,
  _14: 14,
  _16: 16,
  _18: 18,
  _20: 20,
  _22: 22,
  _24: 24,
  _26: 26,
  _28: 28,
  _30: 30,
  _32: 32,
  _36: 36,
  _40: 40,
  _42: 42,
  _46: 46,
  full: 999,
} as const;

/**
 * Color ramps. The legacy `globalColors` name `blue60` is `blue_60` here,
 * `blueGrey10` is `blueGrey_10`.
 */
export const color = {
  green_10: '#EAFCE8',
  green_20: '#CDFACD',
  green_30: '#A6F5AC',
  green_40: '#74E082',
  green_50: '#4BD166',
  green_60: '#1DB847',
  green_70: '#189943',
  green_80: '#09752D',
  green_90: '#005723',
  green_100: '#003816',

  blue_10: '#EDF9FF',
  blue_20: '#D1EDFF',
  blue_30: '#A3D7FF',
  blue_40: '#6BBFFF',
  blue_50: '#3898FF',
  blue_60: '#0E76FD',
  blue_70: '#1761E0',
  blue_80: '#0B4AB8',
  blue_90: '#053085',
  blue_100: '#001E59',

  purple_10: '#F7F5FF',
  purple_20: '#E7E0FF',
  purple_30: '#C6B8FF',
  purple_40: '#9E8FFF',
  purple_50: '#7A70FF',
  purple_60: '#5F5AFA',
  purple_70: '#5248E0',
  purple_80: '#4936C2',
  purple_90: '#38228F',
  purple_100: '#2C0D6B',

  pink_10: '#FFF0FA',
  pink_20: '#FFD6F1',
  pink_30: '#FFB8E2',
  pink_40: '#FF99CF',
  pink_50: '#FF7AB8',
  pink_60: '#FF5CA0',
  pink_70: '#E04887',
  pink_80: '#CC3976',
  pink_90: '#851B53',
  pink_100: '#570040',

  red_10: '#FFF0F0',
  red_20: '#FFD4D1',
  red_30: '#FFACA3',
  red_40: '#FF887A',
  red_50: '#FF6257',
  red_60: '#FA423C',
  red_70: '#D13732',
  red_80: '#B22824',
  red_90: '#7A1714',
  red_100: '#520907',

  orange_10: '#FFF6EB',
  orange_20: '#FFE7CC',
  orange_30: '#FFCF99',
  orange_40: '#FFB266',
  orange_50: '#FF983D',
  orange_60: '#FF801F',
  orange_70: '#E06E16',
  orange_80: '#AD530E',
  orange_90: '#703B12',
  orange_100: '#3D1E0A',

  yellow_10: '#FFFBE0',
  yellow_20: '#FFF5C2',
  yellow_30: '#FFEE99',
  yellow_40: '#FFE566',
  yellow_50: '#FFDF3D',
  yellow_60: '#FFD014',
  yellow_70: '#EBAF09',
  yellow_80: '#B88700',
  yellow_90: '#7A600A',
  yellow_100: '#42320B',

  grey_10: '#F7F7F7',
  grey_20: 'rgba(9, 17, 31, 0.05)',
  grey_30: 'rgba(16, 21, 31, 0.1)',
  grey_40: 'rgba(16, 21, 31, 0.16)',
  grey_50: 'rgba(22, 25, 31, 0.24)',
  grey_60: 'rgba(26, 28, 31, 0.36)',
  grey_70: 'rgba(27, 29, 31, 0.5)',
  grey_80: 'rgba(27, 29, 31, 0.7)',
  grey_90: 'rgba(27, 29, 31, 0.88)',
  grey_100: '#000',

  white_10: '#1B1C1E',
  white_20: 'rgba(245, 248, 255, 0.12)',
  white_30: 'rgba(245, 248, 255, 0.16)',
  white_40: 'rgba(245, 248, 255, 0.2)',
  white_50: 'rgba(245, 248, 255, 0.28)',
  white_60: 'rgba(245, 248, 255, 0.4)',
  white_70: 'rgba(245, 248, 255, 0.56)',
  white_80: 'rgba(245, 248, 255, 0.76)',
  white_90: 'rgba(247, 250, 255, 0.92)',
  white_100: '#FFFFFF',

  blueGrey_10: '#F5F5F7',
  blueGrey_20: '#E6E9F0',
  blueGrey_30: '#DADEE5',
  blueGrey_40: '#CAD0D9',
  blueGrey_50: '#AFB9C7',
  blueGrey_60: '#929EAD',
  blueGrey_70: '#78828F',
  blueGrey_80: '#5F6670',
  blueGrey_90: '#3C4047',
  blueGrey_100: '#242529',

  darkGrey: '#9CA6B1',
} as const;

export type ColorToken = keyof typeof color;

/**
 * Legacy colors from `deprecatedColors` in `design-system/color/palettes.ts`.
 * Only used to build the `deprecated_*` palette entries.
 */
export const deprecatedColor = {
  appleBlue: '#0E76FD',
  appleBlueLight: '#1F87FF',
  black: '#000000',
  blackTint: '#12131a',
  dark: '#1E2028',
  darker: '#12131A',
  grey: 'rgb(60, 66, 82)',
  grey06: 'rgba(60, 66, 82, 0.06)',
  grey10: 'rgba(60, 66, 82, 0.1)',
  grey15: 'rgba(60, 66, 82, 0.15)',
  grey20: 'rgba(60, 66, 82, 0.2)',
  grey25: 'rgba(60, 66, 82, 0.25)',
  grey30: 'rgba(60, 66, 82, 0.3)',
  grey40: 'rgba(60, 66, 82, 0.4)',
  grey50: 'rgba(60, 66, 82, 0.5)',
  grey60: 'rgba(60, 66, 82, 0.6)',
  grey70: 'rgba(60, 66, 82, 0.7)',
  grey80: 'rgba(60, 66, 82, 0.8)',
  greyDark: '#25292E',
  offwhite: '#F5F5F7',
  paleBlue: '#579DFF',
  sky: '#E0E8FF',
  sky06: 'rgba(224, 232, 255, 0.06)',
  sky10: 'rgba(224, 232, 255, 0.1)',
  sky15: 'rgba(224, 232, 255, 0.15)',
  sky20: 'rgba(224, 232, 255, 0.2)',
  sky25: 'rgba(224, 232, 255, 0.25)',
  sky30: 'rgba(224, 232, 255, 0.3)',
  sky40: 'rgba(224, 232, 255, 0.4)',
  sky50: 'rgba(224, 232, 255, 0.5)',
  sky60: 'rgba(224, 232, 255, 0.6)',
  sky70: 'rgba(224, 232, 255, 0.7)',
  sky80: 'rgba(224, 232, 255, 0.8)',
  swapPurple: '#575CFF',
  white: '#FFFFFF',
  white06: 'rgba(255, 255, 255, 0.06)',
  white10: 'rgba(255, 255, 255, 0.1)',
  white15: 'rgba(255, 255, 255, 0.15)',
  white20: 'rgba(255, 255, 255, 0.2)',
  white25: 'rgba(255, 255, 255, 0.25)',
  white30: 'rgba(255, 255, 255, 0.3)',
  white40: 'rgba(255, 255, 255, 0.4)',
  white50: 'rgba(255, 255, 255, 0.5)',
  white60: 'rgba(255, 255, 255, 0.6)',
  white70: 'rgba(255, 255, 255, 0.7)',
  white80: 'rgba(255, 255, 255, 0.8)',
  white90: 'rgba(255, 255, 255, 0.9)',
} as const;

/**
 * Chain brand colors as light/dark pairs. Themes resolve them by scheme into
 * `theme.chain`.
 */
export const chain = {
  mainnet: { light: '#6D6D6D', dark: '#999BA1' },
  arbitrum: { light: '#1690E4', dark: '#52B8FF' },
  optimism: { light: '#FF4040', dark: '#FF8A8A' },
  polygon: { light: '#8247E5', dark: '#BE97FF' },
  base: { light: '#0052FF', dark: '#3979FF' },
  zora: { light: '#2B5DF0', dark: '#6183F0' },
  bsc: { light: '#EBAF09', dark: '#FFDA66' },
  avalanche: { light: '#EBAF09', dark: '#FF5D5E' },
  blast: { light: '#FCFC06', dark: '#FCFC06' },
  degen: { light: '#A36EFD', dark: '#A36EFD' },
} as const;

export type ChainName = keyof typeof chain;
