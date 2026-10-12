import { createBaseStore } from '@storesjs/stores';

import { creationCategories, creationWireBytes } from '@/lib/panta-creation';

export type MarketDraft = {
  question: string;
  description: string;
  category: (typeof creationCategories)[number];
  imageUrl: string;
  resolutionRule: string;
  sources: string;
  startTime: string;
  endTime: string;
  resolutionTime: string;
};
export type DraftField = keyof MarketDraft;
export type DraftErrors = Partial<Record<DraftField, string>>;
export const emptyMarketDraft: MarketDraft = {
  question: '',
  description: '',
  category: 'other',
  imageUrl: '',
  resolutionRule: '',
  sources: '',
  startTime: '',
  endTime: '',
  resolutionTime: '',
};
// Working editor copy. Saved drafts live in draft-library; no account or authorization fields.
export const marketDraftStore = createBaseStore<{ draft: MarketDraft }>(() => ({ draft: { ...emptyMarketDraft } }));

export function draftTimestamp(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, min] = match.map(Number);
  const date = new Date(y, m - 1, d, h, min);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d || date.getHours() !== h || date.getMinutes() !== min)
    return null;
  return Math.floor(date.getTime() / 1000);
}
export function isPublicDraftUrl(value: string) {
  try {
    const url = new URL(value);
    // Local draft check only. Reachability and authoritative SSRF checks belong to Panta.
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.hostname.includes('.') &&
      !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) &&
      !/\.(local|localhost|internal)$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}
export function validateMarketDraft(draft: MarketDraft, now = Date.now()): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.question.trim() || draft.question.trim().length > 512)
    errors.question = 'Enter a clear YES / NO question, up to 512 characters.';
  if (draft.description.length > 4000) errors.description = 'Keep the description under 4,000 characters.';
  if (!creationCategories.includes(draft.category)) errors.category = 'Choose a supported category.';
  if (!draft.resolutionRule.trim() || draft.resolutionRule.trim().length > 2048)
    errors.resolutionRule = 'Describe exactly how YES or NO is decided, up to 2,048 characters.';
  if (draft.imageUrl.trim().length > 2048 || !isPublicDraftUrl(draft.imageUrl.trim()))
    errors.imageUrl = 'Enter a public image URL using https or http.';
  const sources = draft.sources
    .split('\n')
    .map(value => value.trim())
    .filter(Boolean);
  if (!sources.length || sources.length > 20 || sources.some(value => !isPublicDraftUrl(value)))
    errors.sources = 'Add 1–20 public source URLs, one per line.';
  if (creationWireBytes({ question: draft.question.trim(), resolutionRule: draft.resolutionRule.trim(), sourcesOfTruth: sources }) > 1232)
    errors.resolutionRule = 'Question, criteria and links exceed one transaction. Shorten them; move extra context into the description.';
  const start = draftTimestamp(draft.startTime),
    end = draftTimestamp(draft.endTime),
    resolution = draftTimestamp(draft.resolutionTime);
  if (start === null || start <= now / 1000) errors.startTime = 'Choose a future date and time for primary buying to end.';
  if (end === null || (start !== null && end <= start)) errors.endTime = 'Choose an event end after the primary phase ends.';
  if (resolution === null || (end !== null && resolution < end)) errors.resolutionTime = 'Choose resolution at or after event end.';
  return errors;
}

export function formatDraftDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function calendarMonth(year: number, month: number): (number | null)[] {
  const offset = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(offset).fill(null);
  for (let day = 1; day <= count; day++) cells.push(day);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function draftSources(value: string) {
  return value
    .split('\n')
    .map(source => source.trim())
    .filter(Boolean);
}
export function saveDraftSource(value: string, candidate: string, editing: number | null): { value: string; error?: string } {
  const sources = draftSources(value),
    link = candidate.trim();
  if (link.length > 2048 || !isPublicDraftUrl(link))
    return { value, error: 'Enter a public source link beginning with https:// or http://.' };
  if (editing !== null && (!Number.isInteger(editing) || editing < 0 || editing >= sources.length))
    return { value, error: 'This source changed. Select it again to edit.' };
  if (sources.some((source, index) => source === link && index !== editing))
    return { value, error: 'This link is already included. Add a different source.' };
  if (editing === null) {
    if (sources.length >= 20) return { value, error: 'You can add up to 20 sources.' };
    sources.push(link);
  } else sources[editing] = link;
  return { value: sources.join('\n') };
}
