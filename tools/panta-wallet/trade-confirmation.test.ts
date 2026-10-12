import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTradeConfirmation } from '../../src/features/panta/trade-confirmation-policy';

test('confirmation needs a full deliberate release; one ticket cannot send twice', () => {
  const policy = createTradeConfirmation();
  assert.equal(policy.release('a', true, 1, 10), false);
  assert.equal(policy.begin('a', 100, true, 10), true);
  assert.equal(policy.release('a', true, 0.8, 11), false);
  assert.equal(policy.begin('a', 100, true, 12), true);
  assert.equal(policy.release('a', true, 1, 13), true);
  assert.equal(policy.begin('a', 100, true, 14), false);
  assert.equal(policy.release('a', true, 1, 15), false);
  assert.equal(policy.begin('b', 100, true, 16), true);
  assert.equal(policy.release('b', true, 1, 17), true);
});

test('changed account/review, expiry and interruptions discard the gesture', () => {
  for (const scenario of ['changed-ticket', 'disabled', 'expired', 'cancelled'] as const) {
    const policy = createTradeConfirmation();
    policy.begin('a', 100, true, 10);
    if (scenario === 'cancelled') policy.cancel();
    assert.equal(
      policy.release(scenario === 'changed-ticket' ? 'b' : 'a', scenario !== 'disabled', 1, scenario === 'expired' ? 100 : 20),
      false
    );
    // A rejected release cannot later be resumed, even if the account becomes valid again.
    assert.equal(policy.release('a', true, 1, 21), false);
  }
});

test('disabled, invalid or expired reviews cannot begin; malformed movement cannot confirm', () => {
  for (const expiry of [0, 10, NaN, Infinity]) {
    const policy = createTradeConfirmation();
    assert.equal(policy.begin('a', expiry, true, 10), false);
  }
  const policy = createTradeConfirmation();
  assert.equal(policy.begin('a', 100, false, 10), false);
  assert.equal(policy.begin('a', 100, true, NaN), false);
  policy.begin('a', 100, true, 10);
  assert.equal(policy.release('a', true, 1, NaN), false);
  for (const progress of [NaN, Infinity, -1]) {
    policy.begin('a', 100, true, 10);
    assert.equal(policy.release('a', true, progress, 20), false);
  }
});

test('button and assistive confirmation use the same single-use expiry policy', () => {
  const policy = createTradeConfirmation();
  assert.equal(policy.begin('a', 100, true, 99), true);
  assert.equal(policy.release('a', true, 1, 100), false);
  assert.equal(policy.begin('b', 200, true, 101), true);
  assert.equal(policy.release('b', true, 1, 102), true);
  policy.cancel();
  assert.equal(policy.begin('b', 200, true, 103), false);
});
