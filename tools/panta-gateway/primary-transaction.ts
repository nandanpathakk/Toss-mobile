import { createHash } from 'node:crypto';

import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

import { type OrderBuild } from '../../src/lib/panta-order-build';
import { normalizeUsdc } from '../../src/lib/panta-orders';

// Research-pinned deployment, not permission to sign. See solana-deployment-findings.md.
export const deployment = {
  genesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  program: '6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp',
  programData: '56sTLT5hR7f7bQx7CWkH3qXVa4v7nHpqchRxcZT3qaVx',
  deployedSlot: 440119607n,
  loader: 'BPFLoaderUpgradeab1e11111111111111111111111',
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  ata: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  system: '11111111111111111111111111111111',
  memo: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
} as const;
export class PreflightError extends Error {
  constructor(
    public readonly code:
      'POLICY_REJECTED' | 'CHAIN_MISMATCH' | 'EXPIRED' | 'RPC_UNAVAILABLE' | 'SIMULATION_FAILED' | 'ECONOMICS_UNVERIFIED'
  ) {
    super(code);
  }
}
function requirePolicy(value: unknown): asserts value {
  if (!value) throw new PreflightError('POLICY_REJECTED');
}
export function key(address: string): Buffer {
  try {
    const value = Buffer.from(bs58.decode(address));
    requirePolicy(value.length === 32);
    return value;
  } catch {
    throw new PreflightError('POLICY_REJECTED');
  }
}
export function derive(seeds: Buffer[], program: string = deployment.program): string {
  requirePolicy(seeds.length < 16 && seeds.every(seed => seed.length <= 32));
  for (let bump = 255; bump >= 0; bump--) {
    const hash = createHash('sha256')
      .update(Buffer.concat([...seeds, Buffer.from([bump]), key(program), Buffer.from('ProgramDerivedAddress')]))
      .digest();
    try {
      ed25519.ExtendedPoint.fromHex(hash);
    } catch {
      return bs58.encode(hash);
    }
  }
  throw new PreflightError('POLICY_REJECTED');
}
export type ChainAccount = { owner: string; executable: boolean; lamports: number; data: Buffer };
export type AccountSnapshot = Map<string, ChainAccount | null>;
export const configAddress = () => derive([Buffer.from('market_config')]);
function owned(accounts: AccountSnapshot, address: string, owner: string, executable = false): ChainAccount {
  const account = accounts.get(address);
  requirePolicy(account && account.owner === owner && account.executable === executable);
  return account;
}
function tokenAccount(accounts: AccountSnapshot, address: string, authority: string, optional = false) {
  if (optional && accounts.get(address) === null) return;
  const data = owned(accounts, address, deployment.token).data;
  requirePolicy(
    data.length === 165 &&
      data.subarray(0, 32).equals(key(deployment.mint)) &&
      data.subarray(32, 64).equals(key(authority)) &&
      data[108] === 1
  );
}
export function primaryBuyInstruction(build: OrderBuild) {
  const instructions = build.instructions.filter(ix => ix.programId === deployment.program);
  requirePolicy(instructions.length === 1);
  return instructions[0];
}
export function validatePrimaryTransaction(build: OrderBuild, accounts: AccountSnapshot, now = Date.now()) {
  if (Date.parse(build.expiresAt) <= now) throw new PreflightError('EXPIRED');
  requirePolicy(Number.isFinite(Date.parse(build.expiresAt)) && build.disclaimer === null);
  requirePolicy(build.instructions.length >= 1 && build.instructions.length <= 3);
  const create = build.instructions[0].programId === deployment.ata ? build.instructions[0] : null;
  const offset = create ? 1 : 0;
  const buy = build.instructions[offset];
  const memo = build.instructions[offset + 1];
  requirePolicy(
    build.instructions.length === offset + 1 + Number(Boolean(memo)) &&
      buy?.programId === deployment.program &&
      (!memo || memo.programId === deployment.memo)
  );
  const program = owned(accounts, deployment.program, deployment.loader, true).data;
  requirePolicy(program.length === 36 && program.readUInt32LE(0) === 2 && program.subarray(4).equals(key(deployment.programData)));
  const programData = owned(accounts, deployment.programData, deployment.loader).data;
  requirePolicy(
    programData.length >= 45 && programData.readUInt32LE(0) === 3 && programData.readBigUInt64LE(4) === deployment.deployedSlot
  );
  const config = owned(accounts, configAddress(), deployment.program).data;
  requirePolicy(
    config.length === 356 &&
      config.subarray(0, 8).equals(Buffer.from([119, 255, 200, 88, 252, 82, 128, 24])) &&
      config.subarray(244, 276).equals(key(deployment.mint))
  );
  const treasury = bs58.encode(config.subarray(136, 168));
  const event = owned(accounts, build.marketId, deployment.program).data;
  requirePolicy(event.length >= 332 && event.subarray(0, 8).equals(Buffer.from([125, 192, 125, 158, 9, 115, 152, 233])));
  // Fixed prefix through creator_seed_lamports, then Borsh question string.
  const questionOffset = 8 + 32 + 6 * 8 + 8 * 16 + 8 + 5 * 16 + 8 + 16;
  requirePolicy(event.length >= questionOffset + 4);
  const questionLength = event.readUInt32LE(questionOffset);
  requirePolicy(questionLength > 0 && questionLength <= 4096 && questionOffset + 4 + questionLength <= event.length);
  const creator = event.subarray(8, 40);
  const questionHash = createHash('sha256')
    .update(event.subarray(questionOffset + 4, questionOffset + 4 + questionLength))
    .digest();
  requirePolicy(derive([Buffer.from('event_usdc'), creator, questionHash]) === build.marketId);
  const vault = derive([Buffer.from('vault_usdc'), creator, questionHash]);
  owned(accounts, vault, deployment.program);
  const ata = (owner: string) => derive([key(owner), key(deployment.token), key(deployment.mint)], deployment.ata);
  const userAta = ata(build.wallet);
  const vaultAta = ata(vault);
  const treasuryAta = ata(treasury);
  const position = derive([Buffer.from('position'), key(build.marketId), key(build.wallet)]);
  tokenAccount(accounts, vaultAta, vault);
  tokenAccount(accounts, treasuryAta, treasury);
  // Without an ATA creation instruction the canonical buyer account must exist.
  tokenAccount(accounts, userAta, build.wallet, Boolean(create));
  if (accounts.get(position) !== null) {
    const data = owned(accounts, position, deployment.program).data;
    requirePolicy(
      data.length >= 74 &&
        data.subarray(0, 8).equals(Buffer.from([251, 248, 209, 245, 83, 234, 17, 27])) &&
        data[8] === 1 &&
        data.subarray(9, 41).equals(key(build.marketId)) &&
        data.subarray(41, 73).equals(key(build.wallet))
    );
  }
  const mint = owned(accounts, deployment.mint, deployment.token).data;
  requirePolicy(mint.length === 82 && mint[44] === 6 && mint[45] === 1);
  function exact(ix: typeof buy, expected: [string, boolean, boolean][]) {
    requirePolicy(ix.accounts.length === expected.length);
    expected.forEach(([pubkey, isSigner, isWritable], index) =>
      requirePolicy(
        ix.accounts[index].pubkey === pubkey && ix.accounts[index].isSigner === isSigner && ix.accounts[index].isWritable === isWritable
      )
    );
  }
  if (create) {
    exact(create, [
      [build.wallet, true, true],
      [userAta, false, true],
      [build.wallet, false, false],
      [deployment.mint, false, false],
      [deployment.system, false, false],
      [deployment.token, false, false],
    ]);
    requirePolicy(create.data === 'AQ==');
  }
  exact(buy, [
    [build.wallet, true, true],
    [build.marketId, false, true],
    [configAddress(), false, false],
    [vault, false, false],
    [vaultAta, false, true],
    [position, false, true],
    [deployment.mint, false, false],
    [userAta, false, true],
    [treasuryAta, false, true],
    [deployment.token, false, false],
    [deployment.ata, false, false],
    [deployment.system, false, false],
  ]);
  const data = Buffer.from(buy.data, 'base64');
  const [whole, fraction = ''] = normalizeUsdc(build.amountUsdc).split('.');
  const amount = BigInt(whole + fraction.padEnd(6, '0'));
  requirePolicy(
    data.toString('base64') === buy.data &&
      data.length === 17 &&
      data.subarray(0, 8).equals(Buffer.from([46, 137, 68, 116, 49, 89, 13, 247])) &&
      (build.side === 'yes' || build.side === 'no') &&
      data[8] === (build.side === 'yes' ? 0 : 1) &&
      data.readBigUInt64LE(9) === amount
  );
  if (memo) {
    exact(memo, [[build.wallet, true, false]]);
    const data = Buffer.from(memo.data, 'base64');
    requirePolicy(
      data.toString('base64') === memo.data &&
        data.length <= 256 &&
        /^panta:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(data.toString('ascii'))
    );
    const parts = data.toString('ascii').split(':');
    requirePolicy(parts[3] === build.quoteId && parts[4] === build.orderId);
  }
  return { amountBaseUnits: amount.toString(), userAta, position, vaultAta, treasuryAta };
}

// Narrow v0 encoder: one payer/signature, static keys only, no address lookup tables.
// Used for unsigned simulation only. It is not a general wallet transaction compiler.
export function compileUnsignedPrimary(build: OrderBuild) {
  const roles = new Map<string, { signer: boolean; writable: boolean }>([[build.wallet, { signer: true, writable: true }]]);
  for (const ix of build.instructions) {
    for (const account of ix.accounts) {
      requirePolicy(!account.isSigner || account.pubkey === build.wallet);
      const old = roles.get(account.pubkey);
      roles.set(account.pubkey, { signer: account.isSigner || !!old?.signer, writable: account.isWritable || !!old?.writable });
    }
    if (!roles.has(ix.programId)) roles.set(ix.programId, { signer: false, writable: false });
  }
  const keys = [...roles.keys()].sort(
    (a, b) => Number(roles.get(b)!.signer) - Number(roles.get(a)!.signer) || Number(roles.get(b)!.writable) - Number(roles.get(a)!.writable)
  );
  requirePolicy(keys.length <= 64 && keys[0] === build.wallet);
  const compact = (n: number): Buffer => {
    requirePolicy(Number.isInteger(n) && n >= 0 && n <= 65535);
    const out: number[] = [];
    do {
      const byte = n & 127;
      n >>>= 7;
      out.push(byte | (n ? 128 : 0));
    } while (n);
    return Buffer.from(out);
  };
  const readonly = keys.filter(k => !roles.get(k)!.signer && !roles.get(k)!.writable).length;
  const compiled = build.instructions.map(ix => {
    const data = Buffer.from(ix.data, 'base64');
    return Buffer.concat([
      Buffer.from([keys.indexOf(ix.programId)]),
      compact(ix.accounts.length),
      Buffer.from(ix.accounts.map(a => keys.indexOf(a.pubkey))),
      compact(data.length),
      data,
    ]);
  });
  const message = Buffer.concat([
    Buffer.from([128, 1, 0, readonly]),
    compact(keys.length),
    ...keys.map(key),
    key(build.recentBlockhash),
    compact(compiled.length),
    ...compiled,
    Buffer.from([0]),
  ]);
  const transaction = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), message]);
  requirePolicy(transaction.length <= 1232);
  return { message, transaction, keys, messageHash: createHash('sha256').update(message).digest('hex') };
}
