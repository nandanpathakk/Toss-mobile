/** Read-only catalog contract. Credentials belong to the gateway, never this client. */
export type MarketPhase = 'primary' | 'secondary' | 'resolved' | 'cancelled';
export type CatalogMarket = {
  marketId: string;
  title: string;
  description: string;
  category: string;
  images: string[];
  phase: MarketPhase;
  volumeUsdc: string | null;
  startTime: number | null;
  endTime: number | null;
  resolutionTime: number | null;
  region: string | null;
  marketType: 'standard' | 'breaking' | null;
  resolved: boolean | null;
  yesPrice: number | null;
  noPrice: number | null;
  disclaimer: string | null;
  totalVolumeUsdc?: string | null;
  activeVolumeUsdc?: string | null;
  resolutionRule?: string | null;
  sources?: string[];
  creatorAddress?: string | null;
  creatorHandle?: string | null;
  createdAt?: number | null;
  resolvedAt?: number | null;
  outcome?: 'yes' | 'no' | null;
  totalTrades?: string | null;
  priceSource?: string | null;
  /** Gateway observation time in milliseconds; never an execution-price guarantee. */
  priceObservedAt?: number | null;
  valuationStatus?: string | null;
  marketStatus?: string | null;
};
export type CatalogPage = { items: CatalogMarket[]; nextCursor: string | null; disclaimer: string | null };
export type CatalogFilters = { category?: string; status?: MarketPhase; cursor?: string; limit?: number };
export type CatalogTrade = {
  id: string;
  marketId: string;
  wallet: string;
  isPrimary: boolean;
  yesAmount: string;
  noAmount: string;
  feePaid: string;
  blockTime: number | null;
  signature: string;
  quoteAsset: string;
};
export type MarketActivity = { marketId: string; items: CatalogTrade[]; disclaimer: string | null };
export type CatalogErrorCode = 'ACCESS_REQUIRED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'INVALID_RESPONSE';

export class CatalogError extends Error {
  constructor(
    public readonly code: CatalogErrorCode,
    public readonly retryAfterSeconds: number | null = null
  ) {
    super(code);
    this.name = 'CatalogError';
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogError('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) throw new CatalogError('INVALID_RESPONSE');
  return value;
}

function price(value: unknown): number | null {
  // Missing RPC prices remain unavailable; never invent a midpoint or complement.
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value) || value.length > 40)) {
    throw new CatalogError('INVALID_RESPONSE');
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new CatalogError('INVALID_RESPONSE');
  return number;
}

function timestamp(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 253402300799) return value;
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (match) {
      const [, year, month, day, hour, minute, second] = match.map(Number);
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const milliseconds = Date.parse(value);
      if (
        year >= 1970 &&
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= daysInMonth &&
        hour <= 23 &&
        minute <= 59 &&
        second <= 59 &&
        Number.isFinite(milliseconds) &&
        milliseconds >= 0 &&
        milliseconds <= 253402300799999
      ) {
        return Math.floor(milliseconds / 1000);
      }
    }
  }
  throw new CatalogError('INVALID_RESPONSE');
}

function disclaimer(value: unknown): string | null {
  return value == null ? null : text(value, 2000);
}

export function parseCatalogMarket(value: unknown): CatalogMarket {
  const row = object(value);
  const marketId = text(row.marketId, 44);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(marketId)) throw new CatalogError('INVALID_RESPONSE');
  // Live catalog entries may have empty titles; label the missing metadata explicitly.
  const title = text(row.title, 1000).trim() || (row.question == null ? '' : text(row.question, 1000).trim()) || 'Untitled market';
  if (row.isResolved != null && typeof row.isResolved !== 'boolean') throw new CatalogError('INVALID_RESPONSE');
  if (row.isCancelled != null && typeof row.isCancelled !== 'boolean') throw new CatalogError('INVALID_RESPONSE');
  const phase = row.isCancelled === true ? 'cancelled' : row.isResolved === true ? 'resolved' : row.phase;
  if (phase !== 'primary' && phase !== 'secondary' && phase !== 'resolved' && phase !== 'cancelled') {
    throw new CatalogError('INVALID_RESPONSE');
  }
  const totalVolumeUsdc = row.totalVolumeUsdc == null ? null : text(row.totalVolumeUsdc, 40);
  if (totalVolumeUsdc !== null && !/^\d+(?:\.\d+)?$/.test(totalVolumeUsdc)) throw new CatalogError('INVALID_RESPONSE');
  const reportedVolume = row.volumeUsdc == null ? null : text(row.volumeUsdc, 40);
  const volumeUsdc = totalVolumeUsdc ?? reportedVolume;
  const activeVolumeUsdc = row.activeVolumeUsdc == null ? reportedVolume : text(row.activeVolumeUsdc, 40);
  if (activeVolumeUsdc !== null && !/^\d+(?:\.\d+)?$/.test(activeVolumeUsdc)) throw new CatalogError('INVALID_RESPONSE');
  if (volumeUsdc !== null && !/^\d+(?:\.\d+)?$/.test(volumeUsdc)) throw new CatalogError('INVALID_RESPONSE');
  const startTime = timestamp(row.startTime);
  const endTime = timestamp(row.endTime);
  const resolutionTime = timestamp(row.resolutionTime);
  const region = row.region == null ? null : text(row.region, 128);
  const marketType = row.marketType == null ? null : row.marketType;
  if (marketType !== null && marketType !== 'standard' && marketType !== 'breaking') throw new CatalogError('INVALID_RESPONSE');
  const resolved = row.isResolved ?? (row.resolved == null ? null : row.resolved);
  if (resolved !== null && typeof resolved !== 'boolean') throw new CatalogError('INVALID_RESPONSE');
  if (!Array.isArray(row.images) || row.images.length > 20) throw new CatalogError('INVALID_RESPONSE');
  const images = row.images
    .map(value => text(value, 2048))
    .filter(value => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
      } catch {
        return false;
      }
    });
  const rule = row.resolutionRule == null ? null : text(row.resolutionRule, 20000);
  const sources = row.sources == null ? [] : row.sources;
  if (!Array.isArray(sources) || sources.length > 30) throw new CatalogError('INVALID_RESPONSE');
  const sourceUrls = sources
    .map(value => text(value, 2048))
    .filter(value => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
      } catch {
        return false;
      }
    });
  const creatorAddress = row.creatorAddress == null ? null : text(row.creatorAddress, 44);
  if (creatorAddress !== null && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(creatorAddress)) throw new CatalogError('INVALID_RESPONSE');
  const totalTrades = row.totalTrades == null ? null : String(row.totalTrades);
  if (
    totalTrades !== null &&
    (!/^\d{1,20}$/.test(totalTrades) || (typeof row.totalTrades === 'number' && !Number.isSafeInteger(row.totalTrades)))
  )
    throw new CatalogError('INVALID_RESPONSE');
  const outcome = row.outcome == null ? null : row.outcome;
  if (outcome !== null && outcome !== 'yes' && outcome !== 'no') throw new CatalogError('INVALID_RESPONSE');
  if (row.yesWins != null && typeof row.yesWins !== 'boolean') throw new CatalogError('INVALID_RESPONSE');
  return {
    marketId,
    title,
    description: text(row.description, 20000),
    category: text(row.category, 64),
    images,
    phase,
    volumeUsdc,
    totalVolumeUsdc,
    activeVolumeUsdc,
    resolutionRule: rule,
    sources: [...new Set(sourceUrls)],
    creatorAddress,
    creatorHandle:
      row.creatorHandle == null
        ? row.creatorTwitterHandle == null
          ? null
          : text(row.creatorTwitterHandle, 128)
        : text(row.creatorHandle, 128),
    createdAt: timestamp(row.createdAt) || null,
    resolvedAt: timestamp(row.resolvedAt) || null,
    outcome: resolved === true && typeof row.yesWins === 'boolean' ? (row.yesWins ? 'yes' : 'no') : outcome,
    totalTrades,
    priceSource: row.priceSource == null ? null : text(row.priceSource, 128),
    priceObservedAt:
      row.priceObservedAt == null
        ? null
        : typeof row.priceObservedAt === 'number' && Number.isSafeInteger(row.priceObservedAt) && row.priceObservedAt > 0
          ? row.priceObservedAt
          : (() => {
              throw new CatalogError('INVALID_RESPONSE');
            })(),
    valuationStatus: row.valuationStatus == null ? null : text(row.valuationStatus, 64),
    marketStatus: row.marketStatus == null ? (row.status == null ? null : text(row.status, 64)) : text(row.marketStatus, 64),
    startTime,
    endTime,
    resolutionTime,
    region,
    marketType,
    resolved,
    yesPrice: price(row.yesPrice),
    noPrice: price(row.noPrice),
    disclaimer: disclaimer(row.disclaimer),
  };
}

export function parseCatalogPage(value: unknown): CatalogPage {
  const page = object(value);
  if (!Array.isArray(page.items) || page.items.length > 50) throw new CatalogError('INVALID_RESPONSE');
  const note = disclaimer(page.disclaimer);
  const items = page.items.map(value => {
    const market = parseCatalogMarket(value);
    return { ...market, disclaimer: market.disclaimer ?? note };
  });
  if (new Set(items.map(item => item.marketId)).size !== items.length) throw new CatalogError('INVALID_RESPONSE');
  const nextCursor = page.nextCursor == null ? null : text(page.nextCursor, 256);
  if (nextCursor === '') throw new CatalogError('INVALID_RESPONSE');
  return { items, nextCursor, disclaimer: note };
}

function amount(value: unknown): string {
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)) {
    throw new CatalogError('INVALID_RESPONSE');
  }
  const result = typeof value === 'number' ? String(value) : text(value, 40);
  if (!/^\d+(?:\.\d+)?$/.test(result) || result.length > 40) throw new CatalogError('INVALID_RESPONSE');
  return result;
}

export function parseMarketActivity(value: unknown, expectedMarketId?: string): MarketActivity {
  const data = object(value);
  const marketId = text(data.marketId, 44);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(marketId) || (expectedMarketId && marketId !== expectedMarketId)) {
    throw new CatalogError('INVALID_RESPONSE');
  }
  if (!Array.isArray(data.items) || data.items.length > 200) throw new CatalogError('INVALID_RESPONSE');
  const items = data.items.map(value => {
    const row = object(value);
    const id = typeof row.id === 'number' && Number.isSafeInteger(row.id) && row.id >= 0 ? String(row.id) : text(row.id, 128);
    const wallet = text(row.wallet, 44);
    const signature = text(row.signature, 88);
    if (
      !id ||
      row.marketId !== marketId ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet) ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature) ||
      typeof row.isPrimary !== 'boolean'
    ) {
      throw new CatalogError('INVALID_RESPONSE');
    }
    return {
      id,
      marketId,
      wallet,
      signature,
      isPrimary: row.isPrimary,
      yesAmount: amount(row.yesAmount),
      noAmount: amount(row.noAmount),
      feePaid: amount(row.feePaid),
      blockTime: timestamp(row.blockTime),
      quoteAsset: text(row.quoteAsset, 64),
    };
  });
  if (new Set(items.map(item => item.id)).size !== items.length) throw new CatalogError('INVALID_RESPONSE');
  return { marketId, items, disclaimer: disclaimer(data.disclaimer) };
}

export function parseCategories(value: unknown): { categories: string[] } {
  const data = object(value);
  if (!Array.isArray(data.categories) || data.categories.length > 100) throw new CatalogError('INVALID_RESPONSE');
  const categories = data.categories.map(value => text(value, 64));
  if (categories.some(value => !/^[a-z0-9_-]+$/.test(value)) || new Set(categories).size !== categories.length) {
    throw new CatalogError('INVALID_RESPONSE');
  }
  return { categories };
}

export function createCatalogClient(baseUrl: string, fetcher: typeof fetch = fetch) {
  const base = new URL(baseUrl);
  const local = base.hostname === '127.0.0.1' || base.hostname === 'localhost';
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) || base.username || base.password || base.search || base.hash) {
    throw new Error('Catalog gateway must use HTTPS, or loopback HTTP for local development');
  }
  const prefix = baseUrl.replace(/\/$/, '');
  async function request<T>(path: string, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort);
    const timeout = setTimeout(abort, 45000);
    try {
      const response = await fetcher(`${prefix}${path}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) {
        const code =
          response.status === 401 || response.status === 403 ? 'ACCESS_REQUIRED' : response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE';
        const retry = Number(response.headers.get('Retry-After'));
        throw new CatalogError(code, Number.isInteger(retry) && retry > 0 ? Math.min(retry, 3600) : null);
      }
      const body = await response.text();
      if (body.length > 1024 * 1024) throw new CatalogError('INVALID_RESPONSE');
      try {
        return parse(JSON.parse(body));
      } catch {
        throw new CatalogError('INVALID_RESPONSE');
      }
    } catch (error) {
      if (controller.signal.aborted && signal?.aborted) throw error;
      if (error instanceof CatalogError) throw error;
      throw new CatalogError('UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  return {
    categories: (signal?: AbortSignal) => request('/categories/', parseCategories, signal),
    markets: (filters: CatalogFilters = {}, signal?: AbortSignal) => {
      const params = new URLSearchParams();
      if (filters.category) params.set('category', filters.category);
      if (filters.status) params.set('status', filters.status);
      if (filters.cursor) params.set('cursor', filters.cursor);
      if (filters.limit !== undefined) {
        if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 50) throw new Error('Invalid catalog page size');
        params.set('limit', String(filters.limit));
      }
      return request(`/markets/${params.toString() ? `?${params}` : ''}`, parseCatalogPage, signal);
    },
    activity: (marketId: string, limit = 20, signal?: AbortSignal) => {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(marketId)) throw new Error('Invalid market address');
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid activity limit');
      return request(`/markets/${marketId}/trades/?limit=${limit}`, value => parseMarketActivity(value, marketId), signal);
    },
    market: (marketId: string, signal?: AbortSignal, fresh = false) => {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(marketId)) throw new Error('Invalid market address');
      return request(`/markets/${marketId}/${fresh ? '?fresh=1' : ''}`, parseCatalogMarket, signal);
    },
  };
}

/** Keep known public fields during a partial read, but never carry prices across phases. */
export function mergeMarketSnapshot(previous: CatalogMarket, detail: CatalogMarket): CatalogMarket {
  if (previous.marketId !== detail.marketId || previous.phase !== detail.phase) return detail;
  const merged = { ...detail };
  for (const key of Object.keys(previous) as (keyof CatalogMarket)[]) {
    const value = detail[key];
    if (value == null || value === '' || (Array.isArray(value) && !value.length) || (key === 'title' && value === 'Untitled market')) {
      Object.assign(merged, { [key]: previous[key] });
    }
  }
  // Keep the normalized total consistent when a reduced row omits the total
  // but still includes active volume (including a real active zero).
  merged.volumeUsdc = merged.totalVolumeUsdc ?? merged.volumeUsdc;
  // A partial price pair must retain the older observation time, not appear
  // freshly priced because unrelated metadata was fetched successfully.
  if ((detail.yesPrice === null && previous.yesPrice !== null) || (detail.noPrice === null && previous.noPrice !== null))
    merged.priceObservedAt = previous.priceObservedAt ?? null;
  return merged;
}
