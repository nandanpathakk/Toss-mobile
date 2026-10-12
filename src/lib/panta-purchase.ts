import bs58 from 'bs58';

import { type OrderBuild } from './panta-order-build';
import { inspectPrimaryWire } from './panta-order-signing';
import { isWalletAddress } from './panta-portfolio';

export type PurchaseCost = {
  amountBaseUnits: string;
  protocolFeeBaseUnits: string;
  totalUsdcBaseUnits: string;
  networkFeeLamports: string;
  accountRentLamports: string;
  totalSolLamports: string;
};
export type PreparedPurchase = {
  orderId: string;
  wallet: string;
  chain: 'mainnet-beta';
  ticket: string;
  transaction: string;
  messageHash: string;
  expiresAt: string;
  cost: PurchaseCost;
  executionProtection: false;
};
export type PurchaseReceipt = {
  version: 1;
  chain: 'mainnet-beta';
  wallet: string;
  marketId: string;
  orderId: string;
  signature: string;
  messageHash: string;
  status: 'pending' | 'confirmed' | 'failed' | 'not-sent';
};
export const purchaseMessages = {
  INVALID_PURCHASE: 'This purchase could not be validated. Request a new review.',
  PURCHASE_EXPIRED: 'This purchase review expired. Request a new quote.',
  PURCHASE_BLOCKED: 'The transaction or its full cost could not be verified. Check your USDC and SOL balances.',
  PURCHASE_PENDING: 'A purchase is already pending. Check its status before buying again.',
  PURCHASE_UNAVAILABLE: 'The purchase service is unavailable. No new purchase will be retried automatically.',
} as const;
export class PurchaseError extends Error {
  constructor(public readonly code: keyof typeof purchaseMessages) {
    super(purchaseMessages[code]);
  }
}
export function purchaseCheck(ok: unknown): asserts ok {
  if (!ok) throw new PurchaseError('INVALID_PURCHASE');
}
export function usdcBaseUnits(value: string) {
  purchaseCheck(typeof value === 'string' && /^(0|[1-9]\d{0,14})(\.\d{1,6})?$/.test(value));
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(6, '0'));
}
export function parsePurchaseCost(value: unknown, build: OrderBuild): PurchaseCost {
  const row = value as PurchaseCost;
  purchaseCheck(row && typeof row === 'object' && !Array.isArray(row));
  const names = [
    'amountBaseUnits',
    'protocolFeeBaseUnits',
    'totalUsdcBaseUnits',
    'networkFeeLamports',
    'accountRentLamports',
    'totalSolLamports',
  ] as const;
  purchaseCheck(Object.keys(row).length === names.length);
  for (const name of names) purchaseCheck(typeof row[name] === 'string' && /^(0|[1-9]\d{0,20})$/.test(row[name]));
  purchaseCheck(BigInt(row.amountBaseUnits) === usdcBaseUnits(build.amountUsdc));
  purchaseCheck(BigInt(row.protocolFeeBaseUnits) === usdcBaseUnits(build.feeUsdc));
  purchaseCheck(BigInt(row.totalUsdcBaseUnits) === BigInt(row.amountBaseUnits) + BigInt(row.protocolFeeBaseUnits));
  purchaseCheck(
    BigInt(row.networkFeeLamports) > 0n && BigInt(row.totalSolLamports) === BigInt(row.networkFeeLamports) + BigInt(row.accountRentLamports)
  );
  return Object.fromEntries(names.map(name => [name, row[name]])) as PurchaseCost;
}
// Small canonical base64 codec: no extra mobile dependency or permissive decoder.
export function decodePurchaseWire(value: string) {
  purchaseCheck(
    typeof value === 'string' && value.length <= 1644 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  );
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bits = 0;
  let count = 0;
  const bytes: number[] = [];
  for (const c of value.replace(/=+$/, '')) {
    bits = (bits << 6) | alphabet.indexOf(c);
    count += 6;
    if (count >= 8) {
      count -= 8;
      bytes.push((bits >> count) & 255);
      bits &= (1 << count) - 1;
    }
  }
  purchaseCheck(bits === 0 && bytes.length >= 70 && bytes.length <= 1232);
  return Uint8Array.from(bytes);
}
export function encodePurchaseWire(bytes: Uint8Array) {
  purchaseCheck(bytes.length >= 70 && bytes.length <= 1232);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    result +=
      alphabet[(n >>> 18) & 63] +
      alphabet[(n >>> 12) & 63] +
      (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : '=') +
      (i + 2 < bytes.length ? alphabet[n & 63] : '=');
  }
  return result;
}
export function parsePreparedPurchase(value: unknown, build: OrderBuild, now = Date.now()): PreparedPurchase {
  const row = value as PreparedPurchase;
  purchaseCheck(
    row && row.wallet === build.wallet && row.orderId === build.orderId && row.chain === 'mainnet-beta' && row.executionProtection === false
  );
  purchaseCheck(typeof row.ticket === 'string' && /^[a-f0-9]{64}$/.test(row.ticket));
  purchaseCheck(
    typeof row.expiresAt === 'string' &&
      Number.isFinite(Date.parse(row.expiresAt)) &&
      Date.parse(row.expiresAt) > now &&
      Date.parse(row.expiresAt) <= Math.min(Date.parse(build.expiresAt), now + 60000)
  );
  const decoded = inspectPrimaryWire(decodePurchaseWire(row.transaction), build);
  purchaseCheck(decoded.signature.every(value => value === 0) && row.messageHash === decoded.messageHash);
  return {
    orderId: row.orderId,
    wallet: row.wallet,
    chain: row.chain,
    ticket: row.ticket,
    transaction: row.transaction,
    messageHash: row.messageHash,
    expiresAt: row.expiresAt,
    cost: parsePurchaseCost(row.cost, build),
    executionProtection: false,
  };
}
export function parsePurchaseReceipt(value: unknown, wallet: string): PurchaseReceipt {
  const row = value as PurchaseReceipt;
  purchaseCheck(row && typeof row === 'object' && !Array.isArray(row));
  purchaseCheck(Object.keys(row).sort().join(',') === 'chain,marketId,messageHash,orderId,signature,status,version,wallet');
  purchaseCheck(
    row.version === 1 && row.chain === 'mainnet-beta' && row.wallet === wallet && isWalletAddress(wallet) && isWalletAddress(row.marketId)
  );
  purchaseCheck(typeof row.orderId === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(row.orderId));
  purchaseCheck(typeof row.messageHash === 'string' && /^[0-9a-f]{64}$/.test(row.messageHash));
  purchaseCheck(typeof row.signature === 'string' && row.signature.length <= 88 && bs58.decode(row.signature).length === 64);
  purchaseCheck(['pending', 'confirmed', 'failed', 'not-sent'].includes(row.status));
  return { ...row };
}
