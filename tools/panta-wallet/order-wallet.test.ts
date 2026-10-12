import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createOrderStore } from '../../src/features/panta/order-store';
import { selectOrderWallet } from '../../src/features/panta/order-wallet';
import { type OrderQuote } from '../../src/lib/panta-orders';

const address = '11111111111111111111111111111111';
const other = 'So11111111111111111111111111111111111111112';
const external = { status: 'connected', address: other };

test('order identity prefers the authenticated account and blocks external fallback during restoration or recovery', () => {
  assert.deepEqual(selectOrderWallet({ ready: true, authenticated: true, address }, external), {
    source: 'privy',
    address,
    status: 'connected',
  });
  assert.deepEqual(selectOrderWallet({ ready: false, authenticated: false, address }, external), {
    source: null,
    address: null,
    status: 'initializing',
  });
  for (const value of [null, 'invalid']) {
    assert.deepEqual(selectOrderWallet({ ready: true, authenticated: true, address: value }, external), {
      source: 'privy',
      address: null,
      status: 'unavailable',
    });
  }
});

test('external order identity requires a connected validated address and no authenticated account', () => {
  const account = { ready: true, authenticated: false, address: null };
  assert.deepEqual(selectOrderWallet(account, external), { source: 'phantom', address: other, status: 'connected' });
  for (const wallet of [
    { status: 'waiting', address: other },
    { status: 'connected', address: 'invalid' },
    { status: 'disconnected', address: other },
  ]) {
    assert.deepEqual(selectOrderWallet(account, wallet), { source: null, address: null, status: 'disconnected' });
  }
});

test('account wallet quotes carry the selected identity and invalidation discards a late response', async () => {
  const wallet = selectOrderWallet({ ready: true, authenticated: true, address }, external);
  let finish!: (quote: OrderQuote) => void;
  let aborted!: AbortSignal;
  const order = createOrderStore(async (request, signal) => {
    assert.equal(request.wallet, address);
    aborted = signal;
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  const request = { wallet: wallet.address!, marketId: other, side: 'yes' as const, amountUsdc: '1' };
  const pending = order.requestQuote(request);
  order.invalidate();
  finish({
    ...request,
    quoteId: 'qt_test',
    shares: '2',
    avgPrice: null,
    feeUsdc: '0.01',
    expiresAt: '2099-01-01T00:00:00Z',
    disclaimer: 'Synthetic contract fixture',
  });
  await pending;
  assert.equal(aborted.aborted, true);
  assert.equal(order.useStore.getState().quote, null);
});
