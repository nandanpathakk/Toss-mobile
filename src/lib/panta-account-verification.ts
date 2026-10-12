import { isWalletAddress } from './panta-portfolio';

export const pantaPrivyAppId = 'cmuzwi9lz01yv0clb6pw2ua8a';
export const accountVerificationMessages = {
  ACCOUNT_REQUIRED: 'Sign in again before verifying your wallet.',
  ACCOUNT_UNVERIFIED: 'This account could not verify the selected wallet. Refresh Account and try again.',
  ACCOUNT_UNAVAILABLE: 'Account verification is unavailable. Please try again later.',
  IDENTITY_DISABLED: 'Enable identity tokens in your Privy dashboard, then refresh Account.',
} as const;
export class AccountVerificationError extends Error {
  constructor(public readonly code: keyof typeof accountVerificationMessages) {
    super(accountVerificationMessages[code]);
  }
}
export type VerifiedAccountWallet = { wallet: string; verified: true; expiresAt: string };
export function parseVerifiedAccountWallet(value: unknown, wallet: string, now = Date.now()): VerifiedAccountWallet {
  const row = value as VerifiedAccountWallet | null;
  if (
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row) ||
    row.wallet !== wallet ||
    row.verified !== true ||
    typeof row.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(row.expiresAt)) ||
    Date.parse(row.expiresAt) <= now ||
    Date.parse(row.expiresAt) > now + 15 * 60 * 1000
  )
    throw new AccountVerificationError('ACCOUNT_UNVERIFIED');
  return { wallet: row.wallet, verified: true, expiresAt: row.expiresAt };
}

export function createAccountVerificationClient(baseUrl: string, fetcher: typeof fetch = fetch) {
  const url = new URL(baseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
  )
    throw new AccountVerificationError('ACCOUNT_UNAVAILABLE');
  return async (wallet: string, accessToken: string, identityToken: string, signal?: AbortSignal) => {
    if (!isWalletAddress(wallet) || !accessToken || accessToken.length > 8192 || !identityToken || identityToken.length > 8192)
      throw new AccountVerificationError('ACCOUNT_REQUIRED');
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener('abort', cancel);
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, 12000);
    try {
      const response = await fetcher(`${url.origin}/account/wallet/verify/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'Privy-Id-Token': identityToken },
        body: JSON.stringify({ wallet }),
        redirect: 'error',
        signal: abort.signal,
      });
      const text = await response.text();
      if (text.length > 2048) throw new AccountVerificationError('ACCOUNT_UNVERIFIED');
      const data = JSON.parse(text);
      if (!response.ok)
        throw new AccountVerificationError(Object.hasOwn(accountVerificationMessages, data?.code) ? data.code : 'ACCOUNT_UNAVAILABLE');
      return parseVerifiedAccountWallet(data, wallet);
    } catch (error) {
      if (error instanceof AccountVerificationError) throw error;
      throw new AccountVerificationError('ACCOUNT_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  };
}
