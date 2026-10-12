import { createBaseStore, createQueryStore } from '@storesjs/stores';

import { pantaGatewayUrl } from '@/lib/panta-api';
import {
  CatalogError,
  createCatalogClient,
  mergeMarketSnapshot,
  type CatalogMarket,
  type CatalogPage,
  type MarketPhase,
} from '@/lib/panta-catalog';

import { marketPriceStatus } from './market-price-status';
import { createMarketSearch } from './market-search-store';

// Public endpoint only. No environment file or credentials enter the mobile bundle.
const client = pantaGatewayUrl ? createCatalogClient(pantaGatewayUrl) : null;
export const marketSearch = createMarketSearch(client);
type Filters = {
  category: string | undefined;
  status: MarketPhase | undefined;
  cursor: string | undefined;
  foreground: boolean;
  visitedCursors: string[];
};
type Params = Pick<Filters, 'category' | 'status' | 'cursor'>;
type ListState = {
  items: CatalogMarket[];
  filterKey: string | null;
  nextCursor: string | null;
  disclaimer: string | null;
  loadedAt: number | null;
};
export const catalogFilterKey = (filters: Pick<Filters, 'category' | 'status'>) => JSON.stringify([filters.category, filters.status]);

export function createCatalogStores(api: ReturnType<typeof createCatalogClient> | null) {
  const marketDetails = createBaseStore<{ items: Record<string, CatalogMarket> }>(() => ({ items: {} }));
  function catalogClient() {
    if (!api) throw new CatalogError('UNAVAILABLE');
    return api;
  }
  const catalogFilters = createBaseStore<Filters>(() => ({
    category: undefined,
    status: undefined,
    cursor: undefined,
    foreground: true,
    visitedCursors: [],
  }));
  const categoriesStore = createQueryStore({
    fetcher: (_, abort) => catalogClient().categories(abort?.signal),
    enabled: $ => $(catalogFilters).foreground,
    staleTime: 300000,
    disableAutoRefetching: true,
    retry: false,
  });

  const recentPages = new Map<string, ListState>();
  const catalogStore = createQueryStore<CatalogPage, Params, ListState>(
    {
      fetcher: async (params, abort) => {
        const visitedCursors = catalogFilters.getState().visitedCursors;
        const data = await catalogClient().markets({ ...params, limit: 20 }, abort?.signal);
        if (data.nextCursor && (data.nextCursor === params.cursor || visitedCursors.includes(data.nextCursor)))
          throw new CatalogError('INVALID_RESPONSE');
        return data;
      },
      params: {
        category: $ => $(catalogFilters).category,
        status: $ => $(catalogFilters).status,
        cursor: $ => $(catalogFilters).cursor,
      },
      enabled: $ => $(catalogFilters).foreground,
      // Pages are merged below. Do not reuse an old page when returning to a filter.
      disableCache: true,
      disableAutoRefetching: true,
      keepPreviousData: false,
      retry: false,
      onFetched: ({ data, params, set }) => {
        if (catalogFilterKey(params) !== catalogFilterKey(catalogFilters.getState()) || params.cursor !== catalogFilters.getState().cursor)
          return;
        if (!params.cursor) {
          const key = catalogFilterKey(params);
          if (recentPages.size >= 8 && !recentPages.has(key)) recentPages.delete(recentPages.keys().next().value!);
          recentPages.set(key, {
            items: data.items,
            filterKey: key,
            nextCursor: data.nextCursor,
            disclaimer: data.disclaimer,
            loadedAt: Date.now(),
          });
        }
        set(state => ({
          items: mergeCatalogItems(params.cursor && state.filterKey === catalogFilterKey(params) ? state.items : [], data.items),
          filterKey: catalogFilterKey(params),
          nextCursor: data.nextCursor,
          disclaimer: data.disclaimer,
          loadedAt: Date.now(),
        }));
        // Start the first visible incomplete rows as soon as the page arrives,
        // rather than waiting for FlatList's viewability callback.
        for (const market of data.items.slice(0, 3)) {
          if (market.title !== 'Untitled market' && market.yesPrice !== null && market.noPrice !== null) continue;
          const detail = createMarketDetailStore(market.marketId).getState();
          if (detail.status !== 'loading' && (!detail.lastFetchedAt || Date.now() - detail.lastFetchedAt >= 30000)) void detail.fetch();
        }
      },
    },
    () => ({ items: [], filterKey: null, nextCursor: null, disclaimer: null, loadedAt: null })
  );

  function mergeCatalogItems(previous: readonly CatalogMarket[], incoming: readonly CatalogMarket[]): CatalogMarket[] {
    const items = new Map(previous.map(item => [item.marketId, item]));
    for (const item of incoming) items.set(item.marketId, item);
    return [...items.values()];
  }

  function setCatalogFilters(category?: string, status?: MarketPhase) {
    const current = catalogFilters.getState();
    if (current.category === category && current.status === status && current.cursor === undefined) return;
    catalogFilters.setState({ category, status, cursor: undefined, visitedCursors: [] });
    const recent = recentPages.get(catalogFilterKey({ category, status }));
    if (recent?.loadedAt && Date.now() - recent.loadedAt < 30000) catalogStore.setState(recent);
  }

  async function refreshCatalog() {
    catalogFilters.setState({ cursor: undefined, visitedCursors: [] });
    if (!categoriesStore.getState().getData()) void categoriesStore.getState().fetch();
    await catalogStore.getState().fetch({ cursor: undefined }, { force: true, updateQueryKey: true });
  }

  function loadMoreMarkets() {
    const state = catalogStore.getState();
    if (
      state.nextCursor &&
      state.status !== 'loading' &&
      !state.error &&
      catalogFilters.getState().foreground &&
      state.filterKey === catalogFilterKey(catalogFilters.getState()) &&
      state.nextCursor !== catalogFilters.getState().cursor
    )
      catalogFilters.setState({
        cursor: state.nextCursor,
        visitedCursors: [...catalogFilters.getState().visitedCursors, state.nextCursor],
      });
  }

  // Two background reads; reserve a third slot for the market the user opens.
  let activeDetails = 0;
  let openedMarket: string | null = null;
  const detailQueue: { marketId: string; start: () => void }[] = [];
  function drainDetails() {
    while (activeDetails < 3 && detailQueue.length) {
      const preferred = detailQueue.findIndex(item => item.marketId === openedMarket);
      if (activeDetails >= 2 && preferred < 0) return;
      const next = detailQueue.splice(preferred < 0 ? 0 : preferred, 1)[0];
      activeDetails++;
      next.start();
    }
  }
  function prioritizeMarketDetail(marketId: string | null) {
    openedMarket = marketId;
    drainDetails();
  }
  async function fetchDetail(marketId: string, signal?: AbortSignal) {
    await new Promise<void>(resolve => {
      detailQueue.push({ marketId, start: resolve });
      drainDetails();
    });
    try {
      if (signal?.aborted) throw new CatalogError('UNAVAILABLE');
      const incoming = await catalogClient().market(marketId, signal, true);
      const previous = marketDetails.getState().items[marketId] ?? catalogStore.getState().items.find(item => item.marketId === marketId);
      return previous ? mergeMarketSnapshot(previous, incoming) : incoming;
    } finally {
      activeDetails--;
      drainDetails();
    }
  }
  function makeDetailStore(marketId: string) {
    return createQueryStore({
      fetcher: (_, abort) => fetchDetail(marketId, abort?.signal),
      enabled: $ => $(catalogFilters).foreground,
      staleTime: 30000,
      disableAutoRefetching: true,
      retry: false,
      keepPreviousData: true,
      onFetched: ({ data }) => {
        marketDetails.setState(state => {
          const items = { ...state.items, [marketId]: data };
          if (Object.keys(items).length > 200) delete items[Object.keys(items)[0]];
          return { items };
        });
      },
    });
  }

  const detailStores = new Map<string, ReturnType<typeof makeDetailStore>>();
  function createMarketDetailStore(marketId: string) {
    const found = detailStores.get(marketId);
    if (found) return found;
    const store = makeDetailStore(marketId);
    if (detailStores.size >= 200) detailStores.delete(detailStores.keys().next().value!);
    detailStores.set(marketId, store);
    return store;
  }
  const refreshAfter = new Map<string, number>();
  function refreshMarketPrices(market: CatalogMarket, now = Date.now()) {
    if (!catalogFilters.getState().foreground || marketPriceStatus(market, now) === 'fresh') return;
    const store = createMarketDetailStore(market.marketId);
    const state = store.getState();
    if (state.status === 'loading' || (refreshAfter.get(market.marketId) ?? 0) > now) return;
    if (refreshAfter.size >= 200) refreshAfter.delete(refreshAfter.keys().next().value!);
    refreshAfter.set(market.marketId, now + 15000);
    void state
      .fetch(undefined, { force: true })
      .then(() => {
        const error = store.getState().error;
        if (error instanceof CatalogError && error.code === 'RATE_LIMITED')
          refreshAfter.set(market.marketId, Date.now() + (error.retryAfterSeconds ?? 60) * 1000);
      })
      .catch(() => undefined);
  }
  function createMarketActivityStore(marketId: string, limit = 20) {
    return createQueryStore({
      fetcher: (_, abort) => catalogClient().activity(marketId, limit, abort?.signal),
      enabled: $ => $(catalogFilters).foreground,
      staleTime: 30000,
      disableAutoRefetching: true,
      retry: false,
      keepPreviousData: true,
    });
  }

  return {
    catalogFilters,
    catalogStore,
    categoriesStore,
    setCatalogFilters,
    refreshCatalog,
    loadMoreMarkets,
    createMarketDetailStore,
    createMarketActivityStore,
    marketDetails,
    prioritizeMarketDetail,
    refreshMarketPrices,
  };
}

export const {
  catalogFilters,
  catalogStore,
  categoriesStore,
  setCatalogFilters,
  refreshCatalog,
  loadMoreMarkets,
  createMarketDetailStore,
  createMarketActivityStore,
  marketDetails,
  prioritizeMarketDetail,
  refreshMarketPrices,
} = createCatalogStores(client);
