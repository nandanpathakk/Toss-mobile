import assert from 'node:assert/strict';
import { type AddressInfo } from 'node:net';
import { test } from 'node:test';

import { createOrderStore } from '../../src/features/panta/order-store';
import { parseBuildRequest, parseOrderBuild, type OrderBuild } from '../../src/lib/panta-order-build';
import { createOrderClient } from '../../src/lib/panta-order-client';
import { OrderError, type OrderQuote } from '../../src/lib/panta-orders';
import { createCatalogGateway } from './gateway';

const id = '11111111111111111111111111111111';
const other = 'So11111111111111111111111111111111111111112';
const quote: OrderQuote = {
  quoteId: 'qt_valid',
  wallet: id,
  marketId: id,
  side: 'yes',
  amountUsdc: '20',
  shares: '38.42',
  feeUsdc: '0.40',
  avgPrice: null,
  expiresAt: '2099-01-01T00:00:00Z',
  disclaimer: 'Fixture data only.',
};
const request = { quoteId: quote.quoteId, wallet: id, maxSlippageBps: 100 };
const instruction = { programId: id, data: 'AQ==', accounts: [{ pubkey: id, isSigner: true, isWritable: true }] };
const built = {
  orderId: 'ord_valid',
  quoteId: quote.quoteId,
  wallet: id,
  marketId: id,
  side: 'yes',
  amountUsdc: '20.00',
  expectedShares: '38.4',
  feeUsdc: '0.40',
  status: 'built',
  instructions: [instruction],
  recentBlockhash: id,
  lastValidBlockHeight: 123,
  expiresAt: '2099-01-01T00:00:00Z',
};

test('build request validates slippage, public keys and exact allowed fields', () => {
  assert.deepEqual(parseBuildRequest(request), request);
  for (const patch of [{ maxSlippageBps: 5001 }, { maxSlippageBps: -1 }, { maxSlippageBps: 1.5 }, { userId: 'spoof' }, { wallet: 'bad' }])
    assert.throws(() => parseBuildRequest({ ...request, ...patch }), OrderError);
});
test('build preserves only bound fields and refuses empty sandbox instructions', () => {
  const result = parseOrderBuild({ ...built, secret: 'never return' }, quote, request);
  assert.equal(result.amountUsdc, '20');
  assert.equal(result.disclaimer, quote.disclaimer);
  assert.equal('secret' in result, false);
  assert.throws(
    () => parseOrderBuild({ ...built, instructions: [], lastValidBlockHeight: 0 }, quote, request),
    (e: unknown) => e instanceof OrderError && e.code === 'BUILD_UNAVAILABLE'
  );
  for (const patch of [
    { wallet: other },
    { quoteId: 'qt_other' },
    { marketId: other },
    { side: 'no' },
    { amountUsdc: '21' },
    { status: 'confirmed' },
    { recentBlockhash: 'bad' },
    { lastValidBlockHeight: 0 },
    { expiresAt: '2099-02-30T00:00:00Z' },
  ])
    assert.throws(() => parseOrderBuild({ ...built, ...patch }, quote, request), OrderError);
});
test('build checks exact shares/slippage and prevents unreviewed fee increases', () => {
  assert.throws(
    () => parseOrderBuild({ ...built, expectedShares: '38.035799999999999999' }, quote, request),
    (e: unknown) => e instanceof OrderError && e.code === 'QUOTE_STALE'
  );
  assert.equal(parseOrderBuild({ ...built, expectedShares: '38.0358' }, quote, request).expectedShares, '38.0358');
  assert.throws(() => parseOrderBuild({ ...built, feeUsdc: '0.400000000000000001' }, quote, request), OrderError);
  assert.throws(() => parseOrderBuild(built, { ...quote, expiresAt: '2000-01-01T00:00:00Z' }, request), OrderError);
});
test('build rejects malformed instruction bytes, unknown signers and missing wallet signer', () => {
  for (const patch of [
    { data: 'AB==' },
    { data: 'not base64!' },
    { data: 'A'.repeat(1648) },
    { programId: 'bad' },
    { accounts: [{ pubkey: other, isSigner: true, isWritable: true }] },
    { accounts: [{ pubkey: id, isSigner: false, isWritable: true }] },
    { accounts: [{ pubkey: id, isSigner: 'true', isWritable: true }] },
  ])
    assert.throws(() => parseOrderBuild({ ...built, instructions: [{ ...instruction, ...patch }] }, quote, request), OrderError);
});
test('build state prevents duplicate attempts and discards responses after wallet/order invalidation', async () => {
  let calls = 0;
  let finish!: (value: OrderBuild) => void;
  let signal!: AbortSignal;
  const order = createOrderStore(
    async () => quote,
    async (_, __, abort) => {
      calls++;
      signal = abort;
      return new Promise(resolve => {
        finish = resolve;
      });
    }
  );
  await order.requestQuote(quote);
  const pending = order.prepareBuild(100);
  await order.prepareBuild(100);
  assert.equal(calls, 1);
  order.invalidate();
  assert.equal(signal.aborted, true);
  finish(parseOrderBuild(built, quote, request));
  await pending;
  assert.equal(order.useStore.getState().build, null);
  assert.equal(order.useStore.getState().status, 'idle');
});
test('ambiguous build failure requires a fresh quote instead of retrying', async () => {
  let calls = 0;
  const order = createOrderStore(
    async () => quote,
    async () => {
      calls++;
      throw new Error('sensitive diagnostic');
    }
  );
  await order.requestQuote(quote);
  await order.prepareBuild(100);
  await order.prepareBuild(100);
  assert.equal(calls, 1);
  assert.equal(order.useStore.getState().status, 'build-error');
  assert.equal(order.useStore.getState().error?.code, 'UNAVAILABLE');
  assert.equal(order.useStore.getState().error?.message.includes('sensitive'), false);
});

test('one Review order action builds only its own successful quote and ignores duplicate taps', async () => {
  let finish!: (value: OrderQuote) => void;
  let quotes = 0;
  let builds = 0;
  const order = createOrderStore(
    () => {
      quotes++;
      return new Promise(resolve => {
        finish = resolve;
      });
    },
    async () => {
      builds++;
      return parseOrderBuild(built, quote, request);
    }
  );
  const first = order.review(quote, 100);
  await order.review(quote, 100);
  assert.equal(quotes, 1);
  assert.equal(builds, 0);
  finish(quote);
  await first;
  assert.equal(builds, 1);
  assert.equal(order.useStore.getState().status, 'built');
});

test('a cancelled Review order continuation cannot build a newer quote', async () => {
  let finish!: (value: OrderQuote) => void;
  let calls = 0;
  const order = createOrderStore(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
    async () => {
      calls++;
      return parseOrderBuild(built, quote, request);
    }
  );
  const old = order.review(quote, 100);
  const resolveOld = finish;
  order.invalidate();
  const newer = order.requestQuote({ ...quote, side: 'no' });
  finish({ ...quote, side: 'no', quoteId: 'qt_new' });
  await newer;
  resolveOld(quote);
  await old;
  assert.equal(calls, 0);
  assert.equal(order.useStore.getState().quote?.quoteId, 'qt_new');
  assert.equal(order.useStore.getState().status, 'ready');
});
test('gateway binds build to its issued quote and permits a single upstream attempt', async () => {
  let builds = 0;
  const server = createCatalogGateway('pk_test_local_fixture', async (url, options) => {
    assert.equal(new Headers(options?.headers).get('X-Api-Key'), 'pk_test_local_fixture');
    if (String(url).endsWith('/primaryorderquote/')) return new Response(JSON.stringify(quote));
    builds++;
    assert.deepEqual(JSON.parse(String(options?.body)), request);
    return new Response(JSON.stringify({ ...built, secret: 'hidden' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = createOrderClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  try {
    await assert.rejects(client.build(request, quote), (e: unknown) => e instanceof OrderError && e.code === 'EXPIRED');
    const actual = await client.quote({ wallet: quote.wallet, marketId: quote.marketId, side: quote.side, amountUsdc: quote.amountUsdc });
    await assert.rejects(client.build({ ...request, wallet: other }, { ...actual, wallet: other }), OrderError);
    const result = await client.build(request, actual);
    assert.equal(result.orderId, 'ord_valid');
    assert.equal(JSON.stringify(result).includes('hidden'), false);
    await assert.rejects(client.build(request, actual), (e: unknown) => e instanceof OrderError && e.code === 'BUILD_RESTART');
    assert.equal(builds, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});

test('gateway consumes build attempt even when upstream returns unusable sandbox instructions', async () => {
  let builds = 0;
  const server = createCatalogGateway('pk_test_local_fixture', async url => {
    if (String(url).endsWith('/primaryorderquote/')) return new Response(JSON.stringify(quote));
    builds++;
    return new Response(JSON.stringify({ ...built, instructions: [], lastValidBlockHeight: 0 }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = createOrderClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  try {
    const actual = await client.quote({ wallet: id, marketId: id, side: 'yes', amountUsdc: '20' });
    await assert.rejects(client.build(request, actual), (e: unknown) => e instanceof OrderError && e.code === 'BUILD_UNAVAILABLE');
    await assert.rejects(client.build(request, actual), (e: unknown) => e instanceof OrderError && e.code === 'BUILD_RESTART');
    assert.equal(builds, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});
