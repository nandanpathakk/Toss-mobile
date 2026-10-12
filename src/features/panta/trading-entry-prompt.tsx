import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, Platform, Pressable, ScrollView, View } from 'react-native';

import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta, pantaLayout } from '@/design/tokens';

import { DetailIconButton } from './detail-ui';
import { PantaButton, PantaIcon, PantaText } from './panta-ui';
import { type TradingEntry, type TradingIntent } from './trading-entry';

type PromptEntry = Exclude<TradingEntry, 'closed' | 'primary' | 'p2p'>;
type Props = {
  visible: boolean;
  entry: PromptEntry;
  intent: TradingIntent;
  marketTitle: string;
  onClose: () => void;
  onOpenAccount: () => void;
};
const copy: Record<PromptEntry, { title: string; body: string; action: string }> = {
  'sign-in': {
    title: 'Sign in to trade',
    body: 'Sign in or create an account, then set up your Solana wallet to review a trade.',
    action: 'Sign in or create account',
  },
  'wallet': {
    title: 'Get your wallet ready',
    body: 'Open Account to create your Solana wallet, or refresh and recover the wallet linked to your account.',
    action: 'Open Account',
  },
  'connecting': {
    title: 'Connecting your account',
    body: 'Your account is still loading. You can check its status in Account or keep exploring while it connects.',
    action: 'Open Account',
  },
  'unavailable': {
    title: 'Reconnect your account',
    body: 'Your account couldn’t connect. Open Account to check its status before reviewing a trade.',
    action: 'Open Account',
  },
};

function PromptContent({
  entry,
  intent,
  marketTitle,
  onClose,
  onContinue,
}: Omit<Props, 'visible' | 'onOpenAccount'> & { onContinue: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const text = copy[entry];
  const label = intent === 'yes' || intent === 'no' ? `Buy ${intent.toUpperCase()}` : intent === 'sell' ? 'Sell shares' : 'Buy shares';
  return (
    <View style={[a.flex_1, a.justify_end, { backgroundColor: panta.scrim }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss trading prompt"
        onPress={onClose}
        style={[a.absolute, { top: 0, bottom: 0, left: 0, right: 0 }]}
      />
      <View
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        style={[
          a.overflow_hidden,
          t.atoms.bg_elevated,
          {
            maxHeight: '90%',
            borderTopLeftRadius: pantaLayout.cardRadius,
            borderTopRightRadius: pantaLayout.cardRadius,
            marginTop: insets.top,
          },
        ]}
      >
        <ScrollView bounces={false} contentContainerStyle={[a.p_24, a.gap_20, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          <View style={[a.flex_row, a.align_center, a.justify_between, a.gap_16]}>
            <View
              accessibilityElementsHidden
              style={[a.align_center, a.justify_center, a.rounded_16, { width: 56, height: 56, backgroundColor: panta.accentBackground }]}
            >
              <PantaIcon name="wallet" color={panta.accent} size={28} />
            </View>
            <DetailIconButton icon="close" label="Close trading prompt" onPress={onClose} />
          </View>
          <View style={[a.gap_12]}>
            <PantaText style={[a.text_13, a.font_semibold, { color: panta.accent }]}>{label} · Trading account</PantaText>
            <PantaText accessibilityRole="header" style={[a.text_26, a.font_bold, a.leading_135]}>
              {text.title}
            </PantaText>
            <PantaText style={[a.text_15, a.leading_150, t.atoms.text_secondary]}>{text.body}</PantaText>
          </View>
          <View style={[a.p_16, a.gap_8, a.rounded_12, t.atoms.bg]}>
            <PantaText style={[a.text_11, t.atoms.text_secondary]}>Your selected market</PantaText>
            <PantaText style={[a.text_15, a.font_medium, a.leading_135]}>{marketTitle}</PantaText>
          </View>
          <View style={[a.gap_8]}>
            <PantaButton label={text.action} onPress={onContinue} />
            <PantaButton variant="utility" label="Keep exploring" onPress={onClose} />
            <PantaText style={[a.text_11, a.text_center, a.leading_150, t.atoms.text_secondary]}>
              Signing in won’t place an order.
            </PantaText>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

export function TradingEntryPrompt(props: Props) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (active) setReduceMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  function finish() {
    const action = pending.current;
    pending.current = null;
    action?.();
  }
  function continueToDestination() {
    if (pending.current) return;
    pending.current = props.onOpenAccount;
    props.onClose();
    // iOS waits for dismissal before closing the presenting detail screen.
    if (Platform.OS !== 'ios') finish();
  }
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      statusBarTranslucent
      onRequestClose={props.onClose}
      onDismiss={finish}
    >
      <SafeAreaProvider>
        <PromptContent {...props} onContinue={continueToDestination} />
      </SafeAreaProvider>
    </Modal>
  );
}
