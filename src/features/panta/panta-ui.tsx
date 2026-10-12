import React, { type ComponentProps } from 'react';
import { Platform, Pressable, View, type TextStyle } from 'react-native';

import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { Text } from '@/components/typography';
import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';

type PantaTextProps = ComponentProps<typeof Text> & { tabular?: boolean };

// System typography for the first native build; licensed Figtree assets are a separate visual gate.
export const pantaFont: TextStyle = { fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif', letterSpacing: 0 };

export function PantaText({ style, tabular = false, ...props }: PantaTextProps) {
  return <Text allowFontScaling {...props} style={[pantaFont, style, tabular && { fontVariant: [...a.tabular_nums.fontVariant] }]} />;
}

export type PantaIconName =
  | 'explore'
  | 'portfolio'
  | 'account'
  | 'search'
  | 'back'
  | 'close'
  | 'arrow'
  | 'wallet'
  | 'share'
  | 'chevron'
  | 'rules'
  | 'activity'
  | 'info'
  | 'clock';

export function PantaIcon({ name, color = panta.text, size = 22 }: { name: PantaIconName; color?: string; size?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === 'explore' && (
        <>
          <Rect x={3} y={3} width={7} height={7} rx={2} />
          <Rect x={14} y={3} width={7} height={7} rx={2} />
          <Rect x={3} y={14} width={7} height={7} rx={2} />
          <Rect x={14} y={14} width={7} height={7} rx={2} />
        </>
      )}
      {name === 'portfolio' && <Path d="M4 7h16v13H4zM8 7V4h8v3M4 12h16M10 12v3h4v-3" />}
      {name === 'account' && (
        <>
          <Circle cx={12} cy={8} r={4} />
          <Path d="M4 21v-2a8 8 0 0 1 16 0v2" />
        </>
      )}
      {name === 'search' && (
        <>
          <Circle cx={10} cy={10} r={6} />
          <Path d="m15 15 5 5" />
        </>
      )}
      {name === 'back' && <Path d="m14 5-7 7 7 7" />}
      {name === 'close' && <Path d="m6 6 12 12M18 6 6 18" />}
      {name === 'arrow' && <Path d="M6 18 18 6M6 6h12v12" />}
      {name === 'wallet' && <Path d="M3 6h18v15H3zM3 6l14-3v3M16 12h5v5h-5z" />}
      {name === 'share' && <Path d="M12 15V3m-4 4 4-4 4 4M7 10H4v11h16V10h-3" />}
      {name === 'chevron' && <Path d="m9 6 6 6-6 6" />}
      {name === 'rules' && <Path d="M12 3v18M7 21h10M4 7h16M6 7l-3 7h6L6 7Zm12 0-3 7h6l-3-7Z" />}
      {name === 'activity' && <Path d="M3 12h4l3-7 4 14 3-7h4" />}
      {name === 'info' && (
        <>
          <Circle cx={12} cy={12} r={9} />
          <Path d="M12 11v6M12 7h.01" />
        </>
      )}
      {name === 'clock' && (
        <>
          <Circle cx={12} cy={12} r={9} />
          <Path d="M12 7v5l3 2" />
        </>
      )}
    </Svg>
  );
}

export function PantaButton({
  label,
  onPress,
  disabled = false,
  variant = 'primary',
  maxFontSizeMultiplier,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'utility' | 'destructive';
  maxFontSizeMultiplier?: number;
}) {
  const backgroundColor = variant === 'primary' ? panta.accent : variant === 'secondary' ? panta.elevated : 'transparent';
  const color =
    variant === 'primary' ? panta.background : variant === 'destructive' ? panta.no : variant === 'utility' ? panta.secondary : panta.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        a.align_center,
        a.justify_center,
        a.p_16,
        a.rounded_12,
        { minHeight: 48, backgroundColor, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
      ]}
    >
      <PantaText
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        style={[a.text_15, a.font_bold, { color }, a.text_center, maxFontSizeMultiplier !== undefined && { marginTop: 0, marginBottom: 0 }]}
      >
        {label}
      </PantaText>
    </Pressable>
  );
}

export function PantaBadge({ label, accent = false }: { label: string; accent?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={[
        a.px_8,
        a.py_6,
        a.border,
        a.rounded_6,
        t.atoms.border_secondary,
        accent && { backgroundColor: panta.accentBackground, borderColor: 'transparent' },
      ]}
    >
      <PantaText allowFontScaling style={[a.text_10, accent ? { color: panta.accent } : t.atoms.text_secondary]}>
        {label}
      </PantaText>
    </View>
  );
}

export function Attribution() {
  const t = useTheme();
  return (
    <PantaText style={[a.self_center, a.my_24, a.text_11, a.text_center, t.atoms.text_secondary]}>
      Toss · Independent app · Powered by Panta
    </PantaText>
  );
}
