import { deleteItemAsync, getItemAsync, setItemAsync, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from 'expo-secure-store';

import { isWalletAddress } from '@/lib/panta-portfolio';
import { DYNAMIC_STORAGE_KEYS } from '@/stores/keys';

import { createPurchaseRecovery, parsePendingPurchase, PurchaseRecoveryError } from './purchase-recovery';

const options = { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY };
function storageKey(wallet: string) {
  if (!isWalletAddress(wallet)) throw new PurchaseRecoveryError('INVALID_RECOVERY');
  return DYNAMIC_STORAGE_KEYS.pantaPrimaryPurchase(wallet);
}

// Single process-wide coordinator. Kept out of the account connection API.
// Logout must not erase unresolved purchases. No signing or sending is enabled
// by importing this adapter; the approved transport still needs to be connected.
export const purchaseRecovery = createPurchaseRecovery({
  read: async wallet => {
    const value = await getItemAsync(storageKey(wallet), options);
    if (value === null) return null;
    if (value.length > 1024) throw new PurchaseRecoveryError('INVALID_RECOVERY');
    try {
      return parsePendingPurchase(JSON.parse(value), wallet);
    } catch {
      throw new PurchaseRecoveryError('INVALID_RECOVERY');
    }
  },
  write: async (wallet, record) => {
    const value = JSON.stringify(parsePendingPurchase(record, wallet));
    if (value.length > 1024) throw new PurchaseRecoveryError('INVALID_RECOVERY');
    await setItemAsync(storageKey(wallet), value, options);
  },
  remove: async wallet => {
    await deleteItemAsync(storageKey(wallet), options);
  },
});
