import assert from 'node:assert/strict';
import { type AddressInfo } from 'node:net';
import { test } from 'node:test';

import { createOrderStore } from '../../src/features/panta/order-store';
import { type OrderBuild } from '../../src/lib/panta-order-build';
import { createOrderClient } from '../../src/lib/panta-order-client';
import { parsePreflightReport, type PreflightReport } from '../../src/lib/panta-order-preflight';
import { type OrderQuote } from '../../src/lib/panta-orders';
import { createCatalogGateway } from './gateway';
import fixture from './preflight-fixture.json';
import { validatePrimaryEconomics } from './primary-economics';
import { createPrimaryPreflight } from './primary-preflight';
import {
  compileUnsignedPrimary,
  deployment,
  key,
  PreflightError,
  validatePrimaryTransaction,
  type AccountSnapshot,
} from './primary-transaction';

const build = fixture.build as OrderBuild;
const snapshot = (): AccountSnapshot =>
  new Map(Object.entries(fixture.accounts).map(([key, a]) => [key, a ? { ...a, data: Buffer.from(a.data[0], 'base64') } : null]));
const fullSnapshot = () => {
  const map = snapshot();
  for (const ix of build.instructions) for (const a of ix.accounts) if (!map.has(a.pubkey)) map.set(a.pubkey, null);
  return map;
};
function economicsFixture() {
  const accounts = fullSnapshot();
  const ix = build.instructions[1];
  const user = ix.accounts[7].pubkey;
  const vault = ix.accounts[4].pubkey;
  const treasury = ix.accounts[8].pubkey;
  const token = { ...accounts.get(vault)!, data: Buffer.from(accounts.get(vault)!.data) };
  key(build.wallet).copy(token.data, 32);
  accounts.set(user, token);
  const keys = compileUnsignedPrimary(build).keys;
  const rows = (post: boolean) =>
    [user, vault, treasury].map((address, i) => ({
      accountIndex: keys.indexOf(address),
      mint: deployment.mint,
      owner: i === 0 ? build.wallet : i === 1 ? ix.accounts[3].pubkey : '4M2EtWmjCir2wfMBxtHtTjvg5PxAJitXSQhNMV9odTMk',
      uiTokenAmount: {
        decimals: 6,
        amount: String([100000000n, 100000000n, 100000000n][i] + (post ? [-20400000n, 20000000n, 400000n][i] : 0n)),
      },
    }));
  const preBalances = keys.map(address => (address === ix.accounts[5].pubkey ? 0 : 10000000));
  const postBalances = preBalances.map((v, i) =>
    keys[i] === build.wallet ? v - 1681400 : keys[i] === ix.accounts[5].pubkey ? 1676400 : v
  );
  const value = { err: null, fee: 5000, preTokenBalances: rows(false), postTokenBalances: rows(true), preBalances, postBalances };
  return { accounts, keys, value, rent: { token: 2039280, position: 1676400 } };
}
const validReport: PreflightReport = {
  orderId: build.orderId,
  wallet: build.wallet,
  chain: 'mainnet-beta',
  status: 'simulated',
  code: null,
  messageHash: 'a'.repeat(64),
  networkFeeLamports: '5000',
  signable: false,
  executionProtection: false,
};

test('verified primary instruction, exact base units and all derived accounts validate', () => {
  assert.equal(validatePrimaryTransaction(build, fullSnapshot()).amountBaseUnits, '20000000');
});
test('existing canonical buyer ATA supports buy-only or buy/memo; missing, frozen or foreign ATA fails', () => {
  const economics = economicsFixture();
  const existing = structuredClone(build);
  existing.instructions.shift();
  assert.equal(validatePrimaryTransaction(existing, economics.accounts).amountBaseUnits, '20000000');
  existing.instructions.pop();
  assert.equal(validatePrimaryTransaction(existing, economics.accounts).amountBaseUnits, '20000000');
  const user = build.instructions[1].accounts[7].pubkey;
  for (const mutation of ['missing', 'frozen', 'foreign'] as const) {
    const { accounts } = economicsFixture();
    if (mutation === 'missing') accounts.set(user, null);
    else {
      const account = accounts.get(user)!;
      if (mutation === 'frozen') account.data[108] = 2;
      else account.data[32] ^= 1;
    }
    assert.throws(() => validatePrimaryTransaction(existing, accounts), PreflightError);
  }
  const duplicate = structuredClone(existing);
  duplicate.instructions.push(duplicate.instructions[0]);
  assert.throws(() => validatePrimaryTransaction(duplicate, economics.accounts), PreflightError);
  assert.doesNotThrow(() => validatePrimaryEconomics(existing, economics.keys, economics.accounts, economics.value, 5000, economics.rent));
});
test('policy rejects changed spend, side, program, writable flags, account order, memo or extra instruction', () => {
  for (const mutate of [
    (b: OrderBuild) => {
      b.amountUsdc = '21';
    },
    (b: OrderBuild) => {
      b.side = 'no';
    },
    (b: OrderBuild) => {
      b.instructions[1].programId = deployment.system;
    },
    (b: OrderBuild) => {
      b.instructions[1].accounts[2].isWritable = true;
    },
    (b: OrderBuild) => {
      b.instructions[1].accounts.reverse();
    },
    (b: OrderBuild) => {
      b.instructions[0].data = 'AA==';
    },
    (b: OrderBuild) => {
      b.instructions[2].data = Buffer.from('unbound memo').toString('base64');
    },
    (b: OrderBuild) => {
      b.instructions.push(b.instructions[1]);
    },
  ]) {
    const changed = structuredClone(build);
    mutate(changed);
    assert.throws(() => validatePrimaryTransaction(changed, fullSnapshot()), PreflightError);
  }
});
test('policy rejects changed deployment, config, mint ownership and token authority', () => {
  for (const [address, mutation] of [
    [deployment.program, 'owner'],
    [deployment.programData, 'upgrade'],
    [build.instructions[1].accounts[2].pubkey, 'mint'],
    [deployment.mint, 'decimals'],
    [build.instructions[1].accounts[4].pubkey, 'authority'],
  ] as const) {
    const accounts = fullSnapshot();
    const a = accounts.get(address)!;
    if (mutation === 'owner') a.owner = deployment.system;
    if (mutation === 'upgrade') a.data.writeBigUInt64LE(440119608n, 4);
    if (mutation === 'mint') a.data[244] ^= 1;
    if (mutation === 'decimals') a.data[44] = 9;
    if (mutation === 'authority') a.data[32] ^= 1;
    assert.throws(() => validatePrimaryTransaction(build, accounts), PreflightError);
  }
  assert.throws(() => validatePrimaryTransaction({ ...build, expiresAt: '2000-01-01T00:00:00Z' }, fullSnapshot()), PreflightError);
});
test('v0 serialization has one zero signature, correct payer/header and no lookup tables', () => {
  const compiled = compileUnsignedPrimary(build);
  assert.equal(compiled.transaction.length, compiled.message.length + 65);
  assert.equal(compiled.transaction[0], 1);
  assert.ok(compiled.transaction.subarray(1, 65).every(b => b === 0));
  assert.deepEqual([...compiled.message.subarray(0, 3)], [128, 1, 0]);
  assert.equal(compiled.keys[0], build.wallet);
  assert.equal(compiled.message.at(-1), 0);
  assert.ok(compiled.transaction.length <= 1232);
  const foreign = structuredClone(build);
  foreign.instructions[1].accounts[1].isSigner = true;
  assert.throws(() => compileUnsignedPrimary(foreign), PreflightError);
});
function rpcFixture(
  change: { genesis?: string; invalidHash?: boolean; simulationError?: unknown; oversized?: boolean; missingEconomics?: boolean } = {}
) {
  const methods: string[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(url, 'https://api.mainnet-beta.solana.com');
    const request = JSON.parse(String(options?.body));
    methods.push(request.method);
    let result: unknown;
    if (request.method === 'getGenesisHash') result = change.genesis ?? deployment.genesis;
    else if (request.method === 'getMultipleAccounts')
      result = {
        context: { slot: 100 },
        value: request.params[0].map((address: string) => {
          const a = economicsFixture().accounts.get(address);
          return a ? { ...a, data: [a.data.toString('base64'), 'base64'] } : null;
        }),
      };
    else if (request.method === 'getBlockHeight') result = 10;
    else if (request.method === 'isBlockhashValid') result = { context: { slot: 100 }, value: !change.invalidHash };
    else if (request.method === 'getFeeForMessage') result = { context: { slot: 100 }, value: 5000 };
    else if (request.method === 'getMinimumBalanceForRentExemption') result = request.params[0] === 165 ? 2039280 : 1676400;
    else if (request.method === 'simulateTransaction') {
      assert.equal(request.params[1].sigVerify, false);
      assert.equal(request.params[1].replaceRecentBlockhash, false);
      result = {
        context: { slot: 100 },
        value: {
          ...(change.missingEconomics ? {} : economicsFixture().value),
          err: change.simulationError ?? null,
          logs: ['sensitive diagnostic never return'],
          unitsConsumed: 1,
        },
      };
    } else assert.fail('Unexpected RPC method');
    return new Response(change.oversized ? 'x'.repeat(600000) : JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  };
  return { fetcher, methods };
}
test('unsigned RPC simulation succeeds but can never authorize signing or claim execution protection', async () => {
  const fake = rpcFixture();
  const result = await createPrimaryPreflight(fake.fetcher)(build);
  assert.equal(result.status, 'simulated');
  assert.equal(result.signable, false);
  assert.equal(result.executionProtection, false);
  assert.equal(result.networkFeeLamports, '5000');
  assert.ok(result.messageHash);
  assert.equal(JSON.stringify(result).includes('diagnostic'), false);
  assert.ok(fake.methods.includes('simulateTransaction'));
  assert.ok(fake.methods.every(m => !m.includes('send')));
});
test('wrong chain, stale blockhash, RPC overflow and program errors stop safely', async () => {
  for (const [change, code] of [
    [{ genesis: 'devnet' }, 'CHAIN_MISMATCH'],
    [{ invalidHash: true }, 'EXPIRED'],
    [{ oversized: true }, 'RPC_UNAVAILABLE'],
    [{ simulationError: { InstructionError: [0, 'secret'] } }, 'SIMULATION_FAILED'],
  ] as const) {
    const fake = rpcFixture(change);
    const result = await createPrimaryPreflight(fake.fetcher)(build);
    assert.equal(result.status, 'blocked');
    assert.equal(result.code, code);
    assert.equal(JSON.stringify(result).includes('secret'), false);
    if (code !== 'SIMULATION_FAILED') assert.equal(fake.methods.includes('simulateTransaction'), false);
  }
});
test('client rejects foreign reports and any attempt to claim signing or execution protection', () => {
  assert.deepEqual(parsePreflightReport(validReport, build), validReport);
  for (const patch of [
    { signable: true },
    { executionProtection: true },
    { wallet: deployment.system },
    { orderId: 'other' },
    { code: 'unknown' },
    { networkFeeLamports: -1 },
    { messageHash: null },
  ])
    assert.throws(() => parsePreflightReport({ ...validReport, ...patch }, build));
});
test('edited orders abort and discard late simulations without a second request', async () => {
  let finish!: (report: PreflightReport) => void;
  let signal!: AbortSignal;
  let calls = 0;
  const quote = { ...build, quoteId: build.quoteId, shares: build.expectedShares, avgPrice: null } as OrderQuote;
  const store = createOrderStore(
    async () => quote,
    async () => build,
    async (_, abort) => {
      calls++;
      signal = abort;
      return new Promise(resolve => {
        finish = resolve;
      });
    }
  );
  await store.requestQuote(quote);
  await store.prepareBuild(100);
  const pending = store.simulate();
  await store.simulate();
  store.invalidate();
  finish(validReport);
  await pending;
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
  assert.equal(store.useStore.getState().simulation, null);
});
test('gateway permits only its own stored wallet-bound build to reach preflight; arbitrary bytes and financial routes stay blocked', async () => {
  let calls = 0;
  const quote = { ...build, shares: build.expectedShares, avgPrice: null };
  const server = createCatalogGateway(
    'pk_test_local_fixture',
    async url => new Response(JSON.stringify(String(url).endsWith('/primaryorderquote/') ? quote : build)),
    async stored => {
      assert.equal(stored.orderId, build.orderId);
      calls++;
      return validReport;
    }
  );
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = createOrderClient(base);
  try {
    await assert.rejects(client.preflight(build));
    assert.equal(calls, 0);
    const actual = await client.quote({ wallet: build.wallet, marketId: build.marketId, side: build.side, amountUsdc: build.amountUsdc });
    await client.build({ quoteId: actual.quoteId, wallet: actual.wallet, maxSlippageBps: 100 }, actual);
    assert.equal((await client.preflight(build)).signable, false);
    assert.equal(calls, 1);
    for (const [path, body, expected] of [
      ['/primaryorderpreflight/', { orderId: build.orderId, wallet: deployment.system }, 400],
      ['/primaryorderpreflight/', { orderId: build.orderId, wallet: build.wallet, transaction: 'arbitrary' }, 400],
      ['/primaryordersubmit/', {}, 405],
    ] as const) {
      const response = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, expected);
    }
    assert.equal(calls, 1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('compiled v0 message preserves the exact reviewed instruction bytes and account indices', () => {
  const compiled = compileUnsignedPrimary(build);
  const message = compiled.message;
  let offset = 4;
  function length() {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = message[offset++];
      value |= (byte & 127) << shift;
      shift += 7;
      assert.ok(shift <= 21);
    } while (byte & 128);
    return value;
  }
  const count = length();
  assert.equal(count, compiled.keys.length);
  offset += count * 32 + 32;
  assert.equal(length(), build.instructions.length);
  for (const instruction of build.instructions) {
    assert.equal(compiled.keys[message[offset++]], instruction.programId);
    const count = length();
    assert.equal(count, instruction.accounts.length);
    assert.deepEqual(
      [...message.subarray(offset, offset + count)].map(index => compiled.keys[index]),
      instruction.accounts.map(a => a.pubkey)
    );
    offset += count;
    const bytes = length();
    assert.equal(message.subarray(offset, offset + bytes).toString('base64'), instruction.data);
    offset += bytes;
  }
  assert.equal(length(), 0);
  assert.equal(offset, message.length);
});

test('same-bank economics requires fee on top, exact vault/treasury credits and bounded SOL fee/rent', () => {
  const f = economicsFixture();
  assert.doesNotThrow(() => validatePrimaryEconomics(build, f.keys, f.accounts, f.value, 5000, f.rent));
  for (const mutate of [
    (v: any) => {
      v.postTokenBalances[0].uiTokenAmount.amount = '80000000';
    },
    (v: any) => {
      v.postTokenBalances[1].uiTokenAmount.amount = '120000001';
    },
    (v: any) => {
      v.postTokenBalances[2].uiTokenAmount.amount = '100400001';
    },
    (v: any) => {
      v.postTokenBalances[2].owner = build.wallet;
    },
    (v: any) => {
      v.postTokenBalances[0].mint = deployment.system;
    },
    (v: any) => {
      v.postTokenBalances[0].uiTokenAmount.decimals = 9;
    },
    (v: any) => {
      v.postTokenBalances[0].uiTokenAmount.amount = '18446744073709551616';
    },
    (v: any) => {
      v.postTokenBalances[1].accountIndex = v.postTokenBalances[0].accountIndex;
    },
    (v: any) => {
      v.postBalances[f.keys.indexOf(build.wallet)]--;
    },
    (v: any) => {
      v.postBalances[f.keys.indexOf(build.marketId)]++;
    },
    (v: any) => {
      v.fee++;
    },
    (v: any) => {
      delete v.preTokenBalances;
    },
    (v: any) => {
      v.preBalances.pop();
    },
  ]) {
    const value = structuredClone(f.value);
    mutate(value);
    assert.throws(() => validatePrimaryEconomics(build, f.keys, f.accounts, value, 5000, f.rent), PreflightError);
  }
});
test('economic policy refuses changed fee configuration, incorrect rent and unverified fee rounding', () => {
  const f = economicsFixture();
  assert.throws(() => validatePrimaryEconomics({ ...build, feeUsdc: '0.3' }, f.keys, f.accounts, f.value, 5000, f.rent), PreflightError);
  assert.throws(
    () => validatePrimaryEconomics({ ...build, amountUsdc: '0.000001', feeUsdc: '0' }, f.keys, f.accounts, f.value, 5000, f.rent),
    PreflightError
  );
  assert.throws(() => validatePrimaryEconomics(build, f.keys, f.accounts, f.value, 5000, { ...f.rent, position: 1 }), PreflightError);
  f.accounts.get(build.instructions[1].accounts[2].pubkey)!.data.writeBigUInt64LE(201n, 184);
  assert.throws(() => validatePrimaryEconomics(build, f.keys, f.accounts, f.value, 5000, f.rent), PreflightError);
});

test('RPC success without economic balance evidence stays blocked', async () => {
  const fake = rpcFixture({ missingEconomics: true });
  const result = await createPrimaryPreflight(fake.fetcher)(build);
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'ECONOMICS_UNVERIFIED');
  assert.equal(result.signable, false);
});
