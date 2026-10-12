import bs58 from 'bs58';

import { type OrderBuild } from '../../src/lib/panta-order-build';
import { configAddress, deployment, PreflightError, primaryBuyInstruction, type AccountSnapshot } from './primary-transaction';

// Same-bank simulation deltas only. Historical trades establish fee-on-top semantics,
// but never substitute for the current transaction's own economic check.
export function validatePrimaryEconomics(
  build: OrderBuild,
  keys: string[],
  accounts: AccountSnapshot,
  value: any,
  networkFee: number,
  rent: { token: number; position: number }
) {
  function check(ok: unknown): asserts ok {
    if (!ok) throw new PreflightError('ECONOMICS_UNVERIFIED');
  }
  const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
  const units = (s: string): bigint => {
    check(typeof s === 'string' && /^(0|[1-9]\d{0,14})(\.\d{1,6})?$/.test(s));
    const [whole, fraction = ''] = s.split('.');
    return BigInt(whole + fraction.padEnd(6, '0'));
  };
  const buy = primaryBuyInstruction(build);
  const user = buy.accounts[7].pubkey;
  const vault = buy.accounts[4].pubkey;
  const treasury = buy.accounts[8].pubkey;
  const position = buy.accounts[5].pubkey;
  const config = accounts.get(configAddress());
  check(config && config.data.length === 356);
  const bps = config.data.readBigUInt64LE(184);
  const amount = units(build.amountUsdc);
  const fee = units(build.feeUsdc);
  // Fail closed on unverified sub-base-unit fee rounding or changed fee configuration.
  check(bps <= 10000n && (amount * bps) % 10000n === 0n && fee === (amount * bps) / 10000n);
  check(new Set([user, vault, treasury]).size === 3);
  function balances(rows: unknown) {
    check(Array.isArray(rows) && rows.length === 3);
    const balances = new Map<string, bigint>();
    for (const row of rows) {
      check(row && integer(row.accountIndex) && row.accountIndex < keys.length);
      const address = keys[row.accountIndex];
      check([user, vault, treasury].includes(address) && !balances.has(address));
      const account = accounts.get(address);
      check(account && account.owner === deployment.token && account.data.length === 165);
      check(row.mint === deployment.mint && row.owner === bs58.encode(account.data.subarray(32, 64)));
      check(
        row.uiTokenAmount?.decimals === 6 &&
          typeof row.uiTokenAmount.amount === 'string' &&
          /^(0|[1-9]\d{0,19})$/.test(row.uiTokenAmount.amount)
      );
      const balance = BigInt(row.uiTokenAmount.amount);
      check(balance <= 18446744073709551615n);
      balances.set(address, balance);
    }
    return balances;
  }
  const pre = balances(value.preTokenBalances);
  const post = balances(value.postTokenBalances);
  check(post.get(user)! - pre.get(user)! === -amount - fee);
  check(post.get(vault)! - pre.get(vault)! === amount);
  check(post.get(treasury)! - pre.get(treasury)! === fee);
  check(
    integer(value.fee) && value.fee === networkFee && integer(rent.token) && integer(rent.position) && rent.token > 0 && rent.position > 0
  );
  check(Array.isArray(value.preBalances) && Array.isArray(value.postBalances));
  check(value.preBalances.length === keys.length && value.postBalances.length === keys.length);
  let payerCost = BigInt(networkFee);
  for (let index = 0; index < keys.length; index++) {
    const before = value.preBalances[index];
    const after = value.postBalances[index];
    check(integer(before) && integer(after));
    const address = keys[index];
    if (address === build.wallet) continue;
    const created = [user, position].includes(address) && accounts.get(address) === null;
    const expected = created ? BigInt(address === user ? rent.token : rent.position) : 0n;
    check(BigInt(after) - BigInt(before) === expected && (!created || before === 0));
    payerCost += expected;
  }
  const payer = keys.indexOf(build.wallet);
  check(payer >= 0 && BigInt(value.preBalances[payer]) - BigInt(value.postBalances[payer]) === payerCost);
  return {
    amountBaseUnits: amount.toString(),
    protocolFeeBaseUnits: fee.toString(),
    totalUsdcBaseUnits: (amount + fee).toString(),
    networkFeeLamports: String(networkFee),
    accountRentLamports: (payerCost - BigInt(networkFee)).toString(),
    totalSolLamports: payerCost.toString(),
  };
}
