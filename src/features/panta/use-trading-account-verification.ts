import { useEffect, useRef, useState } from 'react';

import { useEmbeddedSolanaWallet, useIdentityToken, usePrivy } from '@privy-io/expo';

import { AccountVerificationError, createAccountVerificationClient } from '@/lib/panta-account-verification';
import { pantaGatewayUrl } from '@/lib/panta-api';

import { accountWalletAddress } from './account-state';
import { emptyTradingAccountState as initial, visibleTradingAccountState, type TradingAccountState } from './trading-account-state';

const verifyWallet = pantaGatewayUrl ? createAccountVerificationClient(pantaGatewayUrl) : null;

// Token access stays inside this operation. No token/provider is returned to the
// account connection boundary, UI, persisted stores, errors or logs.
export function useTradingAccountVerification(wallet: string | null) {
  const auth = usePrivy();
  const embedded = useEmbeddedSolanaWallet();
  const { getIdentityToken } = useIdentityToken();
  const owned = accountWalletAddress(auth.isReady && !auth.error, auth.user, embedded.status, embedded.wallets?.map(w => w.address) ?? []);
  const userId = auth.user?.id ?? null;
  const canVerify = Boolean(verifyWallet && owned && owned === wallet && userId);
  const [state, setState] = useState<TradingAccountState>(initial);
  const latest = useRef({ wallet, userId, owned, canVerify });
  latest.current = { wallet, userId, owned, canVerify };
  const generation = useRef(0);
  const flight = useRef<AbortController | null>(null);
  useEffect(() => {
    generation.current++;
    flight.current?.abort();
    flight.current = null;
    setState(initial);
    return () => {
      generation.current++;
      flight.current?.abort();
      flight.current = null;
    };
  }, [wallet, userId, owned, canVerify]);
  useEffect(() => {
    if (!state.proof) return;
    const timer = setTimeout(() => setState(initial), Math.max(0, Date.parse(state.proof.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [state.proof]);
  async function verify() {
    if (!canVerify || !wallet || !userId || !verifyWallet || flight.current) return;
    const current = generation.current;
    const abort = new AbortController();
    flight.current = abort;
    const valid = () =>
      !abort.signal.aborted &&
      generation.current === current &&
      latest.current.canVerify &&
      latest.current.wallet === wallet &&
      latest.current.userId === userId &&
      latest.current.owned === wallet;
    setState({ status: 'verifying', proof: null, error: null, accountId: userId, wallet });
    try {
      // Refresh signed user data after wallet creation or dashboard token enablement.
      const refreshed = await auth.refreshUser();
      if (!valid()) return;
      if (refreshed.user.id !== userId) throw new AccountVerificationError('ACCOUNT_UNVERIFIED');
      const accessToken = await auth.getAccessToken();
      if (!valid()) return;
      const identityToken = await getIdentityToken();
      if (!valid()) return;
      if (!accessToken) throw new AccountVerificationError('ACCOUNT_REQUIRED');
      if (!identityToken) throw new AccountVerificationError('IDENTITY_DISABLED');
      const proof = await verifyWallet(wallet, accessToken, identityToken, abort.signal);
      if (valid()) setState({ status: 'verified', proof, error: null, accountId: userId, wallet });
    } catch (error) {
      if (valid())
        setState({
          status: 'error',
          proof: null,
          accountId: userId,
          wallet,
          error: error instanceof AccountVerificationError ? error.message : 'Account verification is unavailable. Please try again later.',
        });
    } finally {
      if (flight.current === abort) flight.current = null;
    }
  }
  // Ownership checks are read-only. Errors require an explicit retry; signing is never automatic.
  const verifyLatest = useRef(verify);
  verifyLatest.current = verify;
  const visible = visibleTradingAccountState(state, userId, wallet, canVerify);
  useEffect(() => {
    if (canVerify && visible.status === 'idle') void verifyLatest.current();
  }, [canVerify, visible.status, wallet, userId, owned]);
  return { status: visible.status, error: visible.error, canVerify, verify };
}
