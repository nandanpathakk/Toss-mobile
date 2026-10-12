import { createPublicKey, verify, type KeyObject } from 'node:crypto';

import { AccountVerificationError, pantaPrivyAppId } from '../../src/lib/panta-account-verification';
import { isWalletAddress } from '../../src/lib/panta-portfolio';

type Claims = { sub: string; iat: number; exp: number; iss: string; aud: string; sid?: string; linked_accounts?: string; guest?: string };
function requireAuth(ok: unknown): asserts ok {
  if (!ok) throw new AccountVerificationError('ACCOUNT_UNVERIFIED');
}
function decode(value: string) {
  requireAuth(/^[A-Za-z0-9_-]+$/.test(value));
  const bytes = Buffer.from(value, 'base64url');
  requireAuth(bytes.toString('base64url') === value);
  return bytes;
}
function object(value: unknown): Record<string, any> {
  requireAuth(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, any>;
}

/** Public-key-only verification. Never calls user APIs or sends tokens to Privy.
 * Require both a current access session and signed identity wallet association.
 * The optional fetch/clock are test seams, not caller-controlled server URLs.
 */
export type OwnershipFailureCheck =
  | 'format'
  | 'header'
  | 'public-keys'
  | 'signature'
  | 'claims'
  | 'time'
  | 'issued-at'
  | 'expires-at'
  | 'token-lifetime'
  | 'not-before'
  | 'association';
export type OwnershipFailureStage = 'access-token' | 'identity-token' | 'session-binding' | 'wallet-binding' | 'identity-freshness';
export function createPrivyOwnershipVerifier(
  fetcher: typeof fetch = fetch,
  clock = Date.now,
  onFailure: (stage: OwnershipFailureStage, check: OwnershipFailureCheck) => void = () => {}
) {
  let keys = new Map<string, KeyObject>();
  let validUntil = 0;
  let lastAttempt = -Infinity;
  let loading: Promise<void> | null = null;
  async function load() {
    if (loading) return loading;
    if (clock() - lastAttempt < 30000) throw new AccountVerificationError('ACCOUNT_UNAVAILABLE');
    lastAttempt = clock();
    loading = (async () => {
      const result = await fetcher(`https://api.privy.io/v1/apps/${pantaPrivyAppId}/jwks.json`, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!result.ok || !result.body) throw new AccountVerificationError('ACCOUNT_UNAVAILABLE');
      const reader = result.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 16384) throw new AccountVerificationError('ACCOUNT_UNAVAILABLE');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const body = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      requireAuth(Array.isArray(body.keys) && body.keys.length > 0 && body.keys.length <= 8);
      const next = new Map<string, KeyObject>();
      for (const value of body.keys) {
        const key = object(value);
        requireAuth(typeof key.kid === 'string' && key.kid.length > 0 && key.kid.length <= 128 && !next.has(key.kid));
        requireAuth(
          key.kty === 'EC' &&
            key.crv === 'P-256' &&
            key.d === undefined &&
            (!key.alg || key.alg === 'ES256') &&
            (!key.use || key.use === 'sig')
        );
        requireAuth(typeof key.x === 'string' && typeof key.y === 'string' && decode(key.x).length === 32 && decode(key.y).length === 32);
        next.set(key.kid, createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: key.x, y: key.y }, format: 'jwk' }));
      }
      keys = next;
      validUntil = clock() + 300000;
    })();
    try {
      await loading;
    } catch {
      throw new AccountVerificationError('ACCOUNT_UNAVAILABLE');
    } finally {
      loading = null;
    }
  }
  async function token(value: string, checkpoint: (check: OwnershipFailureCheck) => void, identity = false): Promise<Claims> {
    checkpoint('format');
    requireAuth(value.length <= 8192);
    const parts = value.split('.');
    requireAuth(parts.length === 3);
    checkpoint('header');
    const header = object(JSON.parse(decode(parts[0]).toString('utf8')));
    requireAuth(header.alg === 'ES256' && (header.typ === undefined || header.typ === 'JWT'));
    requireAuth(
      header.crit === undefined &&
        header.b64 === undefined &&
        (header.kid === undefined || (typeof header.kid === 'string' && header.kid.length > 0 && header.kid.length <= 128))
    );
    checkpoint('public-keys');
    if (validUntil <= clock() || (header.kid !== undefined && !keys.has(header.kid))) await load();
    requireAuth(validUntil > clock());
    // JWT kid is optional. Legacy tokens can be verified against the bounded
    // app-pinned public key set. A supplied but unknown kid never falls back.
    const candidates = header.kid === undefined ? [...keys.values()] : [keys.get(header.kid)].filter((key): key is KeyObject => !!key);
    checkpoint('signature');
    const signature = decode(parts[2]);
    requireAuth(
      signature.length === 64 &&
        candidates.filter(key => verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: 'ieee-p1363' }, signature))
          .length === 1
    );
    checkpoint('claims');
    const claims = object(JSON.parse(decode(parts[1]).toString('utf8')));
    const now = Math.floor(clock() / 1000);
    requireAuth(claims.iss === 'privy.io' && claims.aud === pantaPrivyAppId);
    requireAuth(typeof claims.sub === 'string' && /^did:privy:[A-Za-z0-9_-]{1,128}$/.test(claims.sub));
    // NumericDate permits fractional seconds. Identity freshness below bounds
    // usable authorization independently of the vendor's nominal token lifetime.
    const numericDate = (value: unknown): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
    checkpoint('issued-at');
    requireAuth(numericDate(claims.iat) && claims.iat <= now + 30);
    checkpoint('expires-at');
    requireAuth(numericDate(claims.exp) && claims.exp > now && claims.exp > claims.iat);
    checkpoint('token-lifetime');
    requireAuth(identity || claims.exp - claims.iat <= 7200);
    checkpoint('not-before');
    requireAuth(claims.nbf === undefined || (numericDate(claims.nbf) && claims.nbf <= now));
    return claims as Claims;
  }
  return async (wallet: string, authorization: string | undefined, identity: string | undefined) => {
    if (!authorization?.startsWith('Bearer ') || !identity) throw new AccountVerificationError('ACCOUNT_REQUIRED');
    let stage: OwnershipFailureStage = 'access-token';
    let check: OwnershipFailureCheck = 'format';
    const checkpoint = (value: OwnershipFailureCheck) => {
      check = value;
    };
    try {
      requireAuth(isWalletAddress(wallet));
      const access = await token(authorization.slice(7), checkpoint);
      stage = 'identity-token';
      const user = await token(identity, checkpoint, true);
      stage = 'session-binding';
      check = 'association';
      requireAuth(access.linked_accounts === undefined);
      requireAuth(access.sub === user.sub && typeof access.sid === 'string' && access.sid.length > 0 && access.sid.length <= 256);
      stage = 'wallet-binding';
      requireAuth(user.guest !== 't' && typeof user.linked_accounts === 'string' && user.linked_accounts.length <= 6000);
      const accounts: unknown = JSON.parse(user.linked_accounts);
      requireAuth(Array.isArray(accounts) && accounts.length <= 64);
      requireAuth(
        accounts.some(value => {
          const account = object(value);
          // Privy's lightweight identity schema omits connector_type. Its official
          // parser recognizes embedded wallets using wallet_client_type=privy.
          return (
            account.type === 'wallet' &&
            account.chain_type === 'solana' &&
            account.wallet_client_type === 'privy' &&
            account.address === wallet
          );
        })
      );
      stage = 'identity-freshness';
      check = 'time';
      const expiry = Math.min(access.exp, user.exp, user.iat + 900);
      requireAuth(expiry * 1000 > clock());
      return { userId: access.sub, wallet, expiresAt: new Date(expiry * 1000).toISOString() };
    } catch (error) {
      // Only a fixed enum escapes for diagnosis. Never expose JWTs, claims or errors.
      onFailure(stage, check);
      if (error instanceof AccountVerificationError) throw error;
      throw new AccountVerificationError('ACCOUNT_UNVERIFIED');
    }
  };
}
