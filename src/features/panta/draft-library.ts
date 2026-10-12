import { createBaseStore } from '@storesjs/stores';

import { creationCategories } from '@/lib/panta-creation';

import { emptyMarketDraft, type MarketDraft } from './market-draft';

export type LocalMarketDraft = { id: string; updatedAt: number; draft: MarketDraft };
export type DraftLibraryStorage = { load: () => Promise<LocalMarketDraft[]>; save: (records: LocalMarketDraft[]) => Promise<void> };
export function parseLocalDraft(value: unknown): LocalMarketDraft {
  if (!value || typeof value !== 'object') throw new Error('Invalid draft');
  const record = value as LocalMarketDraft;
  if (!/^[a-f0-9-]{36}$/.test(record.id) || !Number.isSafeInteger(record.updatedAt) || record.updatedAt <= 0 || !record.draft)
    throw new Error('Invalid draft');
  const draft = { ...emptyMarketDraft };
  for (const key of Object.keys(draft) as (keyof MarketDraft)[]) {
    const field = record.draft[key];
    if (
      typeof field !== 'string' ||
      field.length >
        (key === 'sources' ? 41000 : key === 'description' ? 4000 : key === 'question' ? 512 : key.endsWith('Time') ? 16 : 2048)
    )
      throw new Error('Invalid draft');
    Object.assign(draft, { [key]: field });
  }
  if (!creationCategories.includes(draft.category)) throw new Error('Invalid draft category');
  return { id: record.id, updatedAt: record.updatedAt, draft };
}
export function hasDraftContent(draft: MarketDraft) {
  return Object.keys(emptyMarketDraft).some(key => draft[key as keyof MarketDraft] !== emptyMarketDraft[key as keyof MarketDraft]);
}
export function createDraftLibrary(storage: DraftLibraryStorage, makeId: () => string, now = Date.now) {
  const useStore = createBaseStore<{
    records: LocalMarketDraft[];
    status: 'idle' | 'loading' | 'ready';
    busy: boolean;
    error: string | null;
  }>(() => ({ records: [], status: 'idle', busy: false, error: null }));
  let loading: Promise<void> | undefined;
  async function load() {
    if (useStore.getState().status === 'ready') return;
    if (loading) return loading;
    useStore.setState({ status: 'loading', error: null });
    loading = (async () => {
      try {
        const records = (await storage.load()).map(parseLocalDraft);
        if (records.length > 20 || new Set(records.map(record => record.id)).size !== records.length)
          throw new Error('Invalid draft library');
        useStore.setState({ records: records.sort((a, b) => b.updatedAt - a.updatedAt), status: 'ready' });
      } catch {
        useStore.setState({ status: 'idle', error: 'Local drafts could not be loaded. Try again before editing.' });
      } finally {
        loading = undefined;
      }
    })();
    return loading;
  }
  async function save(draft: MarketDraft, id: string | null): Promise<string | null> {
    const state = useStore.getState();
    if (state.busy || state.status !== 'ready') return null;
    if (!id && !hasDraftContent(draft)) return null;
    if (!id && state.records.length >= 20) {
      useStore.setState({ error: 'You have 20 drafts. Remove a draft before adding another.' });
      return null;
    }
    if (id && !state.records.some(record => record.id === id)) {
      useStore.setState({ error: 'This draft is no longer available.' });
      return null;
    }
    useStore.setState({ busy: true, error: null });
    try {
      const record = parseLocalDraft({ id: id ?? makeId(), updatedAt: now(), draft });
      const records = [record, ...state.records.filter(item => item.id !== record.id)];
      await storage.save(records);
      useStore.setState({ records });
      return record.id;
    } catch {
      useStore.setState({ error: 'Draft could not be saved. Your edits are still open. Try saving again.' });
      return null;
    } finally {
      useStore.setState({ busy: false });
    }
  }
  async function remove(id: string) {
    const state = useStore.getState();
    if (state.busy || state.status !== 'ready') return;
    useStore.setState({ busy: true, error: null });
    const records = state.records.filter(record => record.id !== id);
    try {
      await storage.save(records);
      useStore.setState({ records });
    } catch {
      useStore.setState({ error: 'Draft could not be removed. Try again.' });
    } finally {
      useStore.setState({ busy: false });
    }
  }
  return { useStore, load, save, remove };
}

/** Immutable generations: write bounded chunks first, then commit the small index. */
export function createDraftStorage(
  io: {
    read: (key: string) => Promise<string | null>;
    write: (key: string, value: string) => Promise<void>;
    remove: (key: string) => Promise<void>;
  },
  indexKey: string,
  chunkKey: (generation: string, chunk: number) => string,
  makeId: () => string
): DraftLibraryStorage {
  type Ref = [string, string, number];
  let refs: Ref[] = [];
  const chunksFor = (ref: Ref) => Array.from({ length: ref[2] }, (_, i) => chunkKey(ref[1], i));
  return {
    async load() {
      const stored = await io.read(indexKey);
      if (stored === null) {
        refs = [];
        return [];
      }
      if (stored.length > 2000) throw new Error('Invalid index');
      const parsed: unknown = JSON.parse(stored);
      if (!Array.isArray(parsed) || parsed.length > 20) throw new Error('Invalid index');
      const next: Ref[] = parsed.map(ref => {
        if (
          !Array.isArray(ref) ||
          ref.length !== 3 ||
          !/^[a-f0-9-]{36}$/.test(ref[0]) ||
          !/^[a-f0-9-]{36}$/.test(ref[1]) ||
          !Number.isInteger(ref[2]) ||
          ref[2] < 1 ||
          ref[2] > 120
        )
          throw new Error('Invalid index');
        return ref as Ref;
      });
      const records: LocalMarketDraft[] = [];
      for (const ref of next) {
        let text = '';
        for (const key of chunksFor(ref)) {
          const part = await io.read(key);
          if (part === null || Array.from(part).length > 500) throw new Error('Missing draft');
          text += part;
        }
        const record = parseLocalDraft(JSON.parse(text));
        if (record.id !== ref[0]) throw new Error('Invalid draft');
        records.push(record);
      }
      refs = next;
      return records;
    },
    async save(records) {
      if (records.length > 20) throw new Error('Too many drafts');
      const next: Ref[] = [],
        written: string[] = [];
      try {
        for (const raw of records) {
          const record = parseLocalDraft(raw),
            text = JSON.stringify(record);
          if (text.length > 60000) throw new Error('Draft too large');
          // Reuse an unchanged record rather than writing every draft on each save.
          const previous = refs.find(ref => ref[0] === record.id);
          if (previous) {
            let prior = '';
            for (const key of chunksFor(previous)) prior += (await io.read(key)) ?? '';
            if (prior === text) {
              next.push(previous);
              continue;
            }
          }
          const characters = Array.from(text);
          const ref: Ref = [record.id, makeId(), Math.ceil(characters.length / 500)];
          for (let i = 0; i < ref[2]; i++) {
            const key = chunkKey(ref[1], i);
            written.push(key);
            await io.write(key, characters.slice(i * 500, (i + 1) * 500).join(''));
          }
          next.push(ref);
        }
        await io.write(indexKey, JSON.stringify(next));
      } catch (error) {
        await Promise.allSettled(written.map(key => io.remove(key)));
        throw error;
      }
      const previous = refs;
      refs = next;
      await Promise.allSettled(
        previous
          .filter(ref => !next.some(item => item[1] === ref[1]))
          .flatMap(chunksFor)
          .map(key => io.remove(key))
      );
    },
  };
}
