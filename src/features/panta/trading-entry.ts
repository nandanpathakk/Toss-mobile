import { type MarketPhase } from '@/lib/panta-catalog';
import { isWalletAddress } from '@/lib/panta-portfolio';

export type TradingEntry = 'closed' | 'connecting' | 'unavailable' | 'sign-in' | 'wallet' | 'primary' | 'p2p';
export type TradingIntent = 'yes' | 'no' | 'buy' | 'sell';

/** UI routing only. Ownership, quote, approval and transaction checks still run in the order flow. */
export function tradingEntry(
  phase: MarketPhase,
  account: { ready: boolean; failed: boolean; authenticated: boolean; address: string | null },
  endTime: number | null = null,
  now = Date.now()
): TradingEntry {
  if (phase === 'resolved' || phase === 'cancelled' || (endTime !== null && Number.isFinite(endTime) && endTime * 1000 <= now))
    return 'closed';
  if (account.failed) return 'unavailable';
  if (!account.ready) return 'connecting';
  if (!account.authenticated) return 'sign-in';
  if (!account.address || !isWalletAddress(account.address)) return 'wallet';
  return phase === 'primary' ? 'primary' : 'p2p';
}
