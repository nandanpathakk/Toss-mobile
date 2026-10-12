import { createHash, randomBytes } from 'node:crypto';

import bs58 from 'bs58';

import { type OrderInstruction } from '../../src/lib/panta-order-build';
import { type PreflightReport } from '../../src/lib/panta-order-preflight';
import { inspectPrimaryWire } from '../../src/lib/panta-order-signing';
import {
  p2pCheck,
  p2pDecimal,
  p2pMaxPeers,
  p2pUnits,
  parseP2PRequest,
  type P2PBuild,
  type P2PFacts,
  type P2PRequest,
} from '../../src/lib/panta-p2p';
import { type PurchaseCost } from '../../src/lib/panta-purchase';
import {
  p2pAccount,
  p2pAta,
  p2pDiscriminators,
  p2pEvent,
  p2pLevel,
  p2pNode,
  p2pOrder,
  p2pOwned,
  p2pPosition,
  p2pPositionData,
  p2pU64,
  type P2PRpc,
} from './p2p-chain';
import {
  compileUnsignedPrimary,
  configAddress,
  deployment,
  derive,
  key,
  type AccountSnapshot,
  type ChainAccount,
} from './primary-transaction';

type Node = ReturnType<typeof p2pOrder>;
type Plan = {
  build: P2PBuild;
  peers: Node[];
  own: Node | null;
  addresses: {
    user: string;
    position: string;
    vault: string;
    vaultAta: string;
    creatorAta: string;
    treasuryAta: string;
    level: string | null;
    node: string | null;
  };
};
const context = { encoding: 'base64', commitment: 'confirmed' } as const;
const placeholderFacts: P2PFacts = {
  filledShares: '0',
  remainingShares: '0',
  lockedUsdc: '0',
  refundUsdc: '0',
  cashCreditUsdc: '0',
  rentRefundLamports: '0',
};
const placeholderCost: PurchaseCost = {
  amountBaseUnits: '0',
  protocolFeeBaseUnits: '0',
  totalUsdcBaseUnits: '0',
  networkFeeLamports: '0',
  accountRentLamports: '0',
  totalSolLamports: '0',
};
export function createP2POrders(rpc: P2PRpc, clock = Date.now, nonceBytes = () => randomBytes(8)) {
  const sessions = new Map<string, Plan>();
  const planning = new Set<string>();
  async function accounts(ids: string[], minContextSlot?: number) {
    const result = await rpc('getMultipleAccounts', [
      ids,
      { ...context, dataSlice: { offset: 0, length: 6144 }, ...(minContextSlot === undefined ? {} : { minContextSlot }) },
    ]);
    p2pCheck(
      Number.isSafeInteger(result?.context?.slot) &&
        result.context.slot >= (minContextSlot ?? 0) &&
        Array.isArray(result.value) &&
        result.value.length === ids.length,
      'P2P_UNAVAILABLE'
    );
    return { slot: result.context.slot as number, values: new Map(ids.map((id, i) => [id, p2pAccount(result.value[i])])) };
  }
  async function plan(input: P2PRequest): Promise<Plan> {
    const startedAt = clock();
    const request = parseP2PRequest(input);
    p2pCheck((await rpc('getGenesisHash')) === deployment.genesis, 'P2P_BLOCKED');
    const position = p2pPosition(request.marketId, request.wallet);
    const initial = await accounts([request.marketId, configAddress(), position, p2pAta(request.wallet)]);
    const event = p2pEvent(initial.values.get(request.marketId)!, request.marketId, clock());
    if (request.intent === 'buy' || request.intent === 'sell') p2pCheck(event.tradingOpen, 'P2P_CLOSED');
    const config = initial.values.get(configAddress());
    p2pCheck(
      config?.owner === deployment.program &&
        config.data.length === 356 &&
        config.data.subarray(0, 8).equals(Buffer.from([119, 255, 200, 88, 252, 82, 128, 24])) &&
        config.data.subarray(244, 276).equals(key(deployment.mint)),
      'P2P_BLOCKED'
    );
    const bps = config.data.readBigUInt64LE(192);
    p2pCheck(bps <= 10000n, 'P2P_BLOCKED');
    const maxPeers = Math.min(p2pMaxPeers, config.data.readUInt32LE(224));
    const creatorFee = derive([Buffer.from('creator_fee_vault_usdc'), key(request.marketId)]);
    const a = {
      user: p2pAta(request.wallet),
      position,
      vault: event.vault,
      vaultAta: p2pAta(event.vault),
      creatorAta: p2pAta(creatorFee),
      treasuryAta: p2pAta(bs58.encode(config.data.subarray(136, 168))),
      level: null as string | null,
      node: null as string | null,
    };
    const peers: Node[] = [];
    let own: Node | null = null;
    let instructionData: Buffer;
    let keys: string[];
    let writes: number[];
    const remaining: string[] = [];
    let amount = 0n;
    let fee = 0n;
    if (request.intent === 'cancel') {
      const found = await accounts([request.order!]);
      own = p2pOrder(request.order!, found.values.get(request.order!)!, request.marketId);
      p2pCheck(own.owner === request.wallet && own.amount > 0n, 'P2P_BLOCKED');
      for (const [linked, direction] of [
        [own.prev, 'next'],
        [own.next, 'prev'],
      ] as const) {
        if (linked === deployment.system) continue;
        const neighbor = await accounts([linked]);
        const node = p2pOrder(linked, neighbor.values.get(linked)!, request.marketId);
        p2pCheck(node.level === own.level && node.intent === own.intent && node[direction] === own.address, 'P2P_BLOCKED');
      }
      a.level = own.level;
      a.node = own.address;
      keys = [
        request.wallet,
        configAddress(),
        request.marketId,
        position,
        a.vault,
        a.vaultAta,
        a.user,
        own.level,
        own.address,
        own.prev === deployment.system ? deployment.program : own.prev,
        own.next === deployment.system ? deployment.program : own.next,
        deployment.mint,
        deployment.token,
        deployment.ata,
        deployment.system,
      ];
      writes = [0, 3, 5, 6, 7, 8, ...(own.prev === deployment.system ? [] : [9]), ...(own.next === deployment.system ? [] : [10])];
      instructionData = Buffer.from([5, 36, 88, 69, 68, 29, 186, 30]);
    } else if (request.intent === 'withdraw') {
      const cash = p2pPositionData(initial.values.get(position), request.marketId, request.wallet).cash;
      p2pCheck(cash > 0n && cash <= 18446744073709551615n, 'P2P_BLOCKED');
      const limit = Buffer.alloc(16);
      limit.writeBigUInt64LE(cash);
      instructionData = Buffer.concat([Buffer.from([59, 240, 239, 57, 94, 149, 99, 18]), key(request.wallet), Buffer.from([1]), limit]);
      keys = [
        request.wallet,
        configAddress(),
        request.marketId,
        a.vault,
        a.vaultAta,
        position,
        a.user,
        deployment.mint,
        deployment.token,
        deployment.ata,
        deployment.system,
      ];
      writes = [0, 4, 5, 6];
    } else {
      const price = p2pUnits(request.price, 9);
      const quantity = p2pUnits(request.shares, 6);
      const gross = (price * quantity) / 1000000000n;
      p2pCheck(gross >= 100000n && gross <= 18446744073709551615n, 'INVALID_P2P');
      amount = request.intent === 'buy' ? gross : 0n;
      fee = (amount * bps) / 10000n;
      a.level = p2pLevel(request.marketId, price);
      const nonce = nonceBytes().readBigUInt64LE();
      a.node = p2pNode(a.level, request.wallet, nonce);
      const levelState = await accounts([a.level]);
      const levelAccount = levelState.values.get(a.level);
      if (levelAccount) {
        const d = p2pOwned(levelAccount, p2pDiscriminators.level, 218);
        p2pCheck(d[8] === 1 && bs58.encode(d.subarray(9, 41)) === request.marketId && d.readBigUInt64LE(41) === price, 'P2P_BLOCKED');
        let head = bs58.encode(d.subarray(request.intent === 'buy' ? 154 : 90, request.intent === 'buy' ? 186 : 122));
        const tail = bs58.encode(d.subarray(request.intent === 'buy' ? 122 : 186, request.intent === 'buy' ? 154 : 218));
        const seen = new Set<string>();
        let available = 0n;
        while (head !== deployment.system && available < quantity) {
          p2pCheck(peers.length < maxPeers && !seen.has(head), 'P2P_COMPLEX_BOOK');
          p2pCheck(clock() - startedAt <= 30000, 'P2P_UNAVAILABLE');
          seen.add(head);
          const source = await accounts([head]);
          const peer = p2pOrder(head, source.values.get(head)!, request.marketId);
          p2pCheck(
            peer.level === a.level &&
              peer.side === request.side &&
              peer.intent !== request.intent &&
              peer.prev === (peers.at(-1)?.address ?? deployment.system) &&
              peer.owner !== request.wallet &&
              peer.amount > 0n,
            'P2P_COMPLEX_BOOK'
          );
          peers.push(peer);
          remaining.push(head, p2pPosition(request.marketId, peer.owner));
          available += peer.amount;
          head = peer.next;
        }
        if (tail !== deployment.system) {
          const source = await accounts([tail]);
          const node = p2pOrder(tail, source.values.get(tail)!, request.marketId);
          p2pCheck(node.level === a.level && node.intent === request.intent && node.next === deployment.system, 'P2P_BLOCKED');
          remaining.push(tail);
        }
      }
      instructionData = Buffer.concat([
        Buffer.from([110, 71, 240, 5, 180, 192, 163, 177]),
        Buffer.from([request.side === 'yes' ? 0 : 1]),
        p2pU64(price),
        p2pU64(quantity),
        Buffer.from([request.intent === 'buy' ? 1 : 0]),
        p2pU64(nonce),
        key(a.level),
      ]);
      keys = [
        request.wallet,
        configAddress(),
        request.marketId,
        position,
        a.level,
        a.node,
        a.vault,
        a.vaultAta,
        creatorFee,
        a.creatorAta,
        a.treasuryAta,
        a.user,
        deployment.mint,
        deployment.token,
        deployment.ata,
        deployment.system,
        ...remaining,
      ];
      writes = [0, 2, 3, 4, 5, 7, 8, 9, 10, 11, ...remaining.map((_, i) => 16 + i)];
    }
    const instructions: OrderInstruction[] = [
      {
        programId: deployment.program,
        data: instructionData.toString('base64'),
        accounts: keys.map((pubkey, i) => ({ pubkey, isSigner: i === 0, isWritable: writes.includes(i) })),
      },
    ];
    if (!initial.values.get(a.user))
      instructions.unshift({
        programId: deployment.ata,
        data: 'AQ==',
        accounts: [
          [request.wallet, true, true],
          [a.user, false, true],
          [request.wallet, false, false],
          [deployment.mint, false, false],
          [deployment.system, false, false],
          [deployment.token, false, false],
        ].map(([pubkey, isSigner, isWritable]) => ({
          pubkey: pubkey as string,
          isSigner: isSigner as boolean,
          isWritable: isWritable as boolean,
        })),
      });
    const block = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    p2pCheck(block?.value && Number.isSafeInteger(block.value.lastValidBlockHeight), 'P2P_UNAVAILABLE');
    const id = `p2p_${randomBytes(16).toString('hex')}`;
    const build: P2PBuild = {
      orderId: id,
      quoteId: id,
      wallet: request.wallet,
      marketId: request.marketId,
      side: request.side,
      amountUsdc: p2pDecimal(amount, 6),
      feeUsdc: p2pDecimal(fee, 6),
      expectedShares: request.shares,
      status: 'built',
      instructions,
      recentBlockhash: block.value.blockhash,
      lastValidBlockHeight: block.value.lastValidBlockHeight,
      expiresAt: new Date(clock() + 60000).toISOString(),
      disclaimer: null,
      p2p: { request, facts: { ...placeholderFacts }, cost: { ...placeholderCost }, snapshotHash: '' },
    };
    // Check the actual wire, including repeated makers, append tail and ATA setup.
    // Never truncate a queue to fit: that would change the reviewed order semantics.
    try {
      compileUnsignedPrimary(build);
    } catch {
      p2pCheck(false, 'P2P_COMPLEX_BOOK');
    }
    p2pCheck(clock() - startedAt <= 30000, 'P2P_UNAVAILABLE');
    return { build, peers, own, addresses: a };
  }
  async function simulate(plan: Plan, bound = false): Promise<{ facts: P2PFacts; cost: PurchaseCost; snapshotHash: string }> {
    const { build, addresses: a } = plan;
    p2pCheck(Date.parse(build.expiresAt) > clock(), 'P2P_CHANGED');
    const compiled = compileUnsignedPrimary(build);
    inspectPrimaryWire(compiled.transaction, build);
    const ids = [...new Set([...compiled.keys, deployment.programData, deployment.mint, configAddress(), build.marketId, a.position])];
    const rents = new Map<number, number>();
    await Promise.all(
      [165, 202, 218, 269].map(async size => {
        const value = await rpc('getMinimumBalanceForRentExemption', [size, { commitment: 'confirmed' }]);
        p2pCheck(Number.isSafeInteger(value) && value > 0, 'P2P_UNAVAILABLE');
        rents.set(size, value);
      })
    );
    const requested = compiled.keys.filter(address =>
      build.instructions.some(ix => ix.accounts.some(meta => meta.pubkey === address && meta.isWritable))
    );
    let snapshot = await accounts(ids);
    let result: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      // Parallel reads reduce bank drift. Both must still return the exact same confirmed slot.
      const minimumSlot = Math.max(snapshot.slot, Number.isSafeInteger(result?.context?.slot) ? result.context.slot : 0);
      [snapshot, result] = await Promise.all([
        accounts(ids, minimumSlot),
        rpc('simulateTransaction', [
          compiled.transaction.toString('base64'),
          {
            ...context,
            minContextSlot: minimumSlot,
            sigVerify: false,
            replaceRecentBlockhash: false,
            innerInstructions: false,
            accounts: { encoding: 'base64', addresses: requested },
          },
        ]),
      ]);
      if (result?.context?.slot === snapshot.slot) break;
    }
    p2pCheck(result?.context?.slot === snapshot.slot && result.value && Object.hasOwn(result.value, 'err'), 'P2P_UNAVAILABLE');
    p2pCheck(result.value.err === null, 'P2P_BLOCKED');
    const values = snapshot.values;
    const payer = values.get(build.wallet);
    p2pCheck(payer?.owner === deployment.system && !payer.executable && payer.data.length === 0, 'P2P_BLOCKED');
    const program = values.get(deployment.program);
    const programData = values.get(deployment.programData);
    p2pCheck(
      program?.owner === deployment.loader &&
        program.executable &&
        program.data.length === 36 &&
        program.data.readUInt32LE(0) === 2 &&
        program.data.subarray(4).equals(key(deployment.programData)),
      'P2P_BLOCKED'
    );
    p2pCheck(
      programData?.owner === deployment.loader &&
        !programData.executable &&
        programData.data.length >= 45 &&
        programData.data.readUInt32LE(0) === 3 &&
        programData.data.readBigUInt64LE(4) === deployment.deployedSlot,
      'P2P_BLOCKED'
    );
    const event = p2pEvent(values.get(build.marketId)!, build.marketId, clock());
    if (['buy', 'sell'].includes(build.p2p.request.intent)) p2pCheck(event.tradingOpen && event.vault === a.vault, 'P2P_CLOSED');
    const config = values.get(configAddress());
    p2pCheck(
      config?.owner === deployment.program &&
        !config.executable &&
        config.data.length === 356 &&
        config.data.subarray(0, 8).equals(Buffer.from([119, 255, 200, 88, 252, 82, 128, 24])) &&
        config.data.subarray(244, 276).equals(key(deployment.mint)),
      'P2P_BLOCKED'
    );
    const mint = values.get(deployment.mint);
    p2pCheck(mint?.owner === deployment.token && mint.data.length === 82 && mint.data[44] === 6 && mint.data[45] === 1, 'P2P_BLOCKED');
    p2pCheck(a.treasuryAta === p2pAta(bs58.encode(config.data.subarray(136, 168))), 'P2P_CHANGED');
    const snapshotHash = createHash('sha256')
      .update(
        ids
          .map(id => {
            const value = values.get(id);
            return `${id}:${value?.owner}:${value?.executable}:${value?.lamports}:${value?.data.toString('base64')}`;
          })
          .join('|')
      )
      .digest('hex');
    if (bound) p2pCheck(snapshotHash === build.p2p.snapshotHash, 'P2P_CHANGED');
    const post = new Map<string, ChainAccount | null>();
    p2pCheck(Array.isArray(result.value.accounts) && result.value.accounts.length === requested.length, 'P2P_UNAVAILABLE');
    requested.forEach((id, i) => post.set(id, p2pAccount(result.value.accounts[i])));
    const outcome = validateP2PEconomics(plan, compiled.keys, values, post, result.value, rents);
    if (bound)
      p2pCheck(
        JSON.stringify(outcome.facts) === JSON.stringify(build.p2p.facts) &&
          JSON.stringify(outcome.cost) === JSON.stringify(build.p2p.cost),
        'P2P_CHANGED'
      );
    const [height, valid, fee] = await Promise.all([
      rpc('getBlockHeight', [{ commitment: 'confirmed' }]),
      rpc('isBlockhashValid', [build.recentBlockhash, { commitment: 'confirmed', minContextSlot: snapshot.slot }]),
      rpc('getFeeForMessage', [compiled.message.toString('base64'), { commitment: 'confirmed', minContextSlot: snapshot.slot }]),
    ]);
    p2pCheck(
      Number.isSafeInteger(height) &&
        height <= build.lastValidBlockHeight &&
        valid?.value === true &&
        fee?.value === Number(outcome.cost.networkFeeLamports) &&
        Date.parse(build.expiresAt) > clock(),
      'P2P_CHANGED'
    );
    return { ...outcome, snapshotHash };
  }
  return {
    build: async (input: P2PRequest) => {
      const request = parseP2PRequest(input);
      p2pCheck(!planning.has(request.wallet), 'P2P_UNAVAILABLE');
      planning.add(request.wallet);
      try {
        for (const [id, value] of sessions) if (Date.parse(value.build.expiresAt) <= clock()) sessions.delete(id);
        p2pCheck(sessions.size < 100, 'P2P_UNAVAILABLE');
        const value = await plan(request);
        const outcome = await simulate(value);
        value.build.p2p = { ...value.build.p2p, ...outcome };
        sessions.set(value.build.orderId, value);
        return structuredClone(value.build);
      } finally {
        planning.delete(request.wallet);
      }
    },
    get: (orderId: string, wallet: string) => {
      const value = sessions.get(orderId);
      p2pCheck(value && value.build.wallet === wallet && Date.parse(value.build.expiresAt) > clock(), 'P2P_CHANGED');
      return structuredClone(value.build);
    },
    preflight: async (source: P2PBuild): Promise<PreflightReport> => {
      const value = sessions.get(source.orderId);
      p2pCheck(value && JSON.stringify(value.build) === JSON.stringify(source), 'P2P_CHANGED');
      const result = await simulate(value, true);
      return {
        orderId: source.orderId,
        wallet: source.wallet,
        chain: 'mainnet-beta',
        status: 'simulated',
        code: null,
        networkFeeLamports: result.cost.networkFeeLamports,
        messageHash: compileUnsignedPrimary(source).messageHash,
        cost: result.cost,
        signable: false,
        executionProtection: false,
      };
    },
  };
}

export function validateP2PEconomics(
  plan: Plan,
  keys: string[],
  before: AccountSnapshot,
  after: AccountSnapshot,
  simulation: any,
  rents: Map<number, number>
) {
  const { build, addresses: a, peers, own } = plan;
  const request = build.p2p.request;
  const check = (ok: unknown) => p2pCheck(ok, 'P2P_BLOCKED');
  const integer = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
  check(integer(simulation.fee) && simulation.fee > 0);
  const readPosition = (map: AccountSnapshot, owner: string) =>
    p2pPositionData(map.get(p2pPosition(build.marketId, owner)), build.marketId, owner);
  const previous = readPosition(before, build.wallet);
  const next = readPosition(after, build.wallet);
  const facts = { ...placeholderFacts };
  let budget = 0n,
    feeBudget = 0n,
    treasury = 0n,
    refund = 0n;
  const bps = before.get(configAddress())!.data.readBigUInt64LE(192);
  check(bps <= 10000n);
  const gross = (shares: bigint, price: bigint) => (shares * price) / 1000000000n;
  const fee = (amount: bigint) => (amount * bps) / 10000n;
  if (request.intent === 'buy' || request.intent === 'sell') {
    const quantity = p2pUnits(request.shares, 6),
      price = p2pUnits(request.price, 9);
    budget = request.intent === 'buy' ? gross(quantity, price) : 0n;
    feeBudget = fee(budget);
    check(!before.get(a.node!));
    const node = p2pOrder(a.node!, after.get(a.node!)!, build.marketId);
    check(
      node.owner === build.wallet &&
        node.intent === request.intent &&
        node.side === request.side &&
        node.price === price &&
        node.amount <= quantity
    );
    const filled = quantity - node.amount;
    check(peers.length <= p2pMaxPeers && peers.length <= before.get(configAddress())!.data.readUInt32LE(224));
    const levelAccount = before.get(a.level!);
    const level = levelAccount ? p2pOwned(levelAccount, p2pDiscriminators.level, 218) : null;
    if (level) check(level[8] === 1 && bs58.encode(level.subarray(9, 41)) === build.marketId && level.readBigUInt64LE(41) === price);
    let head = level
      ? bs58.encode(level.subarray(request.intent === 'buy' ? 154 : 90, request.intent === 'buy' ? 186 : 122))
      : deployment.system;
    let previousNode: string = deployment.system;
    let unfilled = quantity;
    let peerFilled = 0n;
    for (const peer of peers) {
      const original = p2pOrder(peer.address, before.get(peer.address)!, build.marketId);
      check(
        JSON.stringify({
          ...original,
          price: original.price.toString(),
          amount: original.amount.toString(),
          lockedCash: original.lockedCash.toString(),
          lockedYes: original.lockedYes.toString(),
          lockedNo: original.lockedNo.toString(),
        }) ===
          JSON.stringify({
            ...peer,
            price: peer.price.toString(),
            amount: peer.amount.toString(),
            lockedCash: peer.lockedCash.toString(),
            lockedYes: peer.lockedYes.toString(),
            lockedNo: peer.lockedNo.toString(),
          })
      );
      const post = p2pOrder(peer.address, after.get(peer.address)!, build.marketId);
      check(original.address === head && original.prev === previousNode && original.owner !== build.wallet && original.level === a.level);
      check(
        post.owner === peer.owner &&
          post.side === request.side &&
          post.intent !== request.intent &&
          post.price === price &&
          post.amount <= original.amount
      );
      const delta = original.amount - post.amount;
      check(delta === (original.amount < unfilled ? original.amount : unfilled));
      unfilled -= delta;
      previousNode = original.address;
      head = original.next;
      if (peer.intent === 'sell')
        check(
          post.lockedCash === 0n &&
            post[request.side === 'yes' ? 'lockedYes' : 'lockedNo'] ===
              original[request.side === 'yes' ? 'lockedYes' : 'lockedNo'] - delta &&
            post[request.side === 'yes' ? 'lockedNo' : 'lockedYes'] === original[request.side === 'yes' ? 'lockedNo' : 'lockedYes']
        );
      else
        check(
          post.lockedCash === original.lockedCash - gross(delta, price) - fee(gross(delta, price)) &&
            post.lockedYes === 0n &&
            post.lockedNo === 0n
        );
      peerFilled += delta;
      treasury += fee(gross(delta, price));
    }
    check(peerFilled === filled && (unfilled === 0n || head === deployment.system));
    // Multiple nodes can belong to one maker. Validate their aggregate position once.
    for (const owner of new Set(peers.map(peer => peer.owner))) {
      let shares = 0n,
        cash = 0n,
        locked = 0n;
      for (const peer of peers.filter(row => row.owner === owner)) {
        const post = p2pOrder(peer.address, after.get(peer.address)!, build.marketId);
        const delta = peer.amount - post.amount;
        shares += delta;
        cash += gross(delta, price);
        locked += gross(delta, price) + fee(gross(delta, price));
      }
      const pre = readPosition(before, owner),
        post = readPosition(after, owner);
      if (request.intent === 'buy')
        check(
          post[request.side] === pre[request.side] &&
            post.cash === pre.cash + cash &&
            post[request.side === 'yes' ? 'lockedYes' : 'lockedNo'] === pre[request.side === 'yes' ? 'lockedYes' : 'lockedNo'] - shares &&
            post.lockedCash === pre.lockedCash
        );
      else
        check(
          post[request.side] === pre[request.side] + shares &&
            post.cash === pre.cash &&
            post.lockedCash === pre.lockedCash - locked &&
            post.lockedYes === pre.lockedYes &&
            post.lockedNo === pre.lockedNo
        );
      check(post[request.side === 'yes' ? 'no' : 'yes'] === pre[request.side === 'yes' ? 'no' : 'yes']);
      if (request.intent === 'buy')
        check(post[request.side === 'yes' ? 'lockedNo' : 'lockedYes'] === pre[request.side === 'yes' ? 'lockedNo' : 'lockedYes']);
    }
    if (request.intent === 'buy')
      check(
        next[request.side] === previous[request.side] + filled &&
          next.cash === previous.cash &&
          next.lockedCash === previous.lockedCash + node.lockedCash &&
          node.lockedCash === gross(node.amount, price) + fee(gross(node.amount, price)) &&
          node.lockedYes === 0n &&
          node.lockedNo === 0n &&
          next.lockedYes === previous.lockedYes &&
          next.lockedNo === previous.lockedNo
      );
    else
      check(
        previous[request.side] >= quantity &&
          next[request.side] === previous[request.side] - quantity &&
          next.cash === previous.cash + gross(filled, price) &&
          next.lockedCash === previous.lockedCash &&
          next[request.side === 'yes' ? 'lockedYes' : 'lockedNo'] ===
            previous[request.side === 'yes' ? 'lockedYes' : 'lockedNo'] + node.amount &&
          node.lockedCash === 0n &&
          node[request.side === 'yes' ? 'lockedYes' : 'lockedNo'] === node.amount &&
          node[request.side === 'yes' ? 'lockedNo' : 'lockedYes'] === 0n &&
          next[request.side === 'yes' ? 'lockedNo' : 'lockedYes'] === previous[request.side === 'yes' ? 'lockedNo' : 'lockedYes']
      );
    check(next[request.side === 'yes' ? 'no' : 'yes'] === previous[request.side === 'yes' ? 'no' : 'yes']);
    facts.filledShares = p2pDecimal(filled, 6);
    facts.remainingShares = p2pDecimal(node.amount, 6);
    facts.lockedUsdc = p2pDecimal(node.lockedCash, 6);
    facts.cashCreditUsdc = request.intent === 'sell' ? p2pDecimal(gross(filled, price), 6) : '0';
  } else if (request.intent === 'cancel') {
    check(own && own.owner === build.wallet);
    const order = own!;
    const original = p2pOrder(order.address, before.get(order.address)!, build.marketId);
    check(
      original.amount === order.amount &&
        original.lockedCash === order.lockedCash &&
        original.lockedYes === order.lockedYes &&
        original.lockedNo === order.lockedNo
    );
    const node = after.get(order.address);
    check(!node || (node.owner === deployment.system && node.lamports === 0 && node.data.length === 0));
    refund = order.lockedCash;
    check(
      next.yes === previous.yes + order.lockedYes &&
        next.no === previous.no + order.lockedNo &&
        next.cash === previous.cash &&
        next.lockedCash === previous.lockedCash - order.lockedCash &&
        next.lockedYes === previous.lockedYes - order.lockedYes &&
        next.lockedNo === previous.lockedNo - order.lockedNo
    );
    facts.refundUsdc = p2pDecimal(refund, 6);
  } else {
    refund = previous.cash;
    check(
      refund > 0n &&
        next.cash === 0n &&
        next.yes === previous.yes &&
        next.no === previous.no &&
        next.lockedCash === previous.lockedCash &&
        next.lockedYes === previous.lockedYes &&
        next.lockedNo === previous.lockedNo
    );
    facts.refundUsdc = p2pDecimal(refund, 6);
  }
  const tokenIds =
    request.intent === 'cancel' || request.intent === 'withdraw' ? [a.user, a.vaultAta] : [a.user, a.vaultAta, a.treasuryAta, a.creatorAta];
  check(new Set(tokenIds).size === tokenIds.length);
  function tokens(rows: any[], snapshot: AccountSnapshot, post: boolean) {
    check(Array.isArray(rows));
    const map = new Map<string, bigint>();
    for (const row of rows) {
      check(integer(row.accountIndex) && row.accountIndex < keys.length);
      const id = keys[row.accountIndex];
      check(
        tokenIds.includes(id) &&
          !map.has(id) &&
          row.mint === deployment.mint &&
          row.uiTokenAmount?.decimals === 6 &&
          typeof row.uiTokenAmount.amount === 'string' &&
          /^(0|[1-9]\d{0,19})$/.test(row.uiTokenAmount.amount)
      );
      const account = snapshot.get(id);
      check(
        account &&
          account.owner === deployment.token &&
          !account.executable &&
          account.data.length === 165 &&
          account.data.subarray(0, 32).equals(key(deployment.mint)) &&
          account.data[108] === 1 &&
          account.data.readBigUInt64LE(64) === BigInt(row.uiTokenAmount.amount) &&
          account.data.readUInt32LE(72) === 0 &&
          account.data.readUInt32LE(109) === 0 &&
          account.data.readBigUInt64LE(121) === 0n &&
          account.data.readUInt32LE(129) === 0 &&
          row.owner === bs58.encode(account.data.subarray(32, 64))
      );
      const expectedOwner =
        id === a.user
          ? build.wallet
          : id === a.vaultAta
            ? a.vault
            : id === a.treasuryAta
              ? bs58.encode(before.get(configAddress())!.data.subarray(136, 168))
              : derive([Buffer.from('creator_fee_vault_usdc'), key(build.marketId)]);
      check(row.owner === expectedOwner);
      map.set(id, BigInt(row.uiTokenAmount.amount));
    }
    for (const id of tokenIds)
      if (!map.has(id)) {
        check(!post && id === a.user && before.get(id) === null);
        map.set(id, 0n);
      }
    return map;
  }
  const preTokens = tokens(simulation.preTokenBalances, before, false),
    postTokens = tokens(simulation.postTokenBalances, after, true);
  check(postTokens.get(a.user)! - preTokens.get(a.user)! === refund - budget - feeBudget);
  check(postTokens.get(a.vaultAta)! - preTokens.get(a.vaultAta)! === budget + feeBudget - treasury - refund);
  if (tokenIds.includes(a.treasuryAta)) {
    check(postTokens.get(a.treasuryAta)! - preTokens.get(a.treasuryAta)! === treasury);
    check(postTokens.get(a.creatorAta) === preTokens.get(a.creatorAta));
  }
  check(
    Array.isArray(simulation.preBalances) &&
      Array.isArray(simulation.postBalances) &&
      simulation.preBalances.length === keys.length &&
      simulation.postBalances.length === keys.length
  );
  let deposited = 0n,
    returned = 0n;
  const creations = new Set([a.user, a.position, a.level, a.node].filter(Boolean));
  for (let index = 0; index < keys.length; index++) {
    check(integer(simulation.preBalances[index]) && integer(simulation.postBalances[index]));
    const id = keys[index];
    const pre = before.get(id),
      post = after.get(id);
    check(simulation.preBalances[index] === (pre?.lamports ?? 0));
    if (after.has(id)) check(simulation.postBalances[index] === (post?.lamports ?? 0));
    if (pre?.owner === deployment.program && pre.data.length === 202 && post)
      check(post.data.subarray(122, 154).equals(pre.data.subarray(122, 154)));
    if (id === build.wallet) continue;
    let expected = 0n;
    if (!pre && creations.has(id)) {
      check(post && rents.has(post.data.length) && post.lamports === rents.get(post.data.length));
      expected = BigInt(post!.lamports);
      deposited += expected;
    }
    if (request.intent === 'cancel' && id === a.node) {
      check(pre);
      expected = -BigInt(pre!.lamports);
      returned += BigInt(pre!.lamports);
    }
    check(BigInt(simulation.postBalances[index]) - BigInt(simulation.preBalances[index]) === expected);
  }
  const payer = keys.indexOf(build.wallet);
  check(
    payer >= 0 &&
      BigInt(simulation.preBalances[payer]) - BigInt(simulation.postBalances[payer]) === BigInt(simulation.fee) + deposited - returned
  );
  facts.rentRefundLamports = returned.toString();
  const cost: PurchaseCost = {
    amountBaseUnits: budget.toString(),
    protocolFeeBaseUnits: feeBudget.toString(),
    totalUsdcBaseUnits: (budget + feeBudget).toString(),
    networkFeeLamports: String(simulation.fee),
    accountRentLamports: deposited.toString(),
    totalSolLamports: (BigInt(simulation.fee) + deposited).toString(),
  };
  check(p2pUnits(build.amountUsdc, 6) === budget && p2pUnits(build.feeUsdc, 6) === feeBudget);
  return { facts, cost };
}
