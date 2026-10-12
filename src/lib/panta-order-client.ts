import { parseBuildRequest, parseOrderBuild, type BuildRequest, type OrderBuild } from './panta-order-build';
import { parsePreflightReport, type PreflightReport } from './panta-order-preflight';
import { OrderError, orderErrorMessages, parseOrderQuote, parseOrderRequest, type OrderQuote, type OrderRequest } from './panta-orders';

export function createOrderClient(baseUrl: string, fetcher: typeof fetch = fetch) {
  const url = new URL(baseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
  )
    throw new OrderError('INVALID_REQUEST');
  const base = baseUrl.replace(/\/$/, '');
  async function post(path: string, request: unknown, signal?: AbortSignal, timeoutMs = 12000): Promise<unknown> {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener('abort', cancel);
    if (signal?.aborted) cancel();
    const timeout = setTimeout(cancel, timeoutMs);
    try {
      const response = await fetcher(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(request),
        signal: abort.signal,
        redirect: 'error',
      });
      const raw = await response.text();
      if (raw.length > 16384) throw new OrderError('INVALID_RESPONSE');
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new OrderError('INVALID_RESPONSE');
      }
      if (!response.ok) {
        const code = data && typeof data === 'object' && 'code' in data ? String(data.code) : '';
        const seconds = Number(response.headers.get('Retry-After'));
        throw new OrderError(
          Object.hasOwn(orderErrorMessages, code) ? (code as keyof typeof orderErrorMessages) : 'UNAVAILABLE',
          response.status === 429 ? (Number.isInteger(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 60) : 0
        );
      }
      return data;
    } catch (error) {
      if (error instanceof OrderError) throw error;
      throw new OrderError('UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    }
  }
  return {
    async quote(input: OrderRequest, signal?: AbortSignal): Promise<OrderQuote> {
      const request = parseOrderRequest(input);
      return parseOrderQuote(await post('/primaryorderquote/', request, signal), request);
    },
    async preflight(build: OrderBuild, signal?: AbortSignal): Promise<PreflightReport> {
      if (Date.parse(build.expiresAt) <= Date.now()) throw new OrderError('EXPIRED');
      return parsePreflightReport(
        await post('/primaryorderpreflight/', { orderId: build.orderId, wallet: build.wallet }, signal, 22000),
        build
      );
    },
    async build(input: BuildRequest, quote: OrderQuote, signal?: AbortSignal): Promise<OrderBuild> {
      const request = parseBuildRequest(input);
      if (request.quoteId !== quote.quoteId || request.wallet !== quote.wallet || Date.parse(quote.expiresAt) <= Date.now())
        throw new OrderError('EXPIRED');
      return parseOrderBuild(await post('/primaryorderbuild/', request, signal), quote, request);
    },
  };
}
