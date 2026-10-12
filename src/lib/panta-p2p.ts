import { type OrderBuild } from './panta-order-build';
import { isWalletAddress } from './panta-portfolio';
import { type PurchaseCost } from './panta-purchase';

export type P2PIntent = 'buy' | 'sell' | 'cancel' | 'withdraw';
// A work bound, not a promise that every queue fits a single Solana transaction.
export const p2pMaxPeers = 16;
export const p2pMaxTradeAccounts = 16 + 2 * p2pMaxPeers + 1;
export type P2PRequest = {
  wallet: string;
  marketId: string;
  intent: P2PIntent;
  side: 'yes' | 'no';
  price: string;
  shares: string;
  order: string | null;
};
export type P2POrder = {
  address: string;
  owner: string;
  side: 'yes' | 'no';
  intent: 'buy' | 'sell';
  price: string;
  shares: string;
};
export type P2PBook = {
  marketId: string;
  slot: number;
  observedAt: number;
  tradingOpen: boolean;
  feeBps: number;
  orders: P2POrder[];
  availableCash: string;
  yesShares: string;
  noShares: string;
};
export type P2PFacts = {
  filledShares: string;
  remainingShares: string;
  lockedUsdc: string;
  refundUsdc: string;
  cashCreditUsdc: string;
  rentRefundLamports: string;
};
export type P2PBuild = OrderBuild & { p2p: { request: P2PRequest; facts: P2PFacts; cost: PurchaseCost; snapshotHash: string } };
export class P2PError extends Error {
  constructor(public readonly code: 'INVALID_P2P' | 'P2P_UNAVAILABLE' | 'P2P_CHANGED' | 'P2P_CLOSED' | 'P2P_BLOCKED' | 'P2P_COMPLEX_BOOK') {
    super(
      {
        INVALID_P2P: 'Check the price, quantity and selected order.',
        P2P_UNAVAILABLE: 'The order book could not be verified. Try refreshing.',
        P2P_CHANGED: 'The order book or balances changed. Request a new review.',
        P2P_COMPLEX_BOOK: 'Orders at this price need a matching path Toss cannot verify yet. Choose another limit price or try again.',
        P2P_CLOSED: 'This market is no longer open for new orders.',
        P2P_BLOCKED: 'This order or its full cost could not be verified. Check your available shares, USDC and SOL.',
      }[code]
    );
  }
}
export function p2pCheck(ok: unknown, code: P2PError['code'] = 'INVALID_P2P'): asserts ok {
  if (!ok) throw new P2PError(code);
}
export function p2pUnits(value: string, decimals: number): bigint {
  p2pCheck(typeof value === 'string' && /^(0|[1-9]\d{0,10})(\.\d{1,9})?$/.test(value));
  const [whole, fraction = ''] = value.split('.');
  p2pCheck(fraction.length <= decimals);
  const units = BigInt(whole + fraction.padEnd(decimals, '0'));
  p2pCheck(units <= 18446744073709551615n);
  return units;
}
export function p2pDecimal(value: bigint, decimals: number): string {
  p2pCheck(value >= 0n);
  const text = value.toString().padStart(decimals + 1, '0');
  const fraction = text.slice(-decimals).replace(/0+$/, '');
  return `${text.slice(0, -decimals)}${fraction ? `.${fraction}` : ''}`;
}
export function parseP2PRequest(value: unknown): P2PRequest {
  const row = value as P2PRequest;
  p2pCheck(row && typeof row === 'object' && !Array.isArray(row));
  p2pCheck(Object.keys(row).sort().join(',') === 'intent,marketId,order,price,shares,side,wallet');
  p2pCheck(isWalletAddress(row.wallet) && isWalletAddress(row.marketId));
  p2pCheck(['buy', 'sell', 'cancel', 'withdraw'].includes(row.intent) && ['yes', 'no'].includes(row.side));
  const price = p2pUnits(row.price, 9);
  const shares = p2pUnits(row.shares, 6);
  if (row.intent === 'buy' || row.intent === 'sell') p2pCheck(price > 0n && shares > 0n && row.order === null);
  else
    p2pCheck(
      price === 0n &&
        shares === 0n &&
        (row.intent === 'cancel' ? typeof row.order === 'string' && isWalletAddress(row.order) : row.order === null)
    );
  return { ...row, price: p2pDecimal(price, 9), shares: p2pDecimal(shares, 6) };
}
export function parseP2PBook(value: unknown, marketId: string, now = Date.now()): P2PBook {
  const row = value as P2PBook;
  p2pCheck(row && row.marketId === marketId && Number.isSafeInteger(row.slot) && row.slot >= 0);
  p2pCheck(Number.isSafeInteger(row.observedAt) && row.observedAt <= now && now - row.observedAt <= 30000);
  p2pCheck(typeof row.tradingOpen === 'boolean' && Number.isInteger(row.feeBps) && row.feeBps >= 0 && row.feeBps <= 10000);
  p2pCheck(Array.isArray(row.orders) && row.orders.length <= 100);
  const addresses = new Set<string>();
  for (const order of row.orders) {
    p2pCheck(isWalletAddress(order.address) && isWalletAddress(order.owner) && !addresses.has(order.address));
    addresses.add(order.address);
    p2pCheck(['yes', 'no'].includes(order.side) && ['buy', 'sell'].includes(order.intent));
    p2pCheck(p2pUnits(order.price, 9) > 0n && p2pUnits(order.shares, 6) > 0n);
  }
  for (const field of ['availableCash', 'yesShares', 'noShares'] as const) p2pUnits(row[field], 6);
  return row;
}
