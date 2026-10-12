/**
 * Registry of every `storageKey` used by the app's persisted stores.
 *
 * 🚨 The string values here are persisted on users' devices. They must stay byte-identical
 * to the literals they mirror. Renaming a value silently drops the user's persisted data.
 *
 * Every `storageKey` call site reads its value from `STORAGE_KEYS` or `DYNAMIC_STORAGE_KEYS`.
 */

/**
 * `storageKey` values for `@storesjs/stores` stores (`createBaseStore` / `createQueryStore`),
 * persisted in the `rainbow-storage` MMKV instance.
 */
export const STORAGE_KEYS = {
  // Device-only SecureStore draft index; not an MMKV store.
  pantaMarketDrafts: 'panta.market.drafts.v1',
  // src/state
  airdrops: 'airdropsStore',
  claimables: 'claimables',
  colorMode: 'colorMode',
  connectedToAnvil: 'connectedToAnvil',
  fcmToken: 'fcmToken',
  featureCards: 'featureCards',
  nonces: 'nonceStore',
  pendingTransactions: 'pendingTransactions',
  pinnedCoins: 'pinnedCoinsStore',
  pinnedWallets: 'pinnedWallets',
  staleBalances: 'staleBalances',
  swaps: 'swapsStore',
  userAssetsStoreManager: 'userAssetsStoreManager',
  wallets: 'walletStore',
  walletSectionsOpen: 'walletSectionsOpen',
  walletSummary: 'walletSummaryStore',

  // src/resources
  favoritedTokens: 'favoritedTokens',
  /** Reserved: persistence is commented out at the call site until the store ships. */
  tokenMetadata: 'tokenMetadata',

  // src/__swaps__
  discoverTokenSearch: 'discoverTokenSearch',
  popularInRainbow: 'popularInRainbow',
  unverifiedTokenSearch: 'unverifiedTokenSearch',
  verifiedTokenSearch: 'verifiedTokenSearch',

  // src/screens
  superTokens: 'superTokens',

  // src/features
  airdropBalance: 'airdropStore',
  airdropFlowCompletion: 'airdropFlowCompletion',
  backendNetworks: 'backendNetworks',
  backups: 'backups',
  cashAccount: 'cashAccount',
  cashBuyOrder: 'cashBuyOrder',
  cashPaymentMethod: 'cashPaymentMethod',
  cashWallet: 'cashWallet',
  chartSettings: 'chartSettingsStore',
  currencyConversion: 'currencyConversionStore',
  customizeNetworksBanner: 'CustomizeNetworksBanner',
  experimentalConfig: 'experimentalConfig',
  kingOfTheHill: 'kingOfTheHill',
  networkSwitcher: 'network-switcher',
  pinAuth: 'pinAuth',
  placements: 'placementsStore',
  polymarket: 'polymarketStore',
  polymarketBalance: 'polymarketBalanceStore',
  polymarketCategory: 'polymarketCategoryStore',
  polymarketEvents: 'polymarketEventsStore',
  polymarketPositions: 'polymarketPositions',
  polymarketWalletKind: 'polymarketWalletStore',
  positions: 'positions',
  preferredGasSpeed: 'preferred gas speed',
  remoteConfig: 'remoteConfig',
  rnbwMembershipAnalytics: 'rnbwMembershipAnalytics',
  rnbwRewards: 'rnbwRewardsStore',
  rnbwStakingPosition: 'rnbwStakingPosition',
  walletConnectRequests: 'walletConnectRequests',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * `storageKey` builders for stores created per address or per id. The template shapes
 * (separators and casing) are copied exactly from the store factories.
 */
export const DYNAMIC_STORAGE_KEYS = {
  pantaMarketDraftChunk: (generation: string, chunk: number) => `panta.market.draft.v1.${generation}.${chunk}` as const,
  /** SecureStore public purchase recovery metadata; deliberately separate from MMKV. */
  pantaPrimaryPurchase: (wallet: string) => `panta.primary.purchase.v1.${wallet}` as const,
  /** `src/features/placements/surfaces/stores/surfaceStore.ts` */
  surface: (surfaceId: string) => `surfaceStore:${surfaceId}` as const,
  /** `src/state/queries/user-assets/createUserAssetsStore.ts` */
  userAssets: (address: string) => `userAssets_${address}` as const,
  /** `src/features/funding/data/stores/createWithdrawalStore.ts` */
  withdrawal: (configId: string) => `${configId}-withdrawalStore` as const,
} as const;
