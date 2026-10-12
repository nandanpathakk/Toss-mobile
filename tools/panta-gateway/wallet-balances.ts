import { CatalogError } from '../../src/lib/panta-catalog';
import { isWalletAddress, parseWalletBalances, type WalletBalances } from '../../src/lib/panta-portfolio';
import { deployment, derive, key } from './primary-transaction';

/** Fixed, read-only mainnet queries. No RPC credentials or caller-selected network/method. */
export function createWalletBalanceReader(fetcher: typeof fetch = fetch) {
  return async (wallet: string): Promise<WalletBalances> => {
    if (!isWalletAddress(wallet)) throw new CatalogError('INVALID_RESPONSE');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 12000);
    let id = 0;
    async function rpc(method: string, params: unknown[] = []) {
      const requestId = ++id;
      const response = await fetcher('https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'error',
        signal: abort.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new CatalogError(response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE', response.status === 429 ? 60 : null);
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 16384) throw new CatalogError('INVALID_RESPONSE');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const row = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (row.jsonrpc !== '2.0' || row.id !== requestId || row.error || !Object.hasOwn(row, 'result'))
        throw new CatalogError('UNAVAILABLE');
      return row.result;
    }
    try {
      if ((await rpc('getGenesisHash')) !== deployment.genesis) throw new CatalogError('INVALID_RESPONSE');
      const ata = derive([key(wallet), key(deployment.token), key(deployment.mint)], deployment.ata);
      const result = await rpc('getMultipleAccounts', [[wallet, deployment.mint, ata], { encoding: 'base64', commitment: 'confirmed' }]);
      if (
        !Number.isSafeInteger(result?.context?.slot) ||
        result.context.slot < 0 ||
        !Array.isArray(result?.value) ||
        result.value.length !== 3
      )
        throw new CatalogError('INVALID_RESPONSE');
      const decode = (value: any, owner: string, size: number) => {
        if (
          !value ||
          value.owner !== owner ||
          value.executable !== false ||
          !Number.isSafeInteger(value.lamports) ||
          value.lamports < 0 ||
          !Array.isArray(value.data) ||
          value.data.length !== 2 ||
          value.data[1] !== 'base64' ||
          typeof value.data[0] !== 'string'
        )
          throw new CatalogError('INVALID_RESPONSE');
        const bytes = Buffer.from(value.data[0], 'base64');
        if (bytes.length !== size || bytes.toString('base64') !== value.data[0]) throw new CatalogError('INVALID_RESPONSE');
        return bytes;
      };
      const [native, mint, token] = result.value;
      if (native !== null) decode(native, deployment.system, 0);
      const mintBytes = decode(mint, deployment.token, 82);
      if (mintBytes[44] !== 6 || mintBytes[45] !== 1) throw new CatalogError('INVALID_RESPONSE');
      let usdcBaseUnits = '0';
      let usdcState: WalletBalances['usdcState'] = 'missing';
      if (token !== null) {
        const bytes = decode(token, deployment.token, 165);
        if (
          !bytes.subarray(0, 32).equals(key(deployment.mint)) ||
          !bytes.subarray(32, 64).equals(key(wallet)) ||
          ![1, 2].includes(bytes[108])
        )
          throw new CatalogError('INVALID_RESPONSE');
        usdcBaseUnits = bytes.readBigUInt64LE(64).toString();
        usdcState = bytes[108] === 2 ? 'frozen' : 'initialized';
      }
      return parseWalletBalances(
        {
          wallet,
          chain: 'mainnet-beta',
          slot: result.context.slot,
          fetchedAt: new Date().toISOString(),
          solLamports: String(native?.lamports ?? 0),
          usdcBaseUnits,
          usdcAccount: ata,
          usdcState,
        },
        wallet
      );
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      throw new CatalogError('UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  };
}
