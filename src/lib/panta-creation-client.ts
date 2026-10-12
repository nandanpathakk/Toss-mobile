import bs58 from 'bs58';

import { AccountVerificationError, accountVerificationMessages } from './panta-account-verification';
import {
  creationCheck,
  CreationError,
  creationMessages,
  parseCreationQuote,
  parseCreationRequest,
  parseImageUploadTicket,
  type CreationBuild,
  type CreationRequest,
  type ImageUploadTicket,
} from './panta-creation';
import { parsePurchaseCost, type PurchaseReceipt } from './panta-purchase';

export function parseCreationBuild(value: unknown, request: CreationRequest, now = Date.now()): CreationBuild {
  const row = value as CreationBuild;
  creationCheck(row?.creation && JSON.stringify(row.creation.request) === JSON.stringify(parseCreationRequest(request, now)));
  const quote = parseCreationQuote(row.creation.quote, now);
  creationCheck(
    row.orderId === quote.createId &&
      row.quoteId === quote.createId &&
      row.marketId === quote.expectedEventPda &&
      row.wallet === request.wallet &&
      row.side === 'yes' &&
      row.expectedShares === '0' &&
      row.status === 'built' &&
      row.disclaimer === null
  );
  creationCheck(
    Date.parse(row.expiresAt) > now &&
      Date.parse(row.expiresAt) <= Math.min(Date.parse(quote.expiresAt), now + 60000) &&
      Number.isSafeInteger(row.lastValidBlockHeight) &&
      row.lastValidBlockHeight > 0 &&
      typeof row.recentBlockhash === 'string' &&
      bs58.decode(row.recentBlockhash).length === 32
  );
  creationCheck(row.instructions?.length === 1);
  const ix = row.instructions[0],
    keys = ix.accounts;
  creationCheck(
    ix.programId === '6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp' && keys.length === 15 && new Set(keys.map(k => k.pubkey)).size === 15
  );
  const fixed: [number, string][] = [
    [0, request.wallet],
    [1, '8mJjfx7SuWwS4yfVZXtqC2cvzxr3TQHsCgKyjpuDWKAP'],
    [3, quote.expectedEventPda],
    [9, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
    [12, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'],
    [13, 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'],
    [14, '11111111111111111111111111111111'],
  ];
  for (const [i, key] of fixed) creationCheck(keys[i].pubkey === key);
  keys.forEach((k, i) =>
    creationCheck(
      bs58.decode(k.pubkey).length === 32 && k.isSigner === (i === 0) && k.isWritable === [0, 3, 4, 5, 6, 7, 8, 10, 11].includes(i)
    )
  );
  // Independent byte-for-byte argument policy; no general base64 or Buffer shim.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  creationCheck(
    typeof ix.data === 'string' &&
      ix.data.length <= 1644 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(ix.data)
  );
  let bits = 0,
    count = 0;
  const bytes: number[] = [];
  for (const c of ix.data.replace(/=+$/, '')) {
    bits = (bits << 6) | alphabet.indexOf(c);
    count += 6;
    if (count >= 8) {
      count -= 8;
      bytes.push((bits >> count) & 255);
      bits &= (1 << count) - 1;
    }
  }
  creationCheck(bits === 0);
  let cursor = 0;
  const integer = (size: number) => {
    creationCheck(cursor + size <= bytes.length);
    let n = 0n;
    for (let i = 0; i < size; i++) n |= BigInt(bytes[cursor++]) << BigInt(i * 8);
    return n;
  };
  const text = (expected: string) => {
    const length = Number(integer(4));
    const encoded: number[] = [];
    for (const char of expected) {
      const n = char.codePointAt(0)!;
      if (n < 128) encoded.push(n);
      else if (n < 2048) encoded.push(192 | (n >> 6), 128 | (n & 63));
      else if (n < 65536) encoded.push(224 | (n >> 12), 128 | ((n >> 6) & 63), 128 | (n & 63));
      else encoded.push(240 | (n >> 18), 128 | ((n >> 12) & 63), 128 | ((n >> 6) & 63), 128 | (n & 63));
    }
    creationCheck(length === encoded.length && encoded.every(n => bytes[cursor++] === n));
  };
  creationCheck([80, 9, 204, 213, 150, 219, 87, 162].every(n => bytes[cursor++] === n));
  for (const time of [request.startTime, request.endTime, request.resolutionTime]) creationCheck(integer(8) === BigInt(time));
  text(request.question);
  creationCheck(integer(8) === BigInt(quote.paymentUsdc));
  text(request.resolutionRule);
  creationCheck(integer(4) === BigInt(request.sourcesOfTruth.length));
  for (const source of request.sourcesOfTruth) text(source);
  creationCheck(cursor === bytes.length);
  creationCheck(/^[a-f0-9]{64}$/.test(row.creation.snapshotHash));
  parsePurchaseCost(row.creation.cost, row);
  creationCheck(
    row.creation.cost.amountBaseUnits === quote.liquidityInjectionUsdc &&
      row.creation.cost.protocolFeeBaseUnits === quote.platformRevenueUsdc &&
      row.creation.cost.totalUsdcBaseUnits === quote.paymentUsdc
  );
  return row;
}
export type CoverFile = { uri: string; name: string; type: 'image/jpeg'; size: number };
export function createCreationClient(base: string, fetcher: typeof fetch = fetch) {
  const url = new URL(base);
  creationCheck(
    !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/' &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
  );
  async function post(path: string, body: unknown, access: string, identity: string, signal?: AbortSignal) {
    creationCheck(access && identity && access.length <= 8192 && identity.length <= 8192);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 65000);
    try {
      const response = await fetcher(`${url.origin}/creation/${path}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${access}`, 'Privy-Id-Token': identity },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal,
      });
      const raw = await response.text();
      creationCheck(raw.length <= 32768, 'CREATION_UNAVAILABLE');
      const value = JSON.parse(raw);
      if (!response.ok) {
        if (Object.hasOwn(accountVerificationMessages, value?.code)) throw new AccountVerificationError(value.code);
        const minimumStartTime =
          value?.code === 'CREATION_START_TOO_SOON' &&
          Number.isSafeInteger(value.minimumStartTime) &&
          value.minimumStartTime > 0 &&
          value.minimumStartTime <= 253402300799
            ? value.minimumStartTime
            : undefined;
        throw new CreationError(Object.hasOwn(creationMessages, value?.code) ? value.code : 'CREATION_UNAVAILABLE', minimumStartTime);
      }
      return value;
    } catch (error) {
      if (error instanceof CreationError || error instanceof AccountVerificationError) throw error;
      throw new CreationError('CREATION_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  return {
    quote: async (request: CreationRequest, access: string, identity: string, signal?: AbortSignal) =>
      parseCreationQuote(await post('quote', parseCreationRequest(request), access, identity, signal)),
    build: async (request: CreationRequest, createId: string, access: string, identity: string, signal?: AbortSignal) =>
      parseCreationBuild(await post('build', { wallet: request.wallet, createId }, access, identity, signal), request),
    ticket: async (wallet: string, access: string, identity: string, signal?: AbortSignal) =>
      parseImageUploadTicket(await post('image-upload', { wallet }, access, identity, signal)),
    register: async (record: PurchaseReceipt, access: string, identity: string) => {
      creationCheck(record.orderId.startsWith('cr_') && record.status === 'confirmed');
      const value = await post('register', record, access, identity);
      creationCheck(value?.marketId === record.marketId && value.status === 'registered');
      return value as { marketId: string; status: 'registered' };
    },
    upload: async (ticket: ImageUploadTicket, file: CoverFile, signal: AbortSignal) => {
      parseImageUploadTicket(ticket);
      creationCheck(
        file.type === 'image/jpeg' &&
          file.uri.startsWith('file://') &&
          Number.isSafeInteger(file.size) &&
          file.size > 0 &&
          file.size <= 5 * 1024 * 1024,
        'UPLOAD_FAILED'
      );
      const form = new FormData();
      for (const [key, value] of Object.entries(ticket.fields)) form.append(key, String(value));
      form.append('file', file as unknown as Blob);
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      const timer = setTimeout(abort, 45000);
      try {
        const response = await fetcher(ticket.uploadUrl, { method: 'POST', body: form, redirect: 'error', signal: controller.signal });
        const raw = await response.text();
        creationCheck(raw.length <= 16384 && response.ok, 'UPLOAD_FAILED');
        const value = JSON.parse(raw);
        creationCheck(
          value?.public_id === ticket.publicId &&
            value.resource_type === 'image' &&
            ['jpg', 'jpeg'].includes(value.format) &&
            Number.isSafeInteger(value.bytes) &&
            value.bytes > 0 &&
            value.bytes <= 5 * 1024 * 1024,
          'UPLOAD_FAILED'
        );
        const result = new URL(value.secure_url);
        const cloud = new URL(ticket.uploadUrl).pathname.split('/')[2];
        creationCheck(
          result.protocol === 'https:' &&
            result.hostname === 'res.cloudinary.com' &&
            !result.username &&
            !result.password &&
            !result.search &&
            !result.hash &&
            result.pathname.startsWith(`/${cloud}/image/upload/`),
          'UPLOAD_FAILED'
        );
        return result.toString();
      } catch {
        throw new CreationError('UPLOAD_FAILED');
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    },
  };
}
