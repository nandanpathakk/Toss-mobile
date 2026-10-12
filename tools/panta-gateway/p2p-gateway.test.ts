import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { type AddressInfo } from 'node:net';
import { test } from 'node:test';

import { AccountVerificationError } from '../../src/lib/panta-account-verification';
import { type P2PBuild } from '../../src/lib/panta-p2p';
import { PurchaseError } from '../../src/lib/panta-purchase';
import { createPurchaseClient, purchaseChannel } from '../../src/lib/panta-purchase-client';
import { createCatalogGateway } from './gateway';

test('P2P gateway verifies ownership before build, uses only fixed local policies and preserves read-only route boundaries', async t => {
  const source = JSON.parse(readFileSync(new URL('./p2p-buy-yes-fixture.json', import.meta.url), 'utf8'));
  let upstream = 0;
  let reads = 0;
  let verified = 0;
  const server = createCatalogGateway(
    'pk_test_synthetic',
    async () => {
      upstream++;
      throw new Error('upstream should not run');
    },
    undefined,
    undefined,
    async (wallet, access, identity) => {
      if (access !== 'Bearer synthetic-access' || identity !== 'synthetic-identity') throw new AccountVerificationError('ACCOUNT_REQUIRED');
      verified++;
      return { userId: 'did:privy:offline', wallet, expiresAt: new Date(Date.now() + 60000).toISOString() };
    },
    undefined,
    async method => {
      reads++;
      assert.equal(method, 'getGenesisHash');
      return 'wrong-network';
    }
  );
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (headers: Record<string, string>) =>
    fetch(`${base}/p2p/build/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(source.request),
    });
  assert.equal((await post({})).status, 401);
  assert.equal(reads, 0);
  const response = await post({ 'Authorization': 'Bearer synthetic-access', 'Privy-Id-Token': 'synthetic-identity' });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { code: 'P2P_BLOCKED' });
  assert.equal(verified, 1);
  assert.equal(reads, 1);
  assert.equal(upstream, 0);
  assert.equal((await fetch(`${base}/p2p/arbitrary/`, { method: 'POST' })).status, 405);
  assert.equal(
    (await fetch(`${base}/markets/${source.request.marketId}/orderbook/?wallet=${source.request.wallet}&rpc=https://attacker.example`))
      .status,
    404
  );
  assert.equal(reads, 1);
});

test('P2P purchase client uses native routes and turns changed books into fresh-review errors', async () => {
  const build = JSON.parse(readFileSync(new URL('./p2p-buy-yes-fixture.json', import.meta.url), 'utf8')).build as P2PBuild;
  assert.equal(purchaseChannel(build.orderId), 'p2p');
  assert.equal(purchaseChannel('primary-order'), 'primary');
  const client = createPurchaseClient(
    'https://gateway.example',
    async (input, init) => {
      assert.equal(String(input), 'https://gateway.example/p2p/purchases/prepare/');
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('Privy-Id-Token'), 'synthetic-identity');
      return new Response(JSON.stringify({ code: 'P2P_CHANGED' }), { status: 409 });
    },
    'p2p'
  );
  await assert.rejects(
    client.prepare(build, 'synthetic-access', 'synthetic-identity'),
    error => error instanceof PurchaseError && error.code === 'PURCHASE_EXPIRED'
  );
});
