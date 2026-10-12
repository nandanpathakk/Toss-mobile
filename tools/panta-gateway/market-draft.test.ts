import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  calendarMonth,
  draftTimestamp,
  formatDraftDate,
  validateMarketDraft,
  type MarketDraft,
} from '../../src/features/panta/market-draft';
import { mergeMarketSnapshot, parseCatalogMarket } from '../../src/lib/panta-catalog';

const draft: MarketDraft = {
  question: 'Will the event take place?',
  category: 'world',
  description: '',
  imageUrl: 'https://example.com/image.png',
  resolutionRule: 'YES if the official source confirms the event before the deadline; otherwise NO.',
  sources: 'https://example.com/result',
  startTime: '2030-01-01 12:00',
  endTime: '2030-01-02 12:00',
  resolutionTime: '2030-01-02 13:00',
};
test('standard draft validates required fields, source counts and ordered local dates', () => {
  assert.deepEqual(validateMarketDraft(draft, 0), {});
  assert.ok(validateMarketDraft({ ...draft, question: ' ', endTime: draft.startTime }, 0).question);
  assert.ok(validateMarketDraft({ ...draft, endTime: draft.startTime }, 0).endTime);
  assert.ok(validateMarketDraft({ ...draft, resolutionTime: draft.startTime }, 0).resolutionTime);
  assert.ok(validateMarketDraft({ ...draft, sources: Array(21).fill('https://example.com').join('\n') }, 0).sources);
  assert.ok(validateMarketDraft({ ...draft, imageUrl: 'http://127.0.0.1/image' }, 0).imageUrl);
  assert.ok(validateMarketDraft({ ...draft, imageUrl: 'https://user:password@example.com/image' }, 0).imageUrl);
  assert.equal(draftTimestamp('2030-02-30 12:00'), null);
  assert.equal(draftTimestamp('2030-01-01 25:00'), null);
});
test('partial details retain list values without carrying prices to a new phase', () => {
  const previous = parseCatalogMarket({
    marketId: '11111111111111111111111111111111',
    title: 'Known question',
    category: 'world',
    phase: 'primary',
    images: ['https://example.com/image.png'],
    yesPrice: '0.64',
    noPrice: '0.36',
    description: 'Known context',
    volumeUsdc: '123.45',
  });
  const reduced = { ...previous, title: 'Untitled market', images: [], description: '', yesPrice: null, noPrice: null, volumeUsdc: null };
  const merged = mergeMarketSnapshot(previous, reduced);
  assert.equal(merged.yesPrice, 0.64);
  assert.equal(merged.title, previous.title);
  assert.deepEqual(merged.images, previous.images);
  assert.equal(mergeMarketSnapshot(previous, { ...reduced, phase: 'resolved' }).yesPrice, null);
  assert.equal(mergeMarketSnapshot(previous, { ...reduced, yesPrice: 0 }).yesPrice, 0);
});

test('calendar handles leap years and month boundaries; date selections round-trip local minutes', () => {
  const leap = calendarMonth(2028, 1);
  assert.equal(leap.filter(value => value !== null).length, 29);
  assert.equal(calendarMonth(2027, 1).filter(value => value !== null).length, 28);
  assert.equal(calendarMonth(2030, 11).filter(value => value !== null).length, 31);
  assert.equal(leap.length % 7, 0);
  const date = new Date(2030, 11, 31, 23, 59, 0, 0);
  assert.equal(draftTimestamp(formatDraftDate(date)), date.getTime() / 1000);
  assert.ok(validateMarketDraft({ ...draft, description: 'a'.repeat(4001) }, 0).description);
});
