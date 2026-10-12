import React, { Fragment, type ReactNode } from 'react';
import { Text as NativeText, Platform, StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import createEmojiRegex from 'emoji-regex';

import { computeTextTrim, getCapsizeEntry, type CapsizeOptions } from './capsize';
import { flatten } from './flatten';
import { applyFonts, type FontFamilyName, type MutableTextStyle } from './fonts';

/** Line heights at or below this are multipliers of `fontSize` (`a.leading_135`). */
const RELATIVE_LINE_HEIGHT_MAX = 3;

type NormalizeTextOptions = CapsizeOptions & {
  family?: FontFamilyName;
  /** Apply the Capsize trim (default true). */
  trim?: boolean;
  /**
   * Forces a `typeHierarchy` entry (`'<group>/<name>'`) for the trim, for the
   * entries whose metrics collide (see `capsizeAmbiguous`).
   */
  capsizeEntryKey?: string;
};

/**
 * Flattens text styles and applies what the legacy `Text`/`Heading` did through
 * `useTextStyle`: relative line heights resolved against `fontSize`, the
 * SF Pro Rounded face for the weight, and the Capsize trim (as negative
 * `marginTop`/`marginBottom`) for sizes in `typeHierarchy`. Explicit margins in
 * `styles` win over the trim.
 */
export function normalizeTextStyles(styles: StyleProp<TextStyle>, options: NormalizeTextOptions = {}): TextStyle {
  const s: MutableTextStyle = { ...flatten(styles) };

  if (typeof s.fontSize === 'number' && typeof s.lineHeight === 'number' && s.lineHeight > 0 && s.lineHeight <= RELATIVE_LINE_HEIGHT_MAX) {
    s.lineHeight = s.fontSize * s.lineHeight;
  }

  applyFonts(s, options.family);

  if (options.trim !== false && typeof s.fontSize === 'number' && typeof s.lineHeight === 'number') {
    const entry = getCapsizeEntry(
      options.capsizeEntryKey
        ? { entryKey: options.capsizeEntryKey }
        : { fontSize: s.fontSize, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing ?? 0 }
    );
    if (entry) {
      const trim = computeTextTrim(entry, options);
      const trimmed: MutableTextStyle = { marginTop: trim.marginTop, marginBottom: trim.marginBottom };
      // The legacy `Text` rendered Capsize's line height, which is rounded to
      // four decimals (`17 * 1.35` -> 22.95, not 22.950000000000003).
      return { ...trimmed, ...s, lineHeight: entry.lineHeight };
    }
  }

  return s;
}

// https://github.com/facebook/react-native/issues/29232#issuecomment-889767516
// On Android, space between lines of multiline text seems to be irregular
// when using certain fonts.
// The workaround posted on GitHub adds 1 to the line height correction node but
// this adds a noticeable amount of space below the baseline. The workaround still
// seems to work as long as the line height differs from the parent node.
// To remove this additional space we've dropped the line height offset to an
// arbitrarily small number that's close to zero.
export const createLineHeightFixNode = (lineHeight: number | undefined) =>
  Platform.OS === 'android' && lineHeight !== undefined ? <NativeText style={{ lineHeight: lineHeight - 0.001 }} /> : null;

const emojiRegex = createEmojiRegex();
const emojiStyles = StyleSheet.create({
  emoji: {
    color: 'black', // Ensures emoji don't inherit the opacity of rgba colors
    fontFamily: 'System', // Fixes line height issues with custom fonts + emoji
  },
});

type StringNode = string | (string | null)[];

export const nodeHasEmoji = (children: ReactNode) =>
  (Array.isArray(children) ? children : [children]).some(child => typeof child === 'string' && createEmojiRegex().test(child));

export const nodeIsString = (children: ReactNode): children is StringNode =>
  typeof children === 'string' || (Array.isArray(children) && children.every(child => typeof child === 'string' || child === null));

/**
 * @description Renders a string of text containing emoji. This is required due
 * to a rendering issue on iOS where the presence of emoji causes text nodes to
 * render higher than their usual baseline.
 */
export const renderStringWithEmoji = (stringNode: StringNode) => {
  if (__DEV__ && !nodeIsString(stringNode)) {
    throw new Error('renderEmoji: Only string values are supported.');
  }

  const strings = Array.isArray(stringNode) ? stringNode : [stringNode];

  return (
    <Fragment>
      {strings.map(node => {
        if (typeof node !== 'string') {
          return node;
        }

        const string = node;
        const emojis = string.match(emojiRegex);

        if (emojis === null) {
          return string;
        }

        return string.split(emojiRegex).map((stringPart, index) => (
          <Fragment key={index}>
            {stringPart}
            {emojis[index] ? <NativeText style={emojiStyles.emoji}>{emojis[index]}</NativeText> : null}
          </Fragment>
        ));
      })}
    </Fragment>
  );
};
