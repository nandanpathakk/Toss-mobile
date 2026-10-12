import { useEffect } from 'react';
import { AppState, Linking } from 'react-native';

import { walletConnector } from '@/features/panta/wallet-store';

// Separate entry hook for the Panta app; the retained Rainbow intent handler is not loaded.
export function usePantaIntentHandler() {
  useEffect(() => {
    let active = true;
    const links = Linking.addEventListener('url', event => walletConnector.handleURL(event.url));
    void Linking.getInitialURL()
      .then(url => {
        if (active && url) walletConnector.handleURL(url);
      })
      .catch(() => {
        /* No pending session can be recovered after a process restart. */
      });
    const lifecycle = AppState.addEventListener('change', state => {
      if (state === 'background') walletConnector.leftApp();
      if (state === 'active') walletConnector.returnedToApp();
    });
    return () => {
      active = false;
      links.remove();
      lifecycle.remove();
      walletConnector.cancel();
    };
  }, []);
}
