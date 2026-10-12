import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { type AddressInfo } from 'node:net';
import { test } from 'node:test';

import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

import { type OrderBuild } from '../../src/lib/panta-order-build';
import { type PreflightReport } from '../../src/lib/panta-order-preflight';
import {
  decodePurchaseWire,
  encodePurchaseWire,
  parsePreparedPurchase,
  parsePurchaseCost,
  PurchaseError,
  type PurchaseReceipt,
} from '../../src/lib/panta-purchase';
import { createPurchaseClient, PurchaseIngressRejected } from '../../src/lib/panta-purchase-client';
import { createCatalogGateway } from './gateway';
import fixture from './preflight-fixture.json';
import { createPrimaryPurchases } from './primary-purchase';
import { compileUnsignedPrimary, deployment } from './primary-transaction';
import { createPurchaseTransport, PurchaseNotSentError } from './purchase-transport';

// Offline synthetic signer only. Builds below deliberately use an injected
// successful preflight; deployed semantic/economic validation has separate tests.
const secret = new Uint8Array(32).fill(23);
const wallet = bs58.encode(ed25519.getPublicKey(secret));
const now = Date.now();
function build(id = 'order-test'): OrderBuild {
  const value = structuredClone(fixture.build) as OrderBuild;
  const previous = value.wallet;
  value.wallet = wallet;
  value.orderId = id;
  value.expiresAt = new Date(now + 120000).toISOString();
  value.instructions.forEach(ix =>
    ix.accounts.forEach(a => {
      if (a.pubkey === previous) a.pubkey = wallet;
    })
  );
  return value;
}
const cost = {
  amountBaseUnits: '20000000',
  protocolFeeBaseUnits: '400000',
  totalUsdcBaseUnits: '20400000',
  networkFeeLamports: '5000',
  accountRentLamports: '1676400',
  totalSolLamports: '1681400',
};
const identity = { userId: 'did:privy:offline-test', wallet, expiresAt: new Date(now + 900000).toISOString() };
function signed(value: OrderBuild) {
  const wire = Uint8Array.from(compileUnsignedPrimary(value).transaction);
  wire.set(ed25519.sign(wire.subarray(65), secret), 1);
  return wire;
}
const report = (value: OrderBuild): PreflightReport => ({
  orderId: value.orderId,
  wallet,
  chain: 'mainnet-beta',
  status: 'simulated',
  code: null,
  networkFeeLamports: '5000',
  messageHash: compileUnsignedPrimary(value).messageHash,
  cost: { ...cost },
  signable: false,
  executionProtection: false,
});
function setup() {
  let time = now;
  let calls = 0;
  let bank = { ...cost };
  let sendError = false;
  let outcome: PurchaseReceipt['status'] = 'pending';
  const service = createPrimaryPurchases(
    async value => ({ ...report(value), cost: bank }),
    {
      broadcast: async (_wire, _build, signature) => {
        calls++;
        if (sendError) throw new Error('synthetic timeout');
        return signature;
      },
      register: async () => {},
      receipt: async value => ({ ...value, status: outcome }),
    },
    () => time
  );
  return {
    service,
    calls: () => calls,
    advance: (ms: number) => {
      time += ms;
    },
    changeCost: () => {
      bank = { ...cost, networkFeeLamports: '6000', totalSolLamports: '1682400' };
    },
    timeout: () => {
      sendError = true;
    },
    finish: () => {
      outcome = 'confirmed';
    },
  };
}
function request(value: OrderBuild, ticket: string) {
  return { wallet, orderId: value.orderId, ticket, transaction: encodePurchaseWire(signed(value)), priceChangeAccepted: true };
}
test('purchase approval binds exact cost, independently decoded bytes, identity and a short expiry', async () => {
  const state = setup();
  const value = build();
  const prepared = await state.service.prepare(value, identity);
  assert.deepEqual(parsePreparedPurchase(prepared, value, now), prepared);
  assert.equal(Date.parse(prepared.expiresAt), now + 60000);
  assert.equal(prepared.executionProtection, false);
  for (const patch of [
    { totalUsdcBaseUnits: '20000000' },
    { amountBaseUnits: '1' },
    { totalSolLamports: '5000' },
    { networkFeeLamports: '-1' },
  ])
    assert.throws(() => parsePurchaseCost({ ...cost, ...patch }, value));
  await assert.rejects(state.service.prepare(build('wrong-owner'), { ...identity, wallet: '11111111111111111111111111111111' }));
  await assert.rejects(state.service.prepare(value, identity), PurchaseError);
  prepared.ticket = 'b'.repeat(64);
  await assert.rejects(state.service.send(request(value, prepared.ticket), identity));
  assert.equal(state.calls(), 0, 'returned approval mutations cannot change stored approval');
});
test('invalid signature, message, approval acknowledgement or user never broadcasts; valid send consumes approval once', async () => {
  const state = setup();
  const value = build();
  const p = await state.service.prepare(value, identity);
  const valid = request(value, p.ticket);
  for (const patch of [
    { priceChangeAccepted: false },
    { ticket: 'a'.repeat(64) },
    { orderId: 'other' },
    { transaction: p.transaction },
    { wallet: '11111111111111111111111111111111' },
  ])
    await assert.rejects(state.service.send({ ...valid, ...patch }, identity));
  await assert.rejects(state.service.send(valid, { ...identity, userId: 'did:privy:other' }));
  const mutated = signed(value);
  mutated[mutated.length - 2] ^= 1;
  await assert.rejects(state.service.send({ ...valid, transaction: encodePurchaseWire(mutated) }, identity));
  assert.equal(state.calls(), 0);
  const first = state.service.send(valid, identity);
  await assert.rejects(state.service.send(valid, identity));
  const receipt = await first;
  assert.equal(state.calls(), 1);
  assert.equal(receipt.status, 'pending');
  await assert.rejects(state.service.prepare(build('another'), identity));
  state.finish();
  await state.service.receipt(receipt, identity);
  assert.ok(await state.service.prepare(build('next'), identity));
});
test('timeout, expired approval or changed full cost never produces an automatic second send', async () => {
  const timeout = setup();
  const value = build();
  const p = await timeout.service.prepare(value, identity);
  timeout.timeout();
  const receipt = await timeout.service.send(request(value, p.ticket), identity);
  assert.equal(receipt.status, 'pending');
  assert.equal(timeout.calls(), 1);
  await assert.rejects(timeout.service.send(request(value, p.ticket), identity));
  assert.equal((await timeout.service.receipt(receipt, identity)).status, 'pending');
  const changed = setup();
  const q = await changed.service.prepare(value, identity);
  changed.changeCost();
  assert.equal((await changed.service.send(request(value, q.ticket), identity)).status, 'not-sent');
  assert.equal(changed.calls(), 0);
  const expired = setup();
  const r = await expired.service.prepare(value, identity);
  expired.advance(60000);
  await assert.rejects(expired.service.send(request(value, r.ticket), identity));
  assert.equal(expired.calls(), 0);
});
test('concurrent preparation is wallet-scoped and blocked economic reports cannot become approvals', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const state = createPrimaryPurchases(
    async value => {
      await gate;
      return report(value);
    },
    { broadcast: async () => '', register: async () => {}, receipt: async value => value },
    () => now
  );
  const first = state.prepare(build('first'), identity);
  await assert.rejects(state.prepare(build('second'), identity));
  release();
  await first;
  const blocked = createPrimaryPurchases(
    async value => ({ ...report(value), status: 'blocked', code: 'ECONOMICS_UNVERIFIED' }),
    { broadcast: async () => '', register: async () => {}, receipt: async value => value },
    () => now
  );
  await assert.rejects(blocked.prepare(build(), identity));
});
function receipt(value: OrderBuild): PurchaseReceipt {
  return {
    version: 1,
    chain: 'mainnet-beta',
    wallet,
    marketId: value.marketId,
    orderId: value.orderId,
    signature: bs58.encode(signed(value).subarray(1, 65)),
    messageHash: compileUnsignedPrimary(value).messageHash,
    status: 'pending',
  };
}
test('confirmation requires finalized exact message, expected signature and payer; missing/expired sessions remain pending', async () => {
  const value = build();
  const record = receipt(value);
  let response: unknown = null;
  const methods: string[] = [];
  const transport = createPurchaseTransport('pk_test_local', async (_url, init) => {
    const rpc = JSON.parse(String(init?.body));
    methods.push(rpc.method);
    assert.equal(rpc.method === 'getTransaction' ? rpc.params[1].commitment : 'finalized', 'finalized');
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'getGenesisHash' ? deployment.genesis : response })
    );
  });
  assert.equal((await transport.receipt(record)).status, 'pending');
  response = { slot: 100, meta: { err: null }, transaction: [encodePurchaseWire(signed(value)), 'base64'] };
  assert.equal((await transport.receipt(record)).status, 'confirmed');
  await assert.rejects(transport.receipt({ ...record, messageHash: 'a'.repeat(64) }));
  await assert.rejects(transport.receipt({ ...record, signature: bs58.encode(new Uint8Array(64).fill(9)) }));
  response = { slot: 100, meta: { err: { InstructionError: [0, 'Custom'] } }, transaction: [encodePurchaseWire(signed(value)), 'base64'] };
  assert.equal((await transport.receipt(record)).status, 'failed');
  response = {
    slot: 100,
    meta: { err: null },
    transaction: [encodePurchaseWire(signed(build('same-message'))).replace(/.$/, '!'), 'base64'],
  };
  await assert.rejects(transport.receipt(record));
  assert.ok(methods.every(method => ['getGenesisHash', 'getTransaction'].includes(method)));
});
test('broadcast uses pinned RPC with preflight and zero retries; rejects network/height/hash/signature mismatches', async () => {
  const value = build();
  const record = receipt(value);
  let genesis = deployment.genesis as string;
  let height = 0;
  let sent = 0;
  const transport = createPurchaseTransport('pk_test_local', async (url, init) => {
    assert.equal(url, 'https://api.mainnet-beta.solana.com');
    assert.deepEqual(init?.headers, { 'Content-Type': 'application/json' });
    const rpc = JSON.parse(String(init?.body));
    let result: unknown = rpc.method === 'getGenesisHash' ? genesis : rpc.method === 'getBlockHeight' ? height : { value: true };
    if (rpc.method === 'sendTransaction') {
      sent++;
      assert.equal(rpc.params[0], encodePurchaseWire(signed(value)));
      assert.deepEqual(rpc.params[1], { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 });
      result = record.signature;
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
  genesis = 'wrong';
  await assert.rejects(transport.broadcast(signed(value), value, record.signature), PurchaseNotSentError);
  assert.equal(sent, 0);
  genesis = deployment.genesis;
  height = value.lastValidBlockHeight + 1;
  await assert.rejects(transport.broadcast(signed(value), value, record.signature), PurchaseNotSentError);
  assert.equal(sent, 0);
  height = 0;
  assert.equal(await transport.broadcast(signed(value), value, record.signature), record.signature);
  assert.equal(sent, 1);
});
test('Panta registration uses only server credential and original signature; verify amount is exact base units', async () => {
  const value = build();
  const record = receipt(value);
  let amount: unknown = 20000000;
  const paths: string[] = [];
  const transport = createPurchaseTransport('pk_test_local', async (url, init) => {
    paths.push(String(url));
    assert.deepEqual(init?.headers, { 'Content-Type': 'application/json', 'X-Api-Key': 'pk_test_local' });
    assert.deepEqual(JSON.parse(String(init?.body)), { wallet, orderId: value.orderId, signature: record.signature });
    return new Response(
      JSON.stringify(
        String(url).endsWith('submit/')
          ? { orderId: value.orderId, signature: record.signature, status: 'submitted' }
          : {
              orderId: value.orderId,
              signature: record.signature,
              marketId: value.marketId,
              side: value.side,
              amountUsdc: amount,
              status: 'expired',
            }
      )
    );
  });
  await transport.register(record, value);
  amount = '20';
  await assert.rejects(transport.register(record, value));
  assert.ok(paths.every(path => path.startsWith('https://live-api.panta.market/api/v1/primaryorder')));
});
test('authenticated purchase routes cannot forward Privy tokens to upstream or accept unbound wallet requests', async t => {
  const value = build();
  const record = receipt(value);
  let authCalls = 0;
  let receipts = 0;
  const server = createCatalogGateway(
    'pk_test_local',
    async () => {
      throw new Error('upstream forbidden');
    },
    undefined,
    undefined,
    async (selected, access, identityToken) => {
      authCalls++;
      assert.equal(selected, wallet);
      assert.equal(access, 'Bearer synthetic-access');
      assert.equal(identityToken, 'synthetic-identity');
      return identity;
    },
    {
      prepare: async () => {
        throw new Error('missing stored quote');
      },
      send: async () => record,
      receipt: async () => {
        receipts++;
        return record;
      },
    }
  );
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = createPurchaseClient(base);
  assert.deepEqual(await client.receipt(record, 'synthetic-access', 'synthetic-identity'), record);
  assert.equal(authCalls, 1);
  assert.equal(receipts, 1);
  const bad = await fetch(`${base}/purchases/receipt/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...record, wallet: 'bad' }),
  });
  assert.equal(bad.status, 400);
  assert.equal(receipts, 1);
  assert.equal((await fetch(`${base}/primaryordersubmit/`, { method: 'POST' })).status, 405);
});
test('wire base64 round trips exactly, client rejects changed approval and masks transport diagnostics', async () => {
  for (const length of [70, 71, 72, 1231, 1232]) {
    const bytes = Uint8Array.from({ length }, (_, i) => i % 256);
    assert.equal(encodePurchaseWire(bytes), Buffer.from(bytes).toString('base64'));
    assert.deepEqual(decodePurchaseWire(encodePurchaseWire(bytes)), bytes);
  }
  const state = setup();
  const value = build();
  const prepared = await state.service.prepare(value, identity);
  assert.throws(() => parsePreparedPurchase({ ...prepared, messageHash: 'a'.repeat(64) }, value));
  const client = createPurchaseClient('http://127.0.0.1:8787', async () => {
    throw new Error('synthetic-secret');
  });
  await assert.rejects(
    client.prepare(value, 'synthetic-access', 'synthetic-identity'),
    error => error instanceof PurchaseError && !error.message.includes('synthetic-secret')
  );
  assert.equal(createHash('sha256').update(decodePurchaseWire(prepared.transaction).subarray(65)).digest('hex'), prepared.messageHash);
});

test('full offline buy contract persists before gateway dispatch and survives restart without a second send', async () => {
  const { createPrimarySigner } = await import('../../src/features/panta/primary-signer');
  const { createPurchaseRecovery } = await import('../../src/features/panta/purchase-recovery');
  const state = setup();
  const value = build('offline-end-to-end');
  let stored: PurchaseReceipt | null = null;
  let sends = 0;
  const storage = {
    read: async () => stored,
    write: async (_wallet: string, record: PurchaseReceipt) => {
      stored = { ...record };
    },
    remove: async () => {
      stored = null;
    },
  };
  const recovery = createPurchaseRecovery(storage);
  const client = createPurchaseClient('http://127.0.0.1:8787', async (url, init) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic-access');
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith('/prepare/')) return new Response(JSON.stringify(await state.service.prepare(value, identity)));
    if (String(url).endsWith('/send/')) {
      sends++;
      assert.equal(stored?.signature, bs58.encode(decodePurchaseWire(body.transaction).subarray(1, 65)));
      return new Response(JSON.stringify(await state.service.send(body, identity)));
    }
    return new Response(JSON.stringify(await state.service.receipt(body, identity)));
  });
  const p = await client.prepare(value, 'synthetic-access', 'synthetic-identity');
  const sign = createPrimarySigner(() => ({
    address: wallet,
    accountId: identity.userId,
    getProvider: async () => ({
      request: async ({ method, params }) => {
        assert.equal(method, 'signTransaction');
        const wire = Uint8Array.from(params.transaction);
        wire.set(ed25519.sign(wire.subarray(65), secret), 1);
        return { signedTransaction: wire };
      },
    }),
  }));
  const result = await sign(value, decodePurchaseWire(p.transaction), {
    wallet,
    accountId: identity.userId,
    orderId: value.orderId,
    messageHash: p.messageHash,
    expiresAt: p.expiresAt,
    priceChangeAccepted: true,
  });
  const record = receipt(value);
  await recovery.sendOnce(
    record,
    async () => (await client.send(p, encodePurchaseWire(result.transaction), 'synthetic-access', 'synthetic-identity')).signature
  );
  assert.equal(sends, 1);
  assert.equal(state.calls(), 1);
  const restarted = createPurchaseRecovery(storage);
  await assert.rejects(
    restarted.sendOnce(record, async () => {
      throw new Error('must never dispatch');
    })
  );
  state.finish();
  assert.equal((await restarted.reconcile(wallet, r => client.receipt(r, 'synthetic-access', 'synthetic-identity')))?.status, 'confirmed');
  assert.equal(sends, 1);
});

test('definitive pre-dispatch rejection is recoverable as not-sent; a different receipt cannot unlock an ambiguous send', async () => {
  const state = setup();
  const value = build('not-sent-order');
  const p = await state.service.prepare(value, identity);
  state.changeCost();
  const stopped = await state.service.send(request(value, p.ticket), identity);
  assert.equal(stopped.status, 'not-sent');
  assert.equal(state.calls(), 0);
  assert.equal((await state.service.receipt(stopped, identity)).status, 'not-sent');
  await assert.rejects(state.service.receipt({ ...stopped, messageHash: 'b'.repeat(64) }, identity));
  await assert.rejects(state.service.send(request(value, p.ticket), identity));
  assert.ok(await state.service.prepare(build('fresh-review'), identity));
  const ambiguous = setup();
  const pendingBuild = build('pending-order');
  const q = await ambiguous.service.prepare(pendingBuild, identity);
  ambiguous.timeout();
  await ambiguous.service.send(request(pendingBuild, q.ticket), identity);
  ambiguous.finish();
  await ambiguous.service.receipt(receipt(build('unrelated-order')), identity);
  await assert.rejects(ambiguous.service.prepare(build('must-stay-blocked'), identity));
});
test('not-sent resolution is persisted and needs explicit dismissal; a new ticket cannot revive an expired review', async () => {
  const { createPurchaseRecovery } = await import('../../src/features/panta/purchase-recovery');
  const value = build();
  const record = receipt(value);
  let saved: PurchaseReceipt | null = null;
  const storage = {
    read: async () => saved,
    write: async (_wallet: string, r: PurchaseReceipt) => {
      saved = { ...r };
    },
    remove: async () => {
      saved = null;
    },
  };
  const recovery = createPurchaseRecovery(storage);
  await recovery.sendOnce(record, async () => record.signature);
  await recovery.reconcile(wallet, async r => ({ ...r, status: 'not-sent' }));
  const restarted = createPurchaseRecovery(storage);
  assert.equal((await restarted.read(wallet))?.status, 'not-sent');
  await assert.rejects(restarted.sendOnce(record, async () => record.signature));
  await restarted.dismissResolved(wallet);
  assert.equal(await restarted.read(wallet), null);
  const state = setup();
  await state.service.prepare(value, identity);
  state.advance(60000);
  await assert.rejects(state.service.prepare(value, identity));
});

test('only recognized pre-dispatch HTTP rejection can resolve not-sent; timeouts and generic errors remain ambiguous', async () => {
  const state = setup();
  const value = build();
  const p = await state.service.prepare(value, identity);
  for (const [status, code] of [
    [429, 'RATE_LIMITED'],
    [401, 'ACCOUNT_UNVERIFIED'],
    [403, 'FORBIDDEN'],
    [405, 'READ_ONLY'],
  ] as const) {
    const client = createPurchaseClient('http://127.0.0.1:8787', async () => new Response(JSON.stringify({ code }), { status }));
    await assert.rejects(client.send(p, encodePurchaseWire(signed(value)), 'a', 'b'), PurchaseIngressRejected);
  }
  for (const [status, code] of [
    [502, 'UNAVAILABLE'],
    [400, 'PURCHASE_PENDING'],
    [429, 'unknown'],
  ] as const) {
    const client = createPurchaseClient('http://127.0.0.1:8787', async () => new Response(JSON.stringify({ code }), { status }));
    await assert.rejects(
      client.send(p, encodePurchaseWire(signed(value)), 'a', 'b'),
      error => error instanceof PurchaseError && !(error instanceof PurchaseIngressRejected)
    );
  }
  const timeout = createPurchaseClient('http://127.0.0.1:8787', async () => {
    throw new Error('timeout after acceptance');
  });
  await assert.rejects(
    timeout.send(p, encodePurchaseWire(signed(value)), 'a', 'b'),
    error => error instanceof PurchaseError && !(error instanceof PurchaseIngressRejected)
  );
});

test('primary and P2P services share a wallet lock and recover without duplicate transmission', async () => {
  const pending = new Map<string, { signature: string; orderId: string; messageHash: string }>();
  let sends = 0;
  let registrations = 0;
  const transport = {
    broadcast: async (_wire: Uint8Array, _build: OrderBuild, signature: string) => {
      sends++;
      return signature;
    },
    register: async () => {
      registrations++;
    },
    receipt: async (record: PurchaseReceipt) => ({ ...record, status: 'confirmed' as const }),
  };
  const primary = createPrimaryPurchases(
    async value => report(value),
    transport,
    () => now,
    pending
  );
  const p2p = createPrimaryPurchases(
    async value => report(value),
    { ...transport, register: async () => {} },
    () => now,
    pending
  );
  // Synthetic offline wire; injected successful preflight tests coordination only.
  const value = build('p2p_offline-coordination');
  const review = await p2p.prepare(value, identity);
  const record = await p2p.send(
    { wallet, orderId: value.orderId, ticket: review.ticket, transaction: encodePurchaseWire(signed(value)), priceChangeAccepted: true },
    identity
  );
  assert.equal(sends, 1);
  await assert.rejects(
    primary.prepare(build('other-primary'), identity),
    error => error instanceof PurchaseError && error.code === 'PURCHASE_PENDING'
  );
  await assert.rejects(
    p2p.send(
      { wallet, orderId: value.orderId, ticket: review.ticket, transaction: encodePurchaseWire(signed(value)), priceChangeAccepted: true },
      identity
    )
  );
  // Recovery can be opened from either screen without primary API registration.
  assert.equal((await primary.receipt(record, identity)).status, 'confirmed');
  assert.equal(registrations, 0);
  assert.equal(pending.size, 0);
  assert.equal(sends, 1);
});
