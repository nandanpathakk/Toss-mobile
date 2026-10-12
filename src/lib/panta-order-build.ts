import bs58 from 'bs58';

import { normalizeUsdc, OrderError, type OrderQuote } from './panta-orders';

export type BuildRequest = { quoteId: string; wallet: string; maxSlippageBps: number };
export type OrderInstruction = { programId: string; data: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[] };
/** Parsed API data only. This is not authorization to sign or broadcast. */
export type OrderBuild = {
  orderId: string;
  quoteId: string;
  wallet: string;
  marketId: string;
  side: 'yes' | 'no';
  amountUsdc: string;
  expectedShares: string;
  feeUsdc: string;
  status: 'built';
  instructions: OrderInstruction[];
  recentBlockhash: string;
  lastValidBlockHeight: number;
  expiresAt: string;
  disclaimer: string | null;
};
function publicKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}
function sessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}
export function parseBuildRequest(value: unknown): BuildRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OrderError('INVALID_REQUEST');
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some(key => !['quoteId', 'wallet', 'maxSlippageBps'].includes(key)) ||
    !sessionId(row.quoteId) ||
    !publicKey(row.wallet) ||
    !Number.isInteger(row.maxSlippageBps) ||
    Number(row.maxSlippageBps) < 0 ||
    Number(row.maxSlippageBps) > 5000
  )
    throw new OrderError('INVALID_REQUEST');
  return { quoteId: row.quoteId, wallet: row.wallet, maxSlippageBps: row.maxSlippageBps as number };
}
function units(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,29})(\.\d{1,18})?$/.test(value)) throw new OrderError('INVALID_RESPONSE');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(18, '0'));
}
export function parseOrderBuild(value: unknown, quote: OrderQuote, request: BuildRequest, now = Date.now()): OrderBuild {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OrderError('INVALID_RESPONSE');
  const row = value as Record<string, unknown>;
  parseBuildRequest(request);
  if (request.quoteId !== quote.quoteId || request.wallet !== quote.wallet || Date.parse(quote.expiresAt) <= now)
    throw new OrderError('EXPIRED');
  if (
    !sessionId(row.orderId) ||
    row.quoteId !== quote.quoteId ||
    row.wallet !== quote.wallet ||
    row.marketId !== quote.marketId ||
    row.side !== quote.side ||
    typeof row.amountUsdc !== 'string' ||
    normalizeUsdc(row.amountUsdc) !== quote.amountUsdc ||
    row.status !== 'built'
  )
    throw new OrderError('INVALID_RESPONSE');
  if (!Array.isArray(row.instructions) || row.instructions.length === 0) throw new OrderError('BUILD_UNAVAILABLE');
  if (
    row.instructions.length > 32 ||
    !publicKey(row.recentBlockhash) ||
    !Number.isSafeInteger(row.lastValidBlockHeight) ||
    Number(row.lastValidBlockHeight) <= 0
  )
    throw new OrderError('INVALID_RESPONSE');
  if (
    typeof row.expiresAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(row.expiresAt) ||
    !Number.isFinite(Date.parse(row.expiresAt)) ||
    new Date(row.expiresAt).toISOString().slice(0, 19) !== row.expiresAt.slice(0, 19)
  )
    throw new OrderError('INVALID_RESPONSE');
  if (Date.parse(row.expiresAt) <= now) throw new OrderError('EXPIRED');
  if (
    units(row.expectedShares) <= 0n ||
    units(row.expectedShares) * 10000n < units(quote.shares) * BigInt(10000 - request.maxSlippageBps) ||
    units(row.feeUsdc) > units(quote.feeUsdc)
  )
    throw new OrderError('QUOTE_STALE');
  let walletSigner = false;
  const instructions = row.instructions.map((instruction: unknown): OrderInstruction => {
    if (!instruction || typeof instruction !== 'object' || Array.isArray(instruction)) throw new OrderError('INVALID_RESPONSE');
    const item = instruction as Record<string, unknown>;
    if (
      !publicKey(item.programId) ||
      typeof item.data !== 'string' ||
      item.data.length > 1644 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data) ||
      !Array.isArray(item.accounts) ||
      item.accounts.length > 64
    )
      throw new OrderError('INVALID_RESPONSE');
    // Reject noncanonical base64 padding bits without a browser/Buffer decoder dependency.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    if (
      (item.data.endsWith('==') && (alphabet.indexOf(item.data[item.data.length - 3]) & 15) !== 0) ||
      (item.data.endsWith('=') && !item.data.endsWith('==') && (alphabet.indexOf(item.data[item.data.length - 2]) & 3) !== 0)
    )
      throw new OrderError('INVALID_RESPONSE');
    const accounts = item.accounts.map((account: unknown) => {
      if (!account || typeof account !== 'object' || Array.isArray(account)) throw new OrderError('INVALID_RESPONSE');
      const key = account as Record<string, unknown>;
      if (
        !publicKey(key.pubkey) ||
        typeof key.isSigner !== 'boolean' ||
        typeof key.isWritable !== 'boolean' ||
        (key.isSigner && key.pubkey !== quote.wallet)
      )
        throw new OrderError('INVALID_RESPONSE');
      if (key.isSigner) walletSigner = true;
      return { pubkey: key.pubkey, isSigner: key.isSigner, isWritable: key.isWritable };
    });
    return { programId: item.programId, data: item.data, accounts };
  });
  if (!walletSigner) throw new OrderError('INVALID_RESPONSE');
  if (row.disclaimer != null && (typeof row.disclaimer !== 'string' || row.disclaimer.length > 2000))
    throw new OrderError('INVALID_RESPONSE');
  return {
    orderId: row.orderId,
    quoteId: quote.quoteId,
    wallet: quote.wallet,
    marketId: quote.marketId,
    side: quote.side,
    amountUsdc: quote.amountUsdc,
    expectedShares: row.expectedShares as string,
    feeUsdc: row.feeUsdc as string,
    status: 'built',
    instructions,
    recentBlockhash: row.recentBlockhash,
    lastValidBlockHeight: row.lastValidBlockHeight as number,
    expiresAt: row.expiresAt,
    disclaimer: (row.disclaimer as string | null) ?? quote.disclaimer,
  };
}
