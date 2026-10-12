import React from 'react';
import { View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';

import { PantaButton, PantaText } from './panta-ui';

export function TradingAccountPanel({
  status,
  error,
  onVerify,
  canVerify = true,
}: {
  status: 'idle' | 'verifying' | 'verified' | 'error';
  error: string | null;
  onVerify: () => void;
  canVerify?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={[a.gap_8]}>
      <PantaText accessibilityLiveRegion="polite" style={[a.text_13, t.atoms.text_secondary]}>
        {status === 'verified'
          ? '✓ Wallet verified'
          : status === 'error'
            ? 'Wallet check failed'
            : canVerify
              ? 'Checking wallet…'
              : 'Open Account to reconnect your wallet.'}
      </PantaText>
      {error && (
        <PantaText accessibilityRole="alert" style={[a.text_13, a.leading_150]}>
          {error}
        </PantaText>
      )}
      {status === 'error' && canVerify && <PantaButton label="Retry wallet check" variant="utility" onPress={onVerify} />}
    </View>
  );
}
