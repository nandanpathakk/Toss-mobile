import React, { type ReactNode } from 'react';

import { createPrivyClient, PrivyProvider, type PrivyOptions } from '@privy-io/expo';

import { privyConfig } from './privy-config';

// SDK arguments can contain tokens or recovery material. Never forward them to logging.
const silent = () => undefined;
const logger: NonNullable<PrivyOptions['logger']> = { level: 'ERROR', error: silent, warn: silent, info: silent, debug: silent };
const client = createPrivyClient({ ...privyConfig, logger, sessions: { mode: 'single-user' } });
const config = { embedded: { ethereum: { createOnLogin: 'off' as const }, solana: { createOnLogin: 'off' as const } } };

export function PantaPrivyProvider({ children }: { children: ReactNode }) {
  // Retain the SDK's device-only SecureStore adapter. No session persistence in app stores.
  return (
    <PrivyProvider {...privyConfig} client={client} config={config}>
      {children}
    </PrivyProvider>
  );
}
