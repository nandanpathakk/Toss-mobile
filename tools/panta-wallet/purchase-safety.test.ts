import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import bs58 from 'bs58';
import nacl from 'tweetnacl';

import { createPrimarySigner, type PurchaseApproval } from '../../src/features/panta/primary-signer';
import {
  createPurchaseRecovery,
  parsePendingPurchase,
  type PendingPurchase,
  type PurchaseRecoveryStorage,
} from '../../src/features/panta/purchase-recovery';
import { type OrderBuild } from '../../src/lib/panta-order-build';
import { inspectPrimaryWire, validateSignedPrimary } from '../../src/lib/panta-order-signing';
import fixture from '../panta-gateway/preflight-fixture.json';
import { compileUnsignedPrimary } from '../panta-gateway/primary-transaction';

// Deterministic, test-only key. Never used by the app or submitted to any network.
const signer = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const wallet = bs58.encode(signer.publicKey);
function transaction() {
  const build = structuredClone(fixture.build) as OrderBuild;
  const original = build.wallet;
  build.wallet = wallet;
  build.expiresAt = '2099-01-01T00:00:00Z';
  for (const ix of build.instructions) for (const account of ix.accounts) if (account.pubkey === original) account.pubkey = wallet;
  const compiled = compileUnsignedPrimary(build);
  const signed = Uint8Array.from(compiled.transaction);
  signed.set(nacl.sign.detached(compiled.message, signer.secretKey), 1);
  return { build, ...compiled, signed };
}
function approval(build: OrderBuild, messageHash: string): PurchaseApproval {
  return {
    accountId: 'synthetic-user',
    wallet,
    orderId: build.orderId,
    messageHash,
    expiresAt: new Date(Date.now() + 30000).toISOString(),
    priceChangeAccepted: true,
  };
}
test('sign-only adapter uses exact serialized bytes, checks the result and cannot reuse approval/order', async () => {
  const { build, transaction: unsigned, messageHash, signed } = transaction();
  let requests = 0;
  const sign = createPrimarySigner(() => ({
    address: wallet,
    accountId: 'synthetic-user',
    getProvider: async () => ({
      request: async input => {
        requests++;
        assert.equal(input.method, 'signTransaction');
        assert.deepEqual(input.params.transaction, Uint8Array.from(unsigned));
        return { signedTransaction: signed };
      },
    }),
  }));
  const consent = approval(build, messageHash);
  assert.equal((await sign(build, unsigned, consent)).signature, bs58.encode(signed.slice(1, 65)));
  await assert.rejects(sign(build, unsigned, { ...consent }));
  assert.equal(requests, 1);
});
test('signing approval rejects wrong identity, order/hash, missing price acceptance and expiry before provider access', async () => {
  const { build, transaction: unsigned, messageHash } = transaction();
  let calls = 0;
  for (const patch of [
    { wallet: build.marketId },
    { accountId: 'wrong' },
    { orderId: 'different' },
    { messageHash: 'f'.repeat(64) },
    { priceChangeAccepted: false },
    { expiresAt: new Date(0).toISOString() },
    { expiresAt: new Date(Date.now() + 120000).toISOString() },
  ]) {
    const sign = createPrimarySigner(() => ({
      address: wallet,
      accountId: 'synthetic-user',
      getProvider: async () => {
        calls++;
        throw Error('must not access provider');
      },
    }));
    await assert.rejects(sign(build, unsigned, { ...approval(build, messageHash), ...patch } as PurchaseApproval));
  }
  assert.equal(calls, 0);
});
test('account switch during provider acquisition prevents signing; late signing result after logout is discarded', async () => {
  const { build, transaction: unsigned, messageHash, signed } = transaction();
  let active = true;
  let requests = 0;
  const sign = createPrimarySigner(() =>
    active
      ? {
          address: wallet,
          accountId: 'synthetic-user',
          getProvider: async () => {
            active = false;
            return {
              request: async () => {
                requests++;
                return { signedTransaction: signed };
              },
            };
          },
        }
      : null
  );
  await assert.rejects(sign(build, unsigned, approval(build, messageHash)));
  assert.equal(requests, 0);
  active = true;
  const late = createPrimarySigner(() =>
    active
      ? {
          address: wallet,
          accountId: 'synthetic-user',
          getProvider: async () => ({
            request: async () => {
              active = false;
              return { signedTransaction: signed };
            },
          }),
        }
      : null
  );
  await assert.rejects(late(build, unsigned, approval(build, messageHash)));
});
test('provider rejection and changed signed payload are sanitized and consume that order attempt', async () => {
  const { build, transaction: unsigned, messageHash, signed } = transaction();
  const changed = Uint8Array.from(signed);
  changed[100] ^= 1;
  for (const response of [
    async () => {
      throw Error('synthetic-secret-provider-error');
    },
    async () => ({ signedTransaction: changed }),
  ]) {
    const sign = createPrimarySigner(() => ({
      address: wallet,
      accountId: 'synthetic-user',
      getProvider: async () => ({ request: response }),
    }));
    await assert.rejects(
      sign(build, unsigned, approval(build, messageHash)),
      error => error instanceof Error && !error.message.includes('synthetic-secret')
    );
    await assert.rejects(sign(build, unsigned, approval(build, messageHash)));
  }
});

test('independent wire decoder checks encoder semantics and agrees with Node SHA-256', () => {
  const { build, transaction: unsigned, message, messageHash, signed } = transaction();
  const decoded = inspectPrimaryWire(unsigned, build);
  assert.deepEqual(decoded.message, Uint8Array.from(message));
  assert.equal(decoded.messageHash, createHash('sha256').update(message).digest('hex'));
  assert.equal(decoded.messageHash, messageHash);
  const checked = validateSignedPrimary(signed, unsigned, build, messageHash);
  assert.equal(checked.signature, bs58.encode(signed.slice(1, 65)));
  signed.fill(0);
  assert.notEqual(checked.transaction[1], 0, 'returned bytes must be a defensive copy');
});

test('decoder rejects every truncation, noncanonical compact lengths, trailing bytes and lookups', () => {
  const { build, transaction: unsigned } = transaction();
  for (let length = 0; length < unsigned.length; length++) assert.throws(() => inspectPrimaryWire(unsigned.subarray(0, length), build));
  for (const value of [
    Uint8Array.from([129, 0, ...unsigned.subarray(1)]),
    Uint8Array.from([...unsigned, 0]),
    Uint8Array.from([...unsigned.subarray(0, -1), 1]),
  ])
    assert.throws(() => inspectPrimaryWire(value, build));
  for (const [offset, value] of [
    [0, 2],
    [65, 0],
    [66, 2],
    [67, 1],
    [68, 0],
    [69, 65],
  ]) {
    const changed = Uint8Array.from(unsigned);
    changed[offset] = value;
    assert.throws(() => inspectPrimaryWire(changed, build));
  }
});

test('decoder rejects swapped instructions, changed amount/data/account roles, payer and blockhash', () => {
  const { build, transaction: unsigned } = transaction();
  for (const mutate of [
    (b: OrderBuild) => {
      b.instructions.reverse();
    },
    (b: OrderBuild) => {
      b.instructions[1].data = 'AA==';
    },
    (b: OrderBuild) => {
      b.instructions[1].accounts.reverse();
    },
    (b: OrderBuild) => {
      b.instructions[1].accounts[2].isWritable = true;
    },
    (b: OrderBuild) => {
      b.instructions[1].accounts[1].isSigner = true;
    },
    (b: OrderBuild) => {
      b.wallet = b.marketId;
    },
    (b: OrderBuild) => {
      b.recentBlockhash = b.marketId;
    },
  ]) {
    const changed = structuredClone(build);
    mutate(changed);
    assert.throws(() => inspectPrimaryWire(unsigned, changed));
  }
});

test('signed guard rejects provider mutations, wrong/empty signatures, hash substitution and expiry', () => {
  const { build, transaction: unsigned, message, messageHash, signed } = transaction();
  for (const offset of [0, 1, 64, 65, 100, signed.length - 1]) {
    const changed = Uint8Array.from(signed);
    changed[offset] ^= 1;
    assert.throws(() => validateSignedPrimary(changed, unsigned, build, messageHash));
  }
  assert.throws(() => validateSignedPrimary(unsigned, unsigned, build, messageHash));
  const wrong = Uint8Array.from(unsigned);
  wrong.set(nacl.sign.detached(message, nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(8)).secretKey), 1);
  assert.throws(() => validateSignedPrimary(wrong, unsigned, build, messageHash));
  assert.throws(() => validateSignedPrimary(signed, unsigned, build, 'f'.repeat(64)));
  assert.throws(() => validateSignedPrimary(signed, signed, build, messageHash));
  assert.throws(() => validateSignedPrimary(signed, unsigned, { ...build, expiresAt: '2000-01-01T00:00:00Z' }, messageHash));
});

function record(): PendingPurchase {
  const { build, signed, messageHash } = transaction();
  return {
    version: 1,
    chain: 'mainnet-beta',
    wallet,
    marketId: build.marketId,
    orderId: build.orderId,
    signature: bs58.encode(signed.slice(1, 65)),
    messageHash,
    status: 'pending',
  };
}
function memory() {
  const records = new Map<string, unknown>();
  const storage: PurchaseRecoveryStorage = {
    read: async wallet => structuredClone(records.get(wallet) ?? null),
    write: async (wallet, value) => {
      records.set(wallet, structuredClone(value));
    },
    remove: async wallet => {
      records.delete(wallet);
    },
  };
  return { records, storage };
}
test('recovery persists signature before send; timeout and restart cannot trigger another send', async () => {
  const { storage } = memory();
  const purchase = record();
  let sends = 0;
  const flow = createPurchaseRecovery(storage);
  const result = await flow.sendOnce(purchase, async () => {
    sends++;
    assert.deepEqual(await storage.read(wallet), purchase);
    throw new Error('network accepted but response was lost');
  });
  assert.equal(result.status, 'pending');
  const restarted = createPurchaseRecovery(storage);
  await assert.rejects(
    restarted.sendOnce(purchase, async () => {
      sends++;
      return purchase.signature;
    })
  );
  await assert.rejects(restarted.dismissResolved(wallet));
  assert.equal(sends, 1);
});

test('failed durable write and concurrent presses never broadcast', async () => {
  const { storage } = memory();
  const purchase = record();
  let sends = 0;
  const blocked = createPurchaseRecovery({
    ...storage,
    write: async () => {
      throw new Error('disk unavailable');
    },
  });
  await assert.rejects(
    blocked.sendOnce(purchase, async () => {
      sends++;
      return purchase.signature;
    })
  );
  assert.equal(sends, 0);
  let finish!: (value: string) => void;
  const flow = createPurchaseRecovery(storage);
  const first = flow.sendOnce(
    purchase,
    () =>
      new Promise(resolve => {
        sends++;
        finish = resolve;
      })
  );
  await assert.rejects(
    flow.sendOnce(purchase, async () => {
      sends++;
      return purchase.signature;
    })
  );
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  finish(purchase.signature);
  await first;
  assert.equal(sends, 1);
});

test('recovery rejects wrong signatures/receipts and keeps ambiguous operations pending', async () => {
  const { storage } = memory();
  const purchase = record();
  const flow = createPurchaseRecovery(storage);
  await assert.rejects(flow.sendOnce(purchase, async () => 'wrong'));
  for (const patch of [{ signature: bs58.encode(new Uint8Array(64)) }, { orderId: 'different' }, { messageHash: 'f'.repeat(64) }]) {
    await assert.rejects(flow.reconcile(wallet, async current => ({ ...current, ...patch, status: 'confirmed' })));
    assert.equal((await flow.read(wallet))?.status, 'pending');
  }
  await assert.rejects(
    flow.reconcile(wallet, async () => {
      throw new Error('RPC timeout');
    })
  );
  assert.equal((await flow.read(wallet))?.status, 'pending');
  assert.equal((await flow.reconcile(wallet, async current => current))?.status, 'pending');
  assert.equal((await flow.reconcile(wallet, async current => ({ ...current, status: 'confirmed' })))?.status, 'confirmed');
  await flow.dismissResolved(wallet);
  assert.equal(await flow.read(wallet), null);
});

test('corrupt or cross-wallet recovery records fail closed; secret/payload fields cannot persist', async () => {
  const purchase = record();
  for (const patch of [{ version: 2 }, { chain: 'devnet' }, { signedTransaction: 'secret' }, { status: 'expired' }, { signature: 'bad' }])
    assert.throws(() => parsePendingPurchase({ ...purchase, ...patch }, wallet));
  assert.throws(() => parsePendingPurchase(purchase, purchase.marketId));
  const { records, storage } = memory();
  records.set(wallet, { ...purchase, status: 'expired' });
  const flow = createPurchaseRecovery(storage);
  await assert.rejects(
    flow.sendOnce(purchase, async () => {
      assert.fail('must not send with corrupt persisted state');
    })
  );
  await assert.rejects(flow.dismissResolved(wallet));
});
