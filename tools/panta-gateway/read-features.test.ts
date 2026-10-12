import assert from 'node:assert/strict';
import { type AddressInfo } from 'node:net';
import { test } from 'node:test';

import { createMarketSearch, matchesMarket } from '../../src/features/panta/market-search-store';
import { CatalogError, createCatalogClient, parseCatalogMarket } from '../../src/lib/panta-catalog';
import { createPortfolioClient, parseWalletActivity, parseWalletPositions } from '../../src/lib/panta-portfolio';
import { createCatalogGateway } from './gateway';
import { createMarketEnrichment } from './market-enrichment';

const id = '11111111111111111111111111111111';
const other = 'So11111111111111111111111111111111111111112';
const raw = {
  marketId: id,
  title: '',
  question: 'Manchester United will win against Spurs with 2 or more goals',
  description: '',
  category: 'sports',
  phase: 'secondary',
  volumeUsdc: '11.00',
  totalVolumeUsdc: '16.00',
  images: [],
  yesPrice: '0.518009008',
  noPrice: '0.481990992',
  resolutionRule: 'United win by at least two goals',
  sources: ['https://www.espn.com', 'javascript:alert(1)', 'https://secret@example.com'],
  creatorAddress: other,
  createdAt: 1790833190,
  totalTrades: '2',
  isResolved: false,
  yesWins: false,
};
const holding = {
  marketId: id,
  category: 'sports',
  side: 'yes',
  shares: '26.610810',
  phase: 'secondary',
  claimable: false,
  claimed: false,
  outcome: null,
};
const trade = {
  id: 't1',
  marketId: id,
  wallet: other,
  isPrimary: true,
  yesAmount: '10.00',
  noAmount: '0',
  feePaid: '0.05',
  blockTime: 1790833190,
  signature: '1'.repeat(64),
  quoteAsset: 'USDC',
};

test('detail mapping preserves website total volume, active volume, exact spot price and public rules', () => {
  const market = parseCatalogMarket(raw);
  assert.equal(market.volumeUsdc, '16.00');
  assert.equal(market.activeVolumeUsdc, '11.00');
  assert.equal(market.title, raw.question);
  assert.equal(market.yesPrice, 0.518009008);
  assert.equal(market.resolutionRule, raw.resolutionRule);
  assert.deepEqual(market.sources, ['https://www.espn.com']);
  assert.equal(market.outcome, null);
  assert.equal(market.totalTrades, '2');
  assert.deepEqual(parseCatalogMarket(market), market);
  const resolved = parseCatalogMarket({ ...raw, isResolved: true, yesWins: false });
  assert.equal(resolved.phase, 'resolved');
  assert.equal(resolved.outcome, 'no');
  assert.throws(() => parseCatalogMarket({ ...raw, totalVolumeUsdc: 'NaN' }), CatalogError);
});
test('cached detail recovers catalog values without blocking discovery; detail reads are deduplicated', async () => {
  let calls = 0;
  const enrich = createMarketEnrichment(async () => {
    calls++;
    return raw;
  });
  const page = { items: [{ ...raw, question: undefined, yesPrice: null, noPrice: null }], nextCursor: null };
  await Promise.all([enrich.detail(id), enrich.detail(id)]);
  const [a, b] = [enrich.page(page), enrich.page(page)];
  assert.equal(a.items[0].title, raw.question);
  assert.equal(b.items[0].yesPrice, 0.518009008);
  assert.equal(calls, 1);
  await enrich.page(page);
  assert.equal(calls, 1);
  const bad = createMarketEnrichment(async () => ({ ...raw, marketId: other }));
  await assert.rejects(bad.detail(id), CatalogError);
  assert.equal(bad.page(page).items[0].title, 'Untitled market');
});
test('search finds words, descriptions, creator and address on later pages with explicit completion', async () => {
  const market = parseCatalogMarket(raw);
  assert.equal(matchesMarket(market, 'UNITED goals'), true);
  assert.equal(matchesMarket(market, 'United cricket'), false);
  assert.equal(matchesMarket(market, id), true);
  let calls = 0;
  const search = createMarketSearch({
    markets: async filters => {
      calls++;
      return filters?.cursor
        ? { items: [market], nextCursor: null, disclaimer: null }
        : { items: [], nextCursor: 'next', disclaimer: null };
    },
  });
  await search.search({});
  assert.equal(search.useStore.getState().status, 'complete');
  assert.equal(search.useStore.getState().items[0].title, raw.question);
  await search.search({});
  assert.equal(calls, 2);
});
test('cancelled searches ignore late results and cursor loops preserve partial results with an error', async () => {
  let resolve!: (value: { items: ReturnType<typeof parseCatalogMarket>[]; nextCursor: null; disclaimer: null }) => void;
  const search = createMarketSearch({
    markets: () =>
      new Promise(done => {
        resolve = done;
      }),
  });
  const pending = search.search({});
  search.cancel();
  resolve({ items: [parseCatalogMarket(raw)], nextCursor: null, disclaimer: null });
  await pending;
  assert.equal(search.useStore.getState().items.length, 0);
  const loop = createMarketSearch({ markets: async () => ({ items: [parseCatalogMarket(raw)], nextCursor: 'same', disclaimer: null }) });
  await loop.search({});
  assert.equal(loop.useStore.getState().status, 'error');
  assert.equal(loop.useStore.getState().items.length, 1);
});
test('positions permit both outcomes, retain exact shares and reject cross-wallet or repeated sides', () => {
  const data = { wallet: other, positions: [holding, { ...holding, side: 'no' }] };
  const positions = parseWalletPositions(data, other);
  assert.equal(positions.positions.length, 2);
  assert.equal(positions.positions[0].shares, '26.610810');
  assert.throws(() => parseWalletPositions(data, id), CatalogError);
  assert.throws(() => parseWalletPositions({ wallet: other, positions: [holding, holding] }, other), CatalogError);
  assert.throws(() => parseWalletPositions({ wallet: other, positions: [{ ...holding, shares: '1e9' }] }, other), CatalogError);
});
test('wallet history excludes private fields and validates every row against requested wallet', () => {
  const data = parseWalletActivity({ wallet: other, items: [{ ...trade, secret: 'private' }] }, other);
  assert.equal(data.items[0].yesAmount, '10.00');
  assert.equal('secret' in data.items[0], false);
  assert.throws(() => parseWalletActivity({ wallet: other, items: [{ ...trade, wallet: id }] }, other), CatalogError);
});
test('gateway exposes only public wallet read routes and binds responses; account analytics stay private', async () => {
  const key = 'pk_test_local_fixture';
  const server = createCatalogGateway(
    key,
    async input =>
      new Response(
        JSON.stringify(
          String(input).includes('/positions/')
            ? { wallet: other, positions: [holding], secret: key }
            : { wallet: other, items: [trade], secret: key }
        )
      )
  );
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const client = createPortfolioClient(base);
    assert.equal((await client.positions(other)).positions.length, 1);
    assert.equal((await client.activity(other)).items.length, 1);
    for (const path of ['/account/dashboard/', '/account/metrics/']) assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await fetch(base + '/positions/?wallet=' + other + '&wallet=' + id)).status, 400);
    assert.equal((await fetch(base + '/positions/?wallet=bad')).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});

test('reduced live detail retains missing amounts and enrichment preserves reported catalog volume', async () => {
  const reduced = {
    ...raw,
    title: 'Short catalog title',
    question: null,
    volumeUsdc: null,
    totalVolumeUsdc: null,
    yesPrice: null,
    noPrice: null,
  };
  assert.equal(parseCatalogMarket(reduced).volumeUsdc, null);
  const enrich = createMarketEnrichment(async () => reduced);
  const result = await enrich.page({ items: [raw], nextCursor: null });
  assert.equal(result.items[0].volumeUsdc, '16.00');
  assert.equal(result.items[0].activeVolumeUsdc, '11.00');
  assert.equal(result.items[0].yesPrice, 0.518009008);
});

test('catalog returns immediately and shares complete catalog snapshots with details', async () => {
  let calls = 0;
  const enrich = createMarketEnrichment(async () => {
    calls++;
    return raw;
  });
  const full = parseCatalogMarket(raw);
  const result = await enrich.page({ items: [full], nextCursor: null });
  assert.equal(calls, 0);
  assert.deepEqual({ ...result.items[0], priceObservedAt: null }, full);
  const incomplete = await enrich.page({ items: [{ ...full, yesPrice: null, noPrice: null }], nextCursor: null });
  assert.equal(calls, 0);
  assert.equal(incomplete.items[0].yesPrice, full.yesPrice);
  await enrich.detail(id);
  const recovered = enrich.page({ items: [{ ...full, yesPrice: null, noPrice: null }], nextCursor: null });
  assert.equal(calls, 1);
  assert.equal(recovered.items[0].yesPrice, full.yesPrice);
});

test('search binds results to the selected scope and explicit refresh bypasses cached completion', async () => {
  let calls = 0;
  const search = createMarketSearch({
    markets: async () => {
      calls++;
      return { items: [parseCatalogMarket(raw)], nextCursor: null, disclaimer: null };
    },
  });
  await search.search({ category: 'sports' });
  assert.equal(search.useStore.getState().scopeKey, JSON.stringify({ category: 'sports' }));
  await search.search({ category: 'sports' });
  assert.equal(calls, 1);
  await search.search({ category: 'sports' }, true);
  assert.equal(calls, 2);
  await search.search({ category: 'crypto' });
  assert.equal(search.useStore.getState().scopeKey, JSON.stringify({ category: 'crypto' }));
});

test('search reuses completed partial coverage across scopes without repeating the scan', async () => {
  let calls = 0;
  const search = createMarketSearch({
    markets: async () => {
      calls++;
      return { items: [parseCatalogMarket({ ...raw, title: '', question: null })], nextCursor: null, disclaimer: null };
    },
  });
  await search.search({ category: 'sports' });
  await search.search({ category: 'crypto' });
  await search.search({ category: 'sports' });
  assert.equal(calls, 2);
  assert.equal(search.useStore.getState().status, 'partial');
  assert.equal(search.useStore.getState().partialReason, 'metadata');
  await search.search({ category: 'sports' }, true);
  assert.equal(calls, 3);
});

test('live gateway catalog responds without any detail RPC and reuses explicit detail cache', async () => {
  let detailCalls = 0;
  const incomplete = { ...raw, question: null, yesPrice: null, noPrice: null };
  const server = createCatalogGateway('pk_live_fixture', async input => {
    if (new URL(String(input)).pathname.endsWith(`/${id}/`)) {
      detailCalls++;
      return new Response(JSON.stringify(raw));
    }
    return new Response(JSON.stringify({ items: [incomplete], nextCursor: null }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = createCatalogClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  try {
    assert.equal((await client.markets()).items[0].yesPrice, null);
    assert.equal(detailCalls, 0);
    await client.market(id);
    await client.market(id);
    assert.equal(detailCalls, 1);
    assert.equal((await client.markets()).items[0].yesPrice, 0.518009008);
    await client.market(id, undefined, true);
    assert.equal(detailCalls, 2);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const query of ['?fresh=0', '?fresh=1&fresh=1', '?fresh=1&other=1'])
      assert.equal((await fetch(`${base}/markets/${id}/${query}`)).status, 404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('complete catalog snapshot serves detail immediately while one background read is pending', async () => {
  let clock = 100000;
  let calls = 0;
  let release!: (value: unknown) => void;
  const enrich = createMarketEnrichment(
    () => {
      calls++;
      return new Promise(resolve => {
        release = resolve;
      });
    },
    () => clock
  );
  const listed = enrich.page({ items: [raw], nextCursor: null }).items[0];
  const detail = await enrich.detail(id);
  assert.equal(detail.yesPrice, listed.yesPrice);
  assert.equal(detail.volumeUsdc, listed.volumeUsdc);
  assert.equal(detail.priceObservedAt, 100000);
  await enrich.detail(id);
  assert.equal(calls, 1);
  clock += 1000;
  release({ ...raw, yesPrice: '0.6', noPrice: '0.4' });
  await new Promise(resolve => setTimeout(resolve, 0));
  const refreshed = await enrich.detail(id);
  assert.equal(refreshed.yesPrice, 0.6);
  assert.equal(refreshed.priceObservedAt, clock);
  assert.equal(calls, 1);
});

test('reduced snapshots preserve prices and their age; expiry and phase change remove them', async () => {
  let clock = 100000;
  const reduced = { ...raw, yesPrice: null, noPrice: null, totalVolumeUsdc: null, volumeUsdc: null };
  const enrich = createMarketEnrichment(
    async () => reduced,
    () => clock
  );
  enrich.page({ items: [raw], nextCursor: null });
  clock += 31000;
  await enrich.detail(id);
  await new Promise(resolve => setTimeout(resolve, 0));
  const retained = enrich.page({ items: [reduced], nextCursor: null }).items[0];
  assert.equal(retained.yesPrice, Number(raw.yesPrice));
  assert.equal(retained.volumeUsdc, raw.totalVolumeUsdc);
  assert.equal(retained.priceObservedAt, 100000);
  const activeOnly = enrich.page({ items: [{ ...reduced, volumeUsdc: '0' }], nextCursor: null }).items[0];
  assert.equal(activeOnly.volumeUsdc, raw.totalVolumeUsdc);
  assert.equal(activeOnly.activeVolumeUsdc, '0');
  clock = 220000;
  assert.equal(enrich.page({ items: [reduced], nextCursor: null }).items[0].yesPrice, null);
  enrich.page({ items: [raw], nextCursor: null });
  const changed = enrich.page({ items: [{ ...reduced, phase: 'resolved', isResolved: true }], nextCursor: null }).items[0];
  assert.equal(changed.yesPrice, null);
  assert.equal(changed.priceObservedAt, null);
});

test('unavailable cold detail has bounded cooldown and zero prices stay usable', async () => {
  let clock = 100000;
  let calls = 0;
  const enrich = createMarketEnrichment(
    async () => {
      calls++;
      throw new CatalogError('UNAVAILABLE');
    },
    () => clock
  );
  await assert.rejects(enrich.detail(id), CatalogError);
  await assert.rejects(enrich.detail(id), CatalogError);
  assert.equal(calls, 1);
  clock += 5000;
  await assert.rejects(enrich.detail(id), CatalogError);
  assert.equal(calls, 2);
  enrich.page({ items: [{ ...raw, yesPrice: 0, noPrice: 0, totalVolumeUsdc: '0' }], nextCursor: null });
  const zero = await enrich.detail(id);
  assert.equal(zero.yesPrice, 0);
  assert.equal(zero.volumeUsdc, '0');
  assert.throws(() => parseCatalogMarket({ ...raw, priceObservedAt: -1 }), CatalogError);
});

test('fresh detail waits for the deduplicated new observation and local freshness never reaches upstream', async () => {
  let clock = 100000;
  let release!: (value: unknown) => void;
  let calls = 0;
  const enrich = createMarketEnrichment(
    () => {
      calls++;
      return new Promise(resolve => {
        release = resolve;
      });
    },
    () => clock
  );
  enrich.page({ items: [raw], nextCursor: null });
  let settled = false;
  const first = enrich.detail(id, true).then(value => {
    settled = true;
    return value;
  });
  const second = enrich.detail(id, true);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(calls, 1);
  clock += 1000;
  release({ ...raw, yesPrice: '0.6', noPrice: '0.4' });
  assert.equal((await first).priceObservedAt, clock);
  assert.equal((await second).yesPrice, 0.6);
  const server = createCatalogGateway('pk_test_fixture', async input => {
    assert.equal(new URL(String(input)).search, '');
    return new Response(JSON.stringify(raw));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = createCatalogClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    assert.equal((await client.market(id, undefined, true)).marketId, id);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
