import { isWalletAddress } from '@/lib/panta-portfolio';

type Account = {
  type: string;
  address?: string;
  chain_type?: string;
  connector_type?: string;
  wallet_client_type?: string;
};
type AccountUser = { linked_accounts: readonly Account[] } | null;
const embeddedSolana = (account: Account) =>
  account.type === 'wallet' &&
  account.chain_type === 'solana' &&
  account.connector_type === 'embedded' &&
  account.wallet_client_type === 'privy';

export function accountWalletAddress(ready: boolean, user: AccountUser, status: string, addresses: readonly string[]): string | null {
  if (!ready || !user || status !== 'connected') return null;
  return (
    addresses.find(
      address => isWalletAddress(address) && user.linked_accounts.some(account => embeddedSolana(account) && account.address === address)
    ) ?? null
  );
}

export function canCreateAccountWallet(ready: boolean, user: AccountUser, status: string): boolean {
  return ready && user !== null && status === 'not-created' && !user.linked_accounts.some(embeddedSolana);
}
