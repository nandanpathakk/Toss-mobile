import { createBaseStore, createQueryStore } from '@storesjs/stores';

import { AccountVerificationError } from '@/lib/panta-account-verification';
import { P2PError, type P2PBook, type P2PBuild, type P2PRequest } from '@/lib/panta-p2p';
import { type createP2PClient } from '@/lib/panta-p2p-client';

export function createP2POrderStore(client: ReturnType<typeof createP2PClient> | null, marketId: string, wallet: string) {
  const useBook = createQueryStore<P2PBook>({
    fetcher: async (_, abort) => {
      if (!client) throw new Error('P2P unavailable');
      return client.book(marketId, wallet, abort?.signal ?? new AbortController().signal);
    },
    staleTime: 10000,
    disableAutoRefetching: true,
    retry: false,
  });
  const useBuild = createBaseStore<{ build: P2PBuild | null; busy: boolean; error: string | null }>(() => ({
    build: null,
    busy: false,
    error: null,
  }));
  let generation = 0;
  let flight: AbortController | null = null;
  function invalidate() {
    generation++;
    flight?.abort();
    flight = null;
    useBuild.setState({ build: null, busy: false, error: null });
  }
  return {
    useBook,
    useBuild,
    invalidate,
    build: async (request: P2PRequest, credentials: () => Promise<{ access: string; identity: string }>) => {
      if (!client || useBuild.getState().busy) return;
      invalidate();
      const version = generation;
      const controller = new AbortController();
      flight = controller;
      useBuild.setState({ busy: true });
      try {
        const tokens = await credentials();
        if (version !== generation || controller.signal.aborted) return;
        const build = await client.build(request, tokens.access, tokens.identity, controller.signal);
        if (version === generation && !controller.signal.aborted) useBuild.setState({ build, busy: false, error: null });
      } catch (error) {
        if (version === generation && !controller.signal.aborted)
          useBuild.setState({
            build: null,
            busy: false,
            error:
              error instanceof P2PError || error instanceof AccountVerificationError ? error.message : 'This order could not be reviewed.',
          });
      } finally {
        if (version === generation) flight = null;
      }
    },
  };
}
