import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

import bs58 from 'bs58';
import nacl from 'tweetnacl';

import { createPhantomConnector, emptyWalletState, WalletUnavailable, type WalletState } from '../../src/features/panta/phantom-connector';

const identity = 'https://example.com/independent-app';
const now = 1791252000000;
const bytes = (value: unknown) => new Uint8Array(Buffer.from(JSON.stringify(value), 'utf8'));
function fixture(appUrl: string | null = identity, openWallet?: (url: string, signal: AbortSignal) => Promise<void>) {
  let state: WalletState = { ...emptyWalletState };
  let clock = now;
  const urls: string[] = [];
  const timers = new Map<number, () => void>();
  const connector = createPhantomConnector(appUrl, 'devnet', {
    randomBytes: size => new Uint8Array(randomBytes(size)),
    openWallet: async (url, signal) => {
      urls.push(url);
      await openWallet?.(url, signal);
    },
    onState: next => {
      state = next;
    },
    now: () => clock,
    schedule: (fn, delay) => {
      timers.set(delay, fn);
      return () => {
        timers.delete(delay);
      };
    },
  });
  return {
    connector,
    urls,
    timers,
    state: () => state,
    advance: (delay: number) => {
      clock += delay;
    },
  };
}
function response(request: string, overrides: Record<string, unknown> = {}, invalidSignature = false, invalidCiphertext = false) {
  const params = new URL(request).searchParams;
  const redirect = new URL(params.get('redirect_link')!);
  const wallet = nacl.sign.keyPair.fromSeed(new Uint8Array(randomBytes(32)));
  const encryption = nacl.box.keyPair.fromSecretKey(new Uint8Array(randomBytes(32)));
  const nonce = new Uint8Array(randomBytes(24));
  const claims = { app_url: identity, chain: 'solana', cluster: 'devnet', timestamp: now / 1000, ...overrides };
  const signed = nacl.sign(bytes(claims), wallet.secretKey);
  if (invalidSignature) signed[0] ^= 1;
  const token = bs58.encode(signed);
  const shared = nacl.box.before(bs58.decode(params.get('dapp_encryption_public_key')!), encryption.secretKey);
  const encrypted = nacl.box.after(bytes({ public_key: bs58.encode(wallet.publicKey), session: token }), nonce, shared);
  if (invalidCiphertext) encrypted[0] ^= 1;
  redirect.searchParams.set('phantom_encryption_public_key', bs58.encode(encryption.publicKey));
  redirect.searchParams.set('nonce', bs58.encode(nonce));
  redirect.searchParams.set('data', bs58.encode(encrypted));
  return { url: redirect.toString(), address: bs58.encode(wallet.publicKey), shared, token };
}

test('connection uses the official host, explicit devnet and a fresh encryption identity per attempt', async () => {
  const f = fixture();
  await f.connector.connect();
  const first = new URL(f.urls[0]);
  assert.equal(first.origin + first.pathname, 'https://phantom.com/ul/v1/connect');
  assert.equal(first.searchParams.get('cluster'), 'devnet');
  assert.equal(first.searchParams.get('app_url'), identity);
  assert.equal(bs58.decode(first.searchParams.get('dapp_encryption_public_key')!).length, 32);
  assert.equal(bs58.decode(new URL(first.searchParams.get('redirect_link')!).searchParams.get('state')!).length, 24);
  f.connector.cancel();
  await f.connector.connect();
  assert.notEqual(new URL(f.urls[1]).searchParams.get('dapp_encryption_public_key'), first.searchParams.get('dapp_encryption_public_key'));
  assert.notEqual(new URL(f.urls[1]).searchParams.get('redirect_link'), first.searchParams.get('redirect_link'));
  f.connector.cancel();
});

test('verified encrypted approval exposes only public connection state and ignores replay', async () => {
  const f = fixture();
  await f.connector.connect();
  const approval = response(f.urls[0]);
  f.connector.handleURL(approval.url);
  assert.deepEqual(f.state(), { status: 'connected', address: approval.address, error: null });
  assert.equal(f.timers.size, 0);
  assert.equal(JSON.stringify(f.state()).includes(approval.token), false);
  f.connector.handleURL(approval.url);
  assert.equal(f.state().status, 'connected');
  f.connector.cancel();
  f.connector.handleURL(approval.url);
  assert.equal(f.state().status, 'disconnected');
});

for (const [name, claims, signature, ciphertext] of [
  ['different app identity', { app_url: 'https://example.com/other' }, false, false],
  ['different network', { cluster: 'mainnet-beta' }, false, false],
  ['omitted network', { cluster: undefined }, false, false],
  ['different chain', { chain: 'ethereum' }, false, false],
  ['future approval', { timestamp: now / 1000 + 301 }, false, false],
  ['old approval', { timestamp: now / 1000 - 301 }, false, false],
  ['forged signature', {}, true, false],
  ['modified encrypted message', {}, false, true],
] as const) {
  test(`rejects ${name} without creating a wallet session`, async () => {
    const f = fixture();
    await f.connector.connect();
    f.connector.handleURL(response(f.urls[0], claims, signature, ciphertext).url);
    assert.deepEqual(f.state(), { ...emptyWalletState, error: 'INVALID' });
    assert.equal(f.timers.size, 0);
  });
}

test('wrong routes, state, duplicate parameters and malformed encoding cannot authorize a connection', async () => {
  const f = fixture();
  await f.connector.connect();
  const approval = response(f.urls[0]);
  const wrong = new URL(approval.url);
  wrong.searchParams.set('state', bs58.encode(randomBytes(24)));
  for (const url of [
    wrong.toString(),
    approval.url.replace('://wallet/', '://wallet.evil/'),
    approval.url.replace('/connect?', '/disconnect?'),
    approval.url + '&state=other',
    approval.url + '&bad=%zz',
    approval.url + '#fragment',
    'panta-hackathon://wallet/connect?' + 'x'.repeat(13000),
  ]) {
    f.connector.handleURL(url);
    assert.equal(f.state().status, 'waiting');
  }
  f.connector.handleURL(approval.url);
  assert.equal(f.state().status, 'connected');
  f.connector.cancel();
});

test('matching malformed byte lengths and non-contributory encryption keys fail closed', async () => {
  for (const field of ['nonce', 'phantom_encryption_public_key']) {
    const f = fixture();
    await f.connector.connect();
    const url = new URL(response(f.urls[0]).url);
    url.searchParams.set(field, bs58.encode(new Uint8Array(field === 'nonce' ? 23 : 32)));
    f.connector.handleURL(url.toString());
    assert.equal(f.state().error, 'INVALID');
  }
});

test('rejects wallet errors without rendering wallet-controlled error text', async () => {
  const f = fixture();
  await f.connector.connect();
  const redirect = new URL(new URL(f.urls[0]).searchParams.get('redirect_link')!);
  redirect.searchParams.set('errorCode', '4001');
  redirect.searchParams.set('errorMessage', 'Untrusted remote text');
  f.connector.handleURL(redirect.toString());
  assert.deepEqual(f.state(), { ...emptyWalletState, error: 'REJECTED' });
});

test('no identity or an insecure identity prevents wallet launch', async () => {
  for (const identityUrl of [null, 'http://example.com', 'https://user:secret@example.com', 'https://example.com?token=secret']) {
    const f = fixture(identityUrl);
    await f.connector.connect();
    assert.equal(f.urls.length, 0);
    assert.equal(f.state().error, 'SETUP');
  }
});

test('wallet availability, opening failure and late completion never leave a connected state', async () => {
  for (const error of [new WalletUnavailable(), new Error('Internal error')]) {
    const f = fixture(identity, async () => {
      throw error;
    });
    await f.connector.connect();
    assert.equal(f.state().error, error instanceof WalletUnavailable ? 'UNAVAILABLE' : 'OPEN');
  }
  let complete: (() => void) | undefined;
  let openingSignal: AbortSignal | undefined;
  const f = fixture(
    identity,
    (_url, signal) =>
      new Promise<void>(resolve => {
        openingSignal = signal;
        complete = resolve;
      })
  );
  const opening = f.connector.connect();
  f.connector.cancel();
  assert.equal(openingSignal?.aborted, true);
  complete?.();
  await opening;
  assert.deepEqual(f.state(), emptyWalletState);
});

test('timeouts, late callbacks and return without approval clear the pending session', async () => {
  for (const returned of [false, true]) {
    const f = fixture();
    await f.connector.connect();
    const approval = response(f.urls[0]);
    if (returned) {
      f.connector.leftApp();
      f.connector.returnedToApp();
      f.timers.get(2500)!();
    } else {
      f.advance(120001);
      f.connector.handleURL(approval.url);
    }
    assert.equal(f.state().error, returned ? 'RETURNED' : 'TIMEOUT');
    f.connector.handleURL(approval.url);
    assert.equal(f.state().status, 'disconnected');
  }
});

test('disconnect encrypts the session, requires its own callback state, and clears the connection', async () => {
  const f = fixture();
  await f.connector.connect();
  const approval = response(f.urls[0]);
  f.connector.handleURL(approval.url);
  await f.connector.disconnect();
  const disconnect = new URL(f.urls[1]);
  assert.equal(disconnect.origin + disconnect.pathname, 'https://phantom.com/ul/v1/disconnect');
  const plaintext = nacl.box.open.after(
    bs58.decode(disconnect.searchParams.get('payload')!),
    bs58.decode(disconnect.searchParams.get('nonce')!),
    approval.shared
  );
  assert.ok(plaintext);
  assert.deepEqual(JSON.parse(Buffer.from(plaintext).toString('utf8')), { session: approval.token });
  f.connector.handleURL(approval.url);
  assert.equal(f.state().status, 'disconnecting');
  f.connector.handleURL(disconnect.searchParams.get('redirect_link')!);
  assert.deepEqual(f.state(), emptyWalletState);
});

test('disconnect failure clears local data and reports that remote revocation is unconfirmed', async () => {
  const f = fixture(identity, async url => {
    if (url.includes('/disconnect?')) throw new Error('Cannot open');
  });
  await f.connector.connect();
  f.connector.handleURL(response(f.urls[0]).url);
  await f.connector.disconnect();
  assert.deepEqual(f.state(), { ...emptyWalletState, error: 'DISCONNECT' });
});

test('patched native entropy never invokes Math.random and fails if the native module is unavailable', () => {
  const source = readFileSync('node_modules/react-native-get-random-values/index.js', 'utf8');
  assert.equal(source.includes('Math.random'), false);
  const context = vm.createContext({
    Uint8Array,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Uint8ClampedArray,
    global: {
      crypto: {
        getRandomValues: () => {
          throw new Error('Unreviewed provider');
        },
      },
    },
    require: (name: string) =>
      name === 'fast-base64-decode'
        ? (_data: string, target: Uint8Array) => target.fill(42)
        : {
            TurboModuleRegistry: { getEnforcing: () => ({ getRandomBase64: () => 'native-entropy' }) },
          },
  });
  vm.runInContext(source, context);
  const output = new Uint8Array(32);
  context.global.crypto.getRandomValues(output);
  assert.ok(output.every(byte => byte === 42));
  const failed = vm.createContext({
    Uint8Array,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Uint8ClampedArray,
    global: {},
    require: (name: string) =>
      name === 'fast-base64-decode'
        ? () => {}
        : {
            TurboModuleRegistry: {
              getEnforcing: () => {
                throw new Error('No native secure entropy');
              },
            },
          },
  });
  vm.runInContext(source, failed);
  assert.throws(() => failed.global.crypto.getRandomValues(new Uint8Array(32)), /No native secure entropy/);
});
