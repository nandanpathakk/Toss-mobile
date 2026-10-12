import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startPurchaseStatusPolling } from '../../src/features/panta/purchase-status-polling';

function setup(check: () => Promise<boolean | null>) {
  let time = 0;
  let pending = true;
  let active = true;
  let queued: { work: () => void; delay: number } | null = null;
  const stop = startPurchaseStatusPolling({
    pending: () => pending,
    active: () => active,
    check,
    clock: () => time,
    schedule: (work, delay) => {
      queued = { work, delay };
      return () => {
        queued = null;
      };
    },
  });
  return {
    stop,
    queued: () => queued,
    setPending: (value: boolean) => {
      pending = value;
    },
    setActive: (value: boolean) => {
      active = value;
    },
    advance: (ms: number) => {
      time += ms;
    },
    tick: async () => {
      const task = queued;
      assert.ok(task);
      queued = null;
      time += task.delay;
      task.work();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

test('pending receipts check in foreground and stop when independently resolved', async () => {
  let calls = 0;
  const state = setup(async () => {
    calls++;
    return true;
  });
  state.setActive(false);
  await state.tick();
  assert.equal(calls, 0);
  state.setActive(true);
  await state.tick();
  assert.equal(calls, 1);
  state.setPending(false);
  await state.tick();
  assert.equal(calls, 1);
  assert.equal(state.queued(), null);
});

test('receipt read failures back off and stop without altering pending status', async () => {
  let calls = 0;
  const state = setup(async () => {
    calls++;
    throw new Error('offline');
  });
  await state.tick();
  assert.equal(state.queued()?.delay, 10000);
  await state.tick();
  assert.equal(state.queued()?.delay, 20000);
  await state.tick();
  assert.equal(calls, 3);
  assert.equal(state.queued(), null);
});

test('receipt checks do not overlap; changing accounts or unmounting cancels rescheduling', async () => {
  let finish!: (value: boolean) => void;
  let calls = 0;
  const state = setup(() => {
    calls++;
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  await state.tick();
  assert.equal(calls, 1);
  assert.equal(state.queued(), null);
  state.stop();
  finish(true);
  await Promise.resolve();
  assert.equal(state.queued(), null);
});

test('receipt polling has a two-minute bound and skips an already-busy operation', async () => {
  let calls = 0;
  const state = setup(async () => {
    calls++;
    return null;
  });
  await state.tick();
  assert.equal(calls, 1);
  assert.equal(state.queued()?.delay, 5000);
  state.advance(120000);
  await state.tick();
  assert.equal(calls, 1);
  assert.equal(state.queued(), null);
});
