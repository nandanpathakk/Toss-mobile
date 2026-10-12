import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { type AddressInfo } from 'node:net';
import { test } from 'node:test';

import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

import { createCreationFlowStore } from '../../src/features/panta/creation-flow-store';
import { createPrimarySigner } from '../../src/features/panta/primary-signer';
import { AccountVerificationError } from '../../src/lib/panta-account-verification';
import {
  CreationError,
  creationWireBytes,
  parseCreationQuote,
  parseCreationRequest,
  parseImageUploadTicket,
  type CreationBuild,
  type CreationRequest,
} from '../../src/lib/panta-creation';
import { createCreationClient, parseCreationBuild } from '../../src/lib/panta-creation-client';
import { decodePurchaseWire, encodePurchaseWire } from '../../src/lib/panta-purchase';
import { purchaseChannel } from '../../src/lib/panta-purchase-client';
import { createCreationService, creationInstruction, validateCreationEconomics } from './creation-service';
import { createCatalogGateway } from './gateway';
import { createPrimaryPurchases } from './primary-purchase';
import {
  compileUnsignedPrimary,
  configAddress,
  deployment,
  derive,
  key,
  type AccountSnapshot,
  type ChainAccount,
} from './primary-transaction';

const now = 1900000000000;
// Deterministic offline key; never used by a live RPC or real wallet provider.
const syntheticSecret = new Uint8Array(32).fill(7);
const wallet = bs58.encode(ed25519.getPublicKey(syntheticSecret));
const treasury = bs58.encode(Buffer.alloc(32, 8));
const request: CreationRequest = {
  wallet,
  question: 'Will the event happen?',
  description: '',
  category: 'world',
  imageUrl: 'https://example.com/cover.jpg',
  resolutionRule: 'YES if the official source confirms it; otherwise NO.',
  sourcesOfTruth: ['https://example.com/result'],
  startTime: now / 1000 + 7200,
  endTime: now / 1000 + 86400,
  resolutionTime: now / 1000 + 90000,
  marketType: 'standard',
};
function setup(input = request) {
  const quote = {
    createId: 'cr_offline',
    expectedEventPda: derive([Buffer.from('event_usdc'), key(wallet), createHash('sha256').update(input.question).digest()]),
    paymentUsdc: '50000000',
    liquidityInjectionUsdc: '10000000',
    platformRevenueUsdc: '40000000',
    marketType: 'standard' as const,
    expiresAt: new Date(now + 300000).toISOString(),
  };
  const cost = {
    amountBaseUnits: '10000000',
    protocolFeeBaseUnits: '40000000',
    totalUsdcBaseUnits: '50000000',
    networkFeeLamports: '5000',
    accountRentLamports: '0',
    totalSolLamports: '5000',
  };
  const build: CreationBuild = {
    orderId: quote.createId,
    quoteId: quote.createId,
    marketId: quote.expectedEventPda,
    wallet,
    side: 'yes',
    expectedShares: '0',
    amountUsdc: '10',
    feeUsdc: '40',
    status: 'built',
    disclaimer: null,
    instructions: [creationInstruction(input, quote, treasury)],
    recentBlockhash: bs58.encode(Buffer.alloc(32, 9)),
    lastValidBlockHeight: 100,
    expiresAt: new Date(now + 60000).toISOString(),
    creation: { request: input, quote, cost, snapshotHash: 'a'.repeat(64) },
  };
  return { quote, build };
}
const ticket = {
  uploadUrl: 'https://api.cloudinary.com/v1_1/test-cloud/image/upload',
  publicId: 'market/covers/offline',
  expiresAt: new Date(now + 300000).toISOString(),
  fields: {
    api_key: 'synthetic-public-key',
    timestamp: now / 1000,
    signature: 'a'.repeat(40),
    folder: 'market/covers',
    public_id: 'offline',
    overwrite: 'false',
  },
};

test('creation request rejects private URLs, extra fields, duplicate sources and unordered dates', () => {
  assert.deepEqual(parseCreationRequest(request, now), request);
  for (const imageUrl of [
    'http://127.0.0.1/a',
    'http://10.0.0.1/a',
    'https://user:secret@example.com/a',
    'file:///cover',
    'https://host.internal/a',
  ])
    assert.throws(() => parseCreationRequest({ ...request, imageUrl }, now));
  for (const patch of [
    { paymentUsdc: '1' },
    { sourcesOfTruth: [request.sourcesOfTruth[0], request.sourcesOfTruth[0]] },
    { startTime: now / 1000 },
    { endTime: request.startTime },
    { resolutionTime: request.endTime - 1 },
    { marketType: 'breaking' },
  ])
    assert.throws(() => parseCreationRequest({ ...request, ...patch }, now));
});
test('UTF-8 transaction budget equals the actual static versioned wire and rejects oversized criteria', () => {
  for (const question of ['Short?', 'Will 🪙 win?', 'é'.repeat(140)]) {
    const input = { ...request, question };
    const { build } = setup(input);
    assert.equal(compileUnsignedPrimary(build).transaction.length, creationWireBytes(input));
  }
  assert.throws(() => parseCreationRequest({ ...request, resolutionRule: '🪙'.repeat(300) }, now), { code: 'CREATION_TOO_LARGE' });
});
test('quote checks integer base units, split, lifetime and a bounded server clock skew', () => {
  const { quote } = setup();
  assert.deepEqual(parseCreationQuote(quote, now), quote);
  assert.ok(parseCreationQuote({ ...quote, expiresAt: new Date(now + 300500).toISOString() }, now));
  for (const patch of [
    { paymentUsdc: '50.0' },
    { platformRevenueUsdc: '1' },
    { expectedEventPda: 'bad' },
    { expiresAt: new Date(now).toISOString() },
    { expiresAt: new Date(now + 330001).toISOString() },
  ])
    assert.throws(() => parseCreationQuote({ ...quote, ...patch }, now));
});
test('scoped upload policy rejects arbitrary hosts, overwrite and extra form fields', () => {
  assert.deepEqual(parseImageUploadTicket(ticket, now), ticket);
  for (const patch of [
    { uploadUrl: 'https://attacker.example/upload' },
    { uploadUrl: ticket.uploadUrl + '?token=x' },
    { publicId: 'other/image' },
    { fields: { ...ticket.fields, overwrite: 'true' } },
    { fields: { ...ticket.fields, callback: 'https://attacker.example' } },
    { expiresAt: new Date(now - 1).toISOString() },
  ])
    assert.throws(() => parseImageUploadTicket({ ...ticket, ...patch }, now));
});
test('mobile creation policy binds exact question, sources, dates, fees and account roles', () => {
  const { build } = setup();
  assert.equal(parseCreationBuild(build, request, now), build);
  const mutate = (change: (b: CreationBuild) => void) => {
    const b = structuredClone(build);
    change(b);
    assert.throws(() => parseCreationBuild(b, request, now));
  };
  mutate(b => {
    b.creation.request.question = 'Substituted';
  });
  mutate(b => {
    b.instructions[0].accounts[10].isSigner = true;
  });
  mutate(b => {
    b.instructions[0].accounts[3].pubkey = treasury;
  });
  mutate(b => {
    const data = Buffer.from(b.instructions[0].data, 'base64');
    data[8] ^= 1;
    b.instructions[0].data = data.toString('base64');
  });
  mutate(b => {
    b.creation.cost.totalUsdcBaseUnits = '49999999';
  });
  mutate(b => {
    b.instructions.push(b.instructions[0]);
  });
  mutate(b => {
    b.expiresAt = new Date(now - 1).toISOString();
  });
});

test('creation service binds quote ownership and forwards only the backend API key', async () => {
  const { quote } = setup();
  let calls = 0;
  const config = Buffer.alloc(356);
  Buffer.from([119, 255, 200, 88, 252, 82, 128, 24]).copy(config);
  key(deployment.mint).copy(config, 244);
  key(treasury).copy(config, 136);
  config.writeBigUInt64LE(50000000n, 340);
  config.writeBigUInt64LE(10000000n, 348);
  config.writeBigInt64LE(3600n, 176);
  const service = createCreationService(
    'synthetic-backend-key',
    async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://live-api.panta.market/api/v1/markets/create/quote/');
      assert.deepEqual(init?.headers, { 'Content-Type': 'application/json', 'X-Api-Key': 'synthetic-backend-key' });
      return Response.json(quote);
    },
    async method =>
      method === 'getGenesisHash'
        ? deployment.genesis
        : {
            context: { slot: 10 },
            value: [{ owner: deployment.program, executable: false, lamports: 1, data: [config.toString('base64'), 'base64'] }, null],
          },
    () => now
  );
  const identity = { userId: 'did:privy:offline', wallet, expiresAt: new Date(now + 60000).toISOString() };
  await assert.rejects(service.quote(request, { ...identity, wallet: treasury }));
  assert.equal(calls, 0);
  await service.quote(request, identity);
  assert.equal(calls, 1);
  await assert.rejects(service.build(quote.createId, { ...identity, userId: 'did:privy:other' }));
  assert.equal(calls, 1);
  await assert.rejects(service.build('cr_unknown', identity));
  assert.equal(calls, 1);
});

test('creation gateway requires ownership before upstream and refuses unconfirmed registration', async t => {
  let calls = 0;
  const server = createCatalogGateway(
    'pk_test_synthetic',
    async () => {
      calls++;
      throw Error('must not forward');
    },
    undefined,
    undefined,
    async (address, access, identity) => {
      if (access !== 'Bearer synthetic-access' || identity !== 'synthetic-identity') throw new AccountVerificationError('ACCOUNT_REQUIRED');
      return { userId: 'did:privy:offline', wallet: address, expiresAt: new Date(Date.now() + 60000).toISOString() };
    }
  );
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, authorized: boolean) =>
    fetch(base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorized ? { 'Authorization': 'Bearer synthetic-access', 'Privy-Id-Token': 'synthetic-identity' } : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal((await post('/creation/quote/', request, false)).status, 401);
  assert.equal((await post('/creation/image-upload/', { wallet, uploadUrl: 'https://attacker.example' }, true)).status, 400);
  const result = await post(
    '/creation/register/',
    {
      wallet,
      orderId: 'cr_unknown',
      marketId: setup().quote.expectedEventPda,
      signature: bs58.encode(Buffer.alloc(64, 5)),
      status: 'confirmed',
      updatedAt: new Date().toISOString(),
    },
    true
  );
  assert.notEqual(result.status, 200);
  assert.equal(calls, 0);
  assert.equal((await post('/creation/arbitrary/', { wallet }, true)).status, 405);
});

test('creation checks the authoritative start delay before upstream and returns the exact earliest time', async () => {
  let calls = 0;
  const config = Buffer.alloc(356);
  Buffer.from([119, 255, 200, 88, 252, 82, 128, 24]).copy(config);
  key(deployment.mint).copy(config, 244);
  key(treasury).copy(config, 136);
  config.writeBigUInt64LE(50000000n, 340);
  config.writeBigUInt64LE(10000000n, 348);
  config.writeBigInt64LE(7200n, 176);
  const service = createCreationService(
    'synthetic-backend-key',
    async () => {
      calls++;
      return Response.json(setup().quote);
    },
    async method =>
      method === 'getGenesisHash'
        ? deployment.genesis
        : {
            context: { slot: 10 },
            value: [{ owner: deployment.program, executable: false, lamports: 1, data: [config.toString('base64'), 'base64'] }, null],
          },
    () => now
  );
  const identity = { userId: 'did:privy:offline', wallet, expiresAt: new Date(now + 60000).toISOString() };
  await assert.rejects(
    service.quote({ ...request, startTime: now / 1000 + 3600 }, identity),
    (e: unknown) => e instanceof CreationError && e.code === 'CREATION_START_TOO_SOON' && e.minimumStartTime === now / 1000 + 7200
  );
  assert.equal(calls, 0);
  await service.quote(request, identity);
  assert.equal(calls, 1);
});

test('known upstream internal creation failure is unavailable, not an accusation of invalid draft fields', async () => {
  const config = Buffer.alloc(356);
  Buffer.from([119, 255, 200, 88, 252, 82, 128, 24]).copy(config);
  key(deployment.mint).copy(config, 244);
  config.writeBigUInt64LE(50000000n, 340);
  config.writeBigUInt64LE(10000000n, 348);
  const service = createCreationService(
    'synthetic-backend-key',
    async () =>
      Response.json({ code: 'INVALID_MARKET_PARAMS', message: 'unexpected create quote failure — check server logs' }, { status: 400 }),
    async method =>
      method === 'getGenesisHash'
        ? deployment.genesis
        : {
            context: { slot: 10 },
            value: [{ owner: deployment.program, executable: false, lamports: 1, data: [config.toString('base64'), 'base64'] }, null],
          },
    () => now
  );
  await assert.rejects(
    service.quote(request, { userId: 'did:privy:offline', wallet, expiresAt: new Date(now + 60000).toISOString() }),
    (e: unknown) => e instanceof CreationError && e.code === 'CREATION_UNAVAILABLE' && !e.message.includes('server logs')
  );
});

test('creation client formats only bounded timing metadata and never forwards diagnostic strings', async () => {
  for (const minimumStartTime of [now / 1000 + 7200, 'untrusted', Infinity, 253402300800]) {
    const client = createCreationClient('http://127.0.0.1:8787', async () =>
      Response.json(
        {
          code: 'CREATION_START_TOO_SOON',
          minimumStartTime,
          message: 'sensitive diagnostic',
        },
        { status: 400 }
      )
    );
    await assert.rejects(
      client.quote(
        {
          ...request,
          startTime: Math.floor(Date.now() / 1000) + 7200,
          endTime: Math.floor(Date.now() / 1000) + 86400,
          resolutionTime: Math.floor(Date.now() / 1000) + 90000,
        },
        'synthetic-access',
        'synthetic-identity'
      ),
      (e: unknown) =>
        e instanceof CreationError &&
        e.code === 'CREATION_START_TOO_SOON' &&
        !e.message.includes('sensitive') &&
        (typeof minimumStartTime !== 'number' || minimumStartTime > 253402300799 || !Number.isFinite(minimumStartTime)
          ? e.minimumStartTime === undefined
          : e.minimumStartTime === minimumStartTime)
    );
  }
});
test('draft invalidation prevents a late cost response from restoring stale approval', async () => {
  let resolve!: (value: unknown) => void;
  const client = {
    quote: () =>
      new Promise(r => {
        resolve = r;
      }),
    build: () => {
      throw Error('late build must not run');
    },
  } as unknown as ReturnType<typeof createCreationClient>;
  const store = createCreationFlowStore(client);
  const pending = store.review(request, async () => ({ access: 'synthetic', identity: 'synthetic' }));
  await Promise.resolve();
  store.invalidate();
  resolve(setup().quote);
  await pending;
  assert.deepEqual(store.useStore.getState(), { busy: false, quote: null, build: null, error: null });
  assert.equal(purchaseChannel('cr_offline'), 'creation');
  assert.equal(purchaseChannel('p2p_offline'), 'p2p');
  assert.equal(purchaseChannel('primary-offline'), 'primary');
});

// Synthetic account transitions exercise the cost policy. They are not live publication evidence.
function economics() {
  const { build } = setup();
  const ids = build.instructions[0].accounts.map(a => a.pubkey);
  const keys = compileUnsignedPrimary(build).keys;
  const before: AccountSnapshot = new Map(keys.map(id => [id, null]));
  const after: AccountSnapshot = new Map();
  const account = (owner: string, size: number, lamports = 1000): ChainAccount => ({
    owner,
    executable: false,
    lamports,
    data: Buffer.alloc(size),
  });
  before.set(wallet, account(deployment.system, 0, 100000));
  const config = account(deployment.program, 356);
  key(treasury).copy(config.data, 136);
  before.set(configAddress(), config);
  const token = (owner: string, amount: bigint) => {
    const a = account(deployment.token, 165);
    key(deployment.mint).copy(a.data);
    key(owner).copy(a.data, 32);
    a.data.writeBigUInt64LE(amount, 64);
    a.data[108] = 1;
    return a;
  };
  before.set(ids[10], token(wallet, 100000000n));
  before.set(ids[11], token(treasury, 100000000n));
  for (const [id, a] of before) after.set(id, a ? { ...a, data: Buffer.from(a.data) } : null);
  const rents = new Map([
    [165, 1000],
    [89, 1000],
    [202, 1000],
    [2982, 1000],
  ]);
  after.set(ids[3], account(deployment.program, 2982));
  after.set(ids[5], token(ids[4], 10000000n));
  after.set(ids[6], account(deployment.program, 89));
  after.set(ids[7], token(ids[6], 0n));
  after.set(ids[8], account(deployment.program, 202));
  after.get(wallet)!.lamports -= 10000;
  after.get(ids[10])!.data.writeBigUInt64LE(50000000n, 64);
  after.get(ids[11])!.data.writeBigUInt64LE(140000000n, 64);
  const event = after.get(ids[3])!.data;
  Buffer.from([125, 192, 125, 158, 9, 115, 152, 233]).copy(event);
  key(wallet).copy(event, 8);
  [request.startTime, request.endTime, request.resolutionTime].forEach((n, i) => event.writeBigInt64LE(BigInt(n), 40 + i * 8));
  let offset = 328;
  const string = (s: string) => {
    event.writeUInt32LE(Buffer.byteLength(s), offset);
    offset += 4;
    offset += event.write(s, offset);
  };
  string(request.question);
  string(request.resolutionRule);
  event.writeUInt32LE(request.sourcesOfTruth.length, offset);
  offset += 4;
  request.sourcesOfTruth.forEach(string);
  const fee = after.get(ids[6])!.data;
  Buffer.from([21, 14, 215, 247, 197, 137, 200, 121]).copy(fee);
  key(build.marketId).copy(fee, 8);
  key(wallet).copy(fee, 40);
  const position = after.get(ids[8])!.data;
  Buffer.from([251, 248, 209, 245, 83, 234, 17, 27]).copy(position);
  position[8] = 1;
  key(build.marketId).copy(position, 9);
  key(wallet).copy(position, 41);
  const balances = (snapshot: AccountSnapshot) => keys.map(id => snapshot.get(id)?.lamports ?? 0);
  const tokens = (snapshot: AccountSnapshot) =>
    [ids[10], ids[11], ids[5], ids[7]]
      .filter(id => snapshot.get(id))
      .map(id => ({
        accountIndex: keys.indexOf(id),
        owner: bs58.encode(snapshot.get(id)!.data.subarray(32, 64)),
        mint: deployment.mint,
        uiTokenAmount: { decimals: 6, amount: snapshot.get(id)!.data.readBigUInt64LE(64).toString() },
      }));
  const simulation = () => ({
    fee: 5000,
    preBalances: balances(before),
    postBalances: balances(after),
    preTokenBalances: tokens(before),
    postTokenBalances: tokens(after),
  });
  return {
    build,
    ids,
    keys,
    before,
    after,
    rents,
    simulation,
    run: () => validateCreationEconomics(build, keys, before, after, simulation(), rents),
  };
}
test('creation economics verifies the complete USDC split, rent and network fee', () => {
  assert.deepEqual(economics().run(), {
    amountBaseUnits: '10000000',
    protocolFeeBaseUnits: '40000000',
    totalUsdcBaseUnits: '50000000',
    networkFeeLamports: '5000',
    accountRentLamports: '5000',
    totalSolLamports: '10000',
  });
});

for (const bank of ['steady', 'drift-recovers', 'drift-blocked'] as const)
  test(`offline creation ${bank}: quote, build, exact-cost approval, sign-only, one send, receipt and registration`, async () => {
    const s = economics();
    const { quote } = setup();
    const config = s.before.get(configAddress())!;
    Buffer.from([119, 255, 200, 88, 252, 82, 128, 24]).copy(config.data);
    key(deployment.mint).copy(config.data, 244);
    config.data.writeBigUInt64LE(50000000n, 340);
    config.data.writeBigUInt64LE(10000000n, 348);
    config.data.writeBigInt64LE(3600n, 176);
    const program: ChainAccount = { owner: deployment.loader, executable: true, lamports: 1, data: Buffer.alloc(36) };
    program.data.writeUInt32LE(2);
    key(deployment.programData).copy(program.data, 4);
    s.before.set(deployment.program, program);
    const programData: ChainAccount = { owner: deployment.loader, executable: false, lamports: 1, data: Buffer.alloc(45) };
    programData.data.writeUInt32LE(3);
    programData.data.writeBigUInt64LE(deployment.deployedSlot, 4);
    s.before.set(deployment.programData, programData);
    const mint: ChainAccount = { owner: deployment.token, executable: false, lamports: 1, data: Buffer.alloc(82) };
    mint.data[44] = 6;
    mint.data[45] = 1;
    s.before.set(deployment.mint, mint);
    // Read-only accounts have unchanged balances in the synthetic simulation.
    for (const id of [deployment.program, deployment.mint]) s.after.set(id, s.before.get(id)!);
    const rpcAccount = (account: ChainAccount | null | undefined) =>
      account
        ? {
            owner: account.owner,
            executable: account.executable,
            lamports: account.lamports,
            data: [account.data.toString('base64'), 'base64'],
          }
        : null;
    let registrations = 0;
    let simulations = 0;
    let releaseSnapshot: (() => void) | undefined;
    const service = createCreationService(
      'synthetic-backend-key',
      async (url, init) => {
        assert.equal(new Headers(init?.headers).get('X-Api-Key'), 'synthetic-backend-key');
        if (String(url).endsWith('/create/quote/')) return Response.json(quote);
        if (String(url).endsWith('/create/build/'))
          return Response.json({
            ...quote,
            transaction: compileUnsignedPrimary(s.build).transaction.toString('base64'),
            recentBlockhash: s.build.recentBlockhash,
            lastValidBlockHeight: s.build.lastValidBlockHeight,
            buildFingerprint: 'offline-fingerprint',
            expiresAt: s.build.expiresAt,
          });
        assert.equal(String(url), 'https://live-api.panta.market/api/v1/markets/register/');
        registrations++;
        const body = JSON.parse(String(init?.body));
        return Response.json({ ...body, marketId: s.build.marketId, status: 'registered', images: [request.imageUrl] });
      },
      async (method, params = []) => {
        if (method === 'getGenesisHash') return deployment.genesis;
        if (method === 'getMultipleAccounts') {
          const options = params[1] as { minContextSlot?: number };
          if (options.minContextSlot !== undefined)
            await new Promise<void>(resolve => {
              releaseSnapshot = resolve;
            });
          return {
            context: { slot: options.minContextSlot ?? 10 },
            value: (params[0] as string[]).map(id => rpcAccount(s.before.get(id))),
          };
        }
        if (method === 'simulateTransaction') {
          assert.ok(releaseSnapshot, 'account read must already be in flight');
          releaseSnapshot();
          releaseSnapshot = undefined;
          simulations++;
          const options = params[1] as { minContextSlot: number; accounts: { addresses: string[] } };
          const writable = options.accounts.addresses;
          const drift = bank === 'drift-blocked' || (bank === 'drift-recovers' && simulations === 1);
          return {
            context: { slot: options.minContextSlot + (drift ? 1 : 0) },
            value: { err: null, ...s.simulation(), accounts: writable.map(id => rpcAccount(s.after.get(id))) },
          };
        }
        if (method === 'getMinimumBalanceForRentExemption') return s.rents.get(params[0] as number);
        if (method === 'getBlockHeight') return 50;
        if (method === 'isBlockhashValid') return { value: true };
        if (method === 'getFeeForMessage') return { value: 5000 };
        throw new Error(`Unexpected offline RPC: ${method}`);
      },
      () => now
    );
    const identity = { userId: 'did:privy:offline', wallet, expiresAt: new Date(now + 300000).toISOString() };
    const actualQuote = await service.quote(request, identity);
    if (bank === 'drift-blocked') {
      await assert.rejects(
        service.build(actualQuote.createId, identity),
        error => error instanceof CreationError && error.code === 'CREATION_BLOCKED'
      );
      assert.equal(simulations, 3);
      assert.equal(registrations, 0);
      return;
    }
    const actualBuild = await service.build(actualQuote.createId, identity);
    assert.equal(simulations, bank === 'steady' ? 1 : 2);
    assert.deepEqual(parseCreationBuild(actualBuild, request, now), actualBuild);
    let sends = 0;
    const purchases = createPrimaryPurchases(
      value => service.preflight(value as CreationBuild),
      {
        broadcast: async (_, __, signature) => {
          sends++;
          return signature;
        },
        register: async () => {
          throw new Error('Creation must use its separate catalog registration');
        },
        receipt: async record => ({ ...record, status: 'confirmed' }),
      },
      () => now
    );
    const prepared = await purchases.prepare(actualBuild, identity);
    assert.equal(prepared.cost.totalUsdcBaseUnits, '50000000');
    assert.equal(prepared.cost.accountRentLamports, '5000');
    const sign = createPrimarySigner(
      () => ({
        address: wallet,
        accountId: identity.userId,
        getProvider: async () => ({
          request: async input => {
            assert.equal(input.method, 'signTransaction');
            const signedTransaction = Uint8Array.from(input.params.transaction);
            signedTransaction.set(ed25519.sign(signedTransaction.subarray(65), syntheticSecret), 1);
            return { signedTransaction };
          },
        }),
      }),
      () => now
    );
    const signed = await sign(actualBuild, decodePurchaseWire(prepared.transaction), {
      wallet,
      accountId: identity.userId,
      orderId: actualBuild.orderId,
      messageHash: prepared.messageHash,
      expiresAt: prepared.expiresAt,
      priceChangeAccepted: true,
    });
    const send = {
      wallet,
      orderId: actualBuild.orderId,
      ticket: prepared.ticket,
      transaction: encodePurchaseWire(signed.transaction),
      priceChangeAccepted: true,
    };
    const pending = await purchases.send(send, identity);
    assert.equal(pending.status, 'pending');
    await assert.rejects(purchases.send(send, identity));
    assert.equal(sends, 1);
    const confirmed = await purchases.receipt(pending, identity);
    assert.equal(confirmed.status, 'confirmed');
    assert.deepEqual(await service.register(confirmed), { marketId: actualBuild.marketId, status: 'registered' });
    assert.equal(registrations, 1);
  });
for (const scenario of [
  'wallet-extra-charge',
  'treasury-short',
  'vault-short',
  'rent-extra',
  'changed-source',
  'fee-owner',
  'position-owner',
  'token-delegate',
] as const)
  test(`creation rejects ${scenario}`, () => {
    const s = economics();
    const { ids, after } = s;
    if (scenario === 'wallet-extra-charge') after.get(wallet)!.lamports--;
    if (scenario === 'treasury-short') after.get(ids[11])!.data.writeBigUInt64LE(139999999n, 64);
    if (scenario === 'vault-short') after.get(ids[5])!.data.writeBigUInt64LE(9999999n, 64);
    if (scenario === 'rent-extra') after.get(ids[3])!.lamports++;
    if (scenario === 'changed-source') after.get(ids[3])!.data[350] ^= 1;
    if (scenario === 'fee-owner') key(treasury).copy(after.get(ids[6])!.data, 40);
    if (scenario === 'position-owner') key(treasury).copy(after.get(ids[8])!.data, 41);
    if (scenario === 'token-delegate') after.get(ids[10])!.data.writeUInt32LE(1, 72);
    assert.throws(s.run);
  });

test('confirmed registration can recover after gateway restart but rejects another market/signature', async () => {
  const { quote } = setup();
  const record = { wallet, orderId: quote.createId, marketId: quote.expectedEventPda, signature: bs58.encode(Buffer.alloc(64, 5)) };
  let changed = false;
  const service = createCreationService(
    'synthetic-backend-key',
    async (url, init) => {
      assert.equal(String(url), 'https://live-api.panta.market/api/v1/markets/register/');
      assert.deepEqual(JSON.parse(String(init?.body)), { createId: record.orderId, signature: record.signature });
      return Response.json({
        createId: record.orderId,
        signature: record.signature,
        marketId: changed ? treasury : record.marketId,
        status: 'registered',
        images: [request.imageUrl],
      });
    },
    async () => {
      throw Error('finalized confirmation is performed by the gateway before this call');
    },
    () => now
  );
  assert.deepEqual(await service.register(record), { marketId: record.marketId, status: 'registered' });
  changed = true;
  await assert.rejects(service.register(record));
});
