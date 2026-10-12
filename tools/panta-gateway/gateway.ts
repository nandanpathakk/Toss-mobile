import { createServer } from 'node:http';

import { AccountVerificationError } from '../../src/lib/panta-account-verification';
import { CatalogError, parseCatalogMarket, parseCatalogPage, parseCategories, parseMarketActivity } from '../../src/lib/panta-catalog';
import { creationCheck, CreationError, type CreationBuild } from '../../src/lib/panta-creation';
import { parseBuildRequest, parseOrderBuild, type BuildRequest, type OrderBuild } from '../../src/lib/panta-order-build';
import { OrderError, parseOrderQuote, parseOrderRequest, type OrderQuote, type OrderRequest } from '../../src/lib/panta-orders';
import { p2pCheck, P2PError, parseP2PRequest, type P2PBuild } from '../../src/lib/panta-p2p';
import { isWalletAddress, parseWalletActivity, parseWalletPositions } from '../../src/lib/panta-portfolio';
import { PurchaseError } from '../../src/lib/panta-purchase';
import { createCreationService } from './creation-service';
import { createMarketEnrichment } from './market-enrichment';
import { createP2PBookReader, createP2PRpc, type P2PRpc } from './p2p-chain';
import { createP2POrders } from './p2p-orders';
import { createPrimaryPreflight } from './primary-preflight';
import { createPrimaryPurchases } from './primary-purchase';
import { createPrivyOwnershipVerifier } from './privy-ownership';
import { createPurchaseTransport } from './purchase-transport';
import { createWalletBalanceReader } from './wallet-balances';

const upstream = 'https://live-api.panta.market/api/v1';
const responseLimit = 1024 * 1024;

async function readBounded(result: Response, limit: number): Promise<string> {
  if (!result.body) throw new Error('Missing response');
  const reader = result.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Response too large');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await reader.cancel();
  }
}

/** Local development only. Never expose this server on a public interface. */
export function createCatalogGateway(
  apiKey: string,
  fetcher: typeof fetch = fetch,
  preflight = createPrimaryPreflight(),
  balances = createWalletBalanceReader(),
  ownership = createPrivyOwnershipVerifier(),
  injectedPurchases?: ReturnType<typeof createPrimaryPurchases>,
  p2pRpc: P2PRpc = createP2PRpc()
) {
  if (!/^pk_(test|live)_[A-Za-z0-9_-]+$/.test(apiKey)) throw new Error('A valid server-side Panta API key is required');
  const pendingWallets = new Map<string, { signature: string; orderId: string; messageHash: string }>();
  const transport = createPurchaseTransport(apiKey, fetcher);
  const purchases = injectedPurchases ?? createPrimaryPurchases(preflight, transport, Date.now, pendingWallets);
  const p2pBooks = createP2PBookReader(p2pRpc);
  const creation = createCreationService(apiKey, fetcher, p2pRpc);
  const creationPurchases = createPrimaryPurchases(
    build => creation.preflight(build as CreationBuild),
    { ...transport, register: async () => {} },
    Date.now,
    pendingWallets
  );
  const p2pOrders = createP2POrders(p2pRpc);
  const p2pPurchases = createPrimaryPurchases(
    build => p2pOrders.preflight(build as P2PBuild),
    { ...transport, register: async () => {} },
    Date.now,
    pendingWallets
  );
  let detailBackoffUntil = 0;
  const enrichment = createMarketEnrichment(async path => {
    if (Date.now() < detailBackoffUntil) throw new CatalogError('RATE_LIMITED', Math.ceil((detailBackoffUntil - Date.now()) / 1000));
    const result = await fetcher(`${upstream}${path}`, {
      headers: { 'Accept': 'application/json', 'X-Api-Key': apiKey, 'User-Agent': 'PantaMobileCatalog/0.1' },
      redirect: 'error',
      signal: AbortSignal.timeout(7000),
    });
    if (!result.ok) {
      if (result.status === 429) {
        const seconds = Number(result.headers.get('Retry-After'));
        detailBackoffUntil = Date.now() + (Number.isInteger(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 60) * 1000;
      }
      await result.body?.cancel();
      throw new CatalogError(
        result.status === 429 ? 'RATE_LIMITED' : result.status === 401 || result.status === 403 ? 'ACCESS_REQUIRED' : 'UNAVAILABLE',
        result.status === 429 ? Math.ceil((detailBackoffUntil - Date.now()) / 1000) : null
      );
    }
    return JSON.parse(await readBounded(result, responseLimit));
  });
  const quotes = new Map<
    string,
    { quote: OrderQuote; deadline: number; attempted: boolean; build?: OrderBuild; preflightBusy?: boolean }
  >();
  let windowStart = Date.now();
  let requests = 0;
  let inFlight = 0;
  return createServer(async (request, response) => {
    const send = (status: number, value: unknown, retryAfter?: string) => {
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(retryAfter ? { 'Retry-After': retryAfter } : {}),
      });
      response.end(JSON.stringify(value));
    };
    // Restrict browser-origin requests and DNS rebinding against a localhost service.
    const port = (response.socket?.localAddress && response.socket.localPort) || 8787;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host ?? '') || request.headers.origin) {
      send(403, { code: 'FORBIDDEN' });
      return;
    }
    if (
      request.method !== 'GET' &&
      !(
        request.method === 'POST' &&
        [
          '/creation/image-upload/',
          '/creation/quote/',
          '/creation/build/',
          '/creation/register/',
          '/creation/purchases/prepare/',
          '/creation/purchases/send/',
          '/creation/purchases/receipt/',
          '/p2p/build/',
          '/p2p/purchases/prepare/',
          '/p2p/purchases/send/',
          '/p2p/purchases/receipt/',
          '/primaryorderquote/',
          '/primaryorderbuild/',
          '/primaryorderpreflight/',
          '/account/wallet/verify/',
          '/purchases/prepare/',
          '/purchases/send/',
          '/purchases/receipt/',
        ].includes(request.url ?? '')
      )
    ) {
      send(405, { code: 'READ_ONLY' });
      return;
    }
    const url = new URL(request.url ?? '/', 'http://localhost');
    let parse: (value: unknown) => unknown;
    if (request.method === 'POST') parse = value => value;
    else if (
      /^\/wallets\/[1-9A-HJ-NP-Za-km-z]{32,44}\/balances\/$/.test(url.pathname) &&
      !url.search &&
      isWalletAddress(url.pathname.split('/')[2])
    )
      parse = value => value;
    else if (
      /^\/markets\/[1-9A-HJ-NP-Za-km-z]{32,44}\/orderbook\/$/.test(url.pathname) &&
      [...url.searchParams.keys()].length === 1 &&
      url.searchParams.getAll('wallet').length === 1 &&
      isWalletAddress(url.searchParams.get('wallet') ?? '')
    )
      parse = value => value;
    else if (url.pathname === '/positions/') {
      const wallet = url.searchParams.get('wallet');
      if (
        !wallet ||
        !isWalletAddress(wallet) ||
        url.searchParams.getAll('wallet').length !== 1 ||
        [...url.searchParams.keys()].some(key => key !== 'wallet')
      ) {
        send(400, { code: 'INVALID_FILTERS' });
        return;
      }
      parse = value => parseWalletPositions(value, wallet);
    } else if (/^\/wallets\/[1-9A-HJ-NP-Za-km-z]{32,44}\/trades\/$/.test(url.pathname)) {
      const wallet = url.pathname.split('/')[2];
      const limit = url.searchParams.get('limit');
      if (
        !isWalletAddress(wallet) ||
        [...url.searchParams.keys()].some(key => key !== 'limit') ||
        url.searchParams.getAll('limit').length > 1 ||
        (limit !== null && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 200))
      ) {
        send(400, { code: 'INVALID_FILTERS' });
        return;
      }
      parse = value => parseWalletActivity(value, wallet);
    } else if (url.pathname === '/categories/' && !url.search) parse = parseCategories;
    else if (url.pathname === '/markets/') {
      const allowed = new Set(['category', 'status', 'cursor', 'limit']);
      const invalid = [...url.searchParams].some(
        ([key, value]) => !allowed.has(key) || value.length > 256 || url.searchParams.getAll(key).length !== 1
      );
      const limit = url.searchParams.get('limit');
      const phase = url.searchParams.get('status');
      const category = url.searchParams.get('category');
      if (
        invalid ||
        (limit !== null && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 50)) ||
        (phase !== null && !['primary', 'secondary', 'resolved', 'cancelled'].includes(phase)) ||
        (category !== null && !/^[a-z0-9_-]{1,64}$/.test(category))
      ) {
        send(400, { code: 'INVALID_FILTERS' });
        return;
      }
      parse = parseCatalogPage;
    } else if (/^\/markets\/[1-9A-HJ-NP-Za-km-z]{32,44}\/trades\/$/.test(url.pathname)) {
      const limit = url.searchParams.get('limit');
      if (
        [...url.searchParams.keys()].some(key => key !== 'limit') ||
        url.searchParams.getAll('limit').length > 1 ||
        (limit !== null && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 200))
      ) {
        send(400, { code: 'INVALID_FILTERS' });
        return;
      }
      const marketId = url.pathname.split('/')[2];
      parse = value => parseMarketActivity(value, marketId);
    } else if (/^\/markets\/[1-9A-HJ-NP-Za-km-z]{32,44}\/$/.test(url.pathname) && (!url.search || url.search === '?fresh=1'))
      parse = parseCatalogMarket;
    else {
      send(404, { code: 'NOT_FOUND' });
      return;
    }
    if (Date.now() - windowStart >= 60000) {
      windowStart = Date.now();
      requests = 0;
    }
    if (++requests > 30 || inFlight >= 4) {
      send(429, { code: 'RATE_LIMITED' }, '60');
      return;
    }
    inFlight++;
    let order: OrderRequest | BuildRequest | undefined;
    try {
      if (request.method === 'GET' && url.pathname.endsWith('/orderbook/')) {
        send(200, await p2pBooks(url.pathname.split('/')[2], url.searchParams.get('wallet')!));
        return;
      }
      if (request.method === 'GET' && url.pathname.endsWith('/balances/')) {
        send(200, await balances(url.pathname.split('/')[2]));
        return;
      }
      if (request.method === 'POST') {
        const bodyLimit = url.pathname === '/creation/quote/' ? 24576 : url.pathname.endsWith('/purchases/send/') ? 4096 : 2048;
        if (request.headers['content-type'] !== 'application/json' || Number(request.headers['content-length'] ?? 0) > bodyLimit) {
          send(400, { code: 'INVALID_REQUEST' });
          request.resume();
          return;
        }
        const body = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          let size = 0;
          const timer = setTimeout(() => {
            reject(new OrderError('INVALID_REQUEST'));
            request.destroy();
          }, 5000);
          request.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > bodyLimit) {
              clearTimeout(timer);
              reject(new OrderError('INVALID_REQUEST'));
              request.destroy();
            } else chunks.push(chunk);
          });
          request.on('end', () => {
            clearTimeout(timer);
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
          request.on('error', () => {
            clearTimeout(timer);
            reject(new OrderError('INVALID_REQUEST'));
          });
        });
        let bodyValue: unknown;
        try {
          bodyValue = JSON.parse(body);
        } catch {
          throw new OrderError('INVALID_REQUEST');
        }
        if (url.pathname.startsWith('/creation/')) {
          const row = bodyValue as Record<string, unknown>;
          creationCheck(
            row && typeof row === 'object' && !Array.isArray(row) && typeof row.wallet === 'string' && isWalletAddress(row.wallet)
          );
          const token = request.headers['privy-id-token'];
          const identity = await ownership(row.wallet, request.headers.authorization, typeof token === 'string' ? token : undefined);
          if (url.pathname === '/creation/image-upload/') {
            creationCheck(Object.keys(row).join(',') === 'wallet');
            send(200, await creation.upload(identity));
          } else if (url.pathname === '/creation/quote/') {
            if (pendingWallets.has(row.wallet)) throw new PurchaseError('PURCHASE_PENDING');
            send(200, await creation.quote(bodyValue, identity));
          } else if (url.pathname === '/creation/build/') {
            creationCheck(Object.keys(row).sort().join(',') === 'createId,wallet' && typeof row.createId === 'string');
            send(200, await creation.build(row.createId, identity));
          } else if (url.pathname === '/creation/purchases/prepare/') {
            creationCheck(Object.keys(row).sort().join(',') === 'orderId,wallet' && typeof row.orderId === 'string');
            send(200, await creationPurchases.prepare(creation.get(row.orderId, identity), identity));
          } else if (url.pathname === '/creation/purchases/send/') send(200, await creationPurchases.send(bodyValue, identity));
          else if (url.pathname === '/creation/purchases/receipt/') send(200, await creationPurchases.receipt(bodyValue, identity));
          else {
            creationCheck(typeof row.orderId === 'string' && row.orderId.startsWith('cr_'));
            const receipt = await creationPurchases.receipt(bodyValue, identity);
            creationCheck(receipt.status === 'confirmed', 'CREATION_BLOCKED');
            send(200, await creation.register(receipt));
          }
          return;
        }
        if (url.pathname.startsWith('/p2p/')) {
          const row = bodyValue as Record<string, unknown>;
          p2pCheck(row && typeof row === 'object' && !Array.isArray(row) && typeof row.wallet === 'string' && isWalletAddress(row.wallet));
          const token = request.headers['privy-id-token'];
          const identity = await ownership(row.wallet, request.headers.authorization, typeof token === 'string' ? token : undefined);
          if (url.pathname === '/p2p/build/') {
            if (pendingWallets.has(row.wallet)) throw new PurchaseError('PURCHASE_PENDING');
            send(200, await p2pOrders.build(parseP2PRequest(bodyValue)));
          } else if (url.pathname === '/p2p/purchases/prepare/') {
            p2pCheck(Object.keys(row).sort().join(',') === 'orderId,wallet' && typeof row.orderId === 'string');
            send(200, await p2pPurchases.prepare(p2pOrders.get(row.orderId, row.wallet), identity));
          } else if (url.pathname === '/p2p/purchases/send/') send(200, await p2pPurchases.send(bodyValue, identity));
          else send(200, await p2pPurchases.receipt(bodyValue, identity));
          return;
        }
        if (url.pathname === '/account/wallet/verify/') {
          const row = bodyValue as Record<string, unknown>;
          if (
            !row ||
            typeof row !== 'object' ||
            Array.isArray(row) ||
            Object.keys(row).length !== 1 ||
            typeof row.wallet !== 'string' ||
            !isWalletAddress(row.wallet)
          )
            throw new OrderError('INVALID_REQUEST');
          const identity = request.headers['privy-id-token'];
          const verified = await ownership(row.wallet, request.headers.authorization, typeof identity === 'string' ? identity : undefined);
          send(200, { wallet: verified.wallet, verified: true, expiresAt: verified.expiresAt });
          return;
        }
        if (url.pathname.startsWith('/purchases/')) {
          const row = bodyValue as Record<string, unknown>;
          if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.wallet !== 'string' || !isWalletAddress(row.wallet))
            throw new OrderError('INVALID_REQUEST');
          const token = request.headers['privy-id-token'];
          const identity = await ownership(row.wallet, request.headers.authorization, typeof token === 'string' ? token : undefined);
          if (url.pathname === '/purchases/prepare/') {
            if (Object.keys(row).sort().join(',') !== 'orderId,wallet' || typeof row.orderId !== 'string')
              throw new OrderError('INVALID_REQUEST');
            const session = [...quotes.values()].find(entry => entry.build?.orderId === row.orderId && entry.build?.wallet === row.wallet);
            if (!session?.build || session.deadline <= Date.now()) throw new OrderError('EXPIRED');
            send(200, await purchases.prepare(session.build, identity));
          } else if (url.pathname === '/purchases/send/') send(200, await purchases.send(bodyValue, identity));
          else send(200, await purchases.receipt(bodyValue, identity));
          return;
        }
        for (const [id, entry] of quotes) if (entry.deadline <= Date.now()) quotes.delete(id);
        if (url.pathname === '/primaryorderpreflight/') {
          const row = bodyValue as Record<string, unknown>;
          if (
            !row ||
            typeof row !== 'object' ||
            Array.isArray(row) ||
            Object.keys(row).some(k => !['orderId', 'wallet'].includes(k)) ||
            typeof row.orderId !== 'string' ||
            !/^[A-Za-z0-9_-]{1,256}$/.test(row.orderId) ||
            typeof row.wallet !== 'string' ||
            !isWalletAddress(row.wallet)
          )
            throw new OrderError('INVALID_REQUEST');
          const session = [...quotes.values()].find(entry => entry.build?.orderId === row.orderId && entry.build?.wallet === row.wallet);
          if (!session?.build || session.deadline <= Date.now() || Date.parse(session.build.expiresAt) <= Date.now())
            throw new OrderError('EXPIRED');
          if (session.preflightBusy) {
            send(429, { code: 'RATE_LIMITED' }, '1');
            return;
          }
          session.preflightBusy = true;
          try {
            send(200, await preflight(session.build));
          } finally {
            session.preflightBusy = false;
          }
          return;
        }
        if (url.pathname === '/primaryorderquote/') {
          try {
            order = parseOrderRequest(bodyValue);
          } catch {
            throw new OrderError('INVALID_REQUEST');
          }
          const input = order;
          parse = value => {
            const quote = parseOrderQuote(value, input);
            if (quotes.has(quote.quoteId)) throw new OrderError('INVALID_RESPONSE');
            if (quotes.size >= 100) quotes.delete(quotes.keys().next().value!);
            quotes.set(quote.quoteId, { quote, deadline: Math.min(Date.parse(quote.expiresAt), Date.now() + 120000), attempted: false });
            return quote;
          };
        } else {
          order = parseBuildRequest(bodyValue);
          const input = order;
          const session = quotes.get(input.quoteId);
          if (!session || session.quote.wallet !== input.wallet) throw new OrderError('EXPIRED');
          if (session.attempted) throw new OrderError('BUILD_RESTART');
          // Mark before fetching. A timeout must never silently create another order session.
          session.attempted = true;
          parse = value => {
            const build = parseOrderBuild(value, session.quote, input);
            session.build = build;
            return build;
          };
        }
      }
      if (request.method === 'GET' && apiKey.startsWith('pk_live_') && /^\/markets\/[1-9A-HJ-NP-Za-km-z]{32,44}\/$/.test(url.pathname)) {
        send(200, await enrichment.detail(url.pathname.split('/')[2], url.searchParams.get('fresh') === '1'));
        return;
      }
      const result = await fetcher(`${upstream}${url.pathname}${parse === parseCatalogMarket ? '' : url.search}`, {
        method: order ? 'POST' : 'GET',
        ...(order ? { body: JSON.stringify(order) } : {}),
        headers: {
          ...(order ? { 'Content-Type': 'application/json' } : {}),
          'Accept': 'application/json',
          'X-Api-Key': apiKey,
          'User-Agent': 'PantaMobileCatalog/0.1',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) {
        // Only permit documented quote error codes; never forward diagnostic strings.
        if (order && [400, 404, 409, 422].includes(result.status)) {
          const raw = await readBounded(result, 16384);
          let code = 'UNAVAILABLE';
          if (raw.length <= 16384) {
            try {
              const value = JSON.parse(raw);
              if (
                ['AMOUNT_TOO_SMALL', 'INVALID_MARKET_PARAMS', 'MARKET_NOT_FOUND', 'MARKET_NOT_IN_PRIMARY', 'QUOTE_STALE'].includes(
                  value?.code
                )
              )
                code = value.code;
              if (value?.code === 'QUOTE_EXPIRED') code = 'EXPIRED';
            } catch {
              /* Do not expose diagnostics. */
            }
          }
          send(400, { code });
          return;
        }
        // Never return an upstream error body, which may contain sensitive diagnostics.
        const status = result.status === 429 ? 429 : result.status === 401 || result.status === 403 ? 401 : 502;
        const retry = Number(result.headers.get('Retry-After'));
        const delay = Number.isInteger(retry) && retry > 0 ? Math.min(retry, 3600) : 60;
        send(
          status,
          { code: status === 429 ? 'RATE_LIMITED' : status === 401 ? 'ACCESS_REQUIRED' : 'UNAVAILABLE' },
          status === 429 ? String(delay) : undefined
        );
        await result.body?.cancel();
        return;
      }
      // Only validated fields leave the local gateway. Quote payloads have a tighter cap.
      const value = JSON.parse(await readBounded(result, order ? 16384 : responseLimit));
      send(200, url.pathname === '/markets/' && apiKey.startsWith('pk_live_') ? enrichment.page(value) : parse(value));
    } catch (error) {
      if (error instanceof CreationError && !response.destroyed) {
        send(error.code === 'CREATION_UNAVAILABLE' ? 503 : 400, {
          code: error.code,
          ...(error.code === 'CREATION_START_TOO_SOON' ? { minimumStartTime: error.minimumStartTime } : {}),
        });
        return;
      }
      if (error instanceof P2PError && !response.destroyed) {
        send(error.code === 'INVALID_P2P' ? 400 : 409, { code: error.code });
        return;
      }
      if (error instanceof PurchaseError && !response.destroyed) {
        send(error.code === 'PURCHASE_UNAVAILABLE' ? 503 : 400, { code: error.code });
        return;
      }
      if (error instanceof AccountVerificationError && !response.destroyed) {
        send(error.code === 'ACCOUNT_UNAVAILABLE' ? 503 : 401, { code: error.code });
        return;
      }
      if (error instanceof CatalogError && !response.destroyed) {
        send(
          error.code === 'RATE_LIMITED' ? 429 : error.code === 'ACCESS_REQUIRED' ? 401 : 502,
          { code: error.code },
          error.code === 'RATE_LIMITED' ? String(error.retryAfterSeconds ?? 60) : undefined
        );
        return;
      }
      if (!response.destroyed)
        send(error instanceof OrderError && ['INVALID_REQUEST', 'EXPIRED', 'BUILD_RESTART'].includes(error.code) ? 400 : 502, {
          code: error instanceof OrderError ? error.code : 'UNAVAILABLE',
        });
    } finally {
      inFlight--;
    }
  });
}
