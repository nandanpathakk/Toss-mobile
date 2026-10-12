import React from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { atoms as a } from '@/design/atoms';
import { panta, pantaLayout } from '@/design/tokens';
import { type MarketPhase } from '@/lib/panta-catalog';

import { PantaIcon, PantaText } from './panta-ui';

export const marketPhases: { label: string; value: MarketPhase | undefined }[] = [
  { label: 'All phases', value: undefined },
  { label: 'Primary', value: 'primary' },
  { label: 'P2P', value: 'secondary' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Cancelled', value: 'cancelled' },
];

/** Compact Android fallback; iOS uses its built-in action sheet. */
export function PhasePicker({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected: MarketPhase | undefined;
  onSelect: (phase: MarketPhase | undefined) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[a.flex_1, a.justify_end, { backgroundColor: panta.scrim }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss phase selector"
          onPress={onClose}
          style={[a.absolute, { top: 0, right: 0, bottom: 0, left: 0 }]}
        />
        <View
          accessibilityViewIsModal
          style={[
            a.mx_16,
            a.p_16,
            a.gap_12,
            {
              backgroundColor: panta.surface,
              borderRadius: pantaLayout.cardRadius,
              marginBottom: Math.max(insets.bottom, 16),
              maxHeight: '85%',
            },
          ]}
        >
          <View style={[a.flex_row, a.align_center, a.justify_between]}>
            <PantaText allowFontScaling accessibilityRole="header" style={[a.text_17, a.font_semibold]}>
              Market phase
            </PantaText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close phase selector"
              onPress={onClose}
              style={[a.align_center, a.justify_center, { width: 44, height: 44 }]}
            >
              <PantaIcon name="close" size={18} />
            </Pressable>
          </View>
          <ScrollView bounces={false} contentContainerStyle={[a.gap_4]}>
            {marketPhases.map(phase => (
              <Pressable
                key={phase.label}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected === phase.value }}
                onPress={() => {
                  onSelect(phase.value);
                  onClose();
                }}
                style={({ pressed }) => [
                  a.flex_row,
                  a.align_center,
                  a.justify_between,
                  a.p_12,
                  a.rounded_12,
                  {
                    minHeight: 48,
                    backgroundColor: selected === phase.value ? panta.accentBackground : panta.surface,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <PantaText allowFontScaling style={[a.text_17]}>
                  {phase.label}
                </PantaText>
                {selected === phase.value && <PantaText style={[a.text_17, { color: panta.accent }]}>✓</PantaText>}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
