import { useEmbeddedSolanaWallet, useLoginWithEmail, usePrivy } from '@privy-io/expo';

import { accountWalletAddress, canCreateAccountWallet } from './account-state';

// Connection-only account boundary: deliberately exposes no token, signing provider or spending API.
export function usePantaAccount() {
  const auth = usePrivy();
  const login = useLoginWithEmail();
  const wallet = useEmbeddedSolanaWallet();
  const ready = auth.isReady && !auth.error;
  const user = ready ? auth.user : null;
  const email = user?.linked_accounts.find(account => account.type === 'email');
  const address = accountWalletAddress(ready, user, wallet.status, wallet.wallets?.map(wallet => wallet.address) ?? []);
  const loginBusy = login.state.status === 'sending-code' || login.state.status === 'submitting-code';
  return {
    ready,
    loginBusy,
    failed: Boolean(auth.error),
    authenticated: Boolean(user),
    email: email?.type === 'email' ? email.address : null,
    address,
    walletStatus: wallet.status,
    canCreateWallet: canCreateAccountWallet(ready, user, wallet.status) && !wallet.wallets?.length,
    sendCode: async (value: string) => {
      if (!ready || auth.user || loginBusy) throw new Error('Account is not ready for login');
      const result = await login.sendCode({ email: value });
      if (!result.success) throw new Error('Email code was not sent');
    },
    verifyCode: async (email: string, code: string) => {
      if (!ready || auth.user || loginBusy) throw new Error('Account is not ready for login');
      const result = await login.loginWithCode({ email, code });
      if (!result) throw new Error('Email code was not verified');
    },
    createWallet: async () => {
      // Never retry an ambiguous creation by making another wallet.
      if (!canCreateAccountWallet(ready, user, wallet.status) || wallet.status !== 'not-created' || wallet.wallets.length) return;
      await wallet.create({ recoveryMethod: 'privy' });
    },
    refresh: auth.refreshUser,
    logout: auth.logout,
  };
}
