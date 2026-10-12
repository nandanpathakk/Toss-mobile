import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
  type ViewToken,
} from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';
import { mergeMarketSnapshot, type CatalogMarket } from '@/lib/panta-catalog';

import { CatalogCard, categoryLabel } from './catalog-card';
import { CatalogFailure, CatalogLoading } from './catalog-feedback';
import {
  catalogFilterKey,
  catalogFilters,
  catalogStore,
  categoriesStore,
  loadMoreMarkets,
  marketDetails,
  marketSearch,
  refreshCatalog,
  refreshMarketPrices,
  setCatalogFilters,
} from './catalog-store';
import { matchesMarket } from './market-search-store';
import { Attribution, PantaButton, pantaFont, PantaIcon, PantaText } from './panta-ui';
import { marketPhases, PhasePicker } from './phase-picker';

export function ExploreScreen({
  onMarketPress,
  onCreateMarket,
}: {
  onMarketPress: (market: CatalogMarket) => void;
  onCreateMarket: () => void;
}) {
  const t = useTheme();
  const filters = catalogFilters();
  const state = catalogStore();
  const categoryState = categoriesStore();
  const categories = categoryState.getData()?.categories ?? [];
  const category = filters.category;
  const [search, setSearch] = useState('');
  const [phasePicker, setPhasePicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshVersion = useRef(0);
  const details = marketDetails().items;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;
  const visibleMarkets = useRef<CatalogMarket[]>([]);
  const onVisibleMarkets = useRef(({ viewableItems }: { viewableItems: ViewToken<CatalogMarket>[] }) => {
    visibleMarkets.current = viewableItems.map(({ item }) => item);
    visibleMarkets.current.forEach(market => refreshMarketPrices(market));
  }).current;
  useEffect(() => {
    if (!filters.foreground) return;
    const refreshVisible = () => {
      for (const market of visibleMarkets.current) {
        const detail = marketDetails.getState().items[market.marketId];
        refreshMarketPrices(detail && detail.phase === market.phase ? mergeMarketSnapshot(market, detail) : market);
      }
    };
    refreshVisible();
    const timer = setInterval(refreshVisible, 15000);
    return () => clearInterval(timer);
  }, [filters.foreground, filters.category, filters.status]);

  const searchState = marketSearch.useStore();
  const searching = search.trim().length > 0;
  useEffect(() => {
    if (!searching || !filters.foreground) {
      marketSearch.cancel();
      return;
    }
    const timer = setTimeout(() => {
      void marketSearch.search({ category: filters.category, status: filters.status });
    }, 250);
    return () => {
      clearTimeout(timer);
      marketSearch.cancel();
    };
  }, [searching, filters.category, filters.status, filters.foreground]);
  useEffect(() => {
    refreshVersion.current++;
    setRefreshing(false);
    return () => {
      refreshVersion.current++;
    };
  }, [category, filters.status, searching, filters.foreground]);
  const refresh = async () => {
    if (refreshing) return;
    const version = ++refreshVersion.current;
    setRefreshing(true);
    try {
      if (searching) await marketSearch.search({ category, status: filters.status }, true);
      else await refreshCatalog();
    } finally {
      if (version === refreshVersion.current) setRefreshing(false);
    }
  };
  const selectPhase = () => {
    Keyboard.dismiss();
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Market phase',
          options: [...marketPhases.map(phase => `${phase.value === filters.status ? '✓ ' : ''}${phase.label}`), 'Cancel'],
          cancelButtonIndex: marketPhases.length,
          userInterfaceStyle: 'dark',
          tintColor: panta.text,
        },
        index => {
          if (index < marketPhases.length) setCatalogFilters(category, marketPhases[index].value);
        }
      );
    } else setPhasePicker(true);
  };
  const current = state.filterKey === catalogFilterKey(filters);
  const loadedMarkets = current ? state.items : [];
  const searchCurrent = searchState.scopeKey === JSON.stringify({ category: filters.category, status: filters.status });
  const markets = useMemo(
    () =>
      (searching
        ? [
            ...new Map(
              [
                ...loadedMarkets,
                ...(searchCurrent ? searchState.items : []).filter(
                  market => (!category || market.category === category) && (!filters.status || market.phase === filters.status)
                ),
              ].map(market => [market.marketId, market])
            ).values(),
          ]
        : loadedMarkets
      )
        .map(market => {
          const detail = details[market.marketId];
          if (!detail || detail.phase !== market.phase) return market;
          return (detail.priceObservedAt ?? 0) > (market.priceObservedAt ?? 0)
            ? mergeMarketSnapshot(market, detail)
            : mergeMarketSnapshot(detail, market);
        })
        .filter(market => matchesMarket(market, search)),
    [loadedMarkets, search, searching, searchState.items, category, filters.status, details, searchCurrent]
  );
  const loading = state.status === 'loading' || (!current && state.status !== 'error');
  const retry = () => {
    if (categoryState.error) void categoryState.fetch(undefined, { force: true });
    void state.fetch(undefined, { force: true });
  };

  return (
    <>
      <FlatList
        data={markets}
        keyExtractor={market => market.marketId}
        onViewableItemsChanged={onVisibleMarkets}
        viewabilityConfig={viewabilityConfig}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={panta.text}
            colors={[panta.accent]}
            progressBackgroundColor={panta.surface}
            title={refreshing ? 'Updating markets' : undefined}
            titleColor={panta.secondary}
          />
        }
        onEndReached={() => {
          if (!searching && !refreshing && !loading && current) loadMoreMarkets();
        }}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[a.p_20, a.gap_16]}
        ListHeaderComponent={
          <View style={[a.gap_20, a.pb_8]}>
            <View style={[a.gap_12]}>
              <View style={[a.flex_row, a.flex_wrap, a.align_center, a.justify_between, a.gap_12]}>
                <PantaText allowFontScaling accessibilityRole="header" style={[a.text_30, a.font_bold, { letterSpacing: -0.8 }]}>
                  Discover
                </PantaText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="My markets and local drafts"
                  onPress={onCreateMarket}
                  style={[a.flex_row, a.align_center, a.gap_8, a.px_8, { minHeight: 44 }]}
                >
                  <PantaIcon name="rules" color={panta.secondary} size={16} />
                  <PantaText style={[a.text_13, t.atoms.text_secondary]}>My markets</PantaText>
                </Pressable>
              </View>
              <PantaText allowFontScaling style={[a.text_15, a.leading_135, t.atoms.text_secondary]}>
                Find your next market.
              </PantaText>
            </View>
            <View
              style={[
                a.flex_row,
                a.align_center,
                a.gap_10,
                a.px_12,
                a.rounded_12,
                a.border,
                t.atoms.border_secondary,
                { backgroundColor: panta.surface },
              ]}
            >
              <PantaIcon name="search" color={panta.secondary} size={20} />
              <TextInput
                accessibilityLabel="Search markets"
                placeholder="Search markets"
                placeholderTextColor={panta.secondary}
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={() => Keyboard.dismiss()}
                style={[a.flex_1, a.py_12, a.text_15, t.atoms.text, pantaFont, { minHeight: 48 }]}
              />
              {search.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setSearch('')}
                  style={[a.align_center, a.justify_center, { width: 44, height: 44 }]}
                >
                  <PantaIcon name="close" color={panta.secondary} size={16} />
                </Pressable>
              )}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[a.gap_8]}
            >
              {[undefined, ...categories].map(item => (
                <Pressable
                  key={item ?? 'all'}
                  accessibilityRole="button"
                  accessibilityState={{ selected: item === category }}
                  onPress={() => setCatalogFilters(item, filters.status)}
                  style={[
                    a.justify_center,
                    a.px_16,
                    a.rounded_10,
                    a.border,
                    t.atoms.border_secondary,
                    { minHeight: 44, backgroundColor: item === category ? panta.accentBackground : panta.background },
                  ]}
                >
                  <PantaText style={[a.text_13, a.font_medium, item === category ? { color: panta.accent } : t.atoms.text_secondary]}>
                    {item ? categoryLabel(item) : 'All'}
                  </PantaText>
                </Pressable>
              ))}
            </ScrollView>
            {state.disclaimer && current && (
              <View style={[a.p_12, a.rounded_10, t.atoms.bg_elevated]}>
                <PantaText style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>{state.disclaimer}</PantaText>
              </View>
            )}
            {categoryState.error && !state.error && !searching && loadedMarkets.length > 0 && (
              <CatalogFailure
                title="Categories couldn’t update"
                description="You can still browse all markets."
                error={categoryState.error}
                onRetry={() => void categoryState.fetch(undefined, { force: true })}
              />
            )}
            {searching && searchCurrent && searchState.status === 'loading' && (
              <PantaText allowFontScaling accessibilityLiveRegion="polite" style={[a.text_13, t.atoms.text_secondary]}>
                Searching more markets · {searchState.items.length} checked
              </PantaText>
            )}
            {searching && searchCurrent && searchState.status === 'partial' && (
              <PantaText style={[a.text_11, t.atoms.text_secondary]}>
                {searchState.partialReason === 'metadata'
                  ? 'Some market titles are unavailable. Results may be incomplete.'
                  : 'Showing matches from the first 1,000 markets. Narrow your category to search further.'}
              </PantaText>
            )}
            {searching && searchCurrent && searchState.status === 'partial' && (
              <PantaButton
                label="Refresh search results"
                onPress={() => {
                  void marketSearch.search({ category, status: filters.status }, true);
                }}
              />
            )}
            {searching && searchCurrent && searchState.error && (
              <CatalogFailure
                title="Search paused"
                error={searchState.error}
                stale={markets.length > 0}
                onRetry={() => {
                  void marketSearch.search({ category, status: filters.status }, true);
                }}
              />
            )}
            {state.error && !searching && !filters.cursor && (
              <CatalogFailure error={state.error} stale={loadedMarkets.length > 0} onRetry={retry} />
            )}
            <View style={[a.flex_row, a.align_center, a.justify_between, a.gap_12]}>
              <View style={[a.flex_1, a.gap_8]}>
                <PantaText allowFontScaling accessibilityRole="header" style={[a.text_20, a.font_semibold]}>
                  {searching ? 'Search results' : 'Markets'}
                </PantaText>
                <PantaText allowFontScaling accessibilityLiveRegion="polite" style={[a.text_11, t.atoms.text_secondary]}>
                  {searching
                    ? `${markets.length} matches · Catalog search`
                    : loading
                      ? current && markets.length
                        ? 'Updating markets…'
                        : 'Loading markets…'
                      : `${markets.length} loaded · USDC per share`}
                </PantaText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Market phase: ${marketPhases.find(phase => phase.value === filters.status)?.label}. Change filter`}
                onPress={selectPhase}
                style={({ pressed }) => [
                  a.flex_row,
                  a.align_center,
                  a.gap_8,
                  a.px_12,
                  a.py_12,
                  a.rounded_full,
                  { minHeight: 44, backgroundColor: panta.surface, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <PantaText allowFontScaling style={[a.text_13, a.font_medium]}>
                  {marketPhases.find(phase => phase.value === filters.status)?.label}
                </PantaText>
                <PantaIcon name="chevron" color={panta.secondary} size={14} />
              </Pressable>
            </View>
          </View>
        }
        renderItem={({ item }) => <CatalogCard market={item} onPress={() => onMarketPress(item)} />}
        ListEmptyComponent={
          loading || (searching && searchCurrent && searchState.status === 'loading') ? (
            <CatalogLoading />
          ) : state.error ? null : (
            <View style={[a.p_24, a.border, a.rounded_12, t.atoms.border_secondary]}>
              <PantaText style={[a.text_17, a.font_semibold]}>
                {searching
                  ? searchCurrent && searchState.status === 'complete'
                    ? 'No matching markets'
                    : 'No matches in loaded markets'
                  : 'No markets here yet'}
              </PantaText>
              <PantaText style={[a.mt_12, a.text_13, a.leading_150, t.atoms.text_secondary]}>
                {searching
                  ? 'Try a shorter phrase or another category. Markets with missing titles may not appear in search.'
                  : 'Try another category or market phase.'}
              </PantaText>
            </View>
          )
        }
        ListFooterComponent={
          <View style={[a.gap_16, a.pt_16]}>
            {loading && filters.cursor && loadedMarkets.length > 0 && <CatalogLoading label="Loading more markets" />}
            {state.error && !searching && filters.cursor && <CatalogFailure error={state.error} stale onRetry={retry} />}
            {current && !searching && !state.nextCursor && markets.length > 0 && !loading && (
              <PantaText allowFontScaling style={[a.text_13, a.self_center, t.atoms.text_secondary]}>
                You’re all caught up
              </PantaText>
            )}
            {current && state.loadedAt && (
              <PantaText style={[a.text_10, a.self_center, t.atoms.text_secondary]}>
                Last updated {new Date(state.loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </PantaText>
            )}
            <Attribution />
          </View>
        }
      />
      <PhasePicker
        visible={phasePicker}
        selected={filters.status}
        onSelect={phase => setCatalogFilters(category, phase)}
        onClose={() => setPhasePicker(false)}
      />
    </>
  );
}
