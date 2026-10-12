import bs58 from 'bs58';

import { CatalogError, parseMarketActivity, type CatalogTrade, type MarketPhase } from './panta-catalog';

export type WalletPosition = {
  marketId: string;
  category: string | null;
  side: 'yes' | 'no';
  shares: string;
  phase: MarketPhase;
  claimable: boolean;
  claimed: boolean;
  outcome: 'yes' | 'no' | null;
};
export type WalletPositions = { wallet: string; positions: WalletPosition[]; disclaimer: string | null };
export type WalletActivity = { wallet: string; items: CatalogTrade[]; disclaimer: string | null };
export function isWalletAddress(value: string): boolean {
  try {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogError('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function note(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > 2000) throw new CatalogError('INVALID_RESPONSE');
  return value;
}
export function parseWalletPositions(value: unknown, wallet: string): WalletPositions {
  const row = object(value);
  if (row.wallet !== wallet || !isWalletAddress(wallet) || !Array.isArray(row.positions) || row.positions.length > 200)
    throw new CatalogError('INVALID_RESPONSE');
  const positions = row.positions.map((value: unknown): WalletPosition => {
    const item = object(value);
    if (
      typeof item.marketId !== 'string' ||
      !isWalletAddress(item.marketId) ||
      !['yes', 'no'].includes(String(item.side)) ||
      !['primary', 'secondary', 'resolved', 'cancelled'].includes(String(item.phase)) ||
      typeof item.shares !== 'string' ||
      !/^\d{1,30}(\.\d{1,18})?$/.test(item.shares) ||
      typeof item.claimable !== 'boolean' ||
      typeof item.claimed !== 'boolean' ||
      (item.outcome != null && item.outcome !== 'yes' && item.outcome !== 'no') ||
      (item.category != null && (typeof item.category !== 'string' || item.category.length > 64))
    )
      throw new CatalogError('INVALID_RESPONSE');
    return {
      marketId: item.marketId,
      side: item.side as 'yes' | 'no',
      shares: item.shares,
      phase: item.phase as MarketPhase,
      category: (item.category as string | null) ?? null,
      claimable: item.claimable,
      claimed: item.claimed,
      outcome: (item.outcome as 'yes' | 'no' | null) ?? null,
    };
  });
  if (new Set(positions.map(item => `${item.marketId}:${item.side}`)).size !== positions.length) throw new CatalogError('INVALID_RESPONSE');
  return { wallet, positions, disclaimer: note(row.disclaimer) };
}
export function parseWalletActivity(value: unknown, wallet: string): WalletActivity {
  const row = object(value);
  if (row.wallet !== wallet || !isWalletAddress(wallet) || !Array.isArray(row.items) || row.items.length > 200)
    throw new CatalogError('INVALID_RESPONSE');
  const items = row.items.map(value => {
    const item = object(value);
    const trade = parseMarketActivity({ marketId: item.marketId, items: [item] }).items[0];
    if (trade.wallet !== wallet) throw new CatalogError('INVALID_RESPONSE');
    return trade;
  });
  if (new Set(items.map(item => item.id)).size !== items.length) throw new CatalogError('INVALID_RESPONSE');
  return { wallet, items, disclaimer: note(row.disclaimer) };
}
export function createPortfolioClient(baseUrl: string, fetcher: typeof fetch = fetch) {
  const url = new URL(baseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
  )
    throw new CatalogError('UNAVAILABLE');
  async function request<T>(path: string, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener('abort', cancel);
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, 15000);
    try {
      const result = await fetcher(baseUrl.replace(/\/$/, '') + path, {
        headers: { Accept: 'application/json' },
        signal: abort.signal,
        redirect: 'error',
      });
      if (!result.ok)
        throw new CatalogError(
          result.status === 429 ? 'RATE_LIMITED' : result.status === 401 || result.status === 403 ? 'ACCESS_REQUIRED' : 'UNAVAILABLE',
          result.status === 429 ? 60 : null
        );
      const raw = await result.text();
      if (raw.length > 1024 * 1024) throw new CatalogError('INVALID_RESPONSE');
      return parse(JSON.parse(raw));
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      throw new CatalogError('UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
  return {
    balances: (wallet: string, signal?: AbortSignal) => {
      if (!isWalletAddress(wallet)) throw new CatalogError('INVALID_RESPONSE');
      return request(`/wallets/${wallet}/balances/`, value => parseWalletBalances(value, wallet), signal);
    },
    positions: (wallet: string, signal?: AbortSignal) => {
      if (!isWalletAddress(wallet)) throw new CatalogError('INVALID_RESPONSE');
      return request(`/positions/?wallet=${wallet}`, value => parseWalletPositions(value, wallet), signal);
    },
    activity: (wallet: string, signal?: AbortSignal) => {
      if (!isWalletAddress(wallet)) throw new CatalogError('INVALID_RESPONSE');
      return request(`/wallets/${wallet}/trades/?limit=50`, value => parseWalletActivity(value, wallet), signal);
    },
  };
}

export type WalletBalances = {
  wallet: string;
  chain: 'mainnet-beta';
  slot: number;
  fetchedAt: string;
  solLamports: string;
  usdcBaseUnits: string;
  usdcAccount: string;
  usdcState: 'missing' | 'initialized' | 'frozen';
};
export function parseWalletBalances(value: unknown, wallet: string): WalletBalances {
  const row = object(value);
  const units = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n;
  if (
    !isWalletAddress(wallet) ||
    row.wallet !== wallet ||
    row.chain !== 'mainnet-beta' ||
    !Number.isSafeInteger(row.slot) ||
    Number(row.slot) < 0 ||
    typeof row.fetchedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.fetchedAt)) ||
    new Date(row.fetchedAt).toISOString() !== row.fetchedAt ||
    !units(row.solLamports) ||
    !units(row.usdcBaseUnits) ||
    typeof row.usdcAccount !== 'string' ||
    !isWalletAddress(row.usdcAccount) ||
    !['missing', 'initialized', 'frozen'].includes(String(row.usdcState)) ||
    (row.usdcState === 'missing' && row.usdcBaseUnits !== '0')
  )
    throw new CatalogError('INVALID_RESPONSE');
  return {
    wallet,
    chain: 'mainnet-beta',
    slot: row.slot as number,
    fetchedAt: row.fetchedAt,
    solLamports: row.solLamports,
    usdcBaseUnits: row.usdcBaseUnits,
    usdcAccount: row.usdcAccount,
    usdcState: row.usdcState as WalletBalances['usdcState'],
  };
}
/** Exact display of base units, including amounts beyond Number's safe integer range. */
export function formatWalletUnits(value: string, decimals: 6 | 9): string {
  if (!/^(0|[1-9]\d{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n) throw new CatalogError('INVALID_RESPONSE');
  const padded = value.padStart(decimals + 1, '0');
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return padded.slice(0, -decimals) + (fraction ? `.${fraction}` : '');
}
