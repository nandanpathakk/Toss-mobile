import 'react-native-get-random-values';

import { Linking } from 'react-native';

import { createBaseStore } from '@storesjs/stores';

import { createPhantomConnector, emptyWalletState, WalletUnavailable, type WalletState } from './phantom-connector';
import { walletAppUrl, walletCluster } from './wallet-config';

// Deliberately memory-only: tokens and encryption secrets remain inside the connector closure.
export const useWalletStore = createBaseStore<WalletState>(() => ({ ...emptyWalletState }));
export const walletConnector = createPhantomConnector(walletAppUrl, walletCluster, {
  randomBytes: length => globalThis.crypto.getRandomValues(new Uint8Array(length)),
  openWallet: async (url, signal) => {
    if (!(await Linking.canOpenURL('phantom://'))) throw new WalletUnavailable();
    if (signal.aborted) return;
    await Linking.openURL(url);
  },
  onState: state => useWalletStore.setState(state),
});

export const walletErrorText = {
  SETUP: 'Wallet connection is being prepared for this independent app. A public project URL is still needed.',
  UNAVAILABLE: 'Phantom isn’t available on this device. Install it from the official App Store or Google Play listing, then try again.',
  ENTROPY: 'Your device couldn’t provide secure randomness. Close the app and try again without remote debugging.',
  OPEN: 'We couldn’t open Phantom. Check that it’s installed, then try again.',
  REJECTED: 'The connection wasn’t approved in Phantom. You can try again whenever you’re ready.',
  INVALID: 'We couldn’t verify the wallet response. No connection was saved. Please try again.',
  TIMEOUT: 'The connection request expired. Please start a new connection.',
  RETURNED: 'You returned without completing the connection. Please try again.',
  DISCONNECT:
    'The wallet was removed from this app. Revocation in Phantom wasn’t confirmed; remove the app from Phantom’s connected apps too.',
} as const;
