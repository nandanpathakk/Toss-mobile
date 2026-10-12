import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';

import { Attribution, PantaBadge, PantaButton, pantaFont, PantaIcon, PantaText } from './panta-ui';
import { usePantaAccount } from './use-panta-account';

export function WalletScreen({ page }: { page: 'portfolio' | 'account' }) {
  const t = useTheme();
  const account = usePantaAccount();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') setCode('');
    });
    return () => {
      mounted.current = false;
      listener.remove();
    };
  }, []);
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  useEffect(() => {
    if (account.authenticated) {
      setCode('');
      setEmail('');
      setSentTo(null);
    }
  }, [account.authenticated]);
  async function run(label: string, operation: () => Promise<unknown>, failure: string) {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    setBusy(label);
    try {
      await operation();
    } catch {
      if (mounted.current) setError(failure);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  function send() {
    const value = (sentTo ?? email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('Enter a valid email address.');
      return;
    }
    void run(
      'Sending code…',
      async () => {
        await account.sendCode(value);
        if (mounted.current) {
          setSentTo(value);
          setCode('');
          setResendAt(Date.now() + 60000);
          setNow(Date.now());
        }
      },
      'We couldn’t send your code. Check your connection and email address, then try again.'
    );
  }
  const waiting = !account.ready || Boolean(busy) || account.loginBusy;
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const inputStyle = [pantaFont, a.text_17, a.p_16, a.border, a.rounded_12, t.atoms.border_secondary, { color: panta.text, minHeight: 52 }];
  return (
    <KeyboardAvoidingView style={[a.flex_1]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[a.p_20, a.gap_24]}>
        <View style={[a.flex_row, a.flex_wrap, a.align_center, a.justify_between, a.gap_12]}>
          <PantaText accessibilityRole="header" style={[a.text_30, a.font_bold]}>
            {page === 'portfolio' ? 'Portfolio' : 'Account'}
          </PantaText>
          <PantaBadge label="Development" />
        </View>
        <View style={[a.py_24, a.gap_20]}>
          <View style={[a.align_center, a.justify_center, a.rounded_full, { width: 64, height: 64, backgroundColor: panta.elevated }]}>
            {waiting && !account.failed ? (
              <ActivityIndicator color={panta.accent} />
            ) : (
              <PantaIcon name="account" size={28} color={panta.accent} />
            )}
          </View>
          <View style={[a.gap_12]}>
            <PantaText accessibilityRole="header" style={[a.text_26, a.font_bold]}>
              {account.failed
                ? 'Your account is unavailable'
                : !account.ready
                  ? 'Getting your account ready'
                  : account.authenticated
                    ? 'Your Toss account'
                    : sentTo
                      ? 'Check your email'
                      : 'Make yourself at home.'}
            </PantaText>
            <PantaText style={[a.text_15, a.leading_150, t.atoms.text_secondary]}>
              {account.failed
                ? 'You can still explore markets while the account service is unavailable.'
                : !account.ready
                  ? 'You can keep exploring while we connect securely.'
                  : account.authenticated
                    ? (account.email ?? 'Signed in with Privy')
                    : sentTo
                      ? `Enter the six-digit code sent to ${sentTo}.`
                      : 'Sign in with your email to set up your Solana wallet. No password to remember.'}
            </PantaText>
          </View>
          {(account.failed || error) && (
            <PantaText accessibilityRole="alert" style={[a.text_13, a.leading_150, { color: panta.no }]}>
              {error ?? 'Your account service is unavailable. Close and reopen the app to try again. You can still explore markets.'}
            </PantaText>
          )}
          {account.ready && !account.failed && !account.authenticated && (
            <View style={[a.gap_16]}>
              {sentTo ? (
                <>
                  <TextInput
                    accessibilityLabel="Email verification code"
                    placeholder="000000"
                    placeholderTextColor={panta.secondary}
                    value={code}
                    onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    autoCorrect={false}
                    editable={!busy}
                    maxLength={6}
                    style={[inputStyle, { fontVariant: ['tabular-nums'], letterSpacing: 6 }]}
                  />
                  <PantaButton
                    label={busy ?? 'Verify email'}
                    disabled={waiting || code.length !== 6}
                    onPress={() => {
                      void run(
                        'Verifying…',
                        async () => {
                          try {
                            await account.verifyCode(sentTo, code);
                          } finally {
                            if (mounted.current) setCode('');
                          }
                        },
                        'That code couldn’t be verified. Check the latest email or request a new code.'
                      );
                    }}
                  />
                  <Pressable
                    accessibilityRole="button"
                    disabled={waiting || remaining > 0}
                    onPress={send}
                    style={[a.py_12, a.align_center, { minHeight: 44 }]}
                  >
                    <PantaText style={[a.text_13, t.atoms.text_secondary]}>
                      {remaining > 0 ? `Resend code in ${remaining}s` : 'Resend code'}
                    </PantaText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={waiting}
                    onPress={() => {
                      setSentTo(null);
                      setCode('');
                      setError(null);
                    }}
                    style={[a.py_12, a.align_center, { minHeight: 44 }]}
                  >
                    <PantaText style={[a.text_13, t.atoms.text_secondary]}>Use a different email</PantaText>
                  </Pressable>
                </>
              ) : (
                <>
                  <TextInput
                    accessibilityLabel="Email address"
                    placeholder="you@example.com"
                    placeholderTextColor={panta.secondary}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!busy}
                    maxLength={254}
                    returnKeyType="go"
                    onSubmitEditing={send}
                    style={inputStyle}
                  />
                  <PantaButton label={busy ?? 'Continue with email'} disabled={waiting || !email.trim()} onPress={send} />
                  <PantaText style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
                    We’ll send a one-time code. Authentication and wallet services are provided by Privy.
                  </PantaText>
                </>
              )}
            </View>
          )}
          {account.ready && account.authenticated && (
            <View style={[a.gap_20]}>
              <View style={[a.p_20, a.gap_12, a.border, a.rounded_16, t.atoms.border_secondary, t.atoms.bg_elevated]}>
                <PantaText style={[a.text_17, a.font_semibold]}>Solana wallet</PantaText>
                {account.address ? (
                  <PantaText
                    selectable
                    accessibilityLabel={`Wallet address ${account.address}`}
                    style={[a.text_13, a.leading_150, t.atoms.text_secondary]}
                  >
                    {account.address}
                  </PantaText>
                ) : (
                  <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
                    {account.canCreateWallet
                      ? 'Create your wallet when you’re ready. No funds are required.'
                      : account.walletStatus === 'needs-recovery'
                        ? 'This wallet needs recovery. Recovery setup must be verified before this device can access it.'
                        : 'Your wallet isn’t available yet. Refresh your account to check its status.'}
                  </PantaText>
                )}
                {account.canCreateWallet && (
                  <PantaButton
                    label={busy ?? 'Create Solana wallet'}
                    disabled={waiting}
                    onPress={() => {
                      void run(
                        'Creating wallet…',
                        account.createWallet,
                        'Wallet creation couldn’t be confirmed. Refresh your account before trying anything else.'
                      );
                    }}
                  />
                )}
                {!account.address && !account.canCreateWallet && (
                  <PantaButton
                    variant="secondary"
                    label={busy ?? 'Refresh account'}
                    disabled={waiting}
                    onPress={() => {
                      void run('Refreshing…', account.refresh, 'Your account couldn’t be refreshed. Check your connection and try again.');
                    }}
                  />
                )}
              </View>
              <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
                Trading and funding are unavailable in this development build. Keep this wallet unfunded while recovery and transaction
                checks are completed.
              </PantaText>
              <View style={[a.pt_20, a.gap_12, a.border_t, t.atoms.border_secondary]}>
                <PantaText style={[a.text_13, t.atoms.text_secondary]}>Account session</PantaText>
                <PantaButton
                  variant="destructive"
                  label={busy === 'Signing out…' ? busy : 'Sign out'}
                  disabled={waiting}
                  onPress={() => {
                    void run('Signing out…', account.logout, 'Sign-out couldn’t be confirmed. Please try again.');
                  }}
                />
              </View>
            </View>
          )}
        </View>
        <Attribution />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
