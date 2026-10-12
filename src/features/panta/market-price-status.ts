import { type CatalogMarket } from '@/lib/panta-catalog';

export function marketPriceStatus(market: CatalogMarket, now = Date.now()): 'fresh' | 'stale' | 'unavailable' {
  if (market.yesPrice === null || market.noPrice === null) return 'unavailable';
  const observed = market.priceObservedAt;
  return observed != null && observed <= now && now - observed < 30000 ? 'fresh' : 'stale';
}
export function currentMarketPrices(market: CatalogMarket, now = Date.now()): CatalogMarket {
  return marketPriceStatus(market, now) === 'fresh' ? market : { ...market, yesPrice: null, noPrice: null };
}
