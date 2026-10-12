import { createHash } from 'node:crypto';

import bs58 from 'bs58';

import { p2pCheck, p2pDecimal, P2PError, type P2PBook } from '../../src/lib/panta-p2p';
import { configAddress, deployment, derive, key, type ChainAccount } from './primary-transaction';

export const p2pDiscriminators = {
  level: [236, 106, 90, 162, 188, 41, 219, 186],
  order: [220, 235, 38, 63, 66, 140, 138, 244],
  position: [251, 248, 209, 245, 83, 234, 17, 27],
  event: [125, 192, 125, 158, 9, 115, 152, 233],
};
export function p2pU64(value: bigint) {
  p2pCheck(value >= 0n && value <= 18446744073709551615n);
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(value);
  return data;
}
export const p2pAta = (owner: string) => derive([key(owner), key(deployment.token), key(deployment.mint)], deployment.ata);
export const p2pPosition = (market: string, owner: string) => derive([Buffer.from('position'), key(market), key(owner)]);
export const p2pLevel = (market: string, price: bigint) => derive([Buffer.from('level_usdc'), key(market), p2pU64(price)]);
export const p2pNode = (level: string, owner: string, nonce: bigint) =>
  derive([Buffer.from('order_usdc'), key(level), key(owner), p2pU64(nonce)]);
export function p2pAccount(value: any): ChainAccount | null {
  if (value === null) return null;
  p2pCheck(
    value &&
      typeof value.owner === 'string' &&
      typeof value.executable === 'boolean' &&
      Number.isSafeInteger(value.lamports) &&
      value.lamports >= 0
  );
  p2pCheck(
    Array.isArray(value.data) &&
      value.data.length === 2 &&
      value.data[1] === 'base64' &&
      typeof value.data[0] === 'string' &&
      value.data[0].length <= 524288
  );
  const data = Buffer.from(value.data[0], 'base64');
  p2pCheck(data.toString('base64') === value.data[0]);
  return { owner: value.owner, executable: value.executable, lamports: value.lamports, data };
}
export function p2pOwned(account: ChainAccount | null | undefined, discriminator: number[], length?: number) {
  p2pCheck(
    account &&
      account.owner === deployment.program &&
      !account.executable &&
      account.data.subarray(0, 8).equals(Buffer.from(discriminator)),
    'P2P_BLOCKED'
  );
  if (length !== undefined) p2pCheck(account.data.length === length, 'P2P_BLOCKED');
  return account.data;
}
export function p2pEvent(account: ChainAccount | null, address: string, now: number) {
  const data = p2pOwned(account, p2pDiscriminators.event);
  p2pCheck(data.length >= 340 && data.length <= 6144, 'P2P_BLOCKED');
  let offset = 328;
  const text = () => {
    p2pCheck(offset + 4 <= data.length, 'P2P_BLOCKED');
    const size = data.readUInt32LE(offset);
    offset += 4;
    p2pCheck(size <= 4096 && offset + size <= data.length, 'P2P_BLOCKED');
    const bytes = data.subarray(offset, offset + size);
    offset += size;
    return bytes;
  };
  const question = text();
  p2pCheck(question.length > 0, 'P2P_BLOCKED');
  text();
  p2pCheck(offset + 4 <= data.length, 'P2P_BLOCKED');
  const sources = data.readUInt32LE(offset);
  offset += 4;
  p2pCheck(sources <= 20, 'P2P_BLOCKED');
  for (let i = 0; i < sources; i++) text();
  offset += 19; // active_volume u128 and three bumps.
  p2pCheck(offset + 6 <= data.length && [...data.subarray(offset, offset + 6)].every(v => v === 0 || v === 1), 'P2P_BLOCKED');
  const creator = data.subarray(8, 40);
  const hash = createHash('sha256').update(question).digest();
  p2pCheck(derive([Buffer.from('event_usdc'), creator, hash]) === address, 'P2P_BLOCKED');
  return {
    vault: derive([Buffer.from('vault_usdc'), creator, hash]),
    tradingOpen:
      data[offset] === 1 &&
      data[offset + 1] === 1 &&
      data[offset + 2] === 0 &&
      data[offset + 3] === 0 &&
      data.readBigInt64LE(48) > BigInt(Math.floor(now / 1000)),
  };
}
export function p2pOrder(address: string, account: ChainAccount | null, market: string) {
  const d = p2pOwned(account, p2pDiscriminators.order, 269);
  p2pCheck(d[8] === 1 && bs58.encode(d.subarray(41, 73)) === market && d[129] <= 1 && d[130] <= 1 && d[131] <= 1, 'P2P_BLOCKED');
  const owner = bs58.encode(d.subarray(9, 41));
  const level = bs58.encode(d.subarray(73, 105));
  const price = d.readBigUInt64LE(132);
  p2pCheck(
    price > 0n && p2pLevel(market, price) === level && p2pNode(level, owner, d.readBigUInt64LE(149)) === address && d[130] === d[131],
    'P2P_BLOCKED'
  );
  return {
    address,
    owner,
    level,
    side: d[129] === 0 ? ('yes' as const) : ('no' as const),
    intent: d[131] === 0 ? ('buy' as const) : ('sell' as const),
    price,
    amount: d.readBigUInt64LE(105),
    prev: bs58.encode(d.subarray(157, 189)),
    next: bs58.encode(d.subarray(189, 221)),
    lockedCash: d.readBigUInt64LE(221) + (d.readBigUInt64LE(229) << 64n),
    lockedYes: d.readBigUInt64LE(237) + (d.readBigUInt64LE(245) << 64n),
    lockedNo: d.readBigUInt64LE(253) + (d.readBigUInt64LE(261) << 64n),
  };
}
export function p2pPositionData(account: ChainAccount | null | undefined, market: string, owner: string) {
  if (!account) return { yes: 0n, no: 0n, cash: 0n, lockedCash: 0n, lockedYes: 0n, lockedNo: 0n };
  const d = p2pOwned(account, p2pDiscriminators.position, 202);
  p2pCheck(d[8] === 1 && bs58.encode(d.subarray(9, 41)) === market && bs58.encode(d.subarray(41, 73)) === owner, 'P2P_BLOCKED');
  const n = (offset: number) => d.readBigUInt64LE(offset) + (d.readBigUInt64LE(offset + 8) << 64n);
  const value = { yes: n(74), no: n(90), cash: n(106), lockedCash: n(154), lockedYes: n(170), lockedNo: n(186) };
  return value;
}
export function createP2PRpc(fetcher: typeof fetch = fetch) {
  let sequence = 0;
  return async (method: string, params: unknown[] = []): Promise<any> => {
    p2pCheck(
      [
        'getGenesisHash',
        'getMultipleAccounts',
        'getProgramAccounts',
        'getLatestBlockhash',
        'getMinimumBalanceForRentExemption',
        'simulateTransaction',
        'getBlockHeight',
        'isBlockhashValid',
        'getFeeForMessage',
      ].includes(method),
      'P2P_BLOCKED'
    );
    const id = ++sequence;
    const response = await fetcher('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || !response.body) throw new P2PError('P2P_UNAVAILABLE');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const row = await reader.read();
        if (row.done) break;
        length += row.value.length;
        p2pCheck(length <= 1024 * 1024, 'P2P_UNAVAILABLE');
        chunks.push(row.value);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      p2pCheck(value?.id === id && value.jsonrpc === '2.0' && !value.error && Object.hasOwn(value, 'result'), 'P2P_UNAVAILABLE');
      return value.result;
    } finally {
      await reader.cancel();
    }
  };
}
export type P2PRpc = ReturnType<typeof createP2PRpc>;
export function createP2PBookReader(rpc: P2PRpc, clock = Date.now) {
  return async (market: string, wallet: string): Promise<P2PBook> => {
    const startedAt = clock();
    p2pCheck((await rpc('getGenesisHash')) === deployment.genesis, 'P2P_BLOCKED');
    const ids = [market, configAddress(), p2pPosition(market, wallet)];
    const [state, nodes] = await Promise.all([
      rpc('getMultipleAccounts', [ids, { encoding: 'base64', commitment: 'confirmed' }]),
      rpc('getProgramAccounts', [
        deployment.program,
        {
          encoding: 'base64',
          commitment: 'confirmed',
          withContext: true,
          filters: [
            { memcmp: { offset: 0, bytes: bs58.encode(Uint8Array.from(p2pDiscriminators.order)) } },
            { memcmp: { offset: 41, bytes: market } },
          ],
        },
      ]),
    ]);
    p2pCheck(
      Number.isSafeInteger(state?.context?.slot) &&
        Number.isSafeInteger(nodes?.context?.slot) &&
        Array.isArray(state.value) &&
        state.value.length === ids.length &&
        Array.isArray(nodes.value) &&
        nodes.value.length <= 100,
      'P2P_UNAVAILABLE'
    );
    const event = p2pEvent(p2pAccount(state.value[0]), market, clock());
    const config = p2pAccount(state.value[1]);
    p2pCheck(
      config?.owner === deployment.program &&
        !config.executable &&
        config.data.length === 356 &&
        config.data.subarray(0, 8).equals(Buffer.from([119, 255, 200, 88, 252, 82, 128, 24])) &&
        config.data.subarray(244, 276).equals(key(deployment.mint)),
      'P2P_BLOCKED'
    );
    const feeBps = Number(config.data.readBigUInt64LE(192));
    p2pCheck(feeBps >= 0 && feeBps <= 10000, 'P2P_BLOCKED');
    const position = p2pPositionData(p2pAccount(state.value[2]), market, wallet);
    const orders = nodes.value
      .map((row: any) => p2pOrder(row.pubkey, p2pAccount(row.account), market))
      .filter((row: ReturnType<typeof p2pOrder>) => row.amount > 0n)
      .map((row: ReturnType<typeof p2pOrder>) => ({
        address: row.address,
        owner: row.owner,
        side: row.side,
        intent: row.intent,
        price: p2pDecimal(row.price, 9),
        shares: p2pDecimal(row.amount, 6),
      }));
    p2pCheck(clock() - startedAt <= 30000, 'P2P_UNAVAILABLE');
    return {
      marketId: market,
      slot: Math.min(state.context.slot, nodes.context.slot),
      observedAt: startedAt,
      tradingOpen: event.tradingOpen,
      feeBps,
      orders,
      availableCash: p2pDecimal(position.cash, 6),
      yesShares: p2pDecimal(position.yes, 6),
      noShares: p2pDecimal(position.no, 6),
    };
  };
}
