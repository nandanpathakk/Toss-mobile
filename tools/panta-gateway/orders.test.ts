import assert from 'node:assert/strict';
import { type AddressInfo } from 'node:net';
import { test } from 'node:test';

import { createOrderStore } from '../../src/features/panta/order-store';
import { createOrderClient } from '../../src/lib/panta-order-client';
import {
  normalizeUsdc,
  OrderError,
  parseOrderQuote,
  parseOrderRequest,
  type OrderQuote,
  type OrderRequest,
} from '../../src/lib/panta-orders';
import { createCatalogGateway } from './gateway';

const id = '11111111111111111111111111111111';
const request: OrderRequest = { wallet: id, marketId: id, side: 'yes', amountUsdc: '20' };
const fixture = {
  quoteId: 'qt_fixture',
  marketId: id,
  side: 'yes',
  amountUsdc: '20.00',
  shares: '38.42',
  feeUsdc: '0.40',
  expiresAt: '2099-09-04T16:27:00.000000Z',
  disclaimer: 'Test mode fixture only.',
};

test('USDC input is exact, positive and limited to six decimals without float rounding', () => {
  assert.equal(normalizeUsdc('900719925474099.000001'), '900719925474099.000001');
  assert.equal(normalizeUsdc('20.000000'), '20');
  assert.equal(normalizeUsdc('0.000001'), '0.000001');
  for (const amount of ['', '0', '0.000000', '-1', '+1', '1e3', '1,2', '01', '.5', '1.', '1.0000001', ' 20 ', '9007199254740991'])
    assert.throws(() => normalizeUsdc(amount), OrderError);
});
test('requests reject unsupported fields and invalid public-key byte lengths', () => {
  assert.deepEqual(parseOrderRequest({ ...request, amountUsdc: '20.00' }), request);
  for (const row of [
    { ...request, wallet: '2'.repeat(32) },
    { ...request, userId: 'spoof' },
    { ...request, amountUsdc: 20 },
    { ...request, side: 'YES' },
  ])
    assert.throws(() => parseOrderRequest(row), OrderError);
});
test('quote binds market, amount, side and wallet and preserves absent average price and disclaimer', () => {
  const quote = parseOrderQuote({ ...fixture, secret: 'never forward' }, request);
  assert.equal(quote.avgPrice, null);
  assert.equal(quote.disclaimer, fixture.disclaimer);
  assert.equal('secret' in quote, false);
  for (const patch of [
    { marketId: 'different' },
    { side: 'no' },
    { amountUsdc: '21' },
    { wallet: 'different' },
    { shares: '0' },
    { avgPrice: '1.1' },
    { avgPrice: '0' },
    { amountUsdc: 20 },
    { expiresAt: '2099-02-30T00:00:00Z' },
    { feeUsdc: '-1' },
    { expiresAt: 'bad' },
    { quoteId: '../secret' },
  ])
    assert.throws(() => parseOrderQuote({ ...fixture, ...patch }, request), OrderError);
  assert.throws(
    () => parseOrderQuote({ ...fixture, expiresAt: '2000-01-01T00:00:00Z' }, request),
    (error: unknown) => error instanceof OrderError && error.code === 'EXPIRED'
  );
});
test('cancelled or edited orders cannot accept late quote responses', async () => {
  let finish!: (quote: OrderQuote) => void;
  let signal!: AbortSignal;
  const order = createOrderStore((_, abort) => {
    signal = abort;
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  const pending = order.requestQuote(request);
  order.invalidate();
  assert.equal(signal.aborted, true);
  finish(parseOrderQuote(fixture, request));
  await pending;
  assert.equal(order.useStore.getState().quote, null);
  assert.equal(order.useStore.getState().status, 'idle');
});
test('quote requests do not auto retry and edits preserve rate-limit cooldown', async () => {
  let calls = 0;
  const order = createOrderStore(async () => {
    calls++;
    throw new OrderError('RATE_LIMITED', 60);
  });
  await order.requestQuote(request);
  order.invalidate();
  await order.requestQuote({ ...request, side: 'no' });
  assert.equal(calls, 1);
  assert.ok(order.useStore.getState().retryAt > Date.now());
});
test('gateway rejects malformed order bodies, removes secrets and blocks submit', async () => {
  let calls = 0;
  const key = 'pk_test_local_fixture';
  const server = createCatalogGateway(key, async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://live-api.panta.market/api/v1/primaryorderquote/');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).get('X-Api-Key'), key);
    assert.deepEqual(JSON.parse(String(options?.body)), request);
    return new Response(JSON.stringify({ ...fixture, secret: key }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const quote = await createOrderClient(base).quote(request);
    assert.equal(quote.wallet, id);
    assert.equal(JSON.stringify(quote).includes(key), false);
    for (const [path, body, headers, expected] of [
      ['/primaryorderquote/', { ...request, amountUsdc: '-1' }, {}, 400],
      ['/primaryorderquote/', { ...request, secret: key }, {}, 400],
      ['/primaryorderquote/', request, { Origin: 'https://example.com' }, 403],
      ['/primaryorderquote/', request, { 'Content-Type': 'text/plain' }, 400],
      ['/primaryorderquote/', { ...request, extra: 'x'.repeat(2048) }, {}, 400],
      ['/primaryorderbuild/', request, {}, 400],
      ['/primaryordersubmit/', request, {}, 405],
    ] as const) {
      const response = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, expected);
      assert.equal((await response.text()).includes(key), false);
    }
    assert.equal(calls, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});
for (const code of ['AMOUNT_TOO_SMALL', 'INVALID_MARKET_PARAMS'] as const)
  test(`upstream ${code} exposes only documented codes, never diagnostics`, async () => {
    const server = createCatalogGateway(
      'pk_test_local_fixture',
      async () => new Response(JSON.stringify({ code, secret: 'sensitive' }), { status: 400 })
    );
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const client = createOrderClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      await assert.rejects(
        client.quote(request),
        (error: unknown) => error instanceof OrderError && error.code === code && !error.message.includes('sensitive')
      );
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    }
  });
