import bs58 from 'bs58';

import { AccountVerificationError, accountVerificationMessages } from './panta-account-verification';
import { type OrderInstruction } from './panta-order-build';
import {
  p2pCheck,
  P2PError,
  p2pMaxTradeAccounts,
  p2pUnits,
  parseP2PBook,
  parseP2PRequest,
  type P2PBuild,
  type P2PRequest,
} from './panta-p2p';
import { isWalletAddress } from './panta-portfolio';
import { parsePurchaseCost } from './panta-purchase';

export function parseP2PBuild(value: unknown, request: P2PRequest, now = Date.now()): P2PBuild {
  const row = value as P2PBuild;
  p2pCheck(
    row &&
      typeof row === 'object' &&
      row.p2p &&
      JSON.stringify(parseP2PRequest(row.p2p.request)) === JSON.stringify(parseP2PRequest(request))
  );
  p2pCheck(
    row.wallet === request.wallet &&
      row.marketId === request.marketId &&
      row.side === request.side &&
      row.expectedShares === request.shares &&
      row.status === 'built' &&
      row.disclaimer === null
  );
  p2pCheck(typeof row.orderId === 'string' && /^p2p_[a-f0-9]{32}$/.test(row.orderId) && row.quoteId === row.orderId);
  p2pCheck(isWalletAddress(row.recentBlockhash) && Number.isSafeInteger(row.lastValidBlockHeight) && row.lastValidBlockHeight > 0);
  p2pCheck(typeof row.expiresAt === 'string' && Date.parse(row.expiresAt) > now && Date.parse(row.expiresAt) <= now + 60000);
  p2pUnits(row.amountUsdc, 6);
  p2pUnits(row.feeUsdc, 6);
  p2pCheck(Array.isArray(row.instructions) && row.instructions.length >= 1 && row.instructions.length <= 2);
  for (const ix of row.instructions as OrderInstruction[]) {
    p2pCheck(
      isWalletAddress(ix.programId) &&
        typeof ix.data === 'string' &&
        ix.data.length <= 128 &&
        Array.isArray(ix.accounts) &&
        ix.accounts.length <= p2pMaxTradeAccounts
    );
    for (const account of ix.accounts)
      p2pCheck(
        isWalletAddress(account.pubkey) &&
          typeof account.isSigner === 'boolean' &&
          typeof account.isWritable === 'boolean' &&
          (!account.isSigner || account.pubkey === row.wallet)
      );
  }
  p2pCheck(
    row.p2p.facts &&
      Object.keys(row.p2p.facts).sort().join(',') === 'cashCreditUsdc,filledShares,lockedUsdc,refundUsdc,remainingShares,rentRefundLamports'
  );
  for (const name of ['cashCreditUsdc', 'filledShares', 'lockedUsdc', 'refundUsdc', 'remainingShares'] as const)
    p2pUnits(row.p2p.facts[name], 6);
  p2pCheck(/^(0|[1-9]\d{0,19})$/.test(row.p2p.facts.rentRefundLamports));
  p2pCheck(typeof row.p2p.snapshotHash === 'string' && /^[a-f0-9]{64}$/.test(row.p2p.snapshotHash));
  parsePurchaseCost(row.p2p.cost, row);
  validateP2PInstructions(row);
  return row;
}
export function createP2PClient(base: string, fetcher: typeof fetch = fetch) {
  const url = new URL(base);
  p2pCheck(
    !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      url.pathname === '/' &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
  );
  async function read(path: string, init: RequestInit, limit: number) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    init.signal?.addEventListener('abort', abort, { once: true });
    if (init.signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 65000);
    try {
      const response = await fetcher(`${url.origin}${path}`, { ...init, redirect: 'error', signal: controller.signal });
      const text = await response.text();
      p2pCheck(text.length <= limit, 'P2P_UNAVAILABLE');
      const value = JSON.parse(text);
      if (!response.ok) {
        if (Object.hasOwn(accountVerificationMessages, value?.code)) throw new AccountVerificationError(value.code);
        throw new P2PError(
          ['INVALID_P2P', 'P2P_CHANGED', 'P2P_CLOSED', 'P2P_BLOCKED', 'P2P_COMPLEX_BOOK'].includes(value?.code)
            ? value.code
            : 'P2P_UNAVAILABLE'
        );
      }
      return value;
    } catch (error) {
      if (error instanceof P2PError || error instanceof AccountVerificationError) throw error;
      throw new P2PError('P2P_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', abort);
    }
  }
  return {
    book: async (marketId: string, wallet: string, signal: AbortSignal) => {
      p2pCheck(isWalletAddress(marketId) && isWalletAddress(wallet));
      return parseP2PBook(await read(`/markets/${marketId}/orderbook/?wallet=${wallet}`, { signal }, 32768), marketId);
    },
    build: async (input: P2PRequest, access: string, identity: string, signal: AbortSignal) => {
      const request = parseP2PRequest(input);
      p2pCheck(access && identity && access.length <= 8192 && identity.length <= 8192);
      return parseP2PBuild(
        await read(
          '/p2p/build/',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${access}`, 'Privy-Id-Token': identity },
            body: JSON.stringify(request),
            signal,
          },
          16384
        ),
        request
      );
    },
  };
}

// Independent mobile boundary: only the selected P2P operation and optional
// idempotent canonical-USDC ATA setup may enter the sign-only flow.
function validateP2PInstructions(build: P2PBuild) {
  const program = '6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp';
  const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const token = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const ata = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  const system = '11111111111111111111111111111111';
  const ix = build.instructions.at(-1)!;
  p2pCheck(ix.programId === program);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  p2pCheck(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(ix.data));
  const bytes: number[] = [];
  let bits = 0;
  let count = 0;
  for (const char of ix.data.replace(/=+$/, '')) {
    bits = (bits << 6) | alphabet.indexOf(char);
    count += 6;
    if (count >= 8) {
      count -= 8;
      bytes.push((bits >> count) & 255);
      bits &= (1 << count) - 1;
    }
  }
  p2pCheck(bits === 0);
  const data = Uint8Array.from(bytes);
  const integer = (offset: number, size: number) => {
    let value = 0n;
    for (let i = size - 1; i >= 0; i--) value = (value << 8n) | BigInt(data[offset + i]);
    return value;
  };
  const request = build.p2p.request;
  const trade = request.intent === 'buy' || request.intent === 'sell';
  const cancel = request.intent === 'cancel';
  const discriminator = trade
    ? [110, 71, 240, 5, 180, 192, 163, 177]
    : cancel
      ? [5, 36, 88, 69, 68, 29, 186, 30]
      : [59, 240, 239, 57, 94, 149, 99, 18];
  p2pCheck(data.length === (trade ? 66 : cancel ? 8 : 57) && discriminator.every((v, i) => data[i] === v));
  const keys = ix.accounts.map(account => account.pubkey);
  p2pCheck(keys[0] === build.wallet && keys[1] === '8mJjfx7SuWwS4yfVZXtqC2cvzxr3TQHsCgKyjpuDWKAP' && keys[2] === build.marketId);
  const fixed = trade ? 16 : cancel ? 15 : 11;
  p2pCheck(trade ? keys.length >= fixed && keys.length <= p2pMaxTradeAccounts : keys.length === fixed);
  const mintIndex = trade ? 12 : cancel ? 11 : 7;
  p2pCheck(keys[mintIndex] === mint && keys[mintIndex + 1] === token && keys[mintIndex + 2] === ata && keys[mintIndex + 3] === system);
  const writes = trade
    ? [0, 2, 3, 4, 5, 7, 8, 9, 10, 11]
    : cancel
      ? [0, 3, 5, 6, 7, 8, ...(keys[9] === program ? [] : [9]), ...(keys[10] === program ? [] : [10])]
      : [0, 4, 5, 6];
  ix.accounts.forEach((account, i) =>
    p2pCheck(account.isSigner === (i === 0) && account.isWritable === (writes.includes(i) || i >= fixed))
  );
  if (trade) {
    p2pCheck(
      data[8] === (request.side === 'yes' ? 0 : 1) &&
        integer(9, 8) === p2pUnits(request.price, 9) &&
        integer(17, 8) === p2pUnits(request.shares, 6) &&
        data[25] === (request.intent === 'buy' ? 1 : 0) &&
        bs58.encode(data.slice(34, 66)) === keys[4]
    );
  } else if (cancel) p2pCheck(keys[8] === request.order);
  else
    p2pCheck(
      bs58.encode(data.slice(8, 40)) === build.wallet && data[40] === 1 && integer(41, 16) === p2pUnits(build.p2p.facts.refundUsdc, 6)
    );
  if (build.instructions.length === 2) {
    const setup = build.instructions[0];
    const userAta = keys[trade ? 11 : 6];
    const expected = [build.wallet, userAta, build.wallet, mint, system, token];
    p2pCheck(setup.programId === ata && setup.data === 'AQ==' && setup.accounts.length === 6);
    setup.accounts.forEach((account, i) =>
      p2pCheck(account.pubkey === expected[i] && account.isSigner === (i === 0) && account.isWritable === i <= 1)
    );
  }
}
