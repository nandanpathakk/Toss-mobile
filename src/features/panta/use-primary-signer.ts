import { useEffect, useRef } from 'react';

import { useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';

import { accountWalletAddress } from './account-state';
import { createPrimarySigner } from './primary-signer';

// Deliberately separate from the connection-only account hook. No provider or
// token is exposed, and constructing this adapter never requests a signature.
export function usePrimarySigner() {
  const auth = usePrivy();
  const embedded = useEmbeddedSolanaWallet();
  const address = accountWalletAddress(
    auth.isReady && !auth.error,
    auth.user,
    embedded.status,
    embedded.wallets?.map(wallet => wallet.address) ?? []
  );
  const selected = embedded.wallets?.find(wallet => wallet.address === address);
  const latest = useRef<{ address: string; accountId: string; getProvider: NonNullable<typeof selected>['getProvider'] } | null>(null);
  latest.current = address && selected && auth.user ? { address, accountId: auth.user.id, getProvider: selected.getProvider } : null;
  useEffect(
    () => () => {
      latest.current = null;
    },
    []
  );
  const signer = useRef<ReturnType<typeof createPrimarySigner> | null>(null);
  if (!signer.current) signer.current = createPrimarySigner(() => latest.current);
  return signer.current;
}
