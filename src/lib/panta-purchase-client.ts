import { AccountVerificationError, accountVerificationMessages } from './panta-account-verification';
import { type OrderBuild } from './panta-order-build';
import {
  parsePreparedPurchase,
  parsePurchaseReceipt,
  purchaseCheck,
  PurchaseError,
  purchaseMessages,
  type PreparedPurchase,
  type PurchaseReceipt,
} from './panta-purchase';

export const purchaseChannel = (orderId: string): 'primary' | 'p2p' | 'creation' =>
  orderId.startsWith('cr_') ? 'creation' : orderId.startsWith('p2p_') ? 'p2p' : 'primary';

// Only recognized gateway ingress rejections establish that dispatch did not run.
export class PurchaseIngressRejected extends PurchaseError {
  constructor() {
    super('PURCHASE_UNAVAILABLE');
  }
}

export function createPurchaseClient(base: string, fetcher: typeof fetch = fetch, channel: 'primary' | 'p2p' | 'creation' = 'primary') {
  const url = new URL(base);
  purchaseCheck(
    !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/' &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
  );
  async function post(path: 'prepare' | 'send' | 'receipt', body: unknown, access: string, identity: string) {
    purchaseCheck(access && identity && access.length <= 8192 && identity.length <= 8192);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 65000);
    try {
      const response = await fetcher(
        `${url.origin}/${channel === 'creation' ? 'creation/purchases' : channel === 'p2p' ? 'p2p/purchases' : 'purchases'}/${path}/`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${access}`, 'Privy-Id-Token': identity },
          body: JSON.stringify(body),
          redirect: 'error',
          signal: controller.signal,
        }
      );
      const text = await response.text();
      purchaseCheck(text.length <= 8192);
      const value = JSON.parse(text);
      if (!response.ok) {
        if (
          path === 'send' &&
          ((response.status === 429 && value?.code === 'RATE_LIMITED') ||
            (response.status === 401 && Object.hasOwn(accountVerificationMessages, value?.code)) ||
            (response.status === 403 && value?.code === 'FORBIDDEN') ||
            (response.status === 405 && value?.code === 'READ_ONLY'))
        )
          throw new PurchaseIngressRejected();
        if (Object.hasOwn(accountVerificationMessages, value?.code)) throw new AccountVerificationError(value.code);
        if (channel === 'creation' && value?.code === 'CREATE_EXPIRED') throw new PurchaseError('PURCHASE_EXPIRED');
        if (channel === 'creation' && value?.code === 'CREATION_BLOCKED') throw new PurchaseError('PURCHASE_BLOCKED');
        if (channel === 'p2p' && value?.code === 'P2P_CHANGED') throw new PurchaseError('PURCHASE_EXPIRED');
        if (channel === 'p2p' && ['P2P_CLOSED', 'P2P_BLOCKED', 'P2P_COMPLEX_BOOK'].includes(value?.code))
          throw new PurchaseError('PURCHASE_BLOCKED');
        throw new PurchaseError(Object.hasOwn(purchaseMessages, value?.code) ? value.code : 'PURCHASE_UNAVAILABLE');
      }
      return value;
    } catch (error) {
      if (error instanceof PurchaseError || error instanceof AccountVerificationError) throw error;
      throw new PurchaseError('PURCHASE_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    prepare: async (build: OrderBuild, access: string, identity: string): Promise<PreparedPurchase> =>
      parsePreparedPurchase(await post('prepare', { wallet: build.wallet, orderId: build.orderId }, access, identity), build),
    send: async (prepared: PreparedPurchase, transaction: string, access: string, identity: string) => {
      const receipt = parsePurchaseReceipt(
        await post(
          'send',
          { wallet: prepared.wallet, orderId: prepared.orderId, ticket: prepared.ticket, transaction, priceChangeAccepted: true },
          access,
          identity
        ),
        prepared.wallet
      );
      // A broadcast acknowledgement cannot claim chain confirmation.
      purchaseCheck(receipt.status === 'pending' || receipt.status === 'not-sent');
      return receipt;
    },
    receipt: async (record: PurchaseReceipt, access: string, identity: string) =>
      parsePurchaseReceipt(await post('receipt', record, access, identity), record.wallet),
  };
}
