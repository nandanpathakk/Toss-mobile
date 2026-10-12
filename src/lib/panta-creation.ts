import { type OrderBuild } from './panta-order-build';
import { isWalletAddress } from './panta-portfolio';
import { type PurchaseCost } from './panta-purchase';

export const creationCategories = ['sports', 'crypto', 'politics', 'entertainment', 'finance', 'science', 'world', 'other'] as const;
export type CreationRequest = {
  wallet: string;
  question: string;
  description: string;
  category: (typeof creationCategories)[number];
  imageUrl: string;
  resolutionRule: string;
  sourcesOfTruth: string[];
  startTime: number;
  endTime: number;
  resolutionTime: number;
  marketType: 'standard';
};
export type CreationQuote = {
  createId: string;
  expectedEventPda: string;
  paymentUsdc: string;
  liquidityInjectionUsdc: string;
  platformRevenueUsdc: string;
  marketType: 'standard';
  expiresAt: string;
};
export type CreationBuild = OrderBuild & {
  creation: { request: CreationRequest; quote: CreationQuote; cost: PurchaseCost; snapshotHash: string };
};
export const creationMessages = {
  INVALID_CREATION: 'Check the question, dates, image and sources before continuing.',
  CREATION_TOO_LARGE:
    'The question, criteria and source links are too long for one transaction. Shorten them; use the description for extra context.',
  CREATE_NOT_PERMITTED: 'Market creation is not enabled for this service account. Your draft is still available.',
  DUPLICATE_MARKET: 'This wallet already has a market with that exact question. Edit the question or open the existing market.',
  INVALID_MARKET_PARAMS: 'Panta could not accept these details. Check the timeline, public image and resolution sources.',
  CREATE_EXPIRED: 'This creation review expired or changed. Check costs again before publishing.',
  CREATION_START_TOO_SOON: 'Primary buying ends too soon. Choose a later time to meet the network’s minimum lead time.',
  CREATION_BLOCKED: 'The creation transaction or its full cost could not be verified. Check your USDC and SOL balances.',
  CREATION_UNAVAILABLE: 'Creation is temporarily unavailable. Your draft is still here; nothing is published automatically.',
  UPLOAD_NOT_CONFIGURED: 'Photo upload is not configured by Panta. You can use a public image link instead.',
  UPLOAD_FAILED: 'The image could not be uploaded. Choose it again or use a public image link.',
} as const;
export class CreationError extends Error {
  constructor(
    public readonly code: keyof typeof creationMessages,
    public readonly minimumStartTime?: number
  ) {
    super(
      code === 'CREATION_START_TOO_SOON' && Number.isSafeInteger(minimumStartTime) && minimumStartTime! > 0
        ? `Primary buying must end after ${new Date(minimumStartTime! * 1000).toLocaleString()}. Choose a later time.`
        : creationMessages[code]
    );
  }
}
export function creationCheck(ok: unknown, code: keyof typeof creationMessages = 'INVALID_CREATION'): asserts ok {
  if (!ok) throw new CreationError(code);
}
export function publicCreationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value.length <= 2048 &&
      ['http:', 'https:'].includes(url.protocol) &&
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
export function utf8Length(value: string) {
  let bytes = 0;
  for (const char of value) {
    const point = char.codePointAt(0)!;
    bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
  }
  return bytes;
}
// One reviewed create_event_usdc instruction, 16 distinct static keys, one signer.
// Extra instructions are deliberately unsupported and cannot sneak past this budget.
export function creationWireBytes(input: Pick<CreationRequest, 'question' | 'resolutionRule' | 'sourcesOfTruth'>) {
  const payload =
    52 + utf8Length(input.question) + utf8Length(input.resolutionRule) + input.sourcesOfTruth.reduce((n, s) => n + 4 + utf8Length(s), 0);
  return 634 + payload + Number(payload >= 128);
}
export function parseCreationRequest(value: unknown, now = Date.now()): CreationRequest {
  const row = value as CreationRequest;
  creationCheck(row && typeof row === 'object' && !Array.isArray(row));
  creationCheck(
    Object.keys(row).sort().join(',') ===
      'category,description,endTime,imageUrl,marketType,question,resolutionRule,resolutionTime,sourcesOfTruth,startTime,wallet'
  );
  creationCheck(isWalletAddress(row.wallet) && row.marketType === 'standard' && creationCategories.includes(row.category));
  for (const [name, max] of [
    ['question', 512],
    ['resolutionRule', 2048],
    ['description', 4000],
  ] as const)
    creationCheck(
      typeof row[name] === 'string' &&
        row[name] === row[name].trim() &&
        row[name].length <= max &&
        (name === 'description' || row[name].length > 0)
    );
  creationCheck(typeof row.imageUrl === 'string' && publicCreationUrl(row.imageUrl));
  creationCheck(
    Array.isArray(row.sourcesOfTruth) &&
      row.sourcesOfTruth.length >= 1 &&
      row.sourcesOfTruth.length <= 20 &&
      new Set(row.sourcesOfTruth).size === row.sourcesOfTruth.length
  );
  for (const source of row.sourcesOfTruth) creationCheck(typeof source === 'string' && publicCreationUrl(source));
  creationCheck([row.startTime, row.endTime, row.resolutionTime].every(n => Number.isSafeInteger(n) && n > 0));
  creationCheck(row.startTime > now / 1000 && row.startTime < row.endTime && row.endTime <= row.resolutionTime);
  creationCheck(creationWireBytes(row) <= 1232, 'CREATION_TOO_LARGE');
  return { ...row, sourcesOfTruth: [...row.sourcesOfTruth] };
}
export function parseCreationQuote(value: unknown, now = Date.now()): CreationQuote {
  const row = value as CreationQuote;
  creationCheck(row && typeof row === 'object' && /^cr_[A-Za-z0-9_-]{1,220}$/.test(row.createId) && isWalletAddress(row.expectedEventPda));
  for (const field of ['paymentUsdc', 'liquidityInjectionUsdc', 'platformRevenueUsdc'] as const)
    creationCheck(typeof row[field] === 'string' && /^(0|[1-9]\d{0,19})$/.test(row[field]) && BigInt(row[field]) <= 18446744073709551615n);
  creationCheck(
    BigInt(row.paymentUsdc) > 0n && BigInt(row.paymentUsdc) === BigInt(row.liquidityInjectionUsdc) + BigInt(row.platformRevenueUsdc)
  );
  creationCheck(
    row.marketType === 'standard' &&
      typeof row.expiresAt === 'string' &&
      Date.parse(row.expiresAt) > now &&
      Date.parse(row.expiresAt) <= now + 330000
  );
  return {
    createId: row.createId,
    expectedEventPda: row.expectedEventPda,
    paymentUsdc: row.paymentUsdc,
    liquidityInjectionUsdc: row.liquidityInjectionUsdc,
    platformRevenueUsdc: row.platformRevenueUsdc,
    marketType: 'standard',
    expiresAt: row.expiresAt,
  };
}
export type ImageUploadTicket = { uploadUrl: string; publicId: string; expiresAt: string; fields: Record<string, string | number> };
export function parseImageUploadTicket(value: unknown, now = Date.now()): ImageUploadTicket {
  const row = value as ImageUploadTicket;
  creationCheck(row && /^https:\/\/api\.cloudinary\.com\/v1_1\/[a-z0-9_-]+\/image\/upload$/.test(row.uploadUrl), 'UPLOAD_FAILED');
  creationCheck(typeof row.publicId === 'string' && /^[A-Za-z0-9/_-]{1,256}$/.test(row.publicId), 'UPLOAD_FAILED');
  creationCheck(Date.parse(row.expiresAt) > now && Date.parse(row.expiresAt) <= now + 330000, 'UPLOAD_FAILED');
  creationCheck(row.fields && typeof row.fields === 'object' && !Array.isArray(row.fields), 'UPLOAD_FAILED');
  const allowed = ['api_key', 'timestamp', 'signature', 'upload_preset', 'folder', 'public_id', 'overwrite'];
  creationCheck(Object.keys(row.fields).length >= 5 && Object.keys(row.fields).every(k => allowed.includes(k)), 'UPLOAD_FAILED');
  for (const value of Object.values(row.fields))
    creationCheck(
      (typeof value === 'string' && value.length <= 512) || (typeof value === 'number' && Number.isSafeInteger(value)),
      'UPLOAD_FAILED'
    );
  creationCheck(
    typeof row.fields.api_key === 'string' &&
      /^[a-f0-9]{40,64}$/.test(String(row.fields.signature)) &&
      String(row.fields.overwrite) === 'false' &&
      Number.isSafeInteger(Number(row.fields.timestamp)),
    'UPLOAD_FAILED'
  );
  const id = String(row.fields.public_id ?? '');
  creationCheck(id === row.publicId || `${row.fields.folder}/${id}` === row.publicId, 'UPLOAD_FAILED');
  return { uploadUrl: row.uploadUrl, publicId: row.publicId, expiresAt: row.expiresAt, fields: { ...row.fields } };
}
