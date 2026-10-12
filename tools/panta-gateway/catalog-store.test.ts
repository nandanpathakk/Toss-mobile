import assert from 'node:assert/strict';
import { test } from 'node:test';

import { catalogFilterKey, createCatalogStores } from '../../src/features/panta/catalog-store';
import { createCatalogClient } from '../../src/lib/panta-catalog';

const firstId = '11111111111111111111111111111111';
const secondId = '22222222222222222222222222222222';
const row = (marketId = firstId, category = 'crypto', yesPrice: string | null = null) => ({
  marketId,
  category,
  title: `${category} question`,
  description: '',
  images: [],
  phase: 'primary',
  volumeUsdc: '0.00',
  endTime: null,
  yesPrice,
  noPrice: null,
});
const reply = (items: unknown[], nextCursor: string | null = null) => new Response(JSON.stringify({ items, nextCursor }));

function fetchCurrent(stores: ReturnType<typeof createCatalogStores>) {
  const { category, status, cursor } = stores.catalogFilters.getState();
  return stores.catalogStore.getState().fetch({ category, status, cursor }, { force: true, updateQueryKey: true, throwOnError: true });
}

test('pagination preserves existing rows, updates overlaps, and refresh replaces old pages', async () => {
  const client = createCatalogClient('https://gateway.example', async input => {
    const cursor = new URL(String(input)).searchParams.get('cursor');
    return cursor ? reply([row(firstId, 'crypto', '0.60'), row(secondId)], null) : reply([row()], secondId);
  });
  const stores = createCatalogStores(client);
  await fetchCurrent(stores);
  assert.equal(stores.catalogStore.getState().items.length, 1);
  stores.loadMoreMarkets();
  await fetchCurrent(stores);
  assert.equal(stores.catalogStore.getState().items.length, 2);
  assert.equal(stores.catalogStore.getState().items[0].yesPrice, 0.6);
  assert.equal(stores.catalogStore.getState().nextCursor, null);
  stores.setCatalogFilters();
  await fetchCurrent(stores);
  assert.equal(stores.catalogStore.getState().items.length, 1);
  stores.catalogStore.getState().reset();
  stores.categoriesStore.getState().reset();
});

test('late responses from a previous category cannot replace the selected category', async () => {
  let resolveOld: ((value: Response) => void) | undefined;
  const client = createCatalogClient('https://gateway.example', async input => {
    const category = new URL(String(input)).searchParams.get('category');
    if (category === 'crypto')
      return new Promise<Response>(resolve => {
        resolveOld = resolve;
      });
    return reply([row(secondId, 'sports')]);
  });
  const stores = createCatalogStores(client);
  stores.setCatalogFilters('crypto');
  const old = fetchCurrent(stores).catch(() => null);
  stores.setCatalogFilters('sports');
  await fetchCurrent(stores);
  resolveOld?.(reply([row(firstId, 'crypto')]));
  await old;
  assert.equal(stores.catalogStore.getState().items[0].category, 'sports');
  assert.equal(stores.catalogStore.getState().filterKey, catalogFilterKey({ category: 'sports', status: undefined }));
  stores.catalogStore.getState().reset();
});

test('failed pagination keeps loaded data and rejects a looping cursor', async () => {
  const client = createCatalogClient('https://gateway.example', async input => {
    const cursor = new URL(String(input)).searchParams.get('cursor');
    return cursor ? reply([row(secondId)], secondId) : reply([row()], secondId);
  });
  const stores = createCatalogStores(client);
  await fetchCurrent(stores);
  stores.loadMoreMarkets();
  await assert.rejects(fetchCurrent(stores));
  assert.equal(stores.catalogStore.getState().items.length, 1);
  assert.equal(stores.catalogStore.getState().status, 'error');
  stores.catalogStore.getState().reset();
});

test('detail reads publish recovered public values for home cards and search', async () => {
  const client = createCatalogClient('https://gateway.example', async () => new Response(JSON.stringify(row(firstId, 'crypto', '0.61'))));
  const stores = createCatalogStores(client);
  const detail = stores.createMarketDetailStore(firstId);
  await detail.getState().fetch(undefined, { force: true, throwOnError: true });
  assert.equal(stores.marketDetails.getState().items[firstId].yesPrice, 0.61);
  assert.equal(stores.createMarketDetailStore(firstId), detail);
  detail.getState().reset();
});

test('repeated end-of-list events cannot advance the same pending cursor twice', async () => {
  const stores = createCatalogStores(createCatalogClient('https://gateway.example', async () => reply([row()], secondId)));
  await fetchCurrent(stores);
  stores.loadMoreMarkets();
  stores.loadMoreMarkets();
  assert.deepEqual(stores.catalogFilters.getState().visitedCursors, [secondId]);
  stores.catalogStore.getState().reset();
});

test('returning to a recent category restores its first page immediately', async () => {
  const stores = createCatalogStores(
    createCatalogClient('https://gateway.example', async input =>
      reply([row(firstId, new URL(String(input)).searchParams.get('category') || 'crypto')])
    )
  );
  stores.setCatalogFilters('sports');
  await fetchCurrent(stores);
  stores.setCatalogFilters('crypto');
  await fetchCurrent(stores);
  stores.setCatalogFilters('sports');
  assert.equal(stores.catalogStore.getState().items[0].category, 'sports');
  assert.equal(stores.catalogStore.getState().filterKey, catalogFilterKey({ category: 'sports', status: undefined }));
  stores.catalogStore.getState().reset();
});

test('opened market has reserved capacity while background detail requests are busy', async () => {
  const started: string[] = [];
  const release = new Map<string, () => void>();
  const client = createCatalogClient('https://gateway.example', async input => {
    const id = new URL(String(input)).pathname.split('/').filter(Boolean).at(-1)!;
    started.push(id);
    await new Promise<void>(resolve => release.set(id, resolve));
    return new Response(JSON.stringify(row(id)));
  });
  const stores = createCatalogStores(client);
  const ids = [firstId, secondId, '33333333333333333333333333333333', '44444444444444444444444444444444'];
  const reads = ids.map(id => stores.createMarketDetailStore(id).getState().fetch(undefined, { force: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(started, ids.slice(0, 2));
  stores.prioritizeMarketDetail(ids[3]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(started, [ids[0], ids[1], ids[3]]);
  for (const done of release.values()) done();
  await new Promise(resolve => setTimeout(resolve, 0));
  release.get(ids[2])?.();
  await Promise.all(reads);
  ids.forEach(id => stores.createMarketDetailStore(id).getState().reset());
});

test('partial detail cannot erase list prices or volume and their original observation time', async () => {
  const complete = { ...row(), yesPrice: '0.6', noPrice: '0.4', volumeUsdc: '25', priceObservedAt: 100000 };
  const stores = createCatalogStores(
    createCatalogClient('https://gateway.example', async input =>
      new URL(String(input)).pathname === '/markets/' ? reply([complete]) : new Response(JSON.stringify({ ...row(), volumeUsdc: null }))
    )
  );
  await fetchCurrent(stores);
  const detail = stores.createMarketDetailStore(firstId);
  await detail.getState().fetch(undefined, { force: true, throwOnError: true });
  const recovered = detail.getState().getData()!;
  assert.equal(recovered.yesPrice, 0.6);
  assert.equal(recovered.noPrice, 0.4);
  assert.equal(recovered.volumeUsdc, '25');
  assert.equal(recovered.priceObservedAt, 100000);
  detail.getState().reset();
  stores.catalogStore.getState().reset();
});

test('visible stale price refreshes are bounded and stop in the background', async () => {
  let calls = 0;
  const stores = createCatalogStores(
    createCatalogClient('https://gateway.example', async () => {
      calls++;
      return new Response(JSON.stringify(row(firstId, 'crypto', '0.6')));
    })
  );
  const market = { ...row(), yesPrice: 0.6, noPrice: 0.4 } as unknown as import('../../src/lib/panta-catalog').CatalogMarket;
  stores.refreshMarketPrices(market, 100000);
  await new Promise(resolve => setTimeout(resolve, 0));
  stores.refreshMarketPrices(market, 110000);
  assert.equal(calls, 1);
  stores.catalogFilters.setState({ foreground: false });
  stores.refreshMarketPrices(market, 120000);
  assert.equal(calls, 1);
  stores.catalogFilters.setState({ foreground: true });
  stores.refreshMarketPrices(market, 120000);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 2);
  stores.createMarketDetailStore(firstId).getState().reset();
});
