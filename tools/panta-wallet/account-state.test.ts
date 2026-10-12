import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accountWalletAddress, canCreateAccountWallet } from '../../src/features/panta/account-state';

const address = '11111111111111111111111111111111';
const other = 'So11111111111111111111111111111111111111112';
const account = { type: 'wallet', address, chain_type: 'solana', connector_type: 'embedded', wallet_client_type: 'privy' };
const user = { linked_accounts: [account] };

test('account address is bound to the current authenticated embedded Solana wallet', () => {
  assert.equal(accountWalletAddress(true, user, 'connected', [other, address]), address);
  assert.equal(accountWalletAddress(true, user, 'connected', [other]), null);
  assert.equal(accountWalletAddress(false, user, 'connected', [address]), null);
  assert.equal(accountWalletAddress(true, null, 'connected', [address]), null);
  for (const status of ['not-created', 'connecting', 'reconnecting', 'needs-recovery', 'error', 'disconnected']) {
    assert.equal(accountWalletAddress(true, user, status, [address]), null);
  }
});

test('external, other-chain and malformed addresses cannot become the embedded account wallet', () => {
  for (const change of [
    { chain_type: 'ethereum' },
    { connector_type: 'external' },
    { wallet_client_type: 'phantom' },
    { type: 'email' },
    { address: 'invalid' },
  ]) {
    const linked = { linked_accounts: [{ ...account, ...change }] };
    assert.equal(accountWalletAddress(true, linked, 'connected', [linked.linked_accounts[0].address]), null);
  }
});

test('creation is unavailable during restoration, recovery, existing-wallet and ambiguous states', () => {
  const empty = { linked_accounts: [] };
  assert.equal(canCreateAccountWallet(true, empty, 'not-created'), true);
  assert.equal(canCreateAccountWallet(false, empty, 'not-created'), false);
  assert.equal(canCreateAccountWallet(true, null, 'not-created'), false);
  assert.equal(canCreateAccountWallet(true, user, 'not-created'), false);
  for (const status of ['creating', 'connected', 'needs-recovery', 'error', 'disconnected']) {
    assert.equal(canCreateAccountWallet(true, empty, status), false);
  }
});
