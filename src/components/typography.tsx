import React, { useEffect, type ComponentRef, type ReactNode, type Ref } from 'react';
import { Text as NativeText, type TextProps as RNTextProps, type StyleProp, type TextStyle } from 'react-native';

import AnimateableText from 'react-native-animateable-text';
import { useAnimatedProps, type DerivedValue, type SharedValue } from 'react-native-reanimated';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { isIOS } from '@/design/platform';
import { type Theme } from '@/design/themes';
import { createLineHeightFixNode, nodeHasEmoji, nodeIsString, normalizeTextStyles, renderStringWithEmoji } from '@/design/typography';
import { IS_DEV } from '@/lib/env/dev-mode';

type TextStyleOptions = {
  /**
   * Forces the `typeHierarchy` entry (`'<group>/<name>'`) used for the Capsize
   * trim. Only needed for entries whose metrics collide with another entry
   * (`capsizeAmbiguous` in `@/design`), i.e. the legacy
   * `Heading size="28px / 33px (Deprecated)"`.
   */
  capsizeEntryKey?: string;
};

/**
 * The style `Text` renders: `[a.text_17, a.font_regular, t.atoms.text, style]`
 * normalized by `normalizeTextStyles` (relative leading, SF Pro Rounded face,
 * Capsize trim).
 */
function resolveTextStyle(t: Theme, style: StyleProp<TextStyle>, options: TextStyleOptions = {}): TextStyle {
  return normalizeTextStyles([a.text_17, a.font_regular, t.atoms.text, style], { capsizeEntryKey: options.capsizeEntryKey });
}

type TextProps = Omit<RNTextProps, 'style'> &
  TextStyleOptions & {
    style?: StyleProp<TextStyle>;
    /**
     * Set when the children can contain emoji. On iOS each emoji is rendered in
     * its own system-font node so the text keeps its baseline. Children must
     * then be strings.
     */
    emoji?: boolean;
    ref?: Ref<InstanceType<typeof NativeText> | null>;
  };

/**
 * The main text component. Defaults to `[a.text_17, a.font_regular, t.atoms.text]`
 * and `allowFontScaling={false}`, trims to cap height and baseline, and appends
 * the Android multiline line-height fix.
 *
 *   <Text style={[a.text_15, a.font_bold, t.atoms.text_secondary]}>{label}</Text>
 */
export function Text({ allowFontScaling = false, capsizeEntryKey, children, emoji = false, ref, style, ...rest }: TextProps) {
  const t = useTheme();
  useEmojiChecks('Text', children, emoji);

  const s = resolveTextStyle(t, style, { capsizeEntryKey });

  return (
    <NativeText allowFontScaling={allowFontScaling} ref={ref} style={s} {...rest}>
      {isIOS && emoji && nodeIsString(children) ? renderStringWithEmoji(children) : children}
      {createLineHeightFixNode(s.lineHeight)}
    </NativeText>
  );
}

type SharedOrDerivedValueText =
  | (SharedValue<string> | DerivedValue<string>)
  | (SharedValue<string | null> | DerivedValue<string | null>)
  | (SharedValue<string | undefined> | DerivedValue<string | undefined>)
  | (SharedValue<string | null | undefined> | DerivedValue<string | null | undefined>);

type AnimatedTextChildProps = {
  children: SharedOrDerivedValueText | string | null | undefined;
  selector?: undefined;
};

type AnimatedTextSelectorProps<T extends SharedValue | DerivedValue> = {
  children: T;
  /** A worklet that selects the text from the shared value passed as `children`. */
  selector: (sharedValue: T) => string | null | undefined;
};

type AnimatedTextProps<T extends SharedValue | DerivedValue = SharedValue | DerivedValue> = TextStyleOptions & {
  ellipsizeMode?: RNTextProps['ellipsizeMode'];
  numberOfLines?: number;
  ref?: ComponentRef<typeof AnimateableText>;
  selectable?: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
} & (AnimatedTextChildProps | AnimatedTextSelectorProps<T>);

/**
 * `Text` whose content is a shared or derived value, updated on the UI thread.
 * Same default style and trim as `Text`.
 */
export function AnimatedText<T extends SharedValue | DerivedValue>({
  capsizeEntryKey,
  children,
  ellipsizeMode,
  numberOfLines,
  ref,
  selectable,
  selector,
  style,
  testID,
}: AnimatedTextProps<T>) {
  const t = useTheme();
  const s = resolveTextStyle(t, style, { capsizeEntryKey });

  const animatedText = useAnimatedProps(() => ({
    text: (selector ? selector(children) : typeof children === 'string' ? children : children?.value) ?? '',
  }));

  return (
    <AnimateableText
      allowFontScaling={false}
      animatedProps={animatedText}
      ellipsizeMode={ellipsizeMode}
      numberOfLines={numberOfLines}
      ref={ref}
      selectable={selectable}
      style={s}
      testID={testID}
    >
      {createLineHeightFixNode(s.lineHeight)}
    </AnimateableText>
  );
}

/** Dev-only emoji checks. */
function useEmojiChecks(name: string, children: ReactNode, emoji: boolean) {
  useEffect(() => {
    if (IS_DEV) {
      if (!emoji && nodeHasEmoji(children)) {
        console.log(
          `${name}: Emoji characters detected when "emoji" prop isn't set to true: "${children}"\n\nYou should set the "emoji" prop to true, otherwise vertical text alignment will be broken on iOS.`
        );
      }
      if (emoji && !nodeIsString(children)) {
        throw new Error(
          `${name}: When "emoji" is set to true, children can only be strings. If you need low-level control of emoji rendering, you can also use the "renderStringWithEmoji" function directly which accepts a string.`
        );
      }
    }
    // Checked once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
