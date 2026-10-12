import { createBaseStore } from '@storesjs/stores';

import { AccountVerificationError } from '@/lib/panta-account-verification';
import { CreationError, type CreationBuild, type CreationQuote, type CreationRequest } from '@/lib/panta-creation';
import { type createCreationClient } from '@/lib/panta-creation-client';

type Credentials = () => Promise<{ access: string; identity: string }>;
export function createCreationFlowStore(client: ReturnType<typeof createCreationClient> | null) {
  const useStore = createBaseStore<{ busy: boolean; quote: CreationQuote | null; build: CreationBuild | null; error: string | null }>(
    () => ({ busy: false, quote: null, build: null, error: null })
  );
  let generation = 0;
  let controller: AbortController | null = null;
  function invalidate() {
    generation++;
    controller?.abort();
    controller = null;
    useStore.setState({ busy: false, quote: null, build: null, error: null });
  }
  return {
    useStore,
    invalidate,
    review: async (request: CreationRequest, credentials: Credentials) => {
      if (useStore.getState().busy) return;
      invalidate();
      const current = generation;
      controller = new AbortController();
      const signal = controller.signal;
      useStore.setState({ busy: true });
      try {
        if (!client) throw new CreationError('CREATION_UNAVAILABLE');
        const auth = await credentials();
        if (current !== generation) return;
        const quote = await client.quote(request, auth.access, auth.identity, signal);
        if (current !== generation) return;
        useStore.setState({ quote });
        const fresh = await credentials();
        if (current !== generation) return;
        const build = await client.build(request, quote.createId, fresh.access, fresh.identity, signal);
        if (current !== generation) return;
        useStore.setState({ build });
      } catch (error) {
        if (current === generation)
          useStore.setState({
            error:
              error instanceof CreationError || error instanceof AccountVerificationError
                ? error.message
                : 'Creation costs could not be checked. Your draft is still here.',
          });
      } finally {
        if (current === generation) useStore.setState({ busy: false });
      }
    },
  };
}
