import bs58 from 'bs58';

export type OrderRequest = { wallet: string; marketId: string; side: 'yes' | 'no'; amountUsdc: string };
export type OrderQuote = OrderRequest & {
  quoteId: string;
  shares: string;
  avgPrice: string | null;
  feeUsdc: string;
  expiresAt: string;
  disclaimer: string | null;
};
export const orderErrorMessages = {
  INVALID_AMOUNT: 'Enter a positive USDC amount with up to six decimal places.',
  INVALID_REQUEST: 'This order couldn’t be validated. Please reconnect your wallet and try again.',
  INVALID_RESPONSE: 'Panta returned an incomplete or mismatched quote. Request a new quote.',
  BUILD_UNAVAILABLE: 'Panta returned no transaction instructions. This order cannot be signed.',
  QUOTE_STALE: 'The price or fee changed beyond your review. Request a fresh quote.',
  BUILD_RESTART: 'This build attempt cannot be repeated safely. Request a fresh quote.',
  EXPIRED: 'This quote has expired. Request a new quote.',
  ACCESS_REQUIRED: 'Panta API access is unavailable. Please try again later.',
  RATE_LIMITED: 'Please wait before requesting another quote.',
  AMOUNT_TOO_SMALL: 'This amount is below Panta’s minimum for this market.',
  INVALID_MARKET_PARAMS: 'Panta couldn’t prepare this market right now. Request a fresh quote or choose another market.',
  MARKET_NOT_FOUND: 'This market is no longer available.',
  MARKET_NOT_IN_PRIMARY: 'This market no longer accepts primary buys.',
  UNAVAILABLE: 'We couldn’t get a quote. Check your connection and try again.',
} as const;
export class OrderError extends Error {
  constructor(
    public readonly code: keyof typeof orderErrorMessages,
    public readonly retryAfterSeconds = 0
  ) {
    super(orderErrorMessages[code]);
    this.name = 'OrderError';
  }
}

/** Canonical decimal strings only: never round money through floating point. */
export function normalizeUsdc(input: string): string {
  if (!/^(0|[1-9]\d{0,14})(\.\d{1,6})?$/.test(input)) throw new OrderError('INVALID_AMOUNT');
  const [whole, fraction = ''] = input.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  if (whole === '0' && !trimmed) throw new OrderError('INVALID_AMOUNT');
  return trimmed ? `${whole}.${trimmed}` : whole;
}
function address(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}
export function parseOrderRequest(value: unknown): OrderRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OrderError('INVALID_REQUEST');
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some(key => !['wallet', 'marketId', 'side', 'amountUsdc'].includes(key)) ||
    !address(row.wallet) ||
    !address(row.marketId) ||
    !['yes', 'no'].includes(String(row.side)) ||
    typeof row.amountUsdc !== 'string'
  )
    throw new OrderError('INVALID_REQUEST');
  return { wallet: row.wallet, marketId: row.marketId, side: row.side as OrderRequest['side'], amountUsdc: normalizeUsdc(row.amountUsdc) };
}
function decimal(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,29})(\.\d{1,18})?$/.test(value)) throw new OrderError('INVALID_RESPONSE');
  return value;
}
export function parseOrderQuote(value: unknown, request: OrderRequest, now = Date.now()): OrderQuote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OrderError('INVALID_RESPONSE');
  const row = value as Record<string, unknown>;
  let amount: string;
  try {
    if (typeof row.amountUsdc !== 'string') throw new OrderError('INVALID_RESPONSE');
    amount = normalizeUsdc(row.amountUsdc);
  } catch {
    throw new OrderError('INVALID_RESPONSE');
  }
  if (
    row.marketId !== request.marketId ||
    row.side !== request.side ||
    amount !== request.amountUsdc ||
    (row.wallet !== undefined && row.wallet !== request.wallet) ||
    typeof row.quoteId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(row.quoteId) ||
    typeof row.expiresAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(row.expiresAt)
  )
    throw new OrderError('INVALID_RESPONSE');
  const expiry = Date.parse(row.expiresAt);
  if (!Number.isFinite(expiry) || new Date(expiry).toISOString().slice(0, 19) !== row.expiresAt.slice(0, 19))
    throw new OrderError('INVALID_RESPONSE');
  if (expiry <= now) throw new OrderError('EXPIRED');
  const shares = decimal(row.shares);
  if (!/[1-9]/.test(shares)) throw new OrderError('INVALID_RESPONSE');
  if (row.avgPrice != null && (Number(decimal(row.avgPrice)) <= 0 || Number(row.avgPrice) > 1)) throw new OrderError('INVALID_RESPONSE');
  const disclaimer = row.disclaimer == null ? null : row.disclaimer;
  if (disclaimer !== null && (typeof disclaimer !== 'string' || disclaimer.length > 2000)) throw new OrderError('INVALID_RESPONSE');
  return {
    ...request,
    quoteId: row.quoteId,
    shares,
    avgPrice: row.avgPrice == null ? null : decimal(row.avgPrice),
    feeUsdc: decimal(row.feeUsdc),
    expiresAt: row.expiresAt,
    disclaimer,
  };
}
