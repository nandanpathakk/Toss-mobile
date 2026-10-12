import { type OrderBuild } from '@/lib/panta-order-build';
import { inspectPrimaryWire, validateSignedPrimary } from '@/lib/panta-order-signing';

type Provider = {
  request: (input: { method: 'signTransaction'; params: { transaction: Uint8Array } }) => Promise<{ signedTransaction: Uint8Array }>;
};
type Wallet = { address: string; accountId: string; getProvider: () => Promise<Provider> };
export type PurchaseApproval = {
  wallet: string;
  accountId: string;
  orderId: string;
  messageHash: string;
  expiresAt: string;
  priceChangeAccepted: true;
};
export class PrimarySignerError extends Error {
  constructor(public readonly code: 'ACCOUNT_CHANGED' | 'APPROVAL_INVALID' | 'SIGNING_UNAVAILABLE') {
    super(code);
  }
}

/** Sign-only adapter. A caller must have completed backend ownership/preflight and
 * displayed exact costs, network and share-price risk before creating approval.
 * This module never broadcasts or establishes that UI consent occurred.
 */
export function createPrimarySigner(currentWallet: () => Wallet | null, clock = Date.now) {
  let busy = false;
  const used = new Map<string, number>();
  return async (build: OrderBuild, unsigned: Uint8Array, approval: PurchaseApproval) => {
    for (const [orderId, expiry] of used) if (expiry <= clock()) used.delete(orderId);
    if (busy || used.has(build.orderId) || used.size >= 128) throw new PrimarySignerError('APPROVAL_INVALID');
    const wallet = currentWallet();
    const approved = { ...approval };
    const boundBuild = {
      ...build,
      instructions: build.instructions.map(ix => ({ ...ix, accounts: ix.accounts.map(account => ({ ...account })) })),
    };
    const transaction = Uint8Array.from(unsigned);
    function valid() {
      const current = currentWallet();
      if (!wallet || !current || current.accountId !== wallet.accountId || current.address !== wallet.address)
        throw new PrimarySignerError('ACCOUNT_CHANGED');
      if (
        approved.wallet !== wallet.address ||
        boundBuild.wallet !== wallet.address ||
        approved.accountId !== wallet.accountId ||
        approved.orderId !== boundBuild.orderId ||
        approved.priceChangeAccepted !== true ||
        !Number.isFinite(Date.parse(approved.expiresAt)) ||
        Date.parse(approved.expiresAt) <= clock() ||
        Date.parse(approved.expiresAt) > Date.parse(boundBuild.expiresAt) ||
        Date.parse(approved.expiresAt) > clock() + 60000
      )
        throw new PrimarySignerError('APPROVAL_INVALID');
    }
    valid();
    const decoded = inspectPrimaryWire(transaction, boundBuild);
    if (decoded.messageHash !== approved.messageHash || decoded.signature.some(value => value !== 0))
      throw new PrimarySignerError('APPROVAL_INVALID');
    used.set(boundBuild.orderId, Date.parse(boundBuild.expiresAt));
    busy = true;
    try {
      const provider = await wallet!.getProvider();
      valid();
      const result = await provider.request({ method: 'signTransaction', params: { transaction: Uint8Array.from(transaction) } });
      valid();
      return validateSignedPrimary(result.signedTransaction, transaction, boundBuild, approved.messageHash, clock());
    } catch (error) {
      if (error instanceof PrimarySignerError) throw error;
      throw new PrimarySignerError('SIGNING_UNAVAILABLE');
    } finally {
      busy = false;
    }
  };
}
