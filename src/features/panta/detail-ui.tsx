import React, { useEffect, useRef, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';

import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta, pantaLayout } from '@/design/tokens';

import { PantaIcon, PantaText, type PantaIconName } from './panta-ui';

export function DetailSurface({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[a.overflow_hidden, t.atoms.bg_elevated, { borderRadius: pantaLayout.cardRadius }, style]}>{children}</View>;
}

export function DetailIconButton({ icon, label, onPress }: { icon: PantaIconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        a.align_center,
        a.justify_center,
        a.rounded_full,
        { width: pantaLayout.iconTarget, height: pantaLayout.iconTarget, backgroundColor: panta.surface, opacity: pressed ? 0.55 : 1 },
      ]}
    >
      <PantaIcon name={icon} size={20} />
    </Pressable>
  );
}

export function DetailHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  const t = useTheme();
  return (
    <View style={[a.gap_12]}>
      <PantaText allowFontScaling accessibilityRole="header" style={[a.text_20, a.font_semibold]}>
        {title}
      </PantaText>
      {subtitle && (
        <PantaText allowFontScaling style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
          {subtitle}
        </PantaText>
      )}
    </View>
  );
}

export function DetailDisclosure({
  icon,
  title,
  subtitle,
  color = panta.secondary,
  onPress,
  last = false,
}: {
  icon: PantaIconName;
  title: string;
  subtitle: string;
  color?: string;
  onPress: () => void;
  last?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityHint={`Opens ${title.toLowerCase()}`}
      onPress={onPress}
      style={({ pressed }) => [
        a.flex_row,
        a.align_center,
        a.p_16,
        a.gap_16,
        { minHeight: pantaLayout.disclosureMinHeight, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <View style={[a.align_center, a.justify_center, a.rounded_12, { width: 40, height: 40, backgroundColor: `${color}12` }]}>
        <PantaIcon name={icon} color={color} size={20} />
      </View>
      <View style={[a.flex_1, a.gap_8]}>
        <PantaText allowFontScaling style={[a.text_17, a.font_semibold]}>
          {title}
        </PantaText>
        <PantaText allowFontScaling style={[a.text_13, a.leading_135, t.atoms.text_secondary]}>
          {subtitle}
        </PantaText>
      </View>
      <PantaIcon name="chevron" size={16} color={panta.secondary} />
      {!last && <View style={[a.absolute, { left: 72, right: 16, bottom: 0, height: 1, backgroundColor: panta.border }]} />}
    </Pressable>
  );
}

export function DetailField({
  label,
  value,
  last = false,
  selectable = false,
}: {
  label: string;
  value: string;
  last?: boolean;
  selectable?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={[a.p_20, a.gap_12, !last && a.border_b, t.atoms.border_secondary]}>
      <PantaText allowFontScaling style={[a.text_13, t.atoms.text_secondary]}>
        {label}
      </PantaText>
      <PantaText allowFontScaling selectable={selectable} tabular style={[a.text_15, a.leading_150]}>
        {value}
      </PantaText>
    </View>
  );
}

function SheetContent({
  title,
  subtitle,
  onClose,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});
  useEffect(() => {
    scroll.current?.scrollTo({ y: offsets.current[title] ?? 0, animated: false });
  }, [title]);
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[a.flex_1, t.atoms.bg]}>
      <View
        accessibilityElementsHidden
        style={[a.self_center, a.rounded_full, a.mt_8, a.mb_8, { width: 36, height: 5, backgroundColor: panta.secondary, opacity: 0.35 }]}
      />
      <View style={[a.flex_row, a.align_center, a.justify_between, a.px_20, a.py_8, a.gap_16]}>
        {onBack && <DetailIconButton icon="back" label="Back to trades" onPress={onBack} />}
        {!onBack && <DetailIconButton icon="close" label={`Close ${title.toLowerCase()}`} onPress={onClose} />}
        <PantaText allowFontScaling accessibilityRole="header" style={[a.flex_1, a.text_22, a.font_bold]}>
          {title}
        </PantaText>
        {onBack && <DetailIconButton icon="close" label={`Close ${title.toLowerCase()}`} onPress={onClose} />}
      </View>
      <ScrollView
        ref={scroll}
        onScroll={event => {
          offsets.current[title] = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[a.p_20, { gap: pantaLayout.sectionGap, paddingBottom: Math.max(insets.bottom, 20) + 20 }]}
      >
        {subtitle && (
          <PantaText allowFontScaling style={[a.text_15, a.leading_150, t.atoms.text_secondary]}>
            {subtitle}
          </PantaText>
        )}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function DetailSheet({
  visible,
  ...props
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={props.onClose}>
      {visible && (
        <SafeAreaProvider>
          <SheetContent {...props} />
        </SafeAreaProvider>
      )}
    </Modal>
  );
}
