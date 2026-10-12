import bs58 from 'bs58';

import { type PurchaseReceipt } from '@/lib/panta-purchase';

export type PendingPurchase = PurchaseReceipt;
export type PurchaseRecoveryStorage = {
  read: (wallet: string) => Promise<unknown>;
  write: (wallet: string, record: PendingPurchase) => Promise<void>;
  remove: (wallet: string) => Promise<void>;
};
export class PurchaseRecoveryError extends Error {
  constructor(public readonly code: 'BUSY' | 'UNRESOLVED_PURCHASE' | 'INVALID_RECOVERY' | 'RECEIPT_MISMATCH') {
    super(code);
  }
}
function address(value: unknown, length: number): value is string {
  if (typeof value !== 'string' || value.length > 88) return false;
  try {
    return bs58.decode(value).length === length;
  } catch {
    return false;
  }
}
export function parsePendingPurchase(value: unknown, wallet: string): PendingPurchase {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PurchaseRecoveryError('INVALID_RECOVERY');
  const row = value as PendingPurchase;
  if (
    Object.keys(row).sort().join(',') !== 'chain,marketId,messageHash,orderId,signature,status,version,wallet' ||
    row.version !== 1 ||
    row.chain !== 'mainnet-beta' ||
    row.wallet !== wallet ||
    !address(row.wallet, 32) ||
    !address(row.marketId, 32) ||
    !address(row.signature, 64) ||
    typeof row.orderId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(row.orderId) ||
    typeof row.messageHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(row.messageHash) ||
    !['pending', 'confirmed', 'failed', 'not-sent'].includes(row.status)
  )
    throw new PurchaseRecoveryError('INVALID_RECOVERY');
  return { ...row };
}

/** One app-level coordinator, never one per sheet. Storage must be durable and
 * wallet-scoped. It stores only public recovery metadata, never tokens/signed bytes.
 * No signer, automatic retry, re-quote or replacement transaction is exposed here.
 * The future transport must enforce authorization, approval and signed validation.
 */
export function createPurchaseRecovery(storage: PurchaseRecoveryStorage) {
  let busy = false;
  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (busy) throw new PurchaseRecoveryError('BUSY');
    busy = true;
    try {
      return await operation();
    } finally {
      busy = false;
    }
  }
  async function read(wallet: string) {
    if (!address(wallet, 32)) throw new PurchaseRecoveryError('INVALID_RECOVERY');
    const value = await storage.read(wallet);
    return value == null ? null : parsePendingPurchase(value, wallet);
  }
  return {
    read,
    // Requires a validated, signed and explicitly approved transaction upstream.
    // A saved record blocks all subsequent sends, including after app restart.
    sendOnce: (record: PendingPurchase, broadcast: () => Promise<string>) =>
      exclusive(async () => {
        const pending = parsePendingPurchase(record, record.wallet);
        if (pending.status !== 'pending') throw new PurchaseRecoveryError('INVALID_RECOVERY');
        if (await read(pending.wallet)) throw new PurchaseRecoveryError('UNRESOLVED_PURCHASE');
        await storage.write(pending.wallet, { ...pending });
        let signature: string;
        try {
          signature = await broadcast();
        } catch {
          // A timeout/error can occur after the network accepted the transaction.
          // Keep the pre-saved signature pending; never infer definite failure.
          return pending;
        }
        if (signature !== pending.signature) throw new PurchaseRecoveryError('RECEIPT_MISMATCH');
        return pending;
      }),
    // The verifier must independently establish chain success/failure and match
    // the original message, or authoritatively prove dispatch was never attempted.
    // Panta session expiry/not-found is always pending.
    reconcile: (wallet: string, verify: (record: PendingPurchase) => Promise<PendingPurchase>) =>
      exclusive(async () => {
        const pending = await read(wallet);
        if (!pending || pending.status !== 'pending') return pending;
        const result = parsePendingPurchase(await verify({ ...pending }), wallet);
        if (
          Object.keys(pending).some(
            key => key !== 'status' && result[key as keyof PendingPurchase] !== pending[key as keyof PendingPurchase]
          )
        )
          throw new PurchaseRecoveryError('RECEIPT_MISMATCH');
        await storage.write(wallet, { ...result });
        return result;
      }),
    dismissResolved: (wallet: string) =>
      exclusive(async () => {
        const record = await read(wallet);
        if (record?.status === 'pending') throw new PurchaseRecoveryError('UNRESOLVED_PURCHASE');
        if (record) await storage.remove(wallet);
      }),
  };
}
