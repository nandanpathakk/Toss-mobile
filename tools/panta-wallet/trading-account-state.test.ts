import assert from 'node:assert/strict';
import { test } from 'node:test';

import { currentMarketPrices, marketPriceStatus } from '../../src/features/panta/market-price-status';
import {
  emptyTradingAccountState,
  visibleTradingAccountState,
  type TradingAccountState,
} from '../../src/features/panta/trading-account-state';
import { tradingEntry } from '../../src/features/panta/trading-entry';
import { parseCatalogMarket } from '../../src/lib/panta-catalog';

const now = Date.now();
const wallet = '11111111111111111111111111111111';
const state: TradingAccountState = {
  status: 'verified',
  accountId: 'synthetic-user',
  wallet,
  error: null,
  proof: { wallet, verified: true, expiresAt: new Date(now + 60000).toISOString() },
};
test('verified presentation is immediately removed on account, wallet, readiness or expiry change', () => {
  assert.equal(visibleTradingAccountState(state, 'synthetic-user', wallet, true, now), state);
  for (const [user, selected, ready, time] of [
    ['different-user', wallet, true, now],
    ['synthetic-user', 'other-wallet', true, now],
    ['synthetic-user', wallet, false, now],
    [null, wallet, true, now],
    ['synthetic-user', wallet, true, now + 60000],
  ] as const)
    assert.deepEqual(visibleTradingAccountState(state, user, selected, ready, time), emptyTradingAccountState);
  assert.deepEqual(visibleTradingAccountState({ ...state, proof: null }, 'synthetic-user', wallet, true, now), emptyTradingAccountState);
  assert.deepEqual(
    visibleTradingAccountState({ ...state, proof: { ...state.proof!, wallet: 'other-wallet' } }, 'synthetic-user', wallet, true, now),
    emptyTradingAccountState
  );
});

test('trade entry keeps signed-out actions visible but routes to account setup before an order', () => {
  const signedOut = { ready: true, failed: false, authenticated: false, address: null };
  assert.equal(tradingEntry('primary', signedOut), 'sign-in');
  assert.equal(tradingEntry('secondary', signedOut), 'sign-in');
  const signedIn = { ...signedOut, authenticated: true, address: wallet };
  assert.equal(tradingEntry('primary', signedIn), 'primary');
  assert.equal(tradingEntry('secondary', signedIn), 'p2p');
  assert.equal(tradingEntry('primary', { ...signedIn, address: null }), 'wallet');
  assert.equal(tradingEntry('primary', { ...signedIn, address: 'invalid' }), 'wallet');
  assert.equal(tradingEntry('primary', { ...signedIn, ready: false }), 'connecting');
  assert.equal(tradingEntry('primary', { ...signedIn, failed: true }), 'unavailable');
  // A closed market never requests sign-in or starts a new order, for any account state.
  for (const account of [signedOut, signedIn, { ...signedIn, failed: true }]) {
    assert.equal(tradingEntry('resolved', account), 'closed');
    assert.equal(tradingEntry('cancelled', account), 'closed');
  }
  assert.equal(tradingEntry('primary', { ...signedIn, authenticated: false }), 'sign-in');
});

test('browsing hides stale, unknown-age and future-dated prices; true fresh zero stays visible', () => {
  const market = parseCatalogMarket({
    marketId: wallet,
    title: 'Question',
    description: '',
    category: 'world',
    phase: 'primary',
    images: [],
    yesPrice: 0,
    noPrice: 1,
    priceObservedAt: now,
  });
  assert.equal(marketPriceStatus(market, now + 29999), 'fresh');
  assert.equal(currentMarketPrices(market, now).yesPrice, 0);
  for (const candidate of [market, { ...market, priceObservedAt: null }, { ...market, priceObservedAt: now + 40000 }]) {
    assert.equal(marketPriceStatus(candidate, now + 30000), 'stale');
    assert.equal(currentMarketPrices(candidate, now + 30000).yesPrice, null);
    assert.equal(currentMarketPrices(candidate, now + 30000).noPrice, null);
  }
  assert.equal(marketPriceStatus({ ...market, noPrice: null }, now), 'unavailable');
});

test('known event end closes trade entry without changing open-market account routing', () => {
  const signedOut = { ready: true, failed: false, authenticated: false, address: null };
  const signedIn = { ...signedOut, authenticated: true, address: wallet };
  for (const phase of ['primary', 'secondary'] as const) {
    for (const account of [signedOut, signedIn, { ...signedIn, ready: false }]) {
      assert.equal(tradingEntry(phase, account, now / 1000, now), 'closed');
      assert.equal(tradingEntry(phase, account, now / 1000 - 1, now), 'closed');
    }
    assert.equal(tradingEntry(phase, signedOut, now / 1000 + 1, now), 'sign-in');
    assert.equal(tradingEntry(phase, signedOut, null, now), 'sign-in');
    assert.equal(tradingEntry(phase, signedIn, now / 1000 + 1, now), phase === 'primary' ? 'primary' : 'p2p');
  }
});
