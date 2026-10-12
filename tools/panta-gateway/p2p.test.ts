import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createP2POrderStore } from '../../src/features/panta/p2p-order-store';
import { P2PError, p2pUnits, parseP2PBook, parseP2PRequest, type P2PBuild, type P2PRequest } from '../../src/lib/panta-p2p';
import { createP2PClient, parseP2PBuild } from '../../src/lib/panta-p2p-client';
import { createP2PRpc, p2pAccount, p2pOrder } from './p2p-chain';
import { createP2POrders } from './p2p-orders';
import { compileUnsignedPrimary, deployment } from './primary-transaction';

type Capture = {
  now: number;
  nonce: string;
  request: P2PRequest;
  build: P2PBuild;
  trace: { method: string; params: unknown[]; result: any }[];
};
function capture(name = 'buy-yes'): Capture {
  return JSON.parse(readFileSync(new URL(`./p2p-${name}-fixture.json`, import.meta.url), 'utf8'));
}
function comparable(method: string, params: unknown[]) {
  if (method !== 'getMultipleAccounts' && method !== 'simulateTransaction') return JSON.stringify(params);
  const copy = structuredClone(params);
  delete (copy[1] as { minContextSlot?: number }).minContextSlot;
  return JSON.stringify(copy);
}
function replay(source: Capture, mutate: (method: string, result: any) => void = () => {}) {
  const rows = structuredClone(source.trace);
  return async (method: string, params: unknown[] = []) => {
    const index = rows.findIndex(row => row.method === method && comparable(method, row.params) === comparable(method, params));
    const retained = source.trace.findLast(row => row.method === method && comparable(method, row.params) === comparable(method, params));
    assert.ok(index >= 0 || retained, `Unexpected public-read fixture request: ${method}`);
    const result = index >= 0 ? rows.splice(index, 1)[0].result : structuredClone(retained!.result);
    mutate(method, result);
    return result;
  };
}
for (const name of ['buy-yes', 'buy-no', 'sell-yes', 'cancel', 'cancel-buy']) {
  test(`native P2P ${name} replays recorded unsigned public-chain economics`, async () => {
    const source = capture(name);
    const service = createP2POrders(
      replay(source),
      () => source.now,
      () => Buffer.from(source.nonce, 'hex')
    );
    const build = await service.build(source.request);
    assert.deepEqual(build.p2p.facts, source.build.p2p.facts);
    assert.deepEqual(build.p2p.cost, source.build.p2p.cost);
    assert.deepEqual(build.instructions, source.build.instructions);
    assert.equal(parseP2PBuild(build, source.request, source.now), build);
    assert.equal(
      compileUnsignedPrimary(build)
        .transaction.subarray(1, 65)
        .every(byte => byte === 0),
      true
    );
    assert.throws(() => service.get(build.orderId, deployment.system));
    const forged = structuredClone(build);
    forged.p2p.request.price = '999';
    await assert.rejects(service.preflight(forged));
  });
}

test('P2P values preserve ninth/sixth decimals and reject float coercion, extra fields and malformed operations', () => {
  const request = capture().request;
  assert.equal(p2pUnits('0.371234567', 9), 371234567n);
  assert.equal(p2pUnits('1.123456', 6), 1123456n);
  for (const value of ['0.0000000001', 'NaN', '1e3', '-1', ' 1', '01', '99999999999']) assert.throws(() => p2pUnits(value, 9));
  assert.throws(() => parseP2PRequest({ ...request, rpc: 'https://attacker.example' }));
  assert.throws(() => parseP2PRequest({ ...request, intent: 'cancel', order: null }));
  assert.throws(() => parseP2PRequest({ ...request, shares: 1 }));
});

for (const attack of [
  'wrong-genesis',
  'wrong-deployment',
  'wrong-mint',
  'extra-debit',
  'wrong-share-lock',
  'wrong-rent',
  'bank-mismatch',
  'fee-mismatch',
]) {
  test(`P2P blocks ${attack} before a review can be prepared`, async () => {
    const source = capture('buy-no');
    const rpc = replay(source, (method, result) => {
      if (method === 'getMultipleAccounts') {
        for (let i = 0; i < result.value.length; i++) {
          const row = result.value[i];
          if (!row) continue;
          const bytes = Buffer.from(row.data[0], 'base64');
          if (attack === 'wrong-deployment' && row.owner === deployment.loader && bytes.length >= 45) bytes.writeBigUInt64LE(1n, 4);
          if (attack === 'wrong-mint' && bytes.length === 82) bytes[44] = 9;
          row.data[0] = bytes.toString('base64');
        }
      }
      if (method === 'simulateTransaction') {
        if (attack === 'bank-mismatch') result.context.slot++;
        if (attack === 'extra-debit') result.value.postTokenBalances[0].uiTokenAmount.amount = '0';
        if (attack === 'wrong-rent') result.value.postBalances[0]--;
        if (attack === 'fee-mismatch') result.value.fee++;
        if (attack === 'wrong-share-lock')
          for (const row of result.value.accounts) {
            if (!row) continue;
            const bytes = Buffer.from(row.data[0], 'base64');
            if (bytes.length === 202) bytes.writeBigUInt64LE(999n, 154);
            row.data[0] = bytes.toString('base64');
          }
      }
    });
    const guarded = async (method: string, params: unknown[] = []) =>
      attack === 'wrong-genesis' && method === 'getGenesisHash' ? 'devnet' : rpc(method, params);
    await assert.rejects(
      createP2POrders(
        guarded,
        () => source.now,
        () => Buffer.from(source.nonce, 'hex')
      ).build(source.request),
      error => error instanceof P2PError
    );
  });
}

test('P2P decoder rejects legacy PDA and cross-market orders even when discriminators match', () => {
  const source = capture();
  const row = source.trace.filter(row => row.method === 'simulateTransaction').at(-1)!;
  const account = row.result.value.accounts.find((account: any) => account && Buffer.from(account.data[0], 'base64').length === 269);
  const node = source.build.instructions.at(-1)!.accounts[5].pubkey;
  assert.equal(p2pOrder(node, p2pAccount(account), source.request.marketId).amount, 1000000n);
  assert.throws(() => p2pOrder(deployment.system, p2pAccount(account), source.request.marketId));
  assert.throws(() => p2pOrder(node, p2pAccount(account), deployment.system));
});

test('P2P order-book parsing rejects stale, future, duplicate and unbound data', () => {
  const source = capture();
  const book = {
    marketId: source.request.marketId,
    slot: 1,
    observedAt: source.now,
    tradingOpen: true,
    feeBps: 150,
    orders: [],
    availableCash: '0',
    yesShares: '1',
    noShares: '0',
  };
  assert.equal(parseP2PBook(book, book.marketId, source.now), book);
  assert.throws(() => parseP2PBook(book, book.marketId, source.now + 30001));
  assert.throws(() => parseP2PBook(book, book.marketId, source.now - 1));
  assert.throws(() => parseP2PBook(book, deployment.system, source.now));
  const order = { address: source.request.marketId, owner: source.request.wallet, intent: 'sell', side: 'yes', price: '0.5', shares: '1' };
  assert.throws(() => parseP2PBook({ ...book, orders: [order, order] }, book.marketId, source.now));
});

test('P2P client binds reviews to wallet, market, request, expiry and exact costs', () => {
  const source = capture();
  for (const mutate of [
    (value: P2PBuild) => {
      value.instructions[0].programId = deployment.system;
    },
    (value: P2PBuild) => {
      const data = Buffer.from(value.instructions[0].data, 'base64');
      data[8] = 1;
      value.instructions[0].data = data.toString('base64');
    },
    (value: P2PBuild) => {
      value.wallet = deployment.system;
    },
    (value: P2PBuild) => {
      value.marketId = deployment.system;
    },
    (value: P2PBuild) => {
      value.p2p.request.price = '1';
    },
    (value: P2PBuild) => {
      value.p2p.cost.totalUsdcBaseUnits = '1';
    },
    (value: P2PBuild) => {
      value.expiresAt = new Date(source.now).toISOString();
    },
    (value: P2PBuild) => {
      value.instructions[0].accounts[1].isSigner = true;
    },
  ]) {
    const value = structuredClone(source.build);
    mutate(value);
    assert.throws(() => parseP2PBuild(value, source.request, source.now));
  }
});

test('input/account invalidation discards late P2P builds and does not expose SDK error content', async () => {
  const source = capture();
  let resolve!: (value: P2PBuild) => void;
  const client = {
    book: async () => {
      throw new Error('unused');
    },
    build: async () =>
      new Promise<P2PBuild>(done => {
        resolve = done;
      }),
  };
  const store = createP2POrderStore(client, source.request.marketId, source.request.wallet);
  const pending = store.build(source.request, async () => ({ access: 'synthetic', identity: 'synthetic' }));
  await Promise.resolve();
  store.invalidate();
  resolve(source.build);
  await pending;
  assert.equal(store.useBuild.getState().build, null);
  await store.build(source.request, async () => {
    throw new Error('private SDK credential content');
  });
  assert.equal(store.useBuild.getState().error, 'This order could not be reviewed.');
});

test('P2P RPC and client keep URLs fixed and redact network failures', async () => {
  const rpc = createP2PRpc(async input => {
    assert.equal(String(input), 'https://api.mainnet-beta.solana.com');
    return new Response('private upstream error', { status: 503 });
  });
  await assert.rejects(rpc('getGenesisHash'), /order book could not be verified/);
  await assert.rejects(rpc('sendTransaction'), error => error instanceof P2PError && error.code === 'P2P_BLOCKED');
  assert.throws(() => createP2PClient('http://attacker.example'));
  const client = createP2PClient('https://gateway.example', async () => {
    throw new Error('secret upstream text');
  });
  await assert.rejects(
    client.book(capture().request.marketId, capture().request.wallet, new AbortController().signal),
    /order book could not be verified/
  );
});

test('P2P revalidates the exact account snapshot before approval and rejects changes or expiry', async () => {
  const source = capture('buy-no');
  const initial = replay(source);
  let steady = false;
  let changed = false;
  let now = source.now;
  const rpc = async (method: string, params: unknown[] = []) => {
    if (!steady) return initial(method, params);
    const row = source.trace.findLast(row => row.method === method && comparable(method, row.params) === comparable(method, params));
    assert.ok(row);
    const result = structuredClone(row.result);
    if (changed && method === 'getMultipleAccounts') result.value[0].lamports++;
    return result;
  };
  const engine = createP2POrders(
    rpc,
    () => now,
    () => Buffer.from(source.nonce, 'hex')
  );
  const build = await engine.build(source.request);
  steady = true;
  assert.equal((await engine.preflight(build)).status, 'simulated');
  changed = true;
  await assert.rejects(engine.preflight(build), error => error instanceof Error && 'code' in error && error.code === 'P2P_CHANGED');
  changed = false;
  now += 60001;
  assert.throws(() => engine.get(build.orderId, build.wallet));
  await assert.rejects(engine.preflight(build));
});

test('P2P pairs account reads with simulation while retaining the same-bank requirement', async () => {
  const source = capture('buy-no');
  const base = replay(source);
  let snapshots = 0;
  let release: (() => void) | undefined;
  let paired = false;
  const rpc = async (method: string, params: unknown[] = []) => {
    if (method === 'getMultipleAccounts' && (params[0] as string[]).length > 10 && ++snapshots > 1) {
      await new Promise<void>(resolve => {
        release = resolve;
      });
    }
    if (method === 'simulateTransaction') {
      assert.ok(release, 'account read must already be in flight');
      paired = true;
      release();
    }
    const value = await base(method, params);
    const minimumSlot = (params[1] as { minContextSlot?: number } | undefined)?.minContextSlot;
    if (minimumSlot !== undefined) assert.ok(value.context.slot >= minimumSlot);
    return value;
  };
  await createP2POrders(
    rpc,
    () => source.now,
    () => Buffer.from(source.nonce, 'hex')
  ).build(source.request);
  assert.equal(paired, true);
});
