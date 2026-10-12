import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, PanResponder, Pressable, View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { panta } from '@/design/tokens';

import { PantaButton, PantaText } from './panta-ui';
import { createTradeConfirmation } from './trade-confirmation-policy';

export function TradeSwipeConfirm({
  ticket,
  expiresAt,
  label,
  disabled,
  onConfirm,
}: {
  ticket: string;
  expiresAt: string;
  label: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const [width, setWidth] = useState(0);
  const [button, setButton] = useState(false);
  const offset = useRef(new Animated.Value(0)).current;
  const policy = useRef(createTradeConfirmation()).current;
  const latest = useRef({ ticket, expiresAt, disabled, onConfirm, width });
  latest.current = { ticket, expiresAt, disabled, onConfirm, width };
  const reset = () => {
    policy.cancel();
    offset.setValue(0);
  };
  useEffect(() => {
    policy.cancel();
    offset.setValue(0);
  }, [ticket, expiresAt, disabled, width, policy, offset]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', () => {
      policy.cancel();
      offset.setValue(0);
    });
    return () => {
      subscription.remove();
      policy.cancel();
    };
  }, [policy, offset]);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: event => !latest.current.disabled && event.nativeEvent.locationX <= 64,
        onMoveShouldSetPanResponder: (_, gesture) => !latest.current.disabled && gesture.dx > 8 && Math.abs(gesture.dy) < 12,
        onPanResponderGrant: () => {
          const current = latest.current;
          policy.begin(current.ticket, Date.parse(current.expiresAt), !current.disabled && AppState.currentState === 'active', Date.now());
        },
        onPanResponderMove: (_, gesture) => offset.setValue(Math.max(0, Math.min(latest.current.width - 60, gesture.dx))),
        onPanResponderRelease: (_, gesture) => {
          const current = latest.current;
          const travel = current.width - 60;
          const releasedAt = Date.now();
          const confirmed = policy.release(
            current.ticket,
            !current.disabled && AppState.currentState === 'active' && Date.parse(current.expiresAt) > releasedAt,
            travel > 80 && Math.abs(gesture.dy) < 64 ? gesture.dx / travel : 0,
            releasedAt
          );
          offset.setValue(0);
          if (confirmed) current.onConfirm();
        },
        onPanResponderTerminate: () => {
          policy.cancel();
          offset.setValue(0);
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [offset, policy]
  );
  function confirmWithButton() {
    const current = latest.current;
    const enabled = !current.disabled && AppState.currentState === 'active';
    policy.begin(current.ticket, Date.parse(current.expiresAt), enabled, Date.now());
    if (policy.release(current.ticket, enabled, 1, Date.now())) current.onConfirm();
  }
  return (
    <View style={[a.gap_8]}>
      {button ? (
        <PantaButton label={`Confirm ${label}`} disabled={disabled} onPress={confirmWithButton} maxFontSizeMultiplier={2} />
      ) : (
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel={`Confirm ${label}`}
          accessibilityHint="Swipe the handle right. With a screen reader, double tap to confirm."
          accessibilityState={{ disabled }}
          onAccessibilityTap={confirmWithButton}
          accessibilityActions={[{ name: 'activate', label: `Confirm ${label}` }]}
          onAccessibilityAction={event => {
            if (event.nativeEvent.actionName === 'activate') confirmWithButton();
          }}
          onLayout={event => setWidth(event.nativeEvent.layout.width)}
          style={[a.justify_center, a.rounded_full, { minHeight: 64, backgroundColor: panta.accent, opacity: disabled ? 0.4 : 1 }]}
        >
          <View pointerEvents="none" style={[a.align_center, a.py_16, { paddingLeft: 64, paddingRight: 16 }]}>
            <PantaText
              maxFontSizeMultiplier={1.5}
              style={[a.text_15, a.font_bold, { color: panta.background, textAlign: 'center', marginTop: 0, marginBottom: 0 }]}
            >
              Swipe to {label}
            </PantaText>
          </View>
          <Animated.View
            {...responder.panHandlers}
            accessible={false}
            style={[
              a.absolute,
              a.align_center,
              a.justify_center,
              a.rounded_full,
              { left: 6, width: 52, height: 52, backgroundColor: panta.background, transform: [{ translateX: offset }] },
            ]}
          >
            <PantaText allowFontScaling={false} style={[a.text_22, { color: panta.accent }]}>
              →
            </PantaText>
          </Animated.View>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => {
          reset();
          setButton(!button);
        }}
        style={[a.align_center, a.justify_center, { minHeight: 44 }]}
      >
        <PantaText maxFontSizeMultiplier={2} style={[a.text_13, { color: panta.secondary, marginTop: 0, marginBottom: 0 }]}>
          {button ? 'Use swipe instead' : 'Use a button instead'}
        </PantaText>
      </Pressable>
    </View>
  );
}
