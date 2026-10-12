import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import bs58 from 'bs58';

import { p2pDecimal, P2PError, type P2PBuild } from '../../src/lib/panta-p2p';
import { parseP2PBuild } from '../../src/lib/panta-p2p-client';
import { p2pAccount, p2pNode, p2pOrder, p2pPosition } from './p2p-chain';
import { createP2POrders, validateP2PEconomics } from './p2p-orders';
import { compileUnsignedPrimary, configAddress, deployment, key, type AccountSnapshot, type ChainAccount } from './primary-transaction';

// Synthetic economic scenarios built from public account-layout captures.
// These do not claim live standalone matching/withdrawal or signature acceptance.
function setup() {
  const fixture = JSON.parse(readFileSync(new URL('./p2p-buy-yes-fixture.json', import.meta.url), 'utf8'));
  const build = fixture.build as P2PBuild;
  const snapshot = fixture.trace.filter((row: any) => row.method === 'getMultipleAccounts').at(-1);
  const simulated = fixture.trace.filter((row: any) => row.method === 'simulateTransaction').at(-1);
  const before: AccountSnapshot = new Map(snapshot.params[0].map((id: string, i: number) => [id, p2pAccount(snapshot.result.value[i])]));
  const clone = (account: ChainAccount | null | undefined) => (account ? { ...account, data: Buffer.from(account.data) } : null);
  const after: AccountSnapshot = new Map([...before].map(([id, value]) => [id, clone(value)]));
  const keys = compileUnsignedPrimary(build).keys;
  const writable = keys.filter(id => build.instructions.some(ix => ix.accounts.some(meta => meta.pubkey === id && meta.isWritable)));
  writable.forEach((id, i) => after.set(id, p2pAccount(simulated.result.value.accounts[i])));
  const meta = build.instructions.at(-1)!.accounts.map(row => row.pubkey);
  const addresses = {
    user: meta[11],
    position: meta[3],
    vault: meta[6],
    vaultAta: meta[7],
    creatorAta: meta[9],
    treasuryAta: meta[10],
    level: meta[4],
    node: meta[5],
  };
  const rents = new Map<number, number>(
    fixture.trace.filter((row: any) => row.method === 'getMinimumBalanceForRentExemption').map((row: any) => [row.params[0], row.result])
  );
  const amount = (map: AccountSnapshot, id: string) => map.get(id)!.data.readBigUInt64LE(64);
  const setAmount = (map: AccountSnapshot, id: string, value: bigint) => map.get(id)!.data.writeBigUInt64LE(value, 64);
  function simulation(ids: string[], tokenIds: string[]) {
    const balances = (map: AccountSnapshot) => ids.map(id => map.get(id)?.lamports ?? 0);
    const tokens = (map: AccountSnapshot) =>
      tokenIds.map(id => ({
        accountIndex: ids.indexOf(id),
        owner: bs58.encode(map.get(id)!.data.subarray(32, 64)),
        mint: deployment.mint,
        uiTokenAmount: { decimals: 6, amount: amount(map, id).toString() },
      }));
    return {
      fee: 5000,
      preBalances: balances(before),
      postBalances: balances(after),
      preTokenBalances: tokens(before),
      postTokenBalances: tokens(after),
    };
  }
  return { fixture, build, before, after, keys, addresses, rents, amount, setAmount, clone, simulation };
}

function linkQueue(state: ReturnType<typeof setup>, nodes: string[], buy = true) {
  if (!state.before.get(state.addresses.level!)) {
    state.before.set(state.addresses.level!, state.clone(state.after.get(state.addresses.level!)));
    state.after.get(state.build.wallet)!.lamports += state.rents.get(218)!;
  }
  const level = state.before.get(state.addresses.level!)!;
  key(deployment.system).copy(level.data, buy ? 90 : 154);
  key(deployment.system).copy(level.data, buy ? 122 : 186);
  key(nodes[0] ?? deployment.system).copy(level.data, buy ? 154 : 90);
  key(nodes.at(-1) ?? deployment.system).copy(level.data, buy ? 186 : 122);
  nodes.forEach((id, i) => {
    const node = state.before.get(id)!;
    key(nodes[i - 1] ?? deployment.system).copy(node.data, 157);
    key(nodes[i + 1] ?? deployment.system).copy(node.data, 189);
  });
}

test('withdrawal returns only available market cash without changing shares or locks', () => {
  const state = setup();
  const { build, before, after, addresses: a, rents } = state;
  build.p2p.request = { ...build.p2p.request, intent: 'withdraw', price: '0', shares: '0' };
  build.amountUsdc = '0';
  build.feeUsdc = '0';
  for (const [id, account] of before) after.set(id, state.clone(account));
  before.get(a.position)!.data.writeBigUInt64LE(500000n, 106);
  after.get(a.position)!.data.writeBigUInt64LE(0n, 106);
  after.get(build.wallet)!.lamports -= 5000;
  state.setAmount(after, a.user, state.amount(before, a.user) + 500000n);
  state.setAmount(after, a.vaultAta, state.amount(before, a.vaultAta) - 500000n);
  const keys = [
    build.wallet,
    configAddress(),
    build.marketId,
    a.position,
    a.user,
    a.vault,
    a.vaultAta,
    deployment.mint,
    deployment.token,
    deployment.ata,
    deployment.system,
  ];
  const plan = { build, addresses: { ...a, level: null, node: null }, peers: [], own: null };
  const run = () => validateP2PEconomics(plan, keys, before, after, state.simulation(keys, [a.user, a.vaultAta]), rents);
  assert.equal(run().facts.refundUsdc, '0.5');
  state.setAmount(after, a.user, state.amount(after, a.user) - 1n);
  assert.throws(run);
  state.setAmount(after, a.user, state.amount(after, a.user) + 1n);
  after.get(a.position)!.data.writeBigUInt64LE(1n, 154);
  assert.throws(run);
});

test('partial buy validates maker cash, available versus locked shares and remaining escrow', () => {
  const state = setup();
  const { build, before, after, addresses: a, rents } = state;
  const owner = bs58.encode(new Uint8Array(32).fill(18));
  const makerPosition = p2pPosition(build.marketId, owner);
  const makerNode = p2pNode(a.level!, owner, 42n);
  const node = state.clone(after.get(a.node!))!;
  key(owner).copy(node.data, 9);
  node.data.writeBigUInt64LE(42n, 149);
  node.data[130] = 1;
  node.data[131] = 1;
  node.data.fill(0, 221, 269);
  node.data.writeBigUInt64LE(1000000n, 237);
  before.set(makerNode, node);
  const matched = state.clone(node)!;
  matched.data.writeBigUInt64LE(0n, 105);
  matched.data.writeBigUInt64LE(0n, 237);
  after.set(makerNode, matched);
  const position = state.clone(before.get(a.position))!;
  key(owner).copy(position.data, 41);
  position.data.fill(0, 74, 122);
  position.data.fill(0, 154, 202);
  position.data.writeBigUInt64LE(5000000n, 74);
  position.data.writeBigUInt64LE(1000000n, 170);
  before.set(makerPosition, position);
  const paid = state.clone(position)!;
  paid.data.writeBigUInt64LE(500000n, 106);
  paid.data.writeBigUInt64LE(0n, 170);
  after.set(makerPosition, paid);
  build.p2p.request.shares = '2';
  build.expectedShares = '2';
  build.amountUsdc = '1';
  build.feeUsdc = '0.015';
  after.get(a.position)!.data.writeBigUInt64LE(before.get(a.position)!.data.readBigUInt64LE(74) + 1000000n, 74);
  after.get(a.node!)!.data.writeBigUInt64LE(2000000n, 113);
  state.setAmount(after, a.user, state.amount(before, a.user) - 1015000n);
  state.setAmount(after, a.vaultAta, state.amount(before, a.vaultAta) + 1007500n);
  state.setAmount(after, a.treasuryAta, state.amount(before, a.treasuryAta) + 7500n);
  const keys = [...state.keys, makerNode, makerPosition];
  linkQueue(state, [makerNode]);
  const plan = { build, addresses: a, peers: [p2pOrder(makerNode, node, build.marketId)], own: null };
  const run = () =>
    validateP2PEconomics(plan, keys, before, after, state.simulation(keys, [a.user, a.vaultAta, a.treasuryAta, a.creatorAta]), rents);
  assert.deepEqual(run().facts, {
    filledShares: '1',
    remainingShares: '1',
    lockedUsdc: '0.5075',
    refundUsdc: '0',
    cashCreditUsdc: '0',
    rentRefundLamports: '0',
  });
  paid.data.writeBigUInt64LE(500001n, 106);
  assert.throws(run);
  paid.data.writeBigUInt64LE(500000n, 106);
  matched.data.writeBigUInt64LE(1n, 237);
  assert.throws(run);
});

test('partial sell credits market cash and settles a maker bid without double-counting escrow', () => {
  const state = setup();
  const { build, before, after, addresses: a, rents } = state;
  const owner = bs58.encode(new Uint8Array(32).fill(18));
  const makerPosition = p2pPosition(build.marketId, owner);
  const makerNode = p2pNode(a.level!, owner, 42n);
  const node = state.clone(after.get(a.node!))!;
  key(owner).copy(node.data, 9);
  node.data.writeBigUInt64LE(42n, 149);
  node.data[130] = 0;
  node.data[131] = 0;
  node.data.fill(0, 221, 269);
  node.data.writeBigUInt64LE(507500n, 221);
  before.set(makerNode, node);
  const matched = state.clone(node)!;
  matched.data.writeBigUInt64LE(0n, 105);
  matched.data.writeBigUInt64LE(0n, 221);
  after.set(makerNode, matched);
  const position = state.clone(before.get(a.position))!;
  key(owner).copy(position.data, 41);
  position.data.fill(0, 74, 122);
  position.data.fill(0, 154, 202);
  position.data.writeBigUInt64LE(5000000n, 74);
  position.data.writeBigUInt64LE(507500n, 154);
  before.set(makerPosition, position);
  const paid = state.clone(position)!;
  paid.data.writeBigUInt64LE(6000000n, 74);
  paid.data.writeBigUInt64LE(0n, 154);
  after.set(makerPosition, paid);
  build.p2p.request.intent = 'sell';
  build.p2p.request.shares = '2';
  build.expectedShares = '2';
  build.amountUsdc = '0';
  build.feeUsdc = '0';
  after.get(a.position)!.data.writeBigUInt64LE(before.get(a.position)!.data.readBigUInt64LE(74) - 2000000n, 74);
  after.get(a.position)!.data.writeBigUInt64LE(500000n, 106);
  after.get(a.position)!.data.writeBigUInt64LE(0n, 154);
  after.get(a.position)!.data.writeBigUInt64LE(1000000n, 170);
  after.get(a.node!)!.data[130] = 1;
  after.get(a.node!)!.data[131] = 1;
  after.get(a.node!)!.data.writeBigUInt64LE(0n, 221);
  after.get(a.node!)!.data.writeBigUInt64LE(1000000n, 237);
  after.get(a.node!)!.data.writeBigUInt64LE(2000000n, 113);
  state.setAmount(after, a.user, state.amount(before, a.user));
  state.setAmount(after, a.vaultAta, state.amount(before, a.vaultAta) - 7500n);
  state.setAmount(after, a.treasuryAta, state.amount(before, a.treasuryAta) + 7500n);
  const keys = [...state.keys, makerNode, makerPosition];
  linkQueue(state, [makerNode], false);
  const plan = { build, addresses: a, peers: [p2pOrder(makerNode, node, build.marketId)], own: null };
  const run = () =>
    validateP2PEconomics(plan, keys, before, after, state.simulation(keys, [a.user, a.vaultAta, a.treasuryAta, a.creatorAta]), rents);
  assert.deepEqual(run().facts, {
    filledShares: '1',
    remainingShares: '1',
    lockedUsdc: '0',
    refundUsdc: '0',
    cashCreditUsdc: '0.5',
    rentRefundLamports: '0',
  });
  paid.data.writeBigUInt64LE(1n, 106);
  assert.throws(run);
  paid.data.writeBigUInt64LE(0n, 106);
  matched.data.writeBigUInt64LE(1n, 221);
  assert.throws(run);
});

// Entirely synthetic deeper books. The service still performs its real local
// planning, compilation, independent mobile guard and economic validation.
function deepBook(count: number, sharedOwner = false, quantity = BigInt(count + 1) * 1000000n, sell = false) {
  const state = setup();
  const { build, before, after, addresses: a } = state;
  const nodes: string[] = [];
  const ownerTotals = new Map<string, { total: bigint; fill: bigint }>();
  let unfilled = quantity;
  for (let i = 0; i < count; i++) {
    const owner = bs58.encode(new Uint8Array(32).fill(sharedOwner ? 18 : 18 + i));
    const address = p2pNode(a.level!, owner, BigInt(42 + i));
    const node = state.clone(after.get(a.node!))!;
    key(owner).copy(node.data, 9);
    node.data.writeBigUInt64LE(BigInt(42 + i), 149);
    node.data[130] = sell ? 0 : 1;
    node.data[131] = sell ? 0 : 1;
    node.data.fill(0, 221, 269);
    node.data.writeBigUInt64LE(sell ? 507500n : 1000000n, sell ? 221 : 237);
    before.set(address, node);
    const fill = unfilled < 1000000n ? unfilled : 1000000n;
    unfilled -= fill;
    const post = state.clone(node)!;
    post.data.writeBigUInt64LE(1000000n - fill, 105);
    post.data.writeBigUInt64LE(sell ? ((1000000n - fill) * 507500n) / 1000000n : 1000000n - fill, sell ? 221 : 237);
    after.set(address, post);
    nodes.push(address);
    const total = ownerTotals.get(owner) ?? { total: 0n, fill: 0n };
    total.total += 1000000n;
    total.fill += fill;
    ownerTotals.set(owner, total);
  }
  for (const [owner, totals] of ownerTotals) {
    const address = p2pPosition(build.marketId, owner);
    const position = state.clone(before.get(a.position))!;
    key(owner).copy(position.data, 41);
    position.data.fill(0, 74, 122);
    position.data.fill(0, 154, 202);
    position.data.writeBigUInt64LE(sell ? (totals.total * 507500n) / 1000000n : totals.total, sell ? 154 : 170);
    before.set(address, position);
    const post = state.clone(position)!;
    post.data.writeBigUInt64LE(sell ? totals.fill : totals.fill / 2n, sell ? 74 : 106);
    post.data.writeBigUInt64LE(sell ? ((totals.total - totals.fill) * 507500n) / 1000000n : totals.total - totals.fill, sell ? 154 : 170);
    after.set(address, post);
  }
  linkQueue(state, nodes, !sell);
  const filled = quantity - unfilled;
  const gross = sell ? 0n : quantity / 2n;
  const fee = (gross * 150n) / 10000n;
  const treasury = ((filled / 2n) * 150n) / 10000n;
  const locked = sell ? 0n : unfilled / 2n + ((unfilled / 2n) * 150n) / 10000n;
  build.p2p.request.intent = sell ? 'sell' : 'buy';
  build.p2p.request.shares = p2pDecimal(quantity, 6);
  build.expectedShares = build.p2p.request.shares;
  build.amountUsdc = p2pDecimal(gross, 6);
  build.feeUsdc = p2pDecimal(fee, 6);
  const instructionData = Buffer.from(build.instructions.at(-1)!.data, 'base64');
  instructionData.writeBigUInt64LE(quantity, 17);
  instructionData[25] = sell ? 0 : 1;
  build.instructions.at(-1)!.data = instructionData.toString('base64');
  after.get(a.position)!.data.writeBigUInt64LE(before.get(a.position)!.data.readBigUInt64LE(74) + (sell ? -quantity : filled), 74);
  after.get(a.position)!.data.writeBigUInt64LE(before.get(a.position)!.data.readBigUInt64LE(154) + locked, 154);
  if (sell) {
    after.get(a.position)!.data.writeBigUInt64LE(before.get(a.position)!.data.readBigUInt64LE(106) + filled / 2n, 106);
    after.get(a.position)!.data.writeBigUInt64LE(before.get(a.position)!.data.readBigUInt64LE(170) + unfilled, 170);
    after.get(a.node!)!.data[130] = 1;
    after.get(a.node!)!.data[131] = 1;
    after.get(a.node!)!.data.writeBigUInt64LE(unfilled, 237);
  }
  after.get(a.node!)!.data.writeBigUInt64LE(unfilled, 105);
  after.get(a.node!)!.data.writeBigUInt64LE(quantity, 113);
  after.get(a.node!)!.data.writeBigUInt64LE(locked, 221);
  state.setAmount(after, a.user, state.amount(before, a.user) - gross - fee);
  state.setAmount(after, a.vaultAta, state.amount(before, a.vaultAta) + gross + fee - treasury);
  state.setAmount(after, a.treasuryAta, state.amount(before, a.treasuryAta) + treasury);
  const peers = nodes.map(id => p2pOrder(id, before.get(id)!, build.marketId));
  build.instructions
    .at(-1)!
    .accounts.push(
      ...peers
        .flatMap(peer => [peer.address, p2pPosition(build.marketId, peer.owner)])
        .map(pubkey => ({ pubkey, isSigner: false, isWritable: true }))
    );
  let simulations = 0;
  const encode = (account: ChainAccount | null | undefined) =>
    account ? { ...account, data: [account.data.toString('base64'), 'base64'] } : null;
  const rpc = async (method: string, params: unknown[] = []): Promise<any> => {
    if (method === 'getMultipleAccounts') return { context: { slot: 1 }, value: (params[0] as string[]).map(id => encode(before.get(id))) };
    if (method === 'simulateTransaction') {
      simulations++;
      const compiled = compileUnsignedPrimary(build);
      assert.equal(params[0], compiled.transaction.toString('base64'));
      const options = params[1] as { accounts: { addresses: string[] } };
      return {
        context: { slot: 1 },
        value: {
          err: null,
          ...state.simulation(compiled.keys, [a.user, a.vaultAta, a.treasuryAta, a.creatorAta]),
          accounts: options.accounts.addresses.map(id => encode(after.get(id))),
        },
      };
    }
    const retained = state.fixture.trace.find((row: any) => row.method === method && JSON.stringify(row.params) === JSON.stringify(params));
    if (retained) return structuredClone(retained.result);
    if (method === 'isBlockhashValid') return { value: true };
    if (method === 'getFeeForMessage') return { value: 5000 };
    throw Error(`Unexpected synthetic RPC: ${method}`);
  };
  const service = createP2POrders(
    rpc,
    () => state.fixture.now,
    () => Buffer.from(state.fixture.nonce, 'hex')
  );
  return { ...state, peers, nodes, service, simulations: () => simulations };
}

for (const [count, shared, quantity, sell] of [
  [5, false, 6000000n, false],
  [10, true, 11000000n, false],
  [5, false, 4500000n, false],
  [5, false, 6000000n, true],
  [10, true, 11000000n, true],
] as const) {
  test(`synthetic ${count}-node ${sell ? 'sell' : 'buy'} (${shared ? 'one maker' : 'distinct makers'}, ${quantity} units) passes full native build`, async () => {
    const state = deepBook(count, shared, quantity, sell);
    const build = await state.service.build(state.build.p2p.request);
    assert.equal(parseP2PBuild(build, build.p2p.request, state.fixture.now), build);
    assert.ok(compileUnsignedPrimary(build).transaction.length <= 1232);
    assert.equal(build.p2p.facts.filledShares, p2pDecimal(quantity < BigInt(count) * 1000000n ? quantity : BigInt(count) * 1000000n, 6));
    await state.service.preflight(build);
    state.before.get(state.addresses.position)!.data.writeBigUInt64LE(1n, 106);
    await assert.rejects(state.service.preflight(build), error => error instanceof P2PError && error.code === 'P2P_CHANGED');
  });
}

for (const attack of ['wire-limit', 'work-limit', 'config-limit', 'broken-prev', 'cycle', 'wrong-side', 'self-match'] as const) {
  test(`deeper native planner rejects ${attack} without simulation or queue truncation`, async () => {
    const state = deepBook(attack === 'work-limit' ? 17 : attack === 'wire-limit' ? 9 : 5, attack === 'work-limit');
    if (attack === 'config-limit') state.before.get(configAddress())!.data.writeUInt32LE(4, 224);
    if (attack === 'broken-prev') key(deployment.system).copy(state.before.get(state.nodes[1])!.data, 157);
    if (attack === 'cycle') key(state.nodes[0]).copy(state.before.get(state.nodes[1])!.data, 189);
    if (attack === 'wrong-side') state.before.get(state.nodes[2])!.data[129] = 1;
    if (attack === 'self-match') key(state.build.wallet).copy(state.before.get(state.nodes[0])!.data, 9);
    await assert.rejects(state.service.build(state.build.p2p.request), error => error instanceof P2PError);
    assert.equal(state.simulations(), 0);
  });
}

test('deeper economics rejects skipping the FIFO head, maker aggregate drift and hidden fees', async () => {
  for (const attack of ['skip-head', 'maker-cash', 'extra-treasury']) {
    const state = deepBook(5);
    if (attack === 'skip-head') key(state.nodes[1]).copy(state.before.get(state.addresses.level!)!.data, 154);
    if (attack === 'maker-cash') state.after.get(p2pPosition(state.build.marketId, state.peers[0].owner))!.data.writeBigUInt64LE(1n, 106);
    if (attack === 'extra-treasury')
      state.setAmount(state.after, state.addresses.treasuryAta, state.amount(state.after, state.addresses.treasuryAta) + 1n);
    await assert.rejects(state.service.build(state.build.p2p.request), error => error instanceof P2PError);
  }
});
