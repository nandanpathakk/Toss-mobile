import { type OrderBuild } from '../../src/lib/panta-order-build';
import { type PreflightReport } from '../../src/lib/panta-order-preflight';
import { inspectPrimaryWire } from '../../src/lib/panta-order-signing';
import { validatePrimaryEconomics } from './primary-economics';
import {
  compileUnsignedPrimary,
  deployment,
  PreflightError,
  validatePrimaryTransaction,
  type AccountSnapshot,
} from './primary-transaction';

export function createPrimaryPreflight(fetcher: typeof fetch = fetch) {
  // No caller-controlled URL, method, signed payload, blockhash replacement or broadcast.
  return async (build: OrderBuild): Promise<PreflightReport> => {
    const report: PreflightReport = {
      orderId: build.orderId,
      wallet: build.wallet,
      chain: 'mainnet-beta',
      status: 'blocked',
      code: null,
      networkFeeLamports: null,
      messageHash: null,
      signable: false,
      executionProtection: false,
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    let id = 0;
    async function rpc(method: string, params: unknown[] = []): Promise<any> {
      if (controller.signal.aborted) throw new PreflightError('RPC_UNAVAILABLE');
      const requestId = ++id;
      const response = await fetcher('https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok || !response.body) throw new PreflightError('RPC_UNAVAILABLE');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 512 * 1024) throw new PreflightError('RPC_UNAVAILABLE');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (data.id !== requestId || data.jsonrpc !== '2.0' || data.error || !Object.hasOwn(data, 'result'))
        throw new PreflightError('RPC_UNAVAILABLE');
      return data.result;
    }
    const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
    try {
      if (!Number.isFinite(Date.parse(build.expiresAt)) || Date.parse(build.expiresAt) <= Date.now()) throw new PreflightError('EXPIRED');
      const genesis = await rpc('getGenesisHash');
      if (genesis !== deployment.genesis) throw new PreflightError('CHAIN_MISMATCH');
      const addresses = [
        ...new Set([deployment.program, deployment.programData, ...build.instructions.flatMap(ix => ix.accounts.map(a => a.pubkey))]),
      ];
      if (addresses.length > 64) throw new PreflightError('POLICY_REJECTED');
      const snapshot = await rpc('getMultipleAccounts', [
        addresses,
        { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 8192 } },
      ]);
      if (!integer(snapshot?.context?.slot) || !Array.isArray(snapshot?.value) || snapshot.value.length !== addresses.length)
        throw new PreflightError('RPC_UNAVAILABLE');
      const accounts: AccountSnapshot = new Map();
      snapshot.value.forEach((value: any, index: number) => {
        if (value === null) {
          accounts.set(addresses[index], null);
          return;
        }
        if (
          !value ||
          typeof value.owner !== 'string' ||
          typeof value.executable !== 'boolean' ||
          !integer(value.lamports) ||
          !Array.isArray(value.data) ||
          value.data.length !== 2 ||
          value.data[1] !== 'base64' ||
          typeof value.data[0] !== 'string'
        )
          throw new PreflightError('RPC_UNAVAILABLE');
        const data = Buffer.from(value.data[0], 'base64');
        if (data.length > 8192 || data.toString('base64') !== value.data[0]) throw new PreflightError('RPC_UNAVAILABLE');
        accounts.set(addresses[index], { owner: value.owner, executable: value.executable, lamports: value.lamports, data });
      });
      validatePrimaryTransaction(build, accounts);
      const compiled = compileUnsignedPrimary(build);
      // Decode independently before any RPC use. Do not trust an encoder's own hash
      // as evidence that it preserved instruction order, account roles and bytes.
      const decoded = inspectPrimaryWire(compiled.transaction, build);
      if (decoded.messageHash !== compiled.messageHash) throw new PreflightError('POLICY_REJECTED');
      report.messageHash = compiled.messageHash;
      const context = { commitment: 'confirmed', minContextSlot: snapshot.context.slot };
      const [height, valid, fee] = await Promise.all([
        rpc('getBlockHeight', [context]),
        rpc('isBlockhashValid', [build.recentBlockhash, context]),
        rpc('getFeeForMessage', [compiled.message.toString('base64'), context]),
      ]);
      if (
        !integer(height) ||
        typeof valid?.value !== 'boolean' ||
        !integer(valid?.context?.slot) ||
        valid.context.slot < snapshot.context.slot ||
        !integer(fee?.context?.slot) ||
        fee.context.slot < snapshot.context.slot
      )
        throw new PreflightError('RPC_UNAVAILABLE');
      if (!valid.value || !integer(build.lastValidBlockHeight) || height > build.lastValidBlockHeight || fee.value === null)
        throw new PreflightError('EXPIRED');
      if (!integer(fee.value)) throw new PreflightError('RPC_UNAVAILABLE');
      report.networkFeeLamports = String(fee.value);
      const result = await rpc('simulateTransaction', [
        compiled.transaction.toString('base64'),
        { ...context, encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false, innerInstructions: false },
      ]);
      if (
        !integer(result?.context?.slot) ||
        result.context.slot < snapshot.context.slot ||
        !result.value ||
        !Object.hasOwn(result.value, 'err')
      )
        throw new PreflightError('RPC_UNAVAILABLE');
      // Never return raw RPC/program logs, messages, arbitrary return data or signed bytes.
      if (result.value.err !== null) throw new PreflightError('SIMULATION_FAILED');
      const [tokenRent, positionRent] = await Promise.all([
        rpc('getMinimumBalanceForRentExemption', [165, { commitment: 'confirmed' }]),
        rpc('getMinimumBalanceForRentExemption', [202, { commitment: 'confirmed' }]),
      ]);
      const cost = validatePrimaryEconomics(build, compiled.keys, accounts, result.value, fee.value, {
        token: tokenRent,
        position: positionRent,
      });
      if (Date.parse(build.expiresAt) <= Date.now()) throw new PreflightError('EXPIRED');
      report.status = 'simulated';
      report.cost = cost;
    } catch (error) {
      report.code = error instanceof PreflightError ? error.code : 'RPC_UNAVAILABLE';
    } finally {
      clearTimeout(timer);
    }
    return report;
  };
}
