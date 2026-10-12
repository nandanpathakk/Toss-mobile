import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';
import { pantaGatewayUrl } from '@/lib/panta-api';
import { type CatalogMarket } from '@/lib/panta-catalog';
import { createOrderClient } from '@/lib/panta-order-client';
import { normalizeUsdc, OrderError, type OrderRequest } from '@/lib/panta-orders';

import { createOrderStore } from './order-store';
import { selectOrderWallet } from './order-wallet';
import { PantaBadge, PantaButton, pantaFont, PantaIcon, PantaText } from './panta-ui';
import { PurchaseReceiptPanel, PurchaseReviewPanel } from './purchase-review-panel';
import { TradeOutcomeSelector } from './trade-outcome-selector';
import { TradingAccountPanel } from './trading-account-panel';
import { usePantaAccount } from './use-panta-account';
import { usePrimaryPurchase } from './use-primary-purchase';
import { useTradingAccountVerification } from './use-trading-account-verification';
import { walletAppUrl } from './wallet-config';
import { useWalletStore, walletConnector, walletErrorText } from './wallet-store';

const client = pantaGatewayUrl ? createOrderClient(pantaGatewayUrl) : null;
export function OrderSheet({
  market,
  initialSide,
  onClose,
}: {
  market: CatalogMarket;
  initialSide: OrderRequest['side'];
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const externalWallet = useWalletStore();
  const account = usePantaAccount();
  const wallet = selectOrderWallet(account, externalWallet);
  const tradingAccount = useTradingAccountVerification(wallet.source === 'privy' ? wallet.address : null);
  const [side, setSide] = useState(initialSide);
  const [amount, setAmount] = useState('');
  const [now, setNow] = useState(Date.now());
  const order = useMemo(
    () =>
      createOrderStore(
        (request, signal) => {
          if (!client) return Promise.reject(new OrderError('UNAVAILABLE'));
          return client.quote(request, signal);
        },
        (request, quote, signal) => {
          if (!client) return Promise.reject(new OrderError('UNAVAILABLE'));
          return client.build(request, quote, signal);
        },
        (build, signal) => {
          if (!client) return Promise.reject(new OrderError('UNAVAILABLE'));
          return client.preflight(build, signal);
        }
      ),
    [wallet.address, wallet.source, wallet.status]
  );
  const state = order.useStore();
  const scroll = useRef<ScrollView>(null);
  const preparing = useRef<string | null>(null);
  const purchase = usePrimaryPurchase(state.build, wallet.source === 'privy' ? wallet.address : null, tradingAccount.status === 'verified');
  useEffect(() => {
    if (
      state.build &&
      purchase.canPrepare &&
      !purchase.prepared &&
      !purchase.receipt &&
      !purchase.busy &&
      preparing.current !== state.build.orderId
    ) {
      preparing.current = state.build.orderId;
      void purchase.prepare();
      scroll.current?.scrollTo({ y: 0, animated: false });
    }
  }, [state.build, purchase]);
  useEffect(() => {
    order.invalidate();
    return () => order.invalidate();
  }, [order, wallet.address, wallet.status, wallet.source, market.marketId, market.phase]);
  useEffect(() => {
    if (!state.quote && state.retryAt <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.quote, state.retryAt]);
  let canonical: string | null = null;
  try {
    canonical = normalizeUsdc(amount);
  } catch {
    /* Incomplete input is normal while typing. */
  }
  const quote =
    state.quote &&
    state.quote.wallet === wallet.address &&
    state.quote.side === side &&
    state.quote.amountUsdc === canonical &&
    market.phase === 'primary' &&
    wallet.status === 'connected'
      ? state.quote
      : null;
  const seconds = quote ? Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - now) / 1000)) : 0;
  const waiting = Math.max(0, Math.ceil((state.retryAt - now) / 1000));
  const connected = wallet.status === 'connected' && !!wallet.address;
  const busy = purchase.busy || state.status === 'loading' || state.status === 'building' || state.status === 'simulating';
  const walletBusy = ['opening', 'waiting', 'disconnecting'].includes(externalWallet.status);
  function editAmount(value: string) {
    if (purchase.busy || purchase.receipt) return;
    order.invalidate();
    setAmount(value);
  }
  function editSide(value: OrderRequest['side']) {
    if (purchase.busy || purchase.receipt) return;
    order.invalidate();
    setSide(value);
  }
  async function review() {
    if (!canonical || !wallet.address || !connected || market.phase !== 'primary') return;
    setNow(Date.now());
    Keyboard.dismiss();
    await order.review({ marketId: market.marketId, wallet: wallet.address, side, amountUsdc: canonical }, 100);
  }
  return (
    <KeyboardAvoidingView
      style={[a.flex_1, t.atoms.bg, { paddingTop: Platform.OS === 'android' ? insets.top : 0, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[a.flex_row, a.align_center, a.justify_between, a.px_20, a.py_8, a.border_b, t.atoms.border_secondary]}>
        <PantaText style={[a.text_17, a.font_semibold]}>{purchase.receipt ? 'Purchase status' : 'Buy shares'}</PantaText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close order"
          onPress={onClose}
          disabled={purchase.busy}
          style={[a.align_center, a.justify_center, { width: 44, height: 44 }]}
        >
          <PantaIcon name="close" color={panta.secondary} />
        </Pressable>
      </View>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={[a.p_20, a.gap_20, a.pb_32]}>
        {!purchase.receipt && !state.build && (
          <>
            <PantaBadge label="Primary market" />
            <PantaText style={[a.text_22, a.font_bold, a.leading_135]}>{market.title}</PantaText>
            <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
              Fresh prices and fees are checked before you confirm.
            </PantaText>
            <TradeOutcomeSelector side={side} disabled={busy} onChange={editSide} />
            <View style={[a.p_20, a.gap_12, a.rounded_16, a.border, t.atoms.border_secondary]}>
              <PantaText style={[a.text_13, t.atoms.text_secondary]}>Amount · USDC</PantaText>
              <TextInput
                accessibilityLabel="USDC amount"
                editable={!purchase.busy && !purchase.receipt}
                value={amount}
                onChangeText={editAmount}
                placeholder="0.00"
                placeholderTextColor={panta.secondary}
                keyboardType="decimal-pad"
                maxLength={22}
                autoCorrect={false}
                style={[pantaFont, a.text_26, a.font_bold, a.p_0, { color: panta.text, minHeight: 48 }]}
              />
              <View style={[a.flex_row, a.gap_8]}>
                {['5', '10', '25', '50'].map(value => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityLabel={`Set amount to ${value} USDC`}
                    disabled={purchase.busy || !!purchase.receipt}
                    onPress={() => editAmount(value)}
                    style={[a.flex_1, a.align_center, a.py_12, a.rounded_8, t.atoms.bg_secondary]}
                  >
                    <PantaText style={[a.text_13, a.font_semibold]}>${value}</PantaText>
                  </Pressable>
                ))}
              </View>
            </View>
            {amount !== '' && !canonical && (
              <PantaText style={[a.text_13, a.leading_150, { color: panta.no }]}>
                Enter a positive amount using up to six decimal places.
              </PantaText>
            )}
            {market.phase !== 'primary' && (
              <PantaText style={[a.text_13, a.leading_150]}>This market no longer accepts primary buys.</PantaText>
            )}
          </>
        )}
        {!purchase.receipt && wallet.source === 'privy' && (
          <TradingAccountPanel
            canVerify={tradingAccount.canVerify}
            status={tradingAccount.status}
            error={tradingAccount.error}
            onVerify={() => void tradingAccount.verify()}
          />
        )}
        {!purchase.receipt && (!client || (connected && wallet.source !== 'privy')) && (
          <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
            {!client ? 'Trading isn’t available in this build.' : 'Use an Account wallet to buy.'}
          </PantaText>
        )}
        {!purchase.receipt && !purchase.prepared && quote && seconds === 0 && (
          <PantaText accessibilityRole="alert" style={[a.text_13, a.leading_150, { color: panta.no }]}>
            Quote expired. Get a new quote for current estimates and fees.
          </PantaText>
        )}
        {state.status === 'building' && <PantaText style={[a.text_13, t.atoms.text_secondary]}>Preparing your transaction…</PantaText>}
        {!purchase.receipt && !purchase.prepared && state.build && quote && purchase.canPrepare && purchase.phase === 'error' && (
          <PantaButton
            label="Retry cost check"
            disabled={busy || Date.parse(state.build.expiresAt) <= now}
            onPress={() => {
              void purchase.prepare();
            }}
          />
        )}
        {purchase.phase === 'preparing' && <PantaText style={[a.text_13, a.leading_150]}>Checking final costs…</PantaText>}
        {purchase.phase === 'signing' && <PantaText style={[a.text_13, a.leading_150]}>Signing purchase…</PantaText>}
        {purchase.phase === 'sending' && <PantaText style={[a.text_13, a.leading_150]}>Sending purchase…</PantaText>}
        {state.build && !purchase.receipt && !purchase.busy && (
          <PantaButton label="Edit order" variant="utility" onPress={() => order.invalidate()} />
        )}
        {!purchase.receipt && (state.build?.disclaimer ?? quote?.disclaimer ?? market.disclaimer) && (
          <PantaText style={[a.text_11, a.leading_150, { color: panta.accent }]}>
            {state.build?.disclaimer ?? quote?.disclaimer ?? market.disclaimer}
          </PantaText>
        )}
        {purchase.prepared && state.build && quote && (
          <PurchaseReviewPanel
            marketTitle={market.title}
            prepared={purchase.prepared}
            build={state.build}
            now={now}
            busy={purchase.busy}
            onApprove={accepted => {
              void purchase.approve(accepted);
            }}
          />
        )}
        {purchase.receipt && (
          <PurchaseReceiptPanel
            receipt={purchase.receipt}
            checking={purchase.busy}
            onCheck={() => {
              void purchase.checkStatus();
            }}
            onDismiss={() => {
              void purchase.dismissResolved().then(() => order.invalidate());
            }}
          />
        )}
        {purchase.error && (
          <PantaText accessibilityRole="alert" style={[a.text_13, a.leading_150]}>
            {purchase.error}
          </PantaText>
        )}

        {!purchase.receipt && state.error && (
          <PantaText accessibilityRole="alert" style={[a.text_13, a.leading_150, { color: panta.no }]}>
            {state.error.message}
          </PantaText>
        )}
        {connected && !purchase.prepared && !purchase.receipt && !state.build ? (
          <>
            <PantaText style={[a.text_11, t.atoms.text_secondary]}>
              {wallet.source === 'privy' ? 'Account wallet' : 'Phantom wallet'} {wallet.address?.slice(0, 6)}…{wallet.address?.slice(-6)}
            </PantaText>
          </>
        ) : !connected ? (
          <>
            <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
              {wallet.status === 'initializing'
                ? 'Your account is connecting. Please wait before reviewing an order.'
                : wallet.status === 'unavailable'
                  ? 'Your account wallet is unavailable. Close this sheet and open Account to refresh or recover it.'
                  : 'Sign in and create your Solana wallet in Account, then return to review your order.'}
            </PantaText>
            {!account.authenticated && externalWallet.error && (
              <PantaText style={[a.text_13, a.leading_150, { color: panta.no }]}>{walletErrorText[externalWallet.error]}</PantaText>
            )}
            {walletAppUrl && account.ready && !account.authenticated && (
              <PantaButton
                label={walletBusy ? 'Waiting for wallet…' : 'Connect Phantom'}
                disabled={!walletAppUrl || walletBusy}
                onPress={() => {
                  void walletConnector.connect();
                }}
              />
            )}
          </>
        ) : null}
      </ScrollView>
      {connected && !state.build && !purchase.receipt && (
        <View style={[a.px_20, a.py_12, a.border_t, t.atoms.border_secondary]}>
          <PantaButton
            maxFontSizeMultiplier={2}
            label={
              state.status === 'building'
                ? 'Preparing transaction…'
                : busy
                  ? 'Getting quote…'
                  : waiting
                    ? `Try again in ${waiting}s`
                    : 'Review order'
            }
            disabled={
              !canonical || busy || !!purchase.receipt || waiting > 0 || market.phase !== 'primary' || tradingAccount.status !== 'verified'
            }
            onPress={() => void review()}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
