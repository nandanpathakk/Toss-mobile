import { type OrderBuild } from './panta-order-build';
import { OrderError } from './panta-orders';
import { parsePurchaseCost, type PurchaseCost } from './panta-purchase';

export const preflightMessages = {
  POLICY_REJECTED: 'The transaction does not match the verified market rules.',
  CHAIN_MISMATCH: 'The network does not match this market.',
  EXPIRED: 'This transaction expired. Request a fresh quote.',
  RPC_UNAVAILABLE: 'The network check is unavailable. Try again later.',
  ECONOMICS_UNVERIFIED: 'The full transaction cost could not be verified. Purchases remain unavailable.',
  SIMULATION_FAILED: 'The transaction could not complete in simulation. No funds moved.',
} as const;
export type PreflightReport = {
  orderId: string;
  wallet: string;
  chain: 'mainnet-beta';
  status: 'simulated' | 'blocked';
  code: keyof typeof preflightMessages | null;
  networkFeeLamports: string | null;
  messageHash: string | null;
  cost?: PurchaseCost;
  signable: false;
  executionProtection: false;
};
export function parsePreflightReport(value: unknown, build: OrderBuild): PreflightReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OrderError('INVALID_RESPONSE');
  const row = value as PreflightReport;
  if (
    row.orderId !== build.orderId ||
    row.wallet !== build.wallet ||
    row.chain !== 'mainnet-beta' ||
    row.signable !== false ||
    row.executionProtection !== false ||
    !['simulated', 'blocked'].includes(row.status) ||
    (row.status === 'simulated' ? row.code !== null : !row.code || !Object.hasOwn(preflightMessages, row.code)) ||
    (row.networkFeeLamports !== null &&
      (typeof row.networkFeeLamports !== 'string' || !/^(0|[1-9]\d{0,15})$/.test(row.networkFeeLamports))) ||
    (row.messageHash !== null && (typeof row.messageHash !== 'string' || !/^[0-9a-f]{64}$/.test(row.messageHash))) ||
    (row.status === 'simulated' && (!row.messageHash || row.networkFeeLamports === null))
  )
    throw new OrderError('INVALID_RESPONSE');
  return {
    ...(row.cost ? { cost: parsePurchaseCost(row.cost, build) } : {}),
    orderId: row.orderId,
    wallet: row.wallet,
    chain: row.chain,
    status: row.status,
    code: row.code,
    networkFeeLamports: row.networkFeeLamports,
    messageHash: row.messageHash,
    signable: false,
    executionProtection: false,
  };
}
