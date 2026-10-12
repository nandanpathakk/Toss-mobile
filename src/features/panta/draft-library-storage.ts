import { randomUUID } from 'expo-crypto';
import { deleteItemAsync, getItemAsync, setItemAsync, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from 'expo-secure-store';

import { DYNAMIC_STORAGE_KEYS, STORAGE_KEYS } from '@/stores/keys';

import { createDraftLibrary, createDraftStorage } from './draft-library';

// Existing reviewed device-only storage; bounded chunks avoid large Keychain values.
// Draft content only. No wallet, session, approval or transaction data enters this library.
const options = { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export const draftLibrary = createDraftLibrary(
  createDraftStorage(
    {
      read: key => getItemAsync(key, options),
      write: (key, value) => setItemAsync(key, value, options),
      remove: key => deleteItemAsync(key, options),
    },
    STORAGE_KEYS.pantaMarketDrafts,
    DYNAMIC_STORAGE_KEYS.pantaMarketDraftChunk,
    randomUUID
  ),
  randomUUID
);
