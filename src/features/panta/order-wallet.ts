import { isWalletAddress } from '@/lib/panta-portfolio';

type Account = { ready: boolean; authenticated: boolean; address: string | null };
type ExternalWallet = { status: string; address: string | null };
export type OrderWallet = {
  source: 'privy' | 'phantom' | null;
  address: string | null;
  status: 'connected' | 'initializing' | 'unavailable' | 'disconnected';
};

/** Public identity for quote/build only. Never exposes signing or silently changes provider during recovery. */
export function selectOrderWallet(account: Account, external: ExternalWallet): OrderWallet {
  if (!account.ready) return { source: null, address: null, status: 'initializing' };
  if (account.authenticated) {
    const address = account.address && isWalletAddress(account.address) ? account.address : null;
    return { source: 'privy', address, status: address ? 'connected' : 'unavailable' };
  }
  const address = external.status === 'connected' && external.address && isWalletAddress(external.address) ? external.address : null;
  return { source: address ? 'phantom' : null, address, status: address ? 'connected' : 'disconnected' };
}
