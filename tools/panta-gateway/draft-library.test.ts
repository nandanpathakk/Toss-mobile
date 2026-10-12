import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDraftLibrary, createDraftStorage, parseLocalDraft } from '../../src/features/panta/draft-library';
import { draftSources, emptyMarketDraft, saveDraftSource } from '../../src/features/panta/market-draft';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function storage() {
  const items = new Map<string, string>();
  let generation = 100,
    fail = false;
  const io = {
    read: async (key: string) => items.get(key) ?? null,
    write: async (key: string, value: string) => {
      if (fail && key === 'index') throw new Error('disk');
      assert.ok(Buffer.byteLength(value, 'utf8') <= 2048);
      items.set(key, value);
    },
    remove: async (key: string) => {
      items.delete(key);
    },
  };
  const make = () =>
    createDraftStorage(
      io,
      'index',
      (gen, chunk) => `${gen}.${chunk}`,
      () => id(generation++)
    );
  return {
    items,
    make,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
test('source composer appends distinct second and third links; editing never replaces another source', () => {
  let value = '';
  for (const source of ['https://example.org/first', 'https://example.org/second', 'https://official.example/results']) {
    const next = saveDraftSource(value, source, null);
    assert.equal(next.error, undefined);
    value = next.value;
  }
  assert.equal(draftSources(value).length, 3);
  const edited = saveDraftSource(value, 'https://example.org/new-second', 1);
  assert.deepEqual(draftSources(edited.value), [
    'https://example.org/first',
    'https://example.org/new-second',
    'https://official.example/results',
  ]);
  assert.ok(saveDraftSource(value, 'https://example.org/first', null).error);
  assert.ok(saveDraftSource(value, 'https://example.org/new', 3).error);
  assert.ok(
    saveDraftSource(Array.from({ length: 20 }, (_, n) => `https://example.org/${n}`).join('\n'), 'https://example.org/overflow', null).error
  );
});
test('multiple incomplete drafts survive a library restart, edits and confirmed removal remain separate', async () => {
  const disk = storage();
  let next = 1,
    clock = 100;
  const library = createDraftLibrary(
    disk.make(),
    () => id(next++),
    () => clock++
  );
  await library.load();
  const first = await library.save({ ...emptyMarketDraft, question: 'First event' }, null);
  const second = await library.save({ ...emptyMarketDraft, question: 'Second event' }, null);
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first, second);
  await library.save({ ...emptyMarketDraft, question: 'Edited first' }, first);
  const reopened = createDraftLibrary(
    disk.make(),
    () => id(next++),
    () => clock++
  );
  await reopened.load();
  assert.deepEqual(
    reopened.useStore.getState().records.map(record => record.draft.question),
    ['Edited first', 'Second event']
  );
  await reopened.remove(first);
  const again = createDraftLibrary(disk.make(), () => id(next++));
  await again.load();
  assert.deepEqual(
    again.useStore.getState().records.map(record => record.id),
    [second]
  );
});
test('failed save keeps the old committed draft and working input; retry commits Unicode without splitting characters', async () => {
  const disk = storage();
  const library = createDraftLibrary(
    disk.make(),
    () => id(1),
    () => 100
  );
  await library.load();
  const first = await library.save({ ...emptyMarketDraft, question: 'Original' }, null);
  disk.fail(true);
  const draft = { ...emptyMarketDraft, question: 'New 🚀 event', description: '界🚀'.repeat(1000) };
  assert.equal(await library.save(draft, first), null);
  assert.equal(library.useStore.getState().records[0].draft.question, 'Original');
  assert.equal(draft.question, 'New 🚀 event');
  assert.ok(library.useStore.getState().error);
  const reload = createDraftLibrary(disk.make(), () => id(2));
  await reload.load();
  assert.equal(reload.useStore.getState().records[0].draft.question, 'Original');
  disk.fail(false);
  await library.save(draft, first);
  const success = createDraftLibrary(disk.make(), () => id(3));
  await success.load();
  assert.equal(success.useStore.getState().records[0].draft.description, draft.description);
  assert.equal(success.useStore.getState().records[0].draft.question, draft.question);
});
test('draft records strip extra fields; a damaged library fails without enabling overwrite', async () => {
  const parsed = parseLocalDraft({ id: id(1), updatedAt: 100, draft: { ...emptyMarketDraft, secret: 'excluded' }, session: 'excluded' });
  assert.equal('secret' in parsed.draft, false);
  assert.equal('session' in parsed, false);
  const disk = storage();
  disk.items.set('index', 'not json');
  const library = createDraftLibrary(disk.make(), () => id(1));
  await library.load();
  assert.equal(library.useStore.getState().status, 'idle');
  assert.ok(library.useStore.getState().error);
  assert.equal(await library.save({ ...emptyMarketDraft, question: 'Keep safe' }, null), null);
  assert.equal(disk.items.get('index'), 'not json');
});
