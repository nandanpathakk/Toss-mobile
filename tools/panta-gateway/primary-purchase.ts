import { randomBytes } from 'node:crypto';

import { type OrderBuild } from '../../src/lib/panta-order-build';
import { type PreflightReport } from '../../src/lib/panta-order-preflight';
import { validateSignedPrimary } from '../../src/lib/panta-order-signing';
import {
  decodePurchaseWire,
  parsePreparedPurchase,
  parsePurchaseCost,
  parsePurchaseReceipt,
  purchaseCheck,
  PurchaseError,
  type PreparedPurchase,
  type PurchaseReceipt,
} from '../../src/lib/panta-purchase';
import { compileUnsignedPrimary } from './primary-transaction';
import { PurchaseNotSentError, type createPurchaseTransport } from './purchase-transport';

type Identity = { userId: string; wallet: string; expiresAt: string };
type Entry = { build: OrderBuild; userId: string; prepared: PreparedPurchase; consumed: boolean; receipt?: PurchaseReceipt };
export function createPrimaryPurchases(
  preflight: (build: OrderBuild) => Promise<PreflightReport>,
  transport: ReturnType<typeof createPurchaseTransport>,
  clock = Date.now,
  pendingWallets = new Map<string, { signature: string; orderId: string; messageHash: string }>()
) {
  const entries = new Map<string, Entry>();
  const preparing = new Set<string>();
  function authorize(wallet: string, identity: Identity) {
    purchaseCheck(
      identity.wallet === wallet &&
        typeof identity.userId === 'string' &&
        identity.userId.startsWith('did:privy:') &&
        Date.parse(identity.expiresAt) > clock()
    );
  }
  return {
    prepare: async (source: OrderBuild, identity: Identity) => {
      const build = structuredClone(source);
      authorize(build.wallet, identity);
      for (const [id, entry] of entries) {
        if (entry.receipt?.status !== 'pending' && Date.parse(entry.build.expiresAt) <= clock()) entries.delete(id);
      }
      if (preparing.has(build.wallet) || pendingWallets.has(build.wallet)) throw new PurchaseError('PURCHASE_PENDING');
      if (entries.size >= 100) throw new PurchaseError('PURCHASE_UNAVAILABLE');
      // One review per order; refreshing means a new quote/build, never a new ticket for the same order.
      if (entries.has(build.orderId)) throw new PurchaseError('PURCHASE_EXPIRED');
      preparing.add(build.wallet);
      try {
        const result = await preflight(build);
        if (result.status !== 'simulated' || !result.cost) throw new PurchaseError('PURCHASE_BLOCKED');
        const compiled = compileUnsignedPrimary(build);
        purchaseCheck(result.wallet === build.wallet && result.orderId === build.orderId && result.messageHash === compiled.messageHash);
        const prepared = parsePreparedPurchase(
          {
            orderId: build.orderId,
            wallet: build.wallet,
            chain: 'mainnet-beta',
            ticket: randomBytes(32).toString('hex'),
            transaction: compiled.transaction.toString('base64'),
            messageHash: compiled.messageHash,
            expiresAt: new Date(Math.min(clock() + 60000, Date.parse(build.expiresAt), Date.parse(identity.expiresAt))).toISOString(),
            cost: parsePurchaseCost(result.cost, build),
            executionProtection: false,
          },
          build,
          clock()
        );
        entries.set(build.orderId, { build, prepared, userId: identity.userId, consumed: false });
        return structuredClone(prepared);
      } finally {
        preparing.delete(build.wallet);
      }
    },
    send: async (value: unknown, identity: Identity): Promise<PurchaseReceipt> => {
      const row = value as { wallet: string; orderId: string; ticket: string; transaction: string; priceChangeAccepted: true };
      purchaseCheck(row && Object.keys(row).sort().join(',') === 'orderId,priceChangeAccepted,ticket,transaction,wallet');
      authorize(row.wallet, identity);
      const entry = entries.get(row.orderId);
      purchaseCheck(
        entry &&
          entry.build.wallet === row.wallet &&
          entry.userId === identity.userId &&
          entry.prepared.ticket === row.ticket &&
          row.priceChangeAccepted === true
      );
      if (entry.consumed || pendingWallets.has(row.wallet)) throw new PurchaseError('PURCHASE_PENDING');
      if (Date.parse(entry.prepared.expiresAt) <= clock()) throw new PurchaseError('PURCHASE_EXPIRED');
      const signed = validateSignedPrimary(
        decodePurchaseWire(row.transaction),
        decodePurchaseWire(entry.prepared.transaction),
        entry.build,
        entry.prepared.messageHash,
        clock()
      );
      const record: PurchaseReceipt = {
        version: 1,
        chain: 'mainnet-beta',
        wallet: row.wallet,
        marketId: entry.build.marketId,
        orderId: row.orderId,
        signature: signed.signature,
        messageHash: signed.messageHash,
        status: 'pending',
      };
      // Consume before any asynchronous check or dispatch. No retries/replacements of this send.
      entry.consumed = true;
      entry.receipt = record;
      pendingWallets.set(row.wallet, { signature: signed.signature, orderId: record.orderId, messageHash: record.messageHash });
      let dispatchStarted = false;
      try {
        const current = await preflight(entry.build);
        if (current.status !== 'simulated' || !current.cost || current.messageHash !== entry.prepared.messageHash)
          throw new PurchaseError('PURCHASE_BLOCKED');
        purchaseCheck(JSON.stringify(parsePurchaseCost(current.cost, entry.build)) === JSON.stringify(entry.prepared.cost));
        authorize(row.wallet, identity);
        if (Date.parse(entry.prepared.expiresAt) <= clock()) throw new PurchaseError('PURCHASE_EXPIRED');
        dispatchStarted = true;
        await transport.broadcast(signed.transaction, entry.build, signed.signature);
        void transport.register(record, entry.build).catch(() => {});
      } catch (error) {
        if (!dispatchStarted || error instanceof PurchaseNotSentError) {
          record.status = 'not-sent';
          pendingWallets.delete(row.wallet);
        }
        // Once dispatch may have happened, preserve pending and never send again.
      }
      return { ...record };
    },
    receipt: async (value: unknown, identity: Identity) => {
      const record = parsePurchaseReceipt(value, identity.wallet);
      authorize(record.wallet, identity);
      const entry = entries.get(record.orderId);
      if (entry) {
        purchaseCheck(entry.userId === identity.userId && entry.build.wallet === record.wallet);
        if (entry.receipt)
          purchaseCheck(
            Object.keys(entry.receipt).every(
              key => key === 'status' || entry.receipt![key as keyof PurchaseReceipt] === record[key as keyof PurchaseReceipt]
            )
          );
        if (entry.receipt?.status === 'not-sent') return { ...entry.receipt };
      }
      const result = await transport.receipt({ ...record, status: 'pending' });
      if (result.status !== 'pending') {
        const pending = pendingWallets.get(record.wallet);
        if (pending?.signature === record.signature && pending.orderId === record.orderId && pending.messageHash === record.messageHash)
          pendingWallets.delete(record.wallet);
        if (entry) {
          entry.receipt = result;
        }
      }
      // Only retry registration for the exact signature observed finalized on-chain.
      if (result.status === 'confirmed' && !record.orderId.startsWith('p2p_')) {
        try {
          await transport.register(record, entry?.build);
        } catch {
          /* Panta may be expired/unavailable/indexing. */
        }
      }
      return result;
    },
  };
}
