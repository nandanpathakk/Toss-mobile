import { CatalogError, mergeMarketSnapshot, parseCatalogMarket, parseCatalogPage, type CatalogMarket } from '../../src/lib/panta-catalog';

/** Bounded public snapshots only. Never used for quotes, builds or purchases. */
export function createMarketEnrichment(load: (path: string) => Promise<unknown>, now = Date.now) {
  const freshFor = 30000;
  const retainFor = 120000;
  const cache = new Map<string, { market: CatalogMarket; savedAt: number; detailAt: number | null }>();
  const pending = new Map<string, Promise<CatalogMarket>>();
  const failures = new Map<string, { until: number; error: unknown }>();
  let active = 0;
  const queue: (() => void)[] = [];
  function observe(market: CatalogMarket): CatalogMarket {
    return { ...market, priceObservedAt: market.yesPrice !== null || market.noPrice !== null ? now() : null };
  }
  function remember(market: CatalogMarket, detailAt: number | null) {
    cache.delete(market.marketId);
    if (cache.size >= 300) cache.delete(cache.keys().next().value!);
    cache.set(market.marketId, { market, savedAt: now(), detailAt });
  }
  function recent(id: string) {
    const found = cache.get(id);
    if (!found) return undefined;
    if (now() - found.savedAt >= retainFor || (found.market.priceObservedAt != null && now() - found.market.priceObservedAt >= retainFor)) {
      cache.delete(id);
      return undefined;
    }
    return found;
  }
  async function refresh(id: string): Promise<CatalogMarket> {
    const current = pending.get(id);
    if (current) return current;
    const failure = failures.get(id);
    if (failure && failure.until > now()) throw failure.error;
    const operation = (async () => {
      if (active >= 3) await new Promise<void>(resolve => queue.push(resolve));
      else active++;
      try {
        const incoming = observe(parseCatalogMarket(await load(`/markets/${id}/`)));
        if (incoming.marketId !== id) throw new CatalogError('INVALID_RESPONSE');
        const previous = recent(id)?.market;
        const market = previous ? mergeMarketSnapshot(previous, incoming) : incoming;
        remember(market, now());
        failures.delete(id);
        return market;
      } catch (error) {
        // Avoid repeating an expensive failing RPC read for every render/tap.
        if (failures.size >= 300) failures.delete(failures.keys().next().value!);
        failures.set(id, { until: now() + 5000, error });
        throw error;
      } finally {
        const next = queue.shift();
        if (next) next();
        else active--;
      }
    })();
    pending.set(id, operation);
    try {
      return await operation;
    } finally {
      pending.delete(id);
    }
  }
  async function detail(id: string, fresh = false): Promise<CatalogMarket> {
    if (fresh) return refresh(id);
    const found = recent(id);
    // Show a usable public snapshot immediately. Only one background refresh
    // runs per market; its rejection is handled and never replaces the snapshot.
    if (found && found.market.yesPrice !== null && found.market.noPrice !== null && found.market.volumeUsdc !== null) {
      if (found.detailAt === null || now() - found.detailAt >= freshFor) void refresh(id).catch(() => undefined);
      return found.market;
    }
    if (found?.detailAt != null && now() - found.detailAt < freshFor) return found.market;
    return refresh(id);
  }
  function page(value: unknown) {
    const parsed = parseCatalogPage(value);
    // Never wait for individual RPC reads before showing discovery. Catalog
    // observations seed the same cache used by detail, including actual zeros.
    const items = parsed.items.map(original => {
      const found = recent(original.marketId);
      const incoming = observe(original);
      const market = found ? mergeMarketSnapshot(found.market, incoming) : incoming;
      remember(market, found?.market.phase === original.phase ? found.detailAt : null);
      return market;
    });
    return { ...parsed, items };
  }
  return { page, detail };
}
