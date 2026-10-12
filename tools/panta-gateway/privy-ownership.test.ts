import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { type AddressInfo } from 'node:net';
import { test } from 'node:test';

import {
  AccountVerificationError,
  createAccountVerificationClient,
  pantaPrivyAppId,
  parseVerifiedAccountWallet,
} from '../../src/lib/panta-account-verification';
import { createCatalogGateway } from './gateway';
import { createPrivyOwnershipVerifier } from './privy-ownership';

// Local synthetic JWTs only; never obtain or print a real user token.
const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'ES256', use: 'sig' };
const wallet = 'FTtwXec2PAYpKmQd9vrKunCm8xerzwKquTwwZEAh6Qj3';
const other = '11111111111111111111111111111111';
const now = 1800000000000;
const linked = [{ type: 'wallet', wallet_client_type: 'privy', chain_type: 'solana', address: wallet }];
function jwt(patch: Record<string, unknown> = {}, headerPatch: Record<string, unknown> = {}, key = pair.privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'test-key', ...headerPatch })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'did:privy:test-user',
      sid: 'test-session',
      iss: 'privy.io',
      aud: pantaPrivyAppId,
      iat: now / 1000,
      exp: now / 1000 + 3600,
      ...patch,
    })
  ).toString('base64url');
  return `${header}.${payload}.${sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
const access = () => `Bearer ${jwt()}`;
const identity = (patch: Record<string, unknown> = {}) => jwt({ linked_accounts: JSON.stringify(linked), ...patch });
function setup() {
  let calls = 0;
  let time = now;
  let body: unknown = { keys: [jwk] };
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, `https://api.privy.io/v1/apps/${pantaPrivyAppId}/jwks.json`);
    assert.equal(init?.redirect, 'error');
    assert.deepEqual(init?.headers, { Accept: 'application/json' });
    assert.equal(init?.body, undefined, 'credentials must never reach the public-key service');
    calls++;
    return new Response(JSON.stringify(body));
  };
  return {
    verify: createPrivyOwnershipVerifier(fetcher, () => time),
    count: () => calls,
    advance: (ms: number) => {
      time += ms;
    },
    change: (value: unknown) => {
      body = value;
    },
  };
}
test('signed access and identity tokens verify the exact embedded Solana wallet, with bounded freshness', async () => {
  const { verify, count } = setup();
  const proof = await verify(wallet, access(), identity());
  assert.deepEqual(proof, { userId: 'did:privy:test-user', wallet, expiresAt: new Date(now + 900000).toISOString() });
  await verify(wallet, access(), identity());
  assert.equal(count(), 1);
});
test('missing credentials, token substitution, invalid claims and signatures fail closed', async () => {
  const { verify } = setup();
  for (const patch of [
    { aud: 'different-app' },
    { aud: [pantaPrivyAppId] },
    { iss: 'evil.example' },
    { exp: now / 1000 },
    { iat: now / 1000 + 31 },
    { nbf: now / 1000 + 1 },
    { iat: now / 1000 - 901 },
    { exp: 'future' },
    { sub: 'did:privy:different' },
    { linked_accounts: '{}' },
    { linked_accounts: '[null]' },
    { guest: 't' },
  ])
    await assert.rejects(verify(wallet, access(), identity(patch)), AccountVerificationError);
  for (const header of [{ alg: 'none' }, { alg: 'HS256' }, { typ: 'other' }, { crit: ['b64'] }, { b64: false }])
    await assert.rejects(verify(wallet, access(), jwt({ linked_accounts: JSON.stringify(linked) }, header)), AccountVerificationError);
  const otherPair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  await assert.rejects(verify(wallet, access(), jwt({ linked_accounts: JSON.stringify(linked) }, {}, otherPair.privateKey)));
  await assert.rejects(verify(wallet, access(), jwt()));
  await assert.rejects(verify(wallet, `Bearer ${identity()}`, identity()));
});
test('access token requires session; identity requires matching wallet type, chain, user and address', async () => {
  const { verify } = setup();
  await assert.rejects(verify(wallet, undefined, identity()));
  await assert.rejects(verify(wallet, access(), undefined));
  await assert.rejects(verify(wallet, `Bearer ${jwt({ sid: null })}`, identity()));
  await assert.rejects(verify(other, access(), identity()));
  for (const patch of [{ chain_type: 'ethereum' }, { wallet_client_type: 'phantom' }, { type: 'smart_wallet' }, { address: other }])
    await assert.rejects(verify(wallet, access(), identity({ linked_accounts: JSON.stringify([{ ...linked[0], ...patch }]) })));
  for (const token of ['not-a-token', 'a.b.c', 'a'.repeat(8193), `${identity()}=`]) await assert.rejects(verify(wallet, access(), token));
});
test('public-key cache deduplicates loads, throttles unknown keys and refreshes safely after rotation', async () => {
  const state = setup();
  await Promise.all(Array.from({ length: 5 }, () => state.verify(wallet, access(), identity())));
  assert.equal(state.count(), 1);
  await assert.rejects(state.verify(wallet, access(), jwt({ linked_accounts: JSON.stringify(linked) }, { kid: 'new-key' })));
  assert.equal(state.count(), 1);
  state.advance(31000);
  state.change({ keys: [{ ...jwk, kid: 'new-key' }] });
  const newAccess = `Bearer ${jwt({}, { kid: 'new-key' })}`;
  await state.verify(wallet, newAccess, jwt({ linked_accounts: JSON.stringify(linked) }, { kid: 'new-key' }));
  assert.equal(state.count(), 2);
  state.advance(300001);
  state.change({ keys: [] });
  await assert.rejects(state.verify(wallet, newAccess, jwt({ linked_accounts: JSON.stringify(linked) }, { kid: 'new-key' })));
});
test('malformed, duplicate or oversized JWKS responses never authorize', async () => {
  for (const body of [
    { keys: [jwk, jwk] },
    { keys: [{ ...jwk, crv: 'P-384' }] },
    { keys: [{ ...jwk, d: 'private' }] },
    { keys: [{ ...jwk, use: 'enc' }] },
    { keys: [{ ...jwk, x: 'bad' }] },
    { padding: 'x'.repeat(17000), keys: [jwk] },
  ]) {
    const state = setup();
    state.change(body);
    await assert.rejects(state.verify(wallet, access(), identity()));
  }
});
test('ownership route keeps tokens local, sanitizes errors and never enables financial writes', async t => {
  const state = setup();
  let upstreamCalls = 0;
  const gateway = createCatalogGateway(
    'pk_test_contract',
    async () => {
      upstreamCalls++;
      throw new Error('must not forward');
    },
    undefined,
    undefined,
    state.verify
  );
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => gateway.close(() => resolve())));
  const base = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  async function post(path: string, body: unknown, authenticated = true) {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { 'Authorization': access(), 'Privy-Id-Token': identity() } : {}),
      },
      body: JSON.stringify(body),
    });
  }
  const result = await post('/account/wallet/verify/', { wallet });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { wallet, verified: true, expiresAt: new Date(now + 900000).toISOString() });
  assert.equal((await post('/account/wallet/verify/', { wallet }, false)).status, 401);
  const mismatch = await post('/account/wallet/verify/', { wallet: other });
  assert.equal(mismatch.status, 401);
  assert.deepEqual(await mismatch.json(), { code: 'ACCOUNT_UNVERIFIED' });
  assert.equal((await post('/account/wallet/verify/', { wallet, userId: 'spoof' })).status, 400);
  assert.equal((await post('/primaryordersubmit/', { wallet })).status, 405);
  assert.equal(upstreamCalls, 0);
});
test('mobile verification client binds wallet and expiry, sends credentials only to fixed gateway and masks failures', async () => {
  const expiry = new Date(Date.now() + 60000).toISOString();
  const client = createAccountVerificationClient('http://127.0.0.1:8787', async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:8787/account/wallet/verify/');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.body, JSON.stringify({ wallet }));
    return new Response(JSON.stringify({ wallet, verified: true, expiresAt: expiry }));
  });
  assert.equal((await client(wallet, 'synthetic-access', 'synthetic-identity')).wallet, wallet);
  for (const base of ['http://evil.example', 'https://user:pass@example.com', 'https://example.com/?key=secret'])
    assert.throws(() => createAccountVerificationClient(base));
  for (const patch of [
    { wallet: other },
    { verified: false },
    { expiresAt: 'bad' },
    { expiresAt: new Date(Date.now() - 1000).toISOString() },
  ])
    assert.throws(() => parseVerifiedAccountWallet({ wallet, verified: true, expiresAt: expiry, ...patch }, wallet));
  const broken = createAccountVerificationClient('http://localhost:8787', async () => {
    throw new Error('secret-token');
  });
  await assert.rejects(
    broken(wallet, 'a', 'b'),
    error => error instanceof AccountVerificationError && !error.message.includes('secret-token')
  );
});

test('tokens without kid still require an exact signature from the fixed app keys; unknown kid never falls back', async () => {
  const state = setup();
  const second = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  state.change({ keys: [jwk, { ...second.publicKey.export({ format: 'jwk' }), kid: 'second', alg: 'ES256', use: 'sig' }] });
  const legacyAccess = `Bearer ${jwt({}, { kid: undefined })}`;
  const legacyIdentity = jwt({ linked_accounts: JSON.stringify(linked) }, { kid: undefined });
  assert.equal((await state.verify(wallet, legacyAccess, legacyIdentity)).wallet, wallet);
  const untrusted = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  await assert.rejects(
    state.verify(wallet, legacyAccess, jwt({ linked_accounts: JSON.stringify(linked) }, { kid: undefined }, untrusted.privateKey))
  );
  await assert.rejects(state.verify(wallet, legacyAccess, jwt({ linked_accounts: JSON.stringify(linked) }, { kid: 'unknown' })));
  for (const kid of [null, '', 42])
    await assert.rejects(state.verify(wallet, legacyAccess, jwt({ linked_accounts: JSON.stringify(linked) }, { kid })));
});

test('failure diagnostics expose only a fixed check stage, never JWTs or account claims', async () => {
  const stages: string[] = [];
  const verify = createPrivyOwnershipVerifier(
    async () => new Response(JSON.stringify({ keys: [jwk] })),
    () => now,
    (stage, check) => stages.push(`${stage}/${check}`)
  );
  await assert.rejects(verify(wallet, 'Bearer synthetic-secret', identity()));
  await assert.rejects(verify(other, access(), identity()));
  assert.deepEqual(stages, ['access-token/format', 'wallet-binding/association']);
});

test('fractional JWT NumericDates and longer nominal identity lifetimes preserve the 15-minute proof bound', async () => {
  const { verify } = setup();
  const longIdentity = identity({ iat: now / 1000 - 0.5, exp: now / 1000 + 86400 });
  const fractionalAccess = `Bearer ${jwt({ iat: now / 1000 - 0.25, exp: now / 1000 + 3599.75 })}`;
  const proof = await verify(wallet, fractionalAccess, longIdentity);
  assert.equal(Date.parse(proof.expiresAt), now + 899500);
  await assert.rejects(verify(wallet, fractionalAccess, identity({ iat: now / 1000 - 900, exp: now / 1000 + 86400 })));
  await assert.rejects(verify(wallet, `Bearer ${jwt({ exp: now / 1000 + 7201 })}`, longIdentity));
  for (const patch of [
    { iat: null },
    { iat: -1 },
    { iat: '1800000000' },
    { exp: null },
    { exp: '1800003600' },
    { iat: now / 1000 + 30.5 },
    { exp: now / 1000 - 0.5 },
    { nbf: now / 1000 + 0.5 },
  ])
    await assert.rejects(verify(wallet, fractionalAccess, identity(patch)));
});
