import React from 'react';
import { Pressable, View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { panta } from '@/design/tokens';

import { PantaText } from './panta-ui';

export function TradeOutcomeSelector({
  side,
  disabled,
  onChange,
}: {
  side: 'yes' | 'no';
  disabled: boolean;
  onChange: (side: 'yes' | 'no') => void;
}) {
  return (
    <View style={[a.flex_row, a.gap_12]}>
      {(['yes', 'no'] as const).map(value => (
        <Pressable
          key={value}
          accessibilityRole="button"
          accessibilityLabel={`Choose ${value.toUpperCase()}`}
          accessibilityState={{ selected: side === value, disabled }}
          disabled={disabled}
          onPress={() => onChange(value)}
          style={({ pressed }) => [
            a.flex_1,
            a.flex_row,
            a.align_center,
            a.justify_center,
            a.gap_8,
            a.p_16,
            a.rounded_12,
            a.border,
            {
              minHeight: 52,
              borderColor: side === value ? (value === 'yes' ? panta.yes : panta.no) : panta.border,
              backgroundColor: side === value ? (value === 'yes' ? panta.yesBackground : panta.noBackground) : panta.background,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <PantaText
            maxFontSizeMultiplier={2}
            style={[a.text_17, a.font_bold, { color: value === 'yes' ? panta.yes : panta.no, marginTop: 0, marginBottom: 0 }]}
          >
            {side === value ? '✓ ' : ''}
            {value.toUpperCase()}
          </PantaText>
        </Pressable>
      ))}
    </View>
  );
}
