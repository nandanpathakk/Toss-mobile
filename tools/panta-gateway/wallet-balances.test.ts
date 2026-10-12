import assert from 'node:assert/strict';
import { type AddressInfo } from 'node:net';
import { test } from 'node:test';

import { createPortfolioClient, formatWalletUnits, parseWalletBalances } from '../../src/lib/panta-portfolio';
import { createCatalogGateway } from './gateway';
import fixture from './preflight-fixture.json';
import { deployment, key } from './primary-transaction';
import { createWalletBalanceReader } from './wallet-balances';

const wallet = fixture.build.wallet;
function rpcFixture(
  options: { missing?: boolean; frozen?: boolean; wrongChain?: boolean; mutate?: (accounts: any[]) => void; oversized?: boolean } = {}
) {
  const methods: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://api.mainnet-beta.solana.com');
    assert.equal(init?.redirect, 'error');
    assert.equal(String(init?.headers).includes('pk_live'), false);
    const request = JSON.parse(String(init?.body));
    methods.push(request.method);
    let result: unknown;
    if (request.method === 'getGenesisHash') result = options.wrongChain ? 'devnet' : deployment.genesis;
    else {
      assert.equal(request.method, 'getMultipleAccounts');
      assert.equal(request.params[0][0], wallet);
      assert.equal(request.params[0][1], deployment.mint);
      assert.equal(request.params[0].length, 3);
      assert.deepEqual(request.params[1], { encoding: 'base64', commitment: 'confirmed' });
      const mint = Buffer.from(fixture.accounts[deployment.mint].data[0], 'base64');
      const token = Buffer.alloc(165);
      key(deployment.mint).copy(token);
      key(wallet).copy(token, 32);
      token.writeBigUInt64LE(18446744073709551615n, 64);
      token[108] = options.frozen ? 2 : 1;
      const account = (owner: string, data: Buffer, lamports = 2039280) => ({
        owner,
        executable: false,
        lamports,
        data: [data.toString('base64'), 'base64'],
      });
      const accounts = [
        options.missing ? null : account(deployment.system, Buffer.alloc(0), 1234567891),
        account(deployment.token, mint),
        options.missing ? null : account(deployment.token, token),
      ];
      options.mutate?.(accounts);
      result = { context: { slot: 123 }, value: accounts };
    }
    return new Response(options.oversized ? 'x'.repeat(17000) : JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  };
  return { fetcher, methods };
}
test('read-only mainnet balances preserve exact SOL/USDC amounts and validate trading account derivation', async () => {
  const mock = rpcFixture();
  const result = await createWalletBalanceReader(mock.fetcher)(wallet);
  assert.equal(result.usdcAccount, fixture.build.instructions[1].accounts[7].pubkey);
  assert.equal(result.usdcBaseUnits, '18446744073709551615');
  assert.equal(result.solLamports, '1234567891');
  assert.equal(formatWalletUnits(result.usdcBaseUnits, 6), '18446744073709.551615');
  assert.equal(formatWalletUnits(result.solLamports, 9), '1.234567891');
  assert.deepEqual(mock.methods, ['getGenesisHash', 'getMultipleAccounts']);
});
test('confirmed missing accounts are zero; frozen USDC remains explicitly frozen', async () => {
  const missing = await createWalletBalanceReader(rpcFixture({ missing: true }).fetcher)(wallet);
  assert.equal(missing.solLamports, '0');
  assert.equal(missing.usdcBaseUnits, '0');
  assert.equal(missing.usdcState, 'missing');
  assert.equal((await createWalletBalanceReader(rpcFixture({ frozen: true }).fetcher)(wallet)).usdcState, 'frozen');
});
test('wrong chain, altered token/mint authority, unsafe lamports and oversized RPC never become zero balances', async () => {
  for (const options of [
    { wrongChain: true },
    { oversized: true },
    {
      mutate: (a: any[]) => {
        a[0].lamports = Number.MAX_SAFE_INTEGER + 1;
      },
    },
    {
      mutate: (a: any[]) => {
        a[2].owner = deployment.system;
      },
    },
    {
      mutate: (a: any[]) => {
        const data = Buffer.from(a[2].data[0], 'base64');
        data[32] ^= 1;
        a[2].data[0] = data.toString('base64');
      },
    },
    {
      mutate: (a: any[]) => {
        const data = Buffer.from(a[1].data[0], 'base64');
        data[44] = 9;
        a[1].data[0] = data.toString('base64');
      },
    },
    {
      mutate: (a: any[]) => {
        a[2].data[0] = 'AAAA';
      },
    },
  ])
    await assert.rejects(createWalletBalanceReader(rpcFixture(options).fetcher)(wallet));
});
test('balance client binds results to requested wallet/network and rejects invalid or missing amounts', async () => {
  const report = await createWalletBalanceReader(rpcFixture().fetcher)(wallet);
  for (const patch of [
    { wallet: deployment.mint },
    { chain: 'devnet' },
    { usdcBaseUnits: 0 },
    { solLamports: null },
    { usdcState: 'missing' },
    { fetchedAt: 'tomorrow' },
    { slot: -1 },
  ])
    assert.throws(() => parseWalletBalances({ ...report, ...patch }, wallet));
  const client = createPortfolioClient('http://127.0.0.1:8787', async (url, init) => {
    assert.equal(url, `http://127.0.0.1:8787/wallets/${wallet}/balances/`);
    assert.equal(init?.redirect, 'error');
    return new Response(JSON.stringify(report));
  });
  assert.deepEqual(await client.balances(wallet), report);
  assert.equal(formatWalletUnits('1', 6), '0.000001');
  assert.equal(formatWalletUnits('1000000000', 9), '1');
  assert.throws(() => formatWalletUnits('18446744073709551616', 6));
});
test('balance gateway only accepts a bounded public wallet path and never forwards it or the API key upstream', async () => {
  const report = await createWalletBalanceReader(rpcFixture().fetcher)(wallet);
  let reads = 0;
  const server = createCatalogGateway(
    'pk_test_local_fixture',
    async () => {
      assert.fail('Balance request forwarded to Panta');
    },
    undefined,
    async address => {
      assert.equal(address, wallet);
      reads++;
      return report;
    }
  );
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.deepEqual(await createPortfolioClient(base).balances(wallet), report);
    for (const suffix of ['?network=devnet', '?rpc=https://example.com', '?wallet=other'])
      assert.equal((await fetch(`${base}/wallets/${wallet}/balances/${suffix}`)).status, 404);
    assert.equal((await fetch(`${base}/wallets/invalid/balances/`)).status, 404);
    assert.equal((await fetch(`${base}/wallets/${wallet}/balances/`, { method: 'POST' })).status, 405);
    assert.equal(reads, 1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
test('balance RPC failures are sanitized and client cancellation reaches the request', async () => {
  await assert.rejects(
    createWalletBalanceReader(async () => {
      throw Error('private RPC diagnostic');
    })(wallet),
    error => error instanceof Error && !error.message.includes('private')
  );
  const controller = new AbortController();
  controller.abort();
  const client = createPortfolioClient('http://127.0.0.1:8787', async (_, init) => {
    assert.equal(init?.signal?.aborted, true);
    throw Error('aborted');
  });
  await assert.rejects(client.balances(wallet, controller.signal));
});
