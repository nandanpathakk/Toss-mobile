import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  useWindowDimensions,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta, pantaLayout } from '@/design/tokens';
import { mergeMarketSnapshot, type CatalogMarket, type CatalogTrade } from '@/lib/panta-catalog';

import { CatalogArtwork, categoryLabel } from './catalog-card';
import { CatalogFailure } from './catalog-feedback';
import { createMarketDetailStore, prioritizeMarketDetail, refreshMarketPrices } from './catalog-store';
import { DetailDisclosure, DetailField, DetailHeading, DetailIconButton, DetailSheet, DetailSurface } from './detail-ui';
import { MarketActivity, marketDate } from './market-activity';
import { currentMarketPrices, marketPriceStatus } from './market-price-status';
import { OrderSheet } from './order-sheet';
import { P2POrderSheet } from './p2p-order-sheet';
import { PantaBadge, PantaButton, PantaIcon, PantaText } from './panta-ui';
import { TossBrand } from './toss-brand';
import { TradeDetailContent } from './trade-activity-row';
import { tradingEntry, type TradingIntent } from './trading-entry';
import { TradingEntryPrompt } from './trading-entry-prompt';
import { useMarketPriceClock } from './use-market-price-clock';
import { usePantaAccount } from './use-panta-account';

type Section = 'resolution' | 'activity' | 'information';

function OutcomePrice({ side, price }: { side: 'YES' | 'NO'; price: number | null }) {
  const t = useTheme();
  const color = side === 'YES' ? panta.yes : panta.no;
  return (
    <View
      style={[
        a.flex_1,
        a.p_20,
        a.gap_16,
        { borderRadius: pantaLayout.cardRadius, backgroundColor: side === 'YES' ? panta.yesBackground : panta.noBackground },
      ]}
    >
      <View style={[a.flex_row, a.align_center, a.gap_8]}>
        <View style={[a.rounded_full, { width: 6, height: 6, backgroundColor: color }]} />
        <PantaText allowFontScaling style={[a.text_13, a.font_semibold, { color }]}>
          {side}
        </PantaText>
      </View>
      <PantaText allowFontScaling tabular style={[a.text_26, a.font_bold, { color, letterSpacing: -1 }]}>
        {price === null ? '—' : price.toFixed(4)}
      </PantaText>
      <PantaText allowFontScaling tabular style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
        {price === null ? 'Price unavailable' : 'USDC / share'}
      </PantaText>
    </View>
  );
}

export function MarketDetailScreen({
  market: initial,
  onClose,
  onOpenAccount,
}: {
  market: CatalogMarket;
  onClose: () => void;
  onOpenAccount: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const account = usePantaAccount();
  const [tradeIntent, setTradeIntent] = useState<TradingIntent | null>(null);
  const { width, fontScale } = useWindowDimensions();
  const [section, setSection] = useState<Section | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<CatalogTrade | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [p2pIntent, setP2PIntent] = useState<'buy' | 'sell' | null>(null);
  const [p2pSide, setP2PSide] = useState<'yes' | 'no'>('yes');
  const [orderSide, setOrderSide] = useState<'yes' | 'no' | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [openedAt] = useState(Date.now);
  const useDetailStore = useMemo(() => createMarketDetailStore(initial.marketId), [initial.marketId]);
  const state = useDetailStore();
  useEffect(() => {
    prioritizeMarketDetail(initial.marketId);
    const cached = useDetailStore.getState();
    if (cached.getData() && cached.getData()!.phase !== initial.phase) void cached.fetch(undefined, { force: true });
    return () => prioritizeMarketDetail(null);
  }, [initial.marketId, initial.phase, useDetailStore]);
  const fetched = state.getData();
  const detail = fetched && (fetched.phase === initial.phase || (state.lastFetchedAt ?? 0) >= openedAt) ? fetched : null;
  // Reduced detail responses must not erase usable same-phase list data.
  const snapshot = detail
    ? detail.phase === initial.phase && (initial.priceObservedAt ?? 0) > (detail.priceObservedAt ?? 0)
      ? mergeMarketSnapshot(detail, initial)
      : mergeMarketSnapshot(initial, detail)
    : initial;
  const priceNow = useMarketPriceClock(snapshot.priceObservedAt, snapshot.endTime);
  const priceStatus = marketPriceStatus(snapshot, priceNow);
  const market = currentMarketPrices(snapshot, priceNow);
  useEffect(() => {
    const refresh = () => refreshMarketPrices(useDetailStore.getState().getData() ?? initial);
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [initial, useDetailStore]);
  const entry = tradingEntry(market.phase, account, market.endTime, priceNow);
  function startTrade(intent: TradingIntent) {
    if (entry === 'closed') return;
    if (entry === 'primary' && (intent === 'yes' || intent === 'no')) {
      setTradeIntent(null);
      setOrderSide(intent);
    } else if (entry === 'p2p') {
      setTradeIntent(null);
      setP2PSide(intent === 'no' ? 'no' : 'yes');
      setP2PIntent(intent === 'sell' ? 'sell' : 'buy');
    } else setTradeIntent(intent);
  }
  const website = `https://www.panta.market/market/${market.marketId}`;
  const description = market.description || market.resolutionRule;
  const phase = market.phase === 'secondary' ? 'P2P' : categoryLabel(market.phase);
  const open = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Couldn’t open link', 'Please try again.');
    }
  };
  const refresh = async () => {
    if (refreshing) return;
    setRefreshVersion(value => value + 1);
    setRefreshing(true);
    try {
      await state.fetch(undefined, { force: true });
    } finally {
      setRefreshing(false);
    }
  };
  const resolutionSummary = market.outcome
    ? `Resolved ${market.outcome.toUpperCase()}`
    : market.phase === 'cancelled'
      ? 'Market cancelled'
      : 'Rules, sources and expected result';
  const dateShort =
    market.endTime === null
      ? 'End time unavailable'
      : new Date(market.endTime * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return (
    <View style={[a.flex_1, t.atoms.bg]}>
      <View style={[a.flex_row, a.align_center, a.justify_between, a.px_20, a.py_12]}>
        <DetailIconButton icon="back" label="Close market detail" onPress={onClose} />
        <TossBrand />
        <DetailIconButton
          icon="share"
          label="Share market"
          onPress={() => {
            void Share.share({ message: `${market.title}\n${website}`, url: website }).catch(() => undefined);
          }}
        />
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[a.p_20, { gap: pantaLayout.sectionGap }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={panta.text} />}
      >
        <View style={[a.gap_20]}>
          <View style={[a.overflow_hidden, { borderRadius: pantaLayout.cardRadius }]}>
            <CatalogArtwork key={market.images[0] ?? market.marketId} market={market} />
          </View>
          <View style={[a.flex_row, a.align_center, a.justify_between, a.gap_12]}>
            <PantaText allowFontScaling style={[a.flex_1, a.text_13, a.font_medium, t.atoms.text_secondary]}>
              {categoryLabel(market.category)}
            </PantaText>
            <PantaBadge label={phase} accent={market.phase === 'secondary'} />
          </View>
          <PantaText allowFontScaling accessibilityRole="header" style={[a.text_26, a.font_bold, a.leading_135, { letterSpacing: -0.6 }]}>
            {market.title}
          </PantaText>
          <View style={[a.flex_row, a.align_center, a.gap_8, a.flex_wrap]}>
            <PantaIcon name="clock" size={14} color={panta.secondary} />
            <PantaText allowFontScaling style={[a.text_13, t.atoms.text_secondary]}>
              {entry === 'closed' ? 'Event ended' : 'Event ends'} · {dateShort}
            </PantaText>
            {market.marketType === 'breaking' && <PantaBadge label="Breaking" />}
          </View>
        </View>
        {state.error && <CatalogFailure title="Market details couldn’t update" error={state.error} stale onRetry={refresh} />}
        {!state.getData() && !state.error && state.status === 'loading' && (
          <View style={[a.flex_row, a.align_center, a.gap_8]}>
            <ActivityIndicator size="small" color={panta.secondary} />
            <PantaText allowFontScaling style={[a.text_13, t.atoms.text_secondary]}>
              Updating market
            </PantaText>
          </View>
        )}
        <View style={[a.gap_16]}>
          <DetailHeading title="Outcome prices" />
          <View style={[width < 360 || fontScale > 1.3 ? a.flex_col : a.flex_row, a.gap_12]}>
            <OutcomePrice side="YES" price={market.yesPrice} />
            <OutcomePrice side="NO" price={market.noPrice} />
          </View>
          <PantaText allowFontScaling style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
            {entry === 'closed' ? (
              'Trading has ended. Open Resolution for the criteria and reported result.'
            ) : (
              <>
                {priceStatus !== 'fresh' ? 'Current prices are unavailable. Request a fresh quote to review a purchase. ' : null}
                {priceStatus === 'fresh' && market.priceObservedAt != null
                  ? `Price snapshot ${new Date(market.priceObservedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. `
                  : 'Indicative prices. '}
                Final execution uses a fresh quote.
                {detail && ((detail.yesPrice === null && market.yesPrice !== null) || (detail.noPrice === null && market.noPrice !== null))
                  ? ' Some prices are from the market list; current detail prices are unavailable.'
                  : ''}
              </>
            )}
          </PantaText>
          <View style={[a.flex_row, a.gap_20, a.pt_8]}>
            <View style={[a.flex_1, a.gap_8]}>
              <PantaText allowFontScaling style={[a.text_13, t.atoms.text_secondary]}>
                Total volume
              </PantaText>
              <PantaText allowFontScaling tabular style={[a.text_20, a.font_semibold]}>
                {market.volumeUsdc === null
                  ? '—'
                  : `$${Number(market.volumeUsdc).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 })}`}
              </PantaText>
              <PantaText allowFontScaling style={[a.text_11, t.atoms.text_secondary]}>
                USDC
              </PantaText>
            </View>
            <View style={[a.flex_1, a.gap_8]}>
              <PantaText allowFontScaling style={[a.text_13, t.atoms.text_secondary]}>
                Recorded trades
              </PantaText>
              <PantaText allowFontScaling tabular style={[a.text_20, a.font_semibold]}>
                {market.totalTrades ?? '—'}
              </PantaText>
            </View>
          </View>
        </View>
        <View style={[a.gap_16]}>
          <DetailHeading title="Explore this market" />
          <DetailSurface>
            <DetailDisclosure
              icon="rules"
              title="Resolution"
              subtitle={resolutionSummary}
              color={panta.resolution}
              onPress={() => setSection('resolution')}
            />
            <DetailDisclosure
              icon="activity"
              title="Trades"
              subtitle="Recent activity and transaction details"
              color={panta.accent}
              onPress={() => setSection('activity')}
            />
            <DetailDisclosure
              icon="info"
              title="Market information"
              subtitle="Timeline, creator and market addresses"
              onPress={() => setSection('information')}
              last
            />
          </DetailSurface>
        </View>
        {description && (
          <View style={[a.gap_16]}>
            <DetailHeading title="About this market" />
            <PantaText
              allowFontScaling
              numberOfLines={expanded || description.length <= 180 ? undefined : 4}
              style={[a.text_15, a.leading_150, t.atoms.text_secondary]}
            >
              {description}
            </PantaText>
            {description.length > 180 && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setExpanded(value => !value)}
                style={[a.self_start, a.justify_center, { minHeight: pantaLayout.iconTarget }]}
              >
                <PantaText allowFontScaling style={[a.text_13, a.font_semibold]}>
                  {expanded ? 'Show less' : 'Read more'}
                </PantaText>
              </Pressable>
            )}
          </View>
        )}
        {market.creatorAddress && (
          <View style={[a.flex_row, a.align_center, a.gap_12]}>
            <View style={[a.align_center, a.justify_center, a.rounded_full, { width: 36, height: 36, backgroundColor: panta.surface }]}>
              <PantaIcon name="account" size={18} color={panta.secondary} />
            </View>
            <View style={[a.flex_1, a.gap_8]}>
              <PantaText allowFontScaling style={[a.text_11, t.atoms.text_secondary]}>
                Created by
              </PantaText>
              <PantaText allowFontScaling style={[a.text_13, a.font_medium]}>
                {market.creatorHandle || `${market.creatorAddress.slice(0, 6)}…${market.creatorAddress.slice(-4)}`}
              </PantaText>
            </View>
          </View>
        )}
        {market.disclaimer && (
          <PantaText allowFontScaling style={[a.text_11, a.leading_150, { color: panta.accent }]}>
            {market.disclaimer}
          </PantaText>
        )}
        {state.lastFetchedAt && (
          <PantaText allowFontScaling style={[a.text_11, t.atoms.text_secondary]}>
            Data loaded {new Date(state.lastFetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </PantaText>
        )}
      </ScrollView>
      <View
        style={[
          a.px_20,
          a.pt_16,
          a.gap_12,
          a.border_t,
          t.atoms.bg,
          t.atoms.border_secondary,
          { paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        <PantaText style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
          {entry === 'closed' && market.phase !== 'resolved' && market.phase !== 'cancelled'
            ? 'Event ended · trading closed'
            : market.phase === 'primary'
              ? 'Primary market · buying only'
              : market.phase === 'secondary'
                ? 'P2P market · buy and sell with limit orders'
                : market.phase === 'resolved'
                  ? 'Resolved market · trading closed'
                  : 'Cancelled market · trading closed'}
        </PantaText>
        {entry !== 'closed' ? (
          <View style={[a.gap_8]}>
            <View style={[width < 360 || fontScale > 1.3 ? a.flex_col : a.flex_row, a.gap_12]}>
              {(['yes', 'no'] as const).map(side => (
                <Pressable
                  key={side}
                  accessibilityRole="button"
                  onPress={() => startTrade(side)}
                  style={({ pressed }) => [
                    a.flex_1,
                    a.align_center,
                    a.justify_center,
                    a.py_16,
                    a.rounded_16,
                    { minHeight: 52, backgroundColor: side === 'yes' ? panta.yes : panta.no, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <PantaText allowFontScaling style={[a.text_17, a.font_semibold, { color: panta.background }]}>
                    Buy {side.toUpperCase()}
                  </PantaText>
                </Pressable>
              ))}
            </View>
            {market.phase === 'secondary' && <PantaButton label="Sell shares" variant="utility" onPress={() => startTrade('sell')} />}
          </View>
        ) : (
          <PantaButton
            variant="secondary"
            label={market.phase === 'resolved' ? 'View result on Panta' : 'View market on Panta'}
            onPress={() => {
              void open(website);
            }}
          />
        )}
      </View>
      <DetailSheet
        visible={section === 'resolution'}
        title="Resolution"
        subtitle="The criteria and sources reported by Panta."
        onClose={() => setSection(null)}
      >
        <DetailSurface>
          <View style={[a.p_20, a.gap_16]}>
            <PantaText allowFontScaling style={[a.text_13, a.font_semibold, { color: panta.resolution }]}>
              {market.outcome
                ? `Resolved ${market.outcome.toUpperCase()}`
                : market.phase === 'cancelled'
                  ? 'Cancelled'
                  : 'Awaiting resolution'}
            </PantaText>
            <PantaText allowFontScaling style={[a.text_17, a.leading_150]}>
              {market.resolutionRule || 'Resolution criteria are not available from Panta yet.'}
            </PantaText>
          </View>
        </DetailSurface>
        <View style={[a.gap_16]}>
          <DetailHeading title="Resolution sources" subtitle="Open the original sources used to determine the result." />
          {market.sources?.length ? (
            <DetailSurface>
              {market.sources.map((source, index) => (
                <DetailDisclosure
                  key={source}
                  icon="arrow"
                  title={new URL(source).hostname.replace(/^www\./, '')}
                  subtitle="View source"
                  color={panta.resolution}
                  onPress={() => {
                    void open(source);
                  }}
                  last={index === market.sources!.length - 1}
                />
              ))}
            </DetailSurface>
          ) : (
            <PantaText allowFontScaling style={[a.text_15, t.atoms.text_secondary]}>
              No sources provided by Panta.
            </PantaText>
          )}
        </View>
        <DetailSurface>
          <DetailField label="Expected resolution" value={marketDate(market.resolutionTime)} last={!market.resolvedAt} />
          {Boolean(market.resolvedAt) && <DetailField label="Resolved at" value={marketDate(market.resolvedAt ?? null)} last />}
        </DetailSurface>
      </DetailSheet>
      <DetailSheet
        visible={section === 'activity'}
        title={selectedTrade ? 'Trade details' : 'Trades'}
        subtitle={selectedTrade ? undefined : 'Recent trades recorded by Panta. Tap a trade to inspect its transaction.'}
        onBack={selectedTrade ? () => setSelectedTrade(null) : undefined}
        onClose={() => {
          setSection(null);
          setSelectedTrade(null);
        }}
      >
        {section === 'activity' && (
          <>
            <View style={{ display: selectedTrade ? 'none' : 'flex' }}>
              <MarketActivity
                key={market.marketId}
                marketId={market.marketId}
                refreshVersion={refreshVersion}
                onTradePress={setSelectedTrade}
              />
            </View>
            {selectedTrade && <TradeDetailContent trade={selectedTrade} />}
          </>
        )}
      </DetailSheet>
      <DetailSheet visible={section === 'information'} title="Market information" onClose={() => setSection(null)}>
        <View style={[a.gap_16]}>
          <DetailHeading title="Market" />
          <DetailSurface>
            {[
              ['Phase', phase],
              ['Status', market.marketStatus ? categoryLabel(market.marketStatus) : 'Unavailable'],
              ['Region', market.region || 'Unavailable'],
              ['Type', market.marketType ? categoryLabel(market.marketType) : 'Unavailable'],
              ['Price source', market.priceSource ? categoryLabel(market.priceSource) : 'Not provided'],
              ['Total volume', market.volumeUsdc === null ? 'Unavailable' : `${market.volumeUsdc} USDC`],
              ['Active volume', market.activeVolumeUsdc == null ? 'Unavailable' : `${market.activeVolumeUsdc} USDC`],
            ].map(([label, value], index, rows) => (
              <DetailField key={label} label={label} value={value} last={index === rows.length - 1} />
            ))}
          </DetailSurface>
        </View>
        <View style={[a.gap_16]}>
          <DetailHeading title="Timeline" subtitle="Dates use your device’s time zone." />
          <DetailSurface>
            {[
              ['Created', marketDate(market.createdAt ?? null)],
              ['Opens', marketDate(market.startTime)],
              ['Event ends', marketDate(market.endTime)],
              ['Expected resolution', marketDate(market.resolutionTime)],
            ].map(([label, value], index, rows) => (
              <DetailField key={label} label={label} value={value} last={index === rows.length - 1} />
            ))}
          </DetailSurface>
        </View>
        <View style={[a.gap_16]}>
          <DetailHeading title="On-chain identity" />
          <DetailSurface>
            <DetailField label="Market address" value={market.marketId} selectable last={!market.creatorAddress} />
            {market.creatorAddress && <DetailField label="Creator address" value={market.creatorAddress} selectable last />}
          </DetailSurface>
        </View>
        <PantaText allowFontScaling style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
          Prices and indexed data may lag the website or chain.
        </PantaText>
      </DetailSheet>
      <TradingEntryPrompt
        visible={tradeIntent !== null && entry !== 'closed' && entry !== 'primary' && entry !== 'p2p'}
        entry={entry === 'closed' || entry === 'primary' || entry === 'p2p' ? 'sign-in' : entry}
        intent={tradeIntent ?? 'yes'}
        marketTitle={market.title}
        onClose={() => setTradeIntent(null)}
        onOpenAccount={onOpenAccount}
      />
      <Modal visible={p2pIntent !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setP2PIntent(null)}>
        {p2pIntent && <P2POrderSheet market={market} initialIntent={p2pIntent} initialSide={p2pSide} onClose={() => setP2PIntent(null)} />}
      </Modal>
      <Modal visible={orderSide !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOrderSide(null)}>
        {orderSide && <OrderSheet market={market} initialSide={orderSide} onClose={() => setOrderSide(null)} />}
      </Modal>
    </View>
  );
}
