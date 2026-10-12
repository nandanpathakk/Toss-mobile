import { createBaseStore } from '@storesjs/stores';

import { type BuildRequest, type OrderBuild } from '@/lib/panta-order-build';
import { type PreflightReport } from '@/lib/panta-order-preflight';
import { OrderError, type OrderQuote, type OrderRequest } from '@/lib/panta-orders';

// Every sheet owns its request generation. Never cache or retry quote session creation.
export function createOrderStore(
  fetchQuote: (request: OrderRequest, signal: AbortSignal) => Promise<OrderQuote>,
  fetchBuild?: (request: BuildRequest, quote: OrderQuote, signal: AbortSignal) => Promise<OrderBuild>,
  fetchPreflight?: (build: OrderBuild, signal: AbortSignal) => Promise<PreflightReport>
) {
  const useStore = createBaseStore<{
    status: 'idle' | 'loading' | 'ready' | 'building' | 'built' | 'simulating' | 'simulated' | 'build-error' | 'error';
    quote: OrderQuote | null;
    build: OrderBuild | null;
    simulation: PreflightReport | null;
    error: OrderError | null;
    retryAt: number;
  }>(() => ({ status: 'idle', quote: null, build: null, simulation: null, error: null, retryAt: 0 }));
  let generation = 0;
  let pending: AbortController | null = null;
  function invalidate() {
    generation++;
    pending?.abort();
    pending = null;
    // Preserve rate-limit cooldown across edits so it cannot be bypassed by changing amount.
    useStore.setState({ status: 'idle', quote: null, build: null, simulation: null, error: null });
  }
  async function requestQuote(request: OrderRequest) {
    if (['loading', 'building', 'simulating'].includes(useStore.getState().status) || Date.now() < useStore.getState().retryAt) return;
    invalidate();
    const version = generation;
    const abort = new AbortController();
    pending = abort;
    useStore.setState({ status: 'loading' });
    try {
      const quote = await fetchQuote(request, abort.signal);
      if (version === generation && !abort.signal.aborted) {
        useStore.setState({ status: 'ready', quote });
        return version;
      }
    } catch (error) {
      if (version === generation && !abort.signal.aborted) {
        const safe = error instanceof OrderError ? error : new OrderError('UNAVAILABLE');
        useStore.setState({ status: 'error', error: safe, retryAt: Date.now() + safe.retryAfterSeconds * 1000 });
      }
    } finally {
      if (version === generation) pending = null;
    }
  }
  async function prepareBuild(maxSlippageBps: number) {
    const state = useStore.getState();
    if (!fetchBuild || state.status !== 'ready' || !state.quote || Date.now() < state.retryAt) return;
    const quote = state.quote;
    if (Date.parse(quote.expiresAt) <= Date.now()) {
      useStore.setState({ status: 'build-error', error: new OrderError('EXPIRED') });
      return;
    }
    const version = generation;
    const abort = new AbortController();
    pending = abort;
    useStore.setState({ status: 'building', error: null });
    try {
      const build = await fetchBuild({ quoteId: quote.quoteId, wallet: quote.wallet, maxSlippageBps }, quote, abort.signal);
      if (version === generation && !abort.signal.aborted) useStore.setState({ status: 'built', build });
    } catch (error) {
      if (version === generation && !abort.signal.aborted) {
        const safe = error instanceof OrderError ? error : new OrderError('UNAVAILABLE');
        useStore.setState({
          status: 'build-error',
          build: null,
          simulation: null,
          error: safe,
          retryAt: Date.now() + safe.retryAfterSeconds * 1000,
        });
      }
    } finally {
      if (version === generation) pending = null;
    }
  }
  async function simulate() {
    const state = useStore.getState();
    if (!fetchPreflight || !state.build || !['built', 'simulated'].includes(state.status) || Date.now() < state.retryAt) return;
    if (Date.parse(state.build.expiresAt) <= Date.now()) {
      useStore.setState({ error: new OrderError('EXPIRED') });
      return;
    }
    const version = generation;
    const abort = new AbortController();
    pending = abort;
    useStore.setState({ status: 'simulating', simulation: null, error: null });
    try {
      const simulation = await fetchPreflight(state.build, abort.signal);
      if (version === generation && !abort.signal.aborted) useStore.setState({ status: 'simulated', simulation });
    } catch (error) {
      if (version === generation && !abort.signal.aborted) {
        const safe = error instanceof OrderError ? error : new OrderError('UNAVAILABLE');
        useStore.setState({ status: 'built', error: safe, retryAt: Date.now() + safe.retryAfterSeconds * 1000 });
      }
    } finally {
      if (version === generation) pending = null;
    }
  }
  async function review(request: OrderRequest, maxSlippageBps: number) {
    const version = await requestQuote(request);
    // A duplicate tap, failed quote or an edited/unmounted sheet must not build
    // whichever newer quote happens to be in the store when this await settles.
    if (version !== undefined && version === generation) await prepareBuild(maxSlippageBps);
  }
  return { useStore, invalidate, requestQuote, prepareBuild, simulate, review };
}
