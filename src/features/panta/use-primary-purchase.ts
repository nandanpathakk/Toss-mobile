import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useEmbeddedSolanaWallet, useIdentityToken, usePrivy } from '@privy-io/expo';

import { AccountVerificationError } from '@/lib/panta-account-verification';
import { pantaGatewayUrl } from '@/lib/panta-api';
import { type OrderBuild } from '@/lib/panta-order-build';
import { decodePurchaseWire, encodePurchaseWire, PurchaseError, type PreparedPurchase, type PurchaseReceipt } from '@/lib/panta-purchase';
import { createPurchaseClient, purchaseChannel, PurchaseIngressRejected } from '@/lib/panta-purchase-client';

import { accountWalletAddress } from './account-state';
import { purchaseRecovery } from './purchase-recovery-storage';
import { startPurchaseStatusPolling } from './purchase-status-polling';
import { usePrimarySigner } from './use-primary-signer';

const clients = {
  creation: pantaGatewayUrl ? createPurchaseClient(pantaGatewayUrl, fetch, 'creation') : null,
  primary: pantaGatewayUrl ? createPurchaseClient(pantaGatewayUrl) : null,
  p2p: pantaGatewayUrl ? createPurchaseClient(pantaGatewayUrl, fetch, 'p2p') : null,
};
type State = {
  wallet: string | null;
  accountId?: string | null;
  orderId: string | null;
  phase: 'loading' | 'idle' | 'preparing' | 'approval' | 'signing' | 'sending' | 'checking' | 'receipt' | 'error';
  prepared: PreparedPurchase | null;
  receipt: PurchaseReceipt | null;
  error: string | null;
};
const initial: State = { wallet: null, orderId: null, phase: 'loading', prepared: null, receipt: null, error: null };

export function usePrimaryPurchase(
  build: OrderBuild | null,
  wallet: string | null,
  verified: boolean,
  channel: 'primary' | 'p2p' | 'creation' = 'primary'
) {
  const client = clients[channel];
  const auth = usePrivy();
  const embedded = useEmbeddedSolanaWallet();
  const { getIdentityToken } = useIdentityToken();
  const sign = usePrimarySigner();
  const owned = accountWalletAddress(auth.isReady && !auth.error, auth.user, embedded.status, embedded.wallets?.map(w => w.address) ?? []);
  const accountId = auth.user?.id ?? null;
  const ready = !!client && !!wallet && owned === wallet && !!accountId;
  const [state, setState] = useState<State>(initial);
  const current = useRef({ wallet, accountId, owned, orderId: build?.orderId, ready, verified, channel, mounted: true });
  current.current = { wallet, accountId, owned, orderId: build?.orderId, ready, verified, channel, mounted: true };
  const flight = useRef(false);
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    loaded.current = null;
    setState({ ...initial, wallet, accountId });
    let active = true;
    if (ready && wallet) {
      void purchaseRecovery
        .read(wallet)
        .then(receipt => {
          if (!active) return;
          loaded.current = `${accountId}:${wallet}`;
          setState({ ...initial, wallet, accountId, phase: receipt ? 'receipt' : 'idle', receipt });
        })
        .catch(() => {
          if (active)
            setState({
              ...initial,
              wallet,
              accountId,
              phase: 'error',
              error: 'Saved purchase status could not be read. Buying is blocked until it can be recovered.',
            });
        });
    }
    return () => {
      active = false;
      loaded.current = null;
    };
  }, [wallet, accountId, owned, ready, client]);
  useEffect(
    () => () => {
      current.current.mounted = false;
    },
    []
  );
  // Build edits and ownership expiry invalidate the entire one-purchase approval.
  const visible = state.wallet === wallet && state.accountId === accountId && ready ? state : { ...initial, wallet };
  const prepared = visible.prepared && visible.orderId === build?.orderId && verified ? visible.prepared : null;
  const busy = ['preparing', 'signing', 'sending', 'checking'].includes(visible.phase);
  function valid(expectedOrder?: string) {
    const latest = current.current;
    return (
      latest.mounted &&
      latest.channel === channel &&
      latest.ready &&
      latest.wallet === wallet &&
      latest.accountId === accountId &&
      latest.owned === wallet &&
      (expectedOrder === undefined || (latest.orderId === expectedOrder && latest.verified))
    );
  }
  async function credentials(expectedOrder?: string) {
    if (!valid(expectedOrder) || !client) throw new AccountVerificationError('ACCOUNT_UNVERIFIED');
    const refreshed = await auth.refreshUser();
    if (!valid(expectedOrder) || refreshed.user.id !== accountId) throw new AccountVerificationError('ACCOUNT_UNVERIFIED');
    const access = await auth.getAccessToken();
    const identity = await getIdentityToken();
    if (!valid(expectedOrder) || !access || !identity) throw new AccountVerificationError('ACCOUNT_REQUIRED');
    return { access, identity };
  }
  function errorText(error: unknown) {
    return error instanceof PurchaseError || error instanceof AccountVerificationError
      ? error.message
      : 'The purchase could not complete. Check the saved status before trying another buy.';
  }
  async function prepare() {
    if (flight.current || !build || !wallet || !verified || loaded.current !== `${accountId}:${wallet}` || visible.receipt || !client)
      return;
    flight.current = true;
    setState({ ...initial, wallet, accountId, orderId: build.orderId, phase: 'preparing' });
    try {
      // Check durable state again immediately before creating a new review.
      if (await purchaseRecovery.read(wallet)) throw new PurchaseError('PURCHASE_PENDING');
      const tokens = await credentials(build.orderId);
      const result = await client.prepare(build, tokens.access, tokens.identity);
      if (valid(build.orderId)) setState({ ...initial, wallet, accountId, orderId: build.orderId, phase: 'approval', prepared: result });
    } catch (error) {
      if (valid()) setState({ ...initial, wallet, accountId, phase: 'error', error: errorText(error) });
    } finally {
      flight.current = false;
    }
  }
  async function approve(priceChangeAccepted: boolean) {
    if (
      flight.current ||
      !prepared ||
      !build ||
      !wallet ||
      !accountId ||
      !client ||
      !priceChangeAccepted ||
      !valid(build.orderId) ||
      loaded.current !== `${accountId}:${wallet}`
    )
      return;
    flight.current = true;
    const review = prepared;
    let saved: PurchaseReceipt | null = null;
    setState(value => ({ ...value, phase: 'signing', prepared: null, error: null }));
    try {
      if (await purchaseRecovery.read(wallet)) throw new PurchaseError('PURCHASE_PENDING');
      // Fetch fresh authorization before signing; never retain tokens in state/storage.
      const tokens = await credentials(build.orderId);
      if (!valid(build.orderId)) throw new AccountVerificationError('ACCOUNT_UNVERIFIED');
      const signed = await sign(build, decodePurchaseWire(review.transaction), {
        accountId,
        wallet,
        orderId: build.orderId,
        messageHash: review.messageHash,
        expiresAt: review.expiresAt,
        priceChangeAccepted: true,
      });
      if (!valid(build.orderId)) throw new AccountVerificationError('ACCOUNT_UNVERIFIED');
      const record: PurchaseReceipt = {
        version: 1,
        chain: 'mainnet-beta',
        wallet,
        marketId: build.marketId,
        orderId: build.orderId,
        signature: signed.signature,
        messageHash: signed.messageHash,
        status: 'pending',
      };
      setState({ ...initial, wallet, accountId, phase: 'sending', receipt: record });
      let notSent: PurchaseReceipt | null = null;
      saved = await purchaseRecovery.sendOnce(record, async () => {
        if (!valid(build.orderId)) {
          notSent = { ...record, status: 'not-sent' };
          return record.signature;
        }
        let receipt: PurchaseReceipt;
        try {
          receipt = await client.send(review, encodePurchaseWire(signed.transaction), tokens.access, tokens.identity);
        } catch (error) {
          if (!(error instanceof PurchaseIngressRejected)) throw error;
          notSent = { ...record, status: 'not-sent' };
          return record.signature;
        }
        if (receipt.orderId !== record.orderId || receipt.messageHash !== record.messageHash || receipt.marketId !== record.marketId)
          throw new PurchaseError('INVALID_PURCHASE');
        if (receipt.status === 'not-sent') notSent = receipt;
        return receipt.signature;
      });
      // Read-only status check. Never repeats signing or transmission.
      try {
        saved = await purchaseRecovery.reconcile(wallet, record =>
          notSent ? Promise.resolve(notSent) : clients[purchaseChannel(record.orderId)]!.receipt(record, tokens.access, tokens.identity)
        );
      } catch {
        /* Keep durable pending state. */
      }
      if (valid()) setState({ ...initial, wallet, accountId, phase: 'receipt', receipt: saved });
    } catch (error) {
      try {
        saved = await purchaseRecovery.read(wallet);
      } catch {
        /* Storage failure stays blocked. */
      }
      if (valid()) setState({ ...initial, wallet, accountId, phase: saved ? 'receipt' : 'error', receipt: saved, error: errorText(error) });
    } finally {
      flight.current = false;
    }
  }
  async function checkStatus() {
    if (flight.current || !wallet || !client || !visible.receipt || !valid()) return null;
    flight.current = true;
    setState(value => ({ ...value, phase: 'checking', error: null }));
    try {
      const tokens = await credentials();
      const receipt = await purchaseRecovery.reconcile(wallet, record =>
        clients[purchaseChannel(record.orderId)]!.receipt(record, tokens.access, tokens.identity)
      );
      if (valid()) setState({ ...initial, wallet, accountId, phase: 'receipt', receipt });
      return true;
    } catch (error) {
      if (valid()) setState(value => ({ ...value, phase: 'receipt', error: errorText(error) }));
      return false;
    } finally {
      flight.current = false;
    }
  }
  async function dismissResolved() {
    if (flight.current || !wallet || !valid() || !visible.receipt || visible.receipt.status === 'pending') return;
    flight.current = true;
    try {
      await purchaseRecovery.dismissResolved(wallet);
      if (valid()) setState({ ...initial, wallet, accountId, phase: 'idle' });
    } catch (error) {
      if (valid()) setState(value => ({ ...value, error: errorText(error) }));
    } finally {
      flight.current = false;
    }
  }
  const statusCheck = useRef({ pending: false, check: checkStatus });
  statusCheck.current = { pending: ready && visible.receipt?.status === 'pending', check: checkStatus };
  useEffect(() => {
    if (!ready || visible.receipt?.status !== 'pending') return;
    return startPurchaseStatusPolling({
      pending: () => statusCheck.current.pending,
      active: () => AppState.currentState === 'active',
      check: () => statusCheck.current.check(),
    });
  }, [ready, wallet, accountId, channel, visible.receipt?.signature, visible.receipt?.status]);
  return {
    ...visible,
    prepared,
    busy,
    canPrepare: ready && verified && loaded.current === `${accountId}:${wallet}` && !!build && !visible.receipt && !busy,
    prepare,
    approve,
    checkStatus,
    dismissResolved,
  };
}
