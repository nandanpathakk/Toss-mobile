import { createHash } from 'node:crypto';

import bs58 from 'bs58';

import {
  creationCheck,
  CreationError,
  parseCreationQuote,
  parseCreationRequest,
  parseImageUploadTicket,
  publicCreationUrl,
  type CreationBuild,
  type CreationQuote,
  type CreationRequest,
} from '../../src/lib/panta-creation';
import { type PreflightReport } from '../../src/lib/panta-order-preflight';
import { inspectPrimaryWire } from '../../src/lib/panta-order-signing';
import { p2pDecimal } from '../../src/lib/panta-p2p';
import { decodePurchaseWire, type PurchaseCost } from '../../src/lib/panta-purchase';
import { p2pAccount, p2pAta, p2pPosition, type P2PRpc } from './p2p-chain';
import {
  compileUnsignedPrimary,
  configAddress,
  deployment,
  derive,
  key,
  type AccountSnapshot,
  type ChainAccount,
} from './primary-transaction';

type Identity = { wallet: string; userId: string; expiresAt: string };
type Session = { request: CreationRequest; quote: CreationQuote; userId: string; attempted: boolean; build?: CreationBuild };
const zeroCost: PurchaseCost = {
  amountBaseUnits: '0',
  protocolFeeBaseUnits: '0',
  totalUsdcBaseUnits: '0',
  networkFeeLamports: '0',
  accountRentLamports: '0',
  totalSolLamports: '0',
};
const ctx = { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 6144 } };
export function creationInstruction(request: CreationRequest, quote: CreationQuote, treasury: string) {
  const hash = createHash('sha256').update(request.question).digest();
  const event = derive([Buffer.from('event_usdc'), key(request.wallet), hash]);
  creationCheck(event === quote.expectedEventPda, 'CREATION_BLOCKED');
  const vault = derive([Buffer.from('vault_usdc'), key(request.wallet), hash]);
  const feeVault = derive([Buffer.from('creator_fee_vault_usdc'), key(event)]);
  const ids = [
    request.wallet,
    configAddress(),
    derive([Buffer.from('creator_whitelist')]),
    event,
    vault,
    p2pAta(vault),
    feeVault,
    p2pAta(feeVault),
    p2pPosition(event, request.wallet),
    deployment.mint,
    p2pAta(request.wallet),
    p2pAta(treasury),
    deployment.token,
    deployment.ata,
    deployment.system,
  ];
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const u64 = (n: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n);
    return b;
  };
  const string = (s: string) => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)]);
  const data = Buffer.concat([
    Buffer.from([80, 9, 204, 213, 150, 219, 87, 162]),
    ...[request.startTime, request.endTime, request.resolutionTime].map(n => u64(BigInt(n))),
    string(request.question),
    u64(BigInt(quote.paymentUsdc)),
    string(request.resolutionRule),
    u32(request.sourcesOfTruth.length),
    ...request.sourcesOfTruth.map(string),
  ]);
  return {
    programId: deployment.program,
    data: data.toString('base64'),
    accounts: ids.map((pubkey, i) => ({ pubkey, isSigner: i === 0, isWritable: [0, 3, 4, 5, 6, 7, 8, 10, 11].includes(i) })),
  };
}
export function createCreationService(apiKey: string, fetcher: typeof fetch, rpc: P2PRpc, clock = Date.now) {
  const sessions = new Map<string, Session>();
  const busy = new Set<string>();
  function authorize(identity: Identity, wallet: string) {
    creationCheck(
      identity.wallet === wallet && identity.userId.startsWith('did:privy:') && Date.parse(identity.expiresAt) > clock(),
      'CREATION_BLOCKED'
    );
  }
  async function upstream(path: 'quote' | 'build' | 'image-upload' | 'register', body: unknown) {
    const response = await fetcher(
      `https://live-api.panta.market/api/v1/${path === 'register' ? 'markets/register' : `markets/create/${path}`}/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      }
    );
    creationCheck(response.body, 'CREATION_UNAVAILABLE');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let value: any;
    try {
      for (;;) {
        const row = await reader.read();
        if (row.done) break;
        size += row.value.length;
        creationCheck(size <= 32768, 'CREATION_UNAVAILABLE');
        chunks.push(row.value);
      }
      value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally {
      await reader.cancel();
    }
    if (!response.ok) {
      // Observed upstream internal failure uses a parameter-error status/code.
      // Do not blame the owner's draft or forward upstream diagnostic text.
      if (value?.code === 'INVALID_MARKET_PARAMS' && value.message === 'unexpected create quote failure — check server logs')
        throw new CreationError('CREATION_UNAVAILABLE');
      throw new CreationError(
        ['CREATE_NOT_PERMITTED', 'DUPLICATE_MARKET', 'INVALID_MARKET_PARAMS', 'CREATE_EXPIRED', 'UPLOAD_NOT_CONFIGURED'].includes(
          value?.code
        )
          ? value.code
          : 'CREATION_UNAVAILABLE'
      );
    }
    return value;
  }
  async function accounts(ids: string[], minContextSlot?: number) {
    const row = await rpc('getMultipleAccounts', [ids, { ...ctx, ...(minContextSlot === undefined ? {} : { minContextSlot }) }]);
    creationCheck(
      Number.isSafeInteger(row?.context?.slot) &&
        row.context.slot >= (minContextSlot ?? 0) &&
        Array.isArray(row.value) &&
        row.value.length === ids.length,
      'CREATION_UNAVAILABLE'
    );
    return { slot: row.context.slot as number, values: new Map(ids.map((id, i) => [id, p2pAccount(row.value[i])])) };
  }
  function config(account: ChainAccount | null | undefined) {
    creationCheck(
      account?.owner === deployment.program &&
        !account.executable &&
        account.data.length === 356 &&
        account.data.subarray(0, 8).equals(Buffer.from([119, 255, 200, 88, 252, 82, 128, 24])) &&
        account.data.subarray(244, 276).equals(key(deployment.mint)),
      'CREATION_BLOCKED'
    );
    const d = account.data;
    const payment = d.readBigUInt64LE(340),
      liquidity = d.readBigUInt64LE(348),
      delay = d.readBigInt64LE(176);
    creationCheck(payment > 0n && liquidity <= payment && delay >= 0n && delay <= 31536000n, 'CREATION_BLOCKED');
    return { treasury: bs58.encode(d.subarray(136, 168)), payment, liquidity, delay };
  }
  async function checkRequest(request: CreationRequest) {
    creationCheck((await rpc('getGenesisHash')) === deployment.genesis, 'CREATION_BLOCKED');
    const event = derive([Buffer.from('event_usdc'), key(request.wallet), createHash('sha256').update(request.question).digest()]);
    const state = await accounts([configAddress(), event]);
    const values = config(state.values.get(configAddress()));
    creationCheck(!state.values.get(event), 'DUPLICATE_MARKET');
    const minimumStartTime = Math.floor(clock() / 1000) + Number(values.delay);
    if (request.startTime < minimumStartTime) throw new CreationError('CREATION_START_TOO_SOON', minimumStartTime);
    return values;
  }
  async function checkQuote(request: CreationRequest, quote: CreationQuote, checked?: Awaited<ReturnType<typeof checkRequest>>) {
    const values = checked ?? (await checkRequest(request));
    creationInstruction(request, quote, values.treasury);
    creationCheck(
      BigInt(quote.paymentUsdc) === values.payment && BigInt(quote.liquidityInjectionUsdc) === values.liquidity,
      'INVALID_MARKET_PARAMS'
    );
    return values;
  }
  async function simulate(build: CreationBuild, bound: boolean): Promise<PreflightReport> {
    creationCheck(Date.parse(build.expiresAt) > clock(), 'CREATE_EXPIRED');
    await checkQuote(build.creation.request, build.creation.quote);
    const compiled = compileUnsignedPrimary(build);
    inspectPrimaryWire(compiled.transaction, build);
    const ids = [...compiled.keys, deployment.programData];
    const writable = compiled.keys.filter(id => build.instructions[0].accounts.some(a => a.pubkey === id && a.isWritable));
    let before = await accounts(ids);
    let result: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      // Pair reads to reduce bank drift; exact returned-slot equality remains required.
      const minimumSlot = Math.max(before.slot, Number.isSafeInteger(result?.context?.slot) ? result.context.slot : 0);
      [before, result] = await Promise.all([
        accounts(ids, minimumSlot),
        rpc('simulateTransaction', [
          compiled.transaction.toString('base64'),
          {
            encoding: 'base64',
            commitment: 'confirmed',
            minContextSlot: minimumSlot,
            sigVerify: false,
            replaceRecentBlockhash: false,
            accounts: { encoding: 'base64', addresses: writable },
          },
        ]),
      ]);
      if (result?.context?.slot === before.slot) break;
    }
    creationCheck(result?.context?.slot === before.slot && result?.value?.err === null, 'CREATION_BLOCKED');
    const pre = before.values;
    const c = config(pre.get(configAddress()));
    creationCheck(
      JSON.stringify(build.instructions[0]) ===
        JSON.stringify(creationInstruction(build.creation.request, build.creation.quote, c.treasury)),
      'CREATION_BLOCKED'
    );
    const program = pre.get(deployment.program),
      programData = pre.get(deployment.programData),
      mint = pre.get(deployment.mint),
      payer = pre.get(build.wallet);
    creationCheck(
      program?.owner === deployment.loader &&
        program.executable &&
        program.data.length === 36 &&
        program.data.readUInt32LE(0) === 2 &&
        program.data.subarray(4).equals(key(deployment.programData)),
      'CREATION_BLOCKED'
    );
    creationCheck(
      programData?.owner === deployment.loader &&
        !programData.executable &&
        programData.data.length >= 45 &&
        programData.data.readUInt32LE(0) === 3 &&
        programData.data.readBigUInt64LE(4) === deployment.deployedSlot,
      'CREATION_BLOCKED'
    );
    creationCheck(
      mint?.owner === deployment.token &&
        mint.data.length === 82 &&
        mint.data[44] === 6 &&
        mint.data[45] === 1 &&
        payer?.owner === deployment.system &&
        !payer.executable &&
        payer.data.length === 0,
      'CREATION_BLOCKED'
    );
    creationCheck(Array.isArray(result.value.accounts) && result.value.accounts.length === writable.length, 'CREATION_BLOCKED');
    const after: AccountSnapshot = new Map(writable.map((id, i) => [id, p2pAccount(result.value.accounts[i])]));
    const rent = new Map<number, number>();
    await Promise.all(
      [165, 89, 202, 2982].map(async size => {
        const n = await rpc('getMinimumBalanceForRentExemption', [size, { commitment: 'confirmed' }]);
        creationCheck(Number.isSafeInteger(n) && n > 0, 'CREATION_UNAVAILABLE');
        rent.set(size, n);
      })
    );
    const cost = validateCreationEconomics(build, compiled.keys, pre, after, result.value, rent);
    const snapshotHash = createHash('sha256')
      .update(
        ids
          .map(id => {
            const a = pre.get(id);
            return `${id}:${a?.owner}:${a?.executable}:${a?.lamports}:${a?.data.toString('base64')}`;
          })
          .join('|')
      )
      .digest('hex');
    if (bound)
      creationCheck(
        snapshotHash === build.creation.snapshotHash && JSON.stringify(cost) === JSON.stringify(build.creation.cost),
        'CREATE_EXPIRED'
      );
    const [height, valid, fee] = await Promise.all([
      rpc('getBlockHeight', [{ commitment: 'confirmed' }]),
      rpc('isBlockhashValid', [build.recentBlockhash, { commitment: 'confirmed', minContextSlot: before.slot }]),
      rpc('getFeeForMessage', [compiled.message.toString('base64'), { commitment: 'confirmed', minContextSlot: before.slot }]),
    ]);
    creationCheck(
      Number.isSafeInteger(height) &&
        height <= build.lastValidBlockHeight &&
        valid?.value === true &&
        fee?.value === Number(cost.networkFeeLamports) &&
        Date.parse(build.expiresAt) > clock(),
      'CREATE_EXPIRED'
    );
    if (!bound) build.creation = { ...build.creation, cost, snapshotHash };
    return {
      orderId: build.orderId,
      wallet: build.wallet,
      chain: 'mainnet-beta',
      status: 'simulated',
      code: null,
      cost,
      networkFeeLamports: cost.networkFeeLamports,
      messageHash: compiled.messageHash,
      signable: false,
      executionProtection: false,
    };
  }
  function session(id: string, identity: Identity) {
    const entry = sessions.get(id);
    creationCheck(entry && entry.userId === identity.userId, 'CREATE_EXPIRED');
    authorize(identity, entry.request.wallet);
    return entry;
  }
  return {
    upload: async (identity: Identity) => {
      authorize(identity, identity.wallet);
      return parseImageUploadTicket(await upstream('image-upload', {}), clock());
    },
    quote: async (value: unknown, identity: Identity) => {
      const request = parseCreationRequest(value, clock());
      authorize(identity, request.wallet);
      creationCheck(!busy.has(identity.wallet), 'CREATION_UNAVAILABLE');
      busy.add(identity.wallet);
      try {
        for (const [id, e] of sessions) if (Date.parse(e.quote.expiresAt) <= clock()) sessions.delete(id);
        creationCheck(sessions.size < 100, 'CREATION_UNAVAILABLE');
        // Reject known on-chain timing/duplicate failures before reserving an
        // upstream session. Reuse this read for quote economics; builds reread it.
        const checked = await checkRequest(request);
        const quote = parseCreationQuote(await upstream('quote', request), clock());
        creationCheck(!sessions.has(quote.createId), 'CREATION_BLOCKED');
        await checkQuote(request, quote, checked);
        sessions.set(quote.createId, { request, quote, userId: identity.userId, attempted: false });
        return quote;
      } finally {
        busy.delete(identity.wallet);
      }
    },
    build: async (id: string, identity: Identity) => {
      const e = session(id, identity);
      creationCheck(!e.attempted && Date.parse(e.quote.expiresAt) > clock(), 'CREATE_EXPIRED');
      e.attempted = true;
      const c = await checkQuote(e.request, e.quote);
      const value = await upstream('build', { createId: id, wallet: identity.wallet });
      creationCheck(
        value?.createId === id &&
          value.expectedEventPda === e.quote.expectedEventPda &&
          value.marketType === 'standard' &&
          ['paymentUsdc', 'liquidityInjectionUsdc', 'platformRevenueUsdc'].every(k => value[k] === e.quote[k as keyof CreationQuote]) &&
          typeof value.buildFingerprint === 'string' &&
          /^[A-Za-z0-9_-]{1,256}$/.test(value.buildFingerprint),
        'CREATION_BLOCKED'
      );
      creationCheck(
        typeof value.expiresAt === 'string' &&
          Date.parse(value.expiresAt) > clock() &&
          Date.parse(value.expiresAt) <= Date.parse(e.quote.expiresAt) &&
          Number.isSafeInteger(value.lastValidBlockHeight) &&
          value.lastValidBlockHeight > 0,
        'CREATE_EXPIRED'
      );
      const build: CreationBuild = {
        orderId: id,
        quoteId: id,
        marketId: e.quote.expectedEventPda,
        wallet: identity.wallet,
        side: 'yes',
        expectedShares: '0',
        amountUsdc: p2pDecimal(BigInt(e.quote.liquidityInjectionUsdc), 6),
        feeUsdc: p2pDecimal(BigInt(e.quote.platformRevenueUsdc), 6),
        status: 'built',
        disclaimer: null,
        instructions: [creationInstruction(e.request, e.quote, c.treasury)],
        recentBlockhash: value.recentBlockhash,
        lastValidBlockHeight: value.lastValidBlockHeight,
        expiresAt: new Date(Math.min(Date.parse(value.expiresAt), clock() + 60000)).toISOString(),
        creation: { request: e.request, quote: e.quote, cost: { ...zeroCost }, snapshotHash: '' },
      };
      const wire = decodePurchaseWire(value.transaction);
      const compiled = compileUnsignedPrimary(build);
      creationCheck(Buffer.from(wire).equals(compiled.transaction), 'CREATION_BLOCKED');
      await simulate(build, false);
      e.build = build;
      return structuredClone(build);
    },
    get: (id: string, identity: Identity) => {
      const e = session(id, identity);
      creationCheck(e.build && Date.parse(e.build.expiresAt) > clock(), 'CREATE_EXPIRED');
      return structuredClone(e.build);
    },
    preflight: async (build: CreationBuild) => {
      const e = sessions.get(build.orderId);
      creationCheck(e?.build && JSON.stringify(e.build) === JSON.stringify(build), 'CREATE_EXPIRED');
      return simulate(build, true);
    },
    register: async (record: { wallet: string; orderId: string; marketId: string; signature: string }) => {
      const e = sessions.get(record.orderId);
      // A confirmed receipt survives a gateway restart. Panta verifies the original
      // createId/signature pair; local session metadata adds a stricter cover check when present.
      creationCheck(!e || (e.request.wallet === record.wallet && e.quote.expectedEventPda === record.marketId), 'CREATE_EXPIRED');
      const value = await upstream('register', { createId: record.orderId, signature: record.signature });
      creationCheck(
        value?.createId === record.orderId &&
          value.marketId === record.marketId &&
          value.signature === record.signature &&
          value.status === 'registered' &&
          Array.isArray(value.images) &&
          value.images.length === 1 &&
          typeof value.images[0] === 'string' &&
          publicCreationUrl(value.images[0]) &&
          (!e || value.images[0] === e.request.imageUrl),
        'CREATION_BLOCKED'
      );
      return { marketId: record.marketId, status: 'registered' as const };
    },
  };
}

export function validateCreationEconomics(
  build: CreationBuild,
  keys: string[],
  before: AccountSnapshot,
  after: AccountSnapshot,
  sim: any,
  rents: Map<number, number>
): PurchaseCost {
  const check = (ok: unknown) => creationCheck(ok, 'CREATION_BLOCKED');
  const ids = build.instructions[0].accounts.map(a => a.pubkey),
    quote = build.creation.quote;
  const integer = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
  check(
    integer(sim.fee) &&
      sim.fee > 0 &&
      Array.isArray(sim.preBalances) &&
      Array.isArray(sim.postBalances) &&
      sim.preBalances.length === keys.length &&
      sim.postBalances.length === keys.length
  );
  const creates = new Map([
    [ids[3], 2982],
    [ids[5], 165],
    [ids[6], 89],
    [ids[7], 165],
    [ids[8], 202],
  ]);
  let rent = 0n;
  for (let i = 0; i < keys.length; i++) {
    const id = keys[i],
      pre = before.get(id),
      post = after.get(id);
    check(integer(sim.preBalances[i]) && integer(sim.postBalances[i]) && sim.preBalances[i] === (pre?.lamports ?? 0));
    if (after.has(id)) check(sim.postBalances[i] === (post?.lamports ?? 0));
    if (id === build.wallet) continue;
    let delta = 0n;
    if (creates.has(id)) {
      const size = creates.get(id)!;
      check(
        !pre &&
          post &&
          !post.executable &&
          post.data.length === size &&
          post.lamports === rents.get(size) &&
          post.owner === (size === 165 ? deployment.token : deployment.program)
      );
      delta = BigInt(post!.lamports);
      rent += delta;
    }
    check(BigInt(sim.postBalances[i]) - BigInt(sim.preBalances[i]) === delta);
  }
  const payer = keys.indexOf(build.wallet);
  check(BigInt(sim.preBalances[payer]) - BigInt(sim.postBalances[payer]) === BigInt(sim.fee) + rent);
  const tokenIds = [ids[10], ids[5], ids[7], ids[11]];
  const owners = [build.wallet, ids[4], ids[6], bs58.encode(before.get(configAddress())!.data.subarray(136, 168))];
  function tokens(rows: any[], snapshot: AccountSnapshot, post: boolean) {
    check(Array.isArray(rows));
    const result = new Map<string, bigint>();
    for (const row of rows) {
      check(integer(row.accountIndex) && row.accountIndex < keys.length);
      const id = keys[row.accountIndex],
        index = tokenIds.indexOf(id),
        a = snapshot.get(id);
      check(
        index >= 0 &&
          !result.has(id) &&
          a?.owner === deployment.token &&
          !a.executable &&
          a.data.length === 165 &&
          a.data.subarray(0, 32).equals(key(deployment.mint)) &&
          a.data.subarray(32, 64).equals(key(owners[index])) &&
          a.data[108] === 1 &&
          a.data.readUInt32LE(72) === 0 &&
          a.data.readUInt32LE(109) === 0 &&
          a.data.readBigUInt64LE(121) === 0n &&
          a.data.readUInt32LE(129) === 0 &&
          row.owner === owners[index] &&
          row.mint === deployment.mint &&
          row.uiTokenAmount?.decimals === 6 &&
          /^(0|[1-9]\d{0,19})$/.test(row.uiTokenAmount.amount) &&
          a.data.readBigUInt64LE(64) === BigInt(row.uiTokenAmount.amount)
      );
      result.set(id, BigInt(row.uiTokenAmount.amount));
    }
    for (const id of tokenIds)
      if (!result.has(id)) {
        check(!post && !snapshot.get(id) && [ids[5], ids[7]].includes(id));
        result.set(id, 0n);
      }
    return result;
  }
  const preTokens = tokens(sim.preTokenBalances, before, false),
    postTokens = tokens(sim.postTokenBalances, after, true);
  check(postTokens.get(ids[10])! - preTokens.get(ids[10])! === -BigInt(quote.paymentUsdc));
  check(postTokens.get(ids[5])! - preTokens.get(ids[5])! === BigInt(quote.liquidityInjectionUsdc));
  check(postTokens.get(ids[11])! - preTokens.get(ids[11])! === BigInt(quote.platformRevenueUsdc));
  check(postTokens.get(ids[7]) === 0n);
  const event = after.get(ids[3])!.data,
    request = build.creation.request;
  check(
    event.subarray(0, 8).equals(Buffer.from([125, 192, 125, 158, 9, 115, 152, 233])) &&
      event.subarray(8, 40).equals(key(build.wallet)) &&
      event.readBigInt64LE(40) === BigInt(request.startTime) &&
      event.readBigInt64LE(48) === BigInt(request.endTime) &&
      event.readBigInt64LE(56) === BigInt(request.resolutionTime)
  );
  let offset = 328;
  function string(expected: string) {
    const length = event.readUInt32LE(offset);
    offset += 4;
    check(length === Buffer.byteLength(expected) && event.subarray(offset, offset + length).equals(Buffer.from(expected)));
    offset += length;
  }
  string(request.question);
  string(request.resolutionRule);
  check(event.readUInt32LE(offset) === request.sourcesOfTruth.length);
  offset += 4;
  for (const source of request.sourcesOfTruth) string(source);
  // Do not infer creator seed shares or promise a payout from the liquidity fee.
  const feeVault = after.get(ids[6])!.data;
  check(
    feeVault.subarray(0, 8).equals(Buffer.from([21, 14, 215, 247, 197, 137, 200, 121])) &&
      feeVault.subarray(72, 88).every(n => n === 0) &&
      feeVault.subarray(8, 40).equals(key(build.marketId)) &&
      feeVault.subarray(40, 72).equals(key(build.wallet))
  );
  const position = after.get(ids[8])!.data;
  check(
    position.subarray(0, 8).equals(Buffer.from([251, 248, 209, 245, 83, 234, 17, 27])) &&
      position[8] === 1 &&
      position.subarray(9, 41).equals(key(build.marketId)) &&
      position.subarray(41, 73).equals(key(build.wallet))
  );
  return {
    amountBaseUnits: quote.liquidityInjectionUsdc,
    protocolFeeBaseUnits: quote.platformRevenueUsdc,
    totalUsdcBaseUnits: quote.paymentUsdc,
    networkFeeLamports: String(sim.fee),
    accountRentLamports: rent.toString(),
    totalSolLamports: (BigInt(sim.fee) + rent).toString(),
  };
}
