import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { useIdentityToken, usePrivy } from '@privy-io/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';
import { pantaGatewayUrl } from '@/lib/panta-api';
import { type CatalogMarket } from '@/lib/panta-catalog';
import { type P2PIntent, type P2POrder } from '@/lib/panta-p2p';
import { createP2PClient } from '@/lib/panta-p2p-client';

import { P2POrderForm } from './p2p-order-form';
import { createP2POrderStore } from './p2p-order-store';
import { P2PFact as Fact, P2PReviewPanel } from './p2p-review-panel';
import { PantaButton, PantaIcon, PantaText } from './panta-ui';
import { PurchaseReceiptPanel } from './purchase-review-panel';
import { TradingAccountPanel } from './trading-account-panel';
import { usePantaAccount } from './use-panta-account';
import { usePrimaryPurchase } from './use-primary-purchase';
import { useTradingAccountVerification } from './use-trading-account-verification';

const client = pantaGatewayUrl ? createP2PClient(pantaGatewayUrl) : null;
export function P2POrderSheet({
  market,
  initialIntent,
  initialSide = 'yes',
  onClose,
}: {
  market: CatalogMarket;
  initialIntent: 'buy' | 'sell';
  initialSide?: 'yes' | 'no';
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const account = usePantaAccount();
  const auth = usePrivy();
  const { getIdentityToken } = useIdentityToken();
  const wallet = account.address ?? '';
  const tradingAccount = useTradingAccountVerification(account.address);
  const store = useMemo(() => createP2POrderStore(client, market.marketId, wallet), [market.marketId, wallet]);
  const state = store.useBuild();
  const bookState = store.useBook();
  const book = bookState.getData();
  const [intent, setIntent] = useState<'buy' | 'sell'>(initialIntent);
  const [side, setSide] = useState<'yes' | 'no'>(initialSide);
  const [price, setPrice] = useState('');
  const [shares, setShares] = useState('');
  const [tab, setTab] = useState<'trade' | 'orders' | 'review'>('trade');
  const scroll = useRef<ScrollView>(null);
  const [now, setNow] = useState(Date.now());
  const purchase = usePrimaryPurchase(state.build, account.address, tradingAccount.status === 'verified', 'p2p');
  const preparing = useRef<string | null>(null);
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
    }
  }, [state.build, purchase]);
  const fresh = !!book && now - book.observedAt >= 0 && now - book.observedAt <= 30000;
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const refresh = setInterval(() => {
      if (AppState.currentState === 'active')
        void store.useBook
          .getState()
          .fetch(undefined, { force: true })
          .catch(() => undefined);
    }, 15000);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
      store.invalidate();
    };
  }, [store]);
  useEffect(() => {
    store.invalidate();
  }, [store, intent, side, price, shares, account.authenticated, account.ready, account.address, auth.user?.id]);
  async function credentials() {
    const expected = auth.user?.id;
    if (!account.address || !account.authenticated || !expected) throw new Error('Reconnect your account before trading.');
    const refreshed = await auth.refreshUser();
    const access = await auth.getAccessToken();
    const identity = await getIdentityToken();
    if (refreshed.user.id !== expected || !access || !identity) throw new Error('Reconnect your account before trading.');
    return { access, identity };
  }
  async function review(action: P2PIntent, order: P2POrder | null = null) {
    Keyboard.dismiss();
    await store.build(
      {
        wallet,
        marketId: market.marketId,
        intent: action,
        side: order?.side ?? side,
        price: action === 'buy' || action === 'sell' ? price : '0',
        shares: action === 'buy' || action === 'sell' ? shares : '0',
        order: order?.address ?? null,
      },
      credentials
    );
    if (store.useBuild.getState().build) {
      setTab('review');
      scroll.current?.scrollTo({ y: 0, animated: false });
    }
  }
  const own = book?.orders.filter(order => order.owner === wallet) ?? [];
  const offers =
    book?.orders
      .filter(order => order.side === side && order.intent !== intent && order.owner !== wallet)
      .sort((left, right) => (intent === 'buy' ? Number(left.price) - Number(right.price) : Number(right.price) - Number(left.price))) ??
    [];
  const build = state.build;
  const busy = state.busy || purchase.busy;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[a.flex_1, t.atoms.bg, { paddingTop: Platform.OS === 'android' ? insets.top : 0 }]}
    >
      <View style={[a.flex_row, a.align_center, a.justify_between, a.gap_12, a.px_20, a.py_12, a.border_b, t.atoms.border_secondary]}>
        <View style={[a.flex_1, a.gap_8]}>
          <PantaText style={[a.text_22, a.font_bold]}>
            {purchase.receipt ? 'Order status' : tab === 'review' ? 'Review order' : 'Trade shares'}
          </PantaText>
          <PantaText style={[a.text_11, { color: panta.accent }]}>P2P · limit orders · Solana mainnet</PantaText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close P2P trading"
          disabled={purchase.busy}
          onPress={onClose}
          style={[a.align_center, a.justify_center, { width: 44, height: 44 }]}
        >
          <PantaIcon name="close" color={panta.secondary} />
        </Pressable>
      </View>
      <ScrollView
        ref={scroll}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[a.p_20, a.gap_20, { paddingBottom: Math.max(insets.bottom, 20) }]}
      >
        <PantaText style={[a.text_17, a.font_semibold, a.leading_135]}>{market.title}</PantaText>
        {!purchase.receipt && (
          <TradingAccountPanel
            canVerify={tradingAccount.canVerify}
            status={tradingAccount.status}
            error={tradingAccount.error}
            onVerify={() => {
              void tradingAccount.verify();
            }}
          />
        )}
        {!purchase.receipt && tab !== 'review' && (
          <View accessibilityRole="tablist" style={[a.flex_row, a.gap_8]}>
            {(['trade', 'orders'] as const).map(item => (
              <Pressable
                key={item}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === item }}
                disabled={busy}
                onPress={() => {
                  store.invalidate();
                  setTab(item);
                }}
                style={[
                  a.flex_1,
                  a.align_center,
                  a.py_12,
                  a.rounded_12,
                  tab === item ? { backgroundColor: panta.accentBackground } : t.atoms.bg_elevated,
                  { minHeight: 44 },
                ]}
              >
                <PantaText style={[a.text_15, a.font_semibold, { color: tab === item ? panta.accent : panta.secondary }]}>
                  {item === 'trade' ? 'New order' : `My orders (${own.length})`}
                </PantaText>
              </Pressable>
            ))}
          </View>
        )}
        {bookState.status === 'loading' && !book && (
          <PantaText style={[a.text_13, t.atoms.text_secondary]}>Reading the live order book…</PantaText>
        )}
        {bookState.error && (
          <PantaText accessibilityRole="alert" style={[a.text_13, { color: panta.no }]}>
            The order book couldn’t be verified. Refresh before reviewing an order.
          </PantaText>
        )}
        {!purchase.receipt && tab !== 'review' && (!fresh || bookState.error) && (
          <PantaButton
            label={bookState.status === 'loading' ? 'Refreshing…' : 'Refresh prices'}
            variant="utility"
            disabled={bookState.status === 'loading' || busy}
            onPress={() => {
              void store.useBook
                .getState()
                .fetch(undefined, { force: true })
                .catch(() => undefined);
            }}
          />
        )}
        {book && tab !== 'review' && !purchase.receipt && (
          <PantaText style={[a.text_11, t.atoms.text_secondary]}>
            {fresh
              ? `Chain read ${Math.floor((now - book.observedAt) / 1000)}s ago · buyer fee allowance ${book.feeBps / 100}%`
              : 'Order-book snapshot expired. Refresh to view offers.'}
          </PantaText>
        )}
        {tab === 'review' && !purchase.receipt && (
          <PantaButton
            label="Back to order"
            variant="utility"
            disabled={busy}
            onPress={() => {
              const previous = build?.p2p.request.intent;
              store.invalidate();
              setTab(previous === 'cancel' || previous === 'withdraw' ? 'orders' : 'trade');
            }}
          />
        )}
        {tab === 'trade' && !purchase.receipt ? (
          <>
            <P2POrderForm
              intent={intent}
              side={side}
              price={price}
              shares={shares}
              busy={busy}
              fresh={fresh}
              availableShares={(side === 'yes' ? book?.yesShares : book?.noShares) ?? '0'}
              offers={offers}
              setIntent={value => {
                store.invalidate();
                setIntent(value);
              }}
              setSide={value => {
                store.invalidate();
                setSide(value);
              }}
              setPrice={value => {
                store.invalidate();
                setPrice(value);
              }}
              setShares={value => {
                store.invalidate();
                setShares(value);
              }}
            />

            {fresh && !book?.tradingOpen && (
              <PantaText style={[a.text_13, t.atoms.text_secondary]}>
                Trading is closed. You can still review existing orders and available cash.
              </PantaText>
            )}
          </>
        ) : tab === 'orders' && !purchase.receipt ? (
          <View style={[a.gap_16]}>
            {!fresh ? (
              <PantaText style={[a.text_13, t.atoms.text_secondary]}>Refresh to see current orders and available cash.</PantaText>
            ) : (
              <>
                {own.length === 0 && <PantaText style={[a.text_15, t.atoms.text_secondary]}>No open orders in this market.</PantaText>}
                {own.map(order => (
                  <View key={order.address} style={[a.p_20, a.gap_12, a.rounded_16, t.atoms.bg_elevated]}>
                    <PantaText style={[a.text_17, a.font_semibold]}>
                      {order.intent === 'buy' ? 'Buy' : 'Sell'} {order.side.toUpperCase()}
                    </PantaText>
                    <Fact label="Remaining shares" value={order.shares} />
                    <Fact label="Limit price" value={`${order.price} USDC`} />
                    <PantaButton
                      label="Review cancellation"
                      variant="secondary"
                      disabled={busy || tradingAccount.status !== 'verified' || !!purchase.receipt}
                      onPress={() => {
                        void review('cancel', order);
                      }}
                    />
                  </View>
                ))}
                <View style={[a.p_20, a.gap_16, a.rounded_16, t.atoms.bg_elevated]}>
                  <Fact label="Available market cash" value={`${book?.availableCash ?? '0'} USDC`} />
                  <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
                    This is money held in this market, separate from your wallet balance.
                  </PantaText>
                  <PantaButton
                    label="Review withdrawal"
                    variant="secondary"
                    disabled={busy || book?.availableCash === '0' || tradingAccount.status !== 'verified' || !!purchase.receipt}
                    onPress={() => {
                      void review('withdraw');
                    }}
                  />
                </View>
              </>
            )}
          </View>
        ) : null}
        {(state.error || purchase.error) && (
          <PantaText accessibilityRole="alert" style={[a.text_13, a.leading_150, { color: panta.no }]}>
            {state.error ?? purchase.error}
          </PantaText>
        )}
        {build && !purchase.receipt && (
          <P2PReviewPanel
            build={build}
            now={now}
            prepared={purchase.prepared}
            busy={busy}
            canPrepare={purchase.canPrepare}
            prepareError={purchase.phase === 'error'}
            onPrepare={() => {
              void purchase.prepare();
            }}
            onApprove={() => {
              void purchase.approve(true);
            }}
          />
        )}
        {purchase.receipt && (
          <>
            <PurchaseReceiptPanel
              receipt={purchase.receipt}
              checking={purchase.busy}
              transactionLabel="Transaction"
              onCheck={() => {
                void purchase.checkStatus();
              }}
              onDismiss={() => {
                void purchase.dismissResolved().then(() => {
                  store.invalidate();
                  setTab('orders');
                  scroll.current?.scrollTo({ y: 0, animated: false });
                  void store.useBook
                    .getState()
                    .fetch(undefined, { force: true })
                    .catch(() => undefined);
                });
              }}
            />
            <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
              Chain confirmation confirms the transaction. Check My orders and refreshed holdings to see whether shares filled or remain
              open.
            </PantaText>
          </>
        )}
      </ScrollView>
      {tab === 'trade' && !purchase.receipt && (
        <View style={[a.px_20, a.pt_12, a.border_t, t.atoms.border_secondary, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <PantaButton
            maxFontSizeMultiplier={2}
            label={busy ? 'Preparing order…' : 'Review order'}
            disabled={
              busy ||
              tradingAccount.status !== 'verified' ||
              !client ||
              !price ||
              !shares ||
              !fresh ||
              !book?.tradingOpen ||
              !!purchase.receipt
            }
            onPress={() => {
              void review(intent);
            }}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
