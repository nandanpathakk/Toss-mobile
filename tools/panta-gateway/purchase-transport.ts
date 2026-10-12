import { createHash } from 'node:crypto';

import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

import { type OrderBuild } from '../../src/lib/panta-order-build';
import { decodePurchaseWire, purchaseCheck, PurchaseError, usdcBaseUnits, type PurchaseReceipt } from '../../src/lib/panta-purchase';
import { deployment } from './primary-transaction';

// This marker is created only before the financial RPC can be invoked.
export class PurchaseNotSentError extends Error {}

export function createPurchaseTransport(apiKey: string, fetcher: typeof fetch = fetch) {
  let sequence = 0;
  async function json(url: string, init: RequestInit, limit: number) {
    const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(18000) });
    if (!response.ok || !response.body) throw new PurchaseError('PURCHASE_UNAVAILABLE');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        purchaseCheck(length <= limit);
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally {
      await reader.cancel();
    }
  }
  async function rpc(method: string, params: unknown[] = []) {
    const id = ++sequence;
    const data = await json(
      'https://api.mainnet-beta.solana.com',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) },
      262144
    );
    purchaseCheck(data?.jsonrpc === '2.0' && data.id === id && !data.error && Object.hasOwn(data, 'result'));
    return data.result;
  }
  async function network() {
    purchaseCheck((await rpc('getGenesisHash')) === deployment.genesis);
  }
  async function register(record: PurchaseReceipt, build?: OrderBuild) {
    const body = JSON.stringify({ orderId: record.orderId, wallet: record.wallet, signature: record.signature });
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey }, body };
    const submitted = await json('https://live-api.panta.market/api/v1/primaryordersubmit/', init, 16384);
    purchaseCheck(submitted?.orderId === record.orderId && submitted.signature === record.signature && submitted.status === 'submitted');
    const verified = await json('https://live-api.panta.market/api/v1/primaryorderverify/', init, 16384);
    purchaseCheck(verified?.orderId === record.orderId && verified.signature === record.signature && verified.marketId === record.marketId);
    purchaseCheck(['built', 'submitted', 'confirmed', 'failed', 'expired'].includes(verified.status));
    if (build) {
      purchaseCheck(verified.side === build.side);
      const amount = verified.amountUsdc;
      purchaseCheck((typeof amount === 'string' && /^(0|[1-9]\d{0,19})$/.test(amount)) || (Number.isSafeInteger(amount) && amount >= 0));
      purchaseCheck(BigInt(amount) === usdcBaseUnits(build.amountUsdc));
    }
    // An indexer/session result never overrides independently established chain status.
  }
  return {
    broadcast: async (transaction: Uint8Array, build: OrderBuild, signature: string) => {
      try {
        await network();
        const [height, blockhash] = await Promise.all([
          rpc('getBlockHeight', [{ commitment: 'confirmed' }]),
          rpc('isBlockhashValid', [build.recentBlockhash, { commitment: 'confirmed' }]),
        ]);
        purchaseCheck(Number.isSafeInteger(height) && height >= 0 && height <= build.lastValidBlockHeight && blockhash?.value === true);
        if (Date.parse(build.expiresAt) <= Date.now()) throw new PurchaseError('PURCHASE_EXPIRED');
      } catch {
        throw new PurchaseNotSentError();
      }
      const result = await rpc('sendTransaction', [
        Buffer.from(transaction).toString('base64'),
        { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 },
      ]);
      purchaseCheck(result === signature);
      return signature;
    },
    register,
    receipt: async (record: PurchaseReceipt): Promise<PurchaseReceipt> => {
      await network();
      const value = await rpc('getTransaction', [
        record.signature,
        { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
      ]);
      if (value === null) return { ...record, status: 'pending' };
      purchaseCheck(value && Number.isSafeInteger(value.slot) && value.slot >= 0 && value.meta && Object.hasOwn(value.meta, 'err'));
      purchaseCheck(
        value.meta.err === null ||
          (typeof value.meta.err === 'string' && /^[A-Za-z]{1,80}$/.test(value.meta.err)) ||
          (typeof value.meta.err === 'object' && !Array.isArray(value.meta.err) && Object.keys(value.meta.err).length === 1)
      );
      purchaseCheck(Array.isArray(value.transaction) && value.transaction.length === 2 && value.transaction[1] === 'base64');
      const wire = decodePurchaseWire(value.transaction[0]);
      purchaseCheck(wire[0] === 1 && bs58.encode(wire.subarray(1, 65)) === record.signature);
      const message = wire.subarray(65);
      purchaseCheck(createHash('sha256').update(message).digest('hex') === record.messageHash);
      purchaseCheck(
        message[0] === 128 && message[1] === 1 && message[2] === 0 && message[4] > 0 && message[4] <= 64 && message[3] < message[4]
      );
      purchaseCheck(bs58.encode(message.subarray(5, 37)) === record.wallet);
      purchaseCheck(ed25519.verify(wire.subarray(1, 65), message, bs58.decode(record.wallet), { zip215: false }));
      const keys = Array.from({ length: message[4] }, (_, i) => bs58.encode(message.subarray(5 + i * 32, 37 + i * 32)));
      purchaseCheck(keys.includes(record.marketId) && keys.includes(deployment.program));
      return { ...record, status: value.meta.err === null ? 'confirmed' : 'failed' };
    },
  };
}
