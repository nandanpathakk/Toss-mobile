import { type VerifiedAccountWallet } from '@/lib/panta-account-verification';

export type TradingAccountState = {
  status: 'idle' | 'verifying' | 'verified' | 'error';
  proof: VerifiedAccountWallet | null;
  error: string | null;
  accountId: string | null;
  wallet: string | null;
};
export const emptyTradingAccountState: TradingAccountState = { status: 'idle', proof: null, error: null, accountId: null, wallet: null };

// Derive before effects run, so an account switch cannot briefly display the old
// verified state. This result is presentation only, never a spending credential.
export function visibleTradingAccountState(
  state: TradingAccountState,
  accountId: string | null,
  wallet: string | null,
  canVerify: boolean,
  now = Date.now()
): TradingAccountState {
  if (!canVerify || !wallet || !accountId || state.accountId !== accountId || state.wallet !== wallet) return emptyTradingAccountState;
  if (
    state.status === 'verified' &&
    (!state.proof ||
      state.proof.wallet !== wallet ||
      Date.parse(state.proof.expiresAt) <= now ||
      !Number.isFinite(Date.parse(state.proof.expiresAt)))
  )
    return emptyTradingAccountState;
  return state;
}
