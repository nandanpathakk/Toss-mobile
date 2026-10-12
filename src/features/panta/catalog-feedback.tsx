import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';
import { CatalogError } from '@/lib/panta-catalog';

import { PantaButton, PantaText } from './panta-ui';

export function CatalogLoading({ label = 'Finding markets' }: { label?: string }) {
  const t = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={[a.align_center, a.gap_16, a.py_36]}>
      <ActivityIndicator color={panta.accent} />
      <PantaText style={[a.text_13, t.atoms.text_secondary]}>{label}</PantaText>
    </View>
  );
}

export function CatalogFailure({
  error,
  onRetry,
  stale = false,
  title,
  description,
}: {
  error: Error;
  onRetry: () => void;
  stale?: boolean;
  title?: string;
  description?: string;
}) {
  const t = useTheme();
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const until = Date.now() + (error instanceof CatalogError ? (error.retryAfterSeconds ?? 0) : 0) * 1000;
    const update = () => setRemaining(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [error]);
  const message =
    error instanceof CatalogError && error.code === 'ACCESS_REQUIRED'
      ? 'Market access is temporarily unavailable.'
      : error instanceof CatalogError && error.code === 'RATE_LIMITED'
        ? 'Panta is receiving too many requests. Please wait a moment.'
        : error instanceof CatalogError && error.code === 'INVALID_RESPONSE'
          ? 'Panta returned market data we couldn’t verify.'
          : 'Check your connection and try again.';
  return (
    <View accessibilityRole="alert" style={[a.p_20, a.gap_16, a.rounded_16, a.border, t.atoms.border_secondary, t.atoms.bg_elevated]}>
      <PantaText style={[a.text_17, a.font_semibold]}>{title ?? (stale ? 'Couldn’t update markets' : 'Markets couldn’t load')}</PantaText>
      <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
        {description ?? message}
        {stale ? ' Showing previously loaded data.' : ''}
      </PantaText>
      <PantaButton
        variant="secondary"
        label={remaining ? `Try again in ${remaining}s` : 'Try again'}
        disabled={remaining > 0}
        onPress={onRetry}
      />
    </View>
  );
}
