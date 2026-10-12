import { createBaseStore } from '@storesjs/stores';

import { CatalogError, type CatalogFilters, type CatalogMarket, type createCatalogClient } from '@/lib/panta-catalog';

export function matchesMarket(market: CatalogMarket, query: string) {
  const words = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const haystack = [market.title, market.description, market.resolutionRule, market.category, market.marketId, market.creatorHandle]
    .join(' ')
    .normalize('NFKC')
    .toLocaleLowerCase();
  return words.every(word => haystack.includes(word));
}
/** Panta has no documented text-search endpoint. Traverse real catalog pages, showing progress. */
export function createMarketSearch(api: Pick<ReturnType<typeof createCatalogClient>, 'markets'> | null) {
  const useStore = createBaseStore<{
    items: CatalogMarket[];
    status: 'idle' | 'loading' | 'complete' | 'partial' | 'error';
    error: CatalogError | null;
    partialReason: 'limit' | 'metadata' | null;
    scopeKey: string | null;
  }>(() => ({ items: [], status: 'idle', error: null, partialReason: null, scopeKey: null }));
  let generation = 0;
  let pending: AbortController | null = null;
  const cached = new Map<string, { items: CatalogMarket[]; incomplete: boolean; at: number }>();
  function cancel() {
    generation++;
    pending?.abort();
    pending = null;
  }
  async function search(filters: Pick<CatalogFilters, 'category' | 'status'>, force = false) {
    const key = JSON.stringify(filters);
    const found = cached.get(key);
    if (!force && found && Date.now() - found.at < 300000) {
      cancel();
      useStore.setState({
        items: found.items,
        scopeKey: key,
        status: found.incomplete ? 'partial' : 'complete',
        partialReason: found.incomplete ? 'metadata' : null,
        error: null,
      });
      return;
    }
    cancel();
    const version = generation;
    const abort = new AbortController();
    pending = abort;
    useStore.setState({ status: 'loading', error: null, items: [], partialReason: null, scopeKey: key });
    const visited = new Set<string>();
    const markets = new Map<string, CatalogMarket>();
    let cursor: string | undefined;
    let incomplete = false;
    try {
      if (!api) throw new CatalogError('UNAVAILABLE');
      for (let page = 0; page < 20; page++) {
        const result = await api.markets({ ...filters, cursor, limit: 50 }, abort.signal);
        if (version !== generation || abort.signal.aborted) return;
        if (result.items.some(market => market.title === 'Untitled market')) incomplete = true;
        for (const market of result.items) markets.set(market.marketId, market);
        useStore.setState({ items: [...markets.values()] });
        if (!result.nextCursor) {
          if (cached.size >= 5 && !cached.has(key)) cached.delete(cached.keys().next().value!);
          cached.set(key, { items: [...markets.values()], incomplete, at: Date.now() });
          useStore.setState({ status: incomplete ? 'partial' : 'complete', partialReason: incomplete ? 'metadata' : null });
          return;
        }
        if (visited.has(result.nextCursor)) throw new CatalogError('INVALID_RESPONSE');
        visited.add(result.nextCursor);
        cursor = result.nextCursor;
      }
      useStore.setState({ status: 'partial', partialReason: 'limit' });
    } catch (error) {
      if (version === generation && !abort.signal.aborted)
        useStore.setState({ status: 'error', error: error instanceof CatalogError ? error : new CatalogError('UNAVAILABLE') });
    } finally {
      if (version === generation) pending = null;
    }
  }
  return { useStore, search, cancel };
}
