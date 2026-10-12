import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { createQueryStore } from '@storesjs/stores';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';
import { pantaGatewayUrl } from '@/lib/panta-api';
import { type CatalogMarket } from '@/lib/panta-catalog';
import { createPortfolioClient, isWalletAddress } from '@/lib/panta-portfolio';

import { CatalogFailure, CatalogLoading } from './catalog-feedback';
import { catalogFilters, createMarketDetailStore } from './catalog-store';
import { DetailDisclosure, DetailSurface } from './detail-ui';
import { PantaBadge, PantaButton, pantaFont, PantaText } from './panta-ui';
import { TradeActivityRow } from './trade-activity-row';
import { usePantaAccount } from './use-panta-account';
import { WalletBalancesPanel } from './wallet-balances-panel';

const client = pantaGatewayUrl ? createPortfolioClient(pantaGatewayUrl) : null;
function PositionMarket({
  marketId,
  side,
  shares,
  status,
  onMarketPress,
}: {
  marketId: string;
  side: 'yes' | 'no';
  shares: string;
  status: string;
  onMarketPress: (market: CatalogMarket) => void;
}) {
  const t = useTheme();
  const useDetail = useMemo(() => createMarketDetailStore(marketId), [marketId]);
  const state = useDetail();
  const market = state.getData();
  return (
    <Pressable
      disabled={!market}
      accessibilityRole="button"
      accessibilityLabel={market?.title ?? 'Loading market'}
      onPress={() => {
        if (market) onMarketPress(market);
      }}
      style={[a.p_20, a.gap_12, a.rounded_16, t.atoms.bg_elevated]}
    >
      <PantaText allowFontScaling style={[a.text_15, a.font_semibold, a.leading_150]}>
        {market?.title ?? `${marketId.slice(0, 6)}…${marketId.slice(-4)}`}
      </PantaText>
      <View style={[a.gap_8]}>
        <PantaText allowFontScaling style={[a.text_13, a.font_bold, { color: side === 'yes' ? panta.yes : panta.no }]}>
          {side.toUpperCase()} · {shares} shares
        </PantaText>
        <PantaText allowFontScaling style={[a.text_11, t.atoms.text_secondary]}>
          {status}
        </PantaText>
      </View>
      {state.error && (
        <CatalogFailure
          error={state.error}
          onRetry={() => {
            void state.fetch(undefined, { force: true });
          }}
        />
      )}
    </Pressable>
  );
}
function WalletHoldings({ wallet, onMarketPress }: { wallet: string; onMarketPress: (market: CatalogMarket) => void }) {
  const t = useTheme();
  const [tab, setTab] = useState<'Positions' | 'Activity'>('Positions');
  const [visiblePositions, setVisiblePositions] = useState(10);
  const stores = useMemo(
    () => ({
      positions: createQueryStore({
        fetcher: (_, abort) => client!.positions(wallet, abort?.signal),
        enabled: $ => $(catalogFilters).foreground && !!client,
        staleTime: 30000,
        retry: false,
        disableAutoRefetching: true,
      }),
      balances: createQueryStore({
        fetcher: (_, abort) => client!.balances(wallet, abort?.signal),
        enabled: $ => $(catalogFilters).foreground && !!client,
        staleTime: 30000,
        retry: false,
        disableAutoRefetching: true,
      }),
      activity: createQueryStore({
        fetcher: (_, abort) => client!.activity(wallet, abort?.signal),
        enabled: $ => $(catalogFilters).foreground && !!client,
        staleTime: 30000,
        retry: false,
        disableAutoRefetching: true,
      }),
    }),
    [wallet]
  );
  const positions = stores.positions();
  const activity = stores.activity();
  const balances = stores.balances();
  const state = tab === 'Positions' ? positions : activity;
  const refresh = () => {
    void balances.fetch(undefined, { force: true });
    void positions.fetch(undefined, { force: true });
    void activity.fetch(undefined, { force: true });
  };
  return (
    <View style={[a.gap_20]}>
      <PantaText allowFontScaling selectable style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
        {wallet}
      </PantaText>
      <WalletBalancesPanel
        data={balances.getData()}
        loading={balances.status === 'loading'}
        error={balances.error}
        onRetry={() => {
          void balances.fetch(undefined, { force: true });
        }}
      />
      <View accessibilityRole="tablist" style={[a.flex_row, a.gap_8]}>
        {(['Positions', 'Activity'] as const).map(value => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            onPress={() => setTab(value)}
            style={[
              a.flex_1,
              a.align_center,
              a.py_16,
              a.rounded_12,
              { backgroundColor: tab === value ? panta.elevated : panta.background },
            ]}
          >
            <PantaText allowFontScaling style={[a.text_13, a.font_medium]}>
              {value}
            </PantaText>
          </Pressable>
        ))}
      </View>
      {state.error && (
        <CatalogFailure title={`Couldn’t update ${tab.toLowerCase()}`} error={state.error} onRetry={refresh} stale={!!state.getData()} />
      )}
      {state.status === 'loading' && !state.getData() && <CatalogLoading label={`Loading ${tab.toLowerCase()}`} />}
      {tab === 'Positions' &&
        positions
          .getData()
          ?.positions.slice(0, visiblePositions)
          .map(position => (
            <PositionMarket
              key={`${position.marketId}:${position.side}`}
              marketId={position.marketId}
              side={position.side}
              shares={position.shares}
              status={
                position.claimed
                  ? 'Claimed'
                  : position.claimable
                    ? 'Claim eligible'
                    : position.phase === 'primary' || position.phase === 'secondary'
                      ? 'Open'
                      : position.phase === 'resolved'
                        ? 'Resolved'
                        : 'Cancelled'
              }
              onMarketPress={onMarketPress}
            />
          ))}
      {tab === 'Positions' && (positions.getData()?.positions.length ?? 0) > visiblePositions && (
        <PantaButton variant="secondary" label="Show more positions" onPress={() => setVisiblePositions(value => value + 10)} />
      )}
      {tab === 'Activity' && activity.getData()?.items.map(trade => <TradeActivityRow key={trade.id} trade={trade} />)}
      {((tab === 'Positions' && positions.getData()?.positions.length === 0) ||
        (tab === 'Activity' && activity.getData()?.items.length === 0)) && (
        <View style={[a.p_24, a.gap_12, a.rounded_16, t.atoms.bg_elevated]}>
          <PantaText allowFontScaling style={[a.text_17, a.font_semibold]}>
            No {tab.toLowerCase()} found
          </PantaText>
          <PantaText allowFontScaling style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
            Panta hasn’t reported any for this address. Indexing may lag recent transactions.
          </PantaText>
        </View>
      )}
      {(positions.getData()?.disclaimer ?? activity.getData()?.disclaimer) && (
        <PantaText allowFontScaling style={[a.text_11, t.atoms.text_secondary]}>
          {positions.getData()?.disclaimer ?? activity.getData()?.disclaimer}
        </PantaText>
      )}
      <PantaButton
        variant="utility"
        label="Refresh wallet data"
        onPress={refresh}
        disabled={positions.status === 'loading' || activity.status === 'loading' || balances.status === 'loading'}
      />
      <PantaText allowFontScaling style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
        Panta holdings are separate from your available wallet balance. Positions are capped at 200; activity shows up to 50 recent trades.
        Buying and claims are currently unavailable.
      </PantaText>
    </View>
  );
}
export function PortfolioScreen({
  onMarketPress,
  onOpenAccount,
}: {
  onMarketPress: (market: CatalogMarket) => void;
  onOpenAccount: () => void;
}) {
  const t = useTheme();
  const account = usePantaAccount();
  const [lookup, setLookup] = useState(false);
  const [input, setInput] = useState('');
  const [publicWallet, setPublicWallet] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const owned = account.ready && account.authenticated && account.address && isWalletAddress(account.address) ? account.address : null;
  const wallet = lookup ? publicWallet : owned;
  function view() {
    const address = input.trim();
    if (!isWalletAddress(address)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setPublicWallet(address);
  }
  return (
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[a.p_20, a.gap_24, a.pb_32]}>
      <View style={[a.gap_12]}>
        <PantaText allowFontScaling accessibilityRole="header" style={[a.text_30, a.font_bold]}>
          Portfolio
        </PantaText>
        <View style={[a.self_start]}>
          <PantaBadge label="Solana mainnet" />
        </View>
      </View>
      {lookup && publicWallet ? (
        <View style={[a.gap_8]}>
          <PantaText allowFontScaling style={[a.text_17, a.font_semibold]}>
            Public wallet · read only
          </PantaText>
          <Pressable accessibilityRole="button" onPress={() => setPublicWallet(null)} style={[a.py_12, { minHeight: 44 }]}>
            <PantaText allowFontScaling style={[a.text_13, t.atoms.text_secondary]}>
              Change address
            </PantaText>
          </Pressable>
        </View>
      ) : lookup ? (
        <View style={[a.p_20, a.gap_16, a.rounded_16, t.atoms.bg_elevated]}>
          <PantaText allowFontScaling style={[a.text_20, a.font_semibold]}>
            Public wallet lookup
          </PantaText>
          <PantaText allowFontScaling style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
            View a public wallet’s balances, Panta positions and recent trades. This does not connect that wallet.
          </PantaText>
          <TextInput
            accessibilityLabel="Public wallet address"
            placeholder="Solana public address"
            placeholderTextColor={panta.secondary}
            value={input}
            onChangeText={value => {
              setInput(value);
              setInvalid(false);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={44}
            returnKeyType="search"
            onSubmitEditing={view}
            style={[pantaFont, a.text_13, a.p_12, a.rounded_12, a.border, t.atoms.border_secondary, { color: panta.text, minHeight: 48 }]}
          />
          {invalid && (
            <PantaText allowFontScaling accessibilityRole="alert" style={[a.text_11, { color: panta.no }]}>
              Enter a valid Solana public address.
            </PantaText>
          )}
          <PantaButton label="View wallet" onPress={view} disabled={!input.trim()} />
          <Pressable accessibilityRole="button" onPress={() => setLookup(false)} style={[a.py_12, { minHeight: 44 }]}>
            <PantaText allowFontScaling style={[a.text_13, a.font_medium]}>
              {owned ? 'Back to my wallet' : 'Back to portfolio'}
            </PantaText>
          </Pressable>
        </View>
      ) : !account.ready ? (
        account.failed ? (
          <CatalogFailure
            title="Account couldn’t load"
            description="Open Account to reconnect your wallet."
            error={new Error('Account unavailable')}
            onRetry={onOpenAccount}
          />
        ) : (
          <CatalogLoading label="Connecting your account" />
        )
      ) : !owned ? (
        <View style={[a.p_24, a.gap_16, a.rounded_16, t.atoms.bg_elevated]}>
          <PantaText allowFontScaling style={[a.text_22, a.font_semibold]}>
            {account.authenticated ? 'Your wallet is not ready' : 'Your portfolio starts here'}
          </PantaText>
          <PantaText allowFontScaling style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
            {account.authenticated
              ? 'Open Account to create, refresh or recover your Solana wallet.'
              : 'Sign in to see your wallet balances, positions and activity together.'}
          </PantaText>
          <PantaButton label="Open Account" onPress={onOpenAccount} />
        </View>
      ) : (
        <PantaText allowFontScaling style={[a.text_17, a.font_semibold]}>
          My wallet
        </PantaText>
      )}
      {wallet && <WalletHoldings key={`${lookup ? 'public' : 'owned'}:${wallet}`} wallet={wallet} onMarketPress={onMarketPress} />}
      {lookup && publicWallet && (
        <PantaButton variant="utility" label={owned ? 'Back to my wallet' : 'Back to portfolio'} onPress={() => setLookup(false)} />
      )}
      {!lookup && (
        <DetailSurface>
          <DetailDisclosure
            icon="search"
            title="View another wallet"
            subtitle="Look up public balances and Panta activity"
            onPress={() => setLookup(true)}
            last
          />
        </DetailSurface>
      )}
    </ScrollView>
  );
}
