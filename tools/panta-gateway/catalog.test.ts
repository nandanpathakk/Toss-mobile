import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { type AddressInfo } from 'node:net';
import { test } from 'node:test';

import { CatalogError, createCatalogClient, parseCatalogMarket, parseCatalogPage, parseMarketActivity } from '../../src/lib/panta-catalog';
import { createCatalogGateway } from './gateway';

const id = '11111111111111111111111111111111';
const row = {
  marketId: id,
  title: 'A catalog question',
  description: 'Resolution description',
  category: 'crypto',
  images: ['https://example.com/image.png', 'file:///private/secret', 'javascript:alert(1)'],
  phase: 'primary',
  volumeUsdc: '1234.50',
  endTime: 1798761599,
  yesPrice: null,
  noPrice: null,
};

test('catalog preserves missing prices and exact volume; removes unsafe image schemes', () => {
  const market = parseCatalogMarket(row);
  assert.equal(market.yesPrice, null);
  assert.equal(market.noPrice, null);
  assert.equal(market.volumeUsdc, '1234.50');
  assert.deepEqual(market.images, ['https://example.com/image.png']);
  assert.equal(parseCatalogMarket({ ...row, yesPrice: '0.52' }).yesPrice, 0.52);
});

test('verified ISO dates normalize to seconds and sandbox disclaimers reach each market', () => {
  const note = 'Test mode: fixtures only. Not on mainnet.';
  const page = parseCatalogPage({ items: [{ ...row, endTime: '2026-12-31T23:59:59Z' }], nextCursor: null, disclaimer: note });
  assert.equal(page.items[0].endTime, 1798761599);
  assert.equal(page.disclaimer, note);
  assert.equal(page.items[0].disclaimer, note);
  assert.equal(parseCatalogMarket({ ...row, endTime: null }).endTime, null);
  assert.throws(() => parseCatalogMarket({ ...row, endTime: 'not a date' }), CatalogError);
  assert.throws(() => parseCatalogMarket({ ...row, endTime: -1 }), CatalogError);
});

test('invalid prices, phases, duplicate markets, and oversized pages fail closed', () => {
  for (const value of ['NaN', '-0.2', '0.5oops', Infinity, -1, true]) {
    assert.throws(() => parseCatalogMarket({ ...row, yesPrice: value }), CatalogError);
  }
  assert.throws(() => parseCatalogMarket({ ...row, phase: 'unknown' }), CatalogError);
  assert.throws(() => parseCatalogPage({ items: [row, row], nextCursor: null }), CatalogError);
  assert.throws(() => parseCatalogPage({ items: Array(51).fill(row) }), CatalogError);
});

test('client rejects credential URLs and insecure remote gateways', () => {
  for (const url of ['http://example.com', 'https://key@example.com', 'https://example.com?key=secret']) {
    assert.throws(() => createCatalogClient(url));
  }
});

test('local gateway permits only catalog reads and never exposes upstream credentials or diagnostic fields', async () => {
  const calls: string[] = [];
  const key = 'pk_test_local_fixture';
  const server = createCatalogGateway(key, async (input, options) => {
    const url = String(input);
    calls.push(url);
    assert.equal(new Headers(options?.headers).get('X-Api-Key'), key);
    assert.equal(options?.redirect, 'error');
    const data = url.includes('/categories/')
      ? { categories: ['crypto', 'science'], secret: key }
      : { items: [{ ...row, secret: key }], nextCursor: 'next' };
    return new Response(JSON.stringify(data), { headers: { 'X-Secret': key } });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const client = createCatalogClient(base);
    const result = await client.markets({ limit: 20, category: 'crypto' });
    assert.equal(result.items[0].yesPrice, null);
    assert.equal(result.nextCursor, 'next');
    assert.equal(JSON.stringify(result).includes(key), false);
    assert.deepEqual(await client.categories(), { categories: ['crypto', 'science'] });
    for (const [path, options, status] of [
      ['/account/keys/', undefined, 404],
      ['/markets/', { method: 'POST' }, 405],
      ['/markets/?key=secret', undefined, 400],
      ['/markets/?limit=51', undefined, 400],
      ['/markets/?status=unknown', undefined, 400],
      ['/markets/?limit=1&limit=2', undefined, 400],
      ['/markets/', { headers: { Origin: 'https://malicious.example' } }, 403],
    ] as const) {
      const response = await fetch(`${base}${path}`, options);
      assert.equal(response.status, status);
      assert.equal((await response.text()).includes(key), false);
    }
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${base}/markets/`, { headers: { Host: 'malicious.example' } }, response => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(hostStatus, 403);
    assert.equal(calls.length, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('upstream errors are sanitized and correctly surfaced to the client', async () => {
  const key = 'pk_test_error_fixture';
  const server = createCatalogGateway(key, async () => new Response(JSON.stringify({ debug: key }), { status: 401 }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${base}/markets/`);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.text()).includes(key), false);
    await assert.rejects(
      createCatalogClient(base).markets(),
      (error: unknown) => error instanceof CatalogError && error.code === 'ACCESS_REQUIRED'
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('upstream rate-limit delay reaches the client without exposing the error body', async () => {
  const key = 'pk_test_rate_fixture';
  const server = createCatalogGateway(
    key,
    async () => new Response(JSON.stringify({ debug: key }), { status: 429, headers: { 'Retry-After': '120' } })
  );
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await assert.rejects(
      createCatalogClient(base).markets(),
      (error: unknown) => error instanceof CatalogError && error.code === 'RATE_LIMITED' && error.retryAfterSeconds === 120
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

const trade = {
  id: 1,
  marketId: id,
  wallet: '2'.repeat(32),
  isPrimary: true,
  yesAmount: '10.000000',
  noAmount: 0,
  feePaid: '0.050000',
  blockTime: 1798761599,
  signature: '3'.repeat(88),
  quoteAsset: 'USDC',
};

test('activity retains reported decimals and sandbox notices without inferring dollar amounts', () => {
  const activity = parseMarketActivity({ marketId: id, items: [trade], disclaimer: 'Sandbox fixtures' }, id);
  assert.equal(activity.items[0].yesAmount, '10.000000');
  assert.equal(activity.items[0].feePaid, '0.050000');
  assert.equal(activity.items[0].noAmount, '0');
  assert.equal(activity.disclaimer, 'Sandbox fixtures');
  assert.equal(parseMarketActivity({ marketId: id, items: [] }, id).items.length, 0);
});

test('activity rejects cross-market rows, duplicate ids, unsafe amounts and malformed signatures', () => {
  for (const row of [
    { ...trade, marketId: '2'.repeat(32) },
    { ...trade, yesAmount: '-1' },
    { ...trade, feePaid: Infinity },
    { ...trade, signature: 'not-a-transaction' },
    { ...trade, isPrimary: 'true' },
  ])
    assert.throws(() => parseMarketActivity({ marketId: id, items: [row] }, id), CatalogError);
  assert.throws(() => parseMarketActivity({ marketId: id, items: [trade, trade] }, id), CatalogError);
  assert.throws(() => parseMarketActivity({ marketId: id, items: [trade] }, '2'.repeat(32)), CatalogError);
});

test('gateway activity route is read-only, strips extra fields and rejects unexpected filters', async () => {
  const key = 'pk_test_activity_fixture';
  let calls = 0;
  const server = createCatalogGateway(key, async () => {
    calls++;
    return new Response(JSON.stringify({ marketId: id, items: [{ ...trade, secret: key }], secret: key, disclaimer: 'Sandbox' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const data = await createCatalogClient(base).activity(id);
    assert.equal(data.items.length, 1);
    assert.equal(JSON.stringify(data).includes(key), false);
    for (const query of ['limit=201', 'limit=0', 'limit=20&limit=30', 'key=secret', 'cursor=not-supported']) {
      assert.equal((await fetch(`${base}/markets/${id}/trades/?${query}`)).status, 400);
    }
    assert.equal((await fetch(`${base}/markets/${id}/trades/`, { method: 'POST' })).status, 405);
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('market timing preserves absent data, timezone offsets and explicit resolution state', () => {
  const market = parseCatalogMarket({
    ...row,
    startTime: '2026-01-01T00:00:00Z',
    resolutionTime: '2027-01-01T05:30:00+05:30',
    region: 'Global',
    marketType: 'standard',
    resolved: false,
  });
  assert.equal(market.startTime, 1767225600);
  assert.equal(market.resolutionTime, 1798761600);
  assert.equal(market.resolved, false);
  assert.equal(parseCatalogMarket(row).resolved, null);
  for (const resolutionTime of ['tomorrow', '2027-02-31T00:00:00Z', '2027-01-01T24:00:00Z']) {
    assert.throws(() => parseCatalogMarket({ ...row, resolutionTime }), CatalogError);
  }
  assert.throws(() => parseCatalogMarket({ ...row, resolved: 'false' }), CatalogError);
});

test('live catalog entries with empty titles do not break a page or invent a question', () => {
  const page = parseCatalogPage({ items: [{ ...row, title: '' }], nextCursor: null });
  assert.equal(page.items[0].title, 'Untitled market');
  assert.equal(parseCatalogMarket({ ...row, title: '   ' }).title, 'Untitled market');
  assert.throws(() => parseCatalogMarket({ ...row, title: null }), CatalogError);
  assert.throws(() => parseCatalogMarket({ ...row, title: 123 }), CatalogError);
});
