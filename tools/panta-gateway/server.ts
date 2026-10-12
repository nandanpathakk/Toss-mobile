import { createCatalogGateway } from './gateway';
import { createPrivyOwnershipVerifier } from './privy-ownership';

const key = process.env.PANTA_API_KEY;
if (!key) throw new Error('Set PANTA_API_KEY in the ignored server-only environment file');
const ownership = createPrivyOwnershipVerifier(fetch, Date.now, (stage, check) => {
  console.warn(`Account ownership check failed at: ${stage}/${check}`);
});
const server = createCatalogGateway(key, undefined, undefined, undefined, ownership);
server.listen(8787, '127.0.0.1', () => {
  console.log('Local Panta catalog and quote gateway: http://127.0.0.1:8787');
});
server.on('error', () => {
  console.error('Catalog gateway could not start. Check whether port 8787 is already in use.');
  process.exitCode = 1;
});
