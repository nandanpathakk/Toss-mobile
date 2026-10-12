import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, NativeModules, Platform, Pressable, View } from 'react-native';

import BootSplash from 'react-native-bootsplash';
import { SystemBars } from 'react-native-edge-to-edge';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { atoms as a } from '@/design/atoms';
import { ThemeProvider, useTheme } from '@/design/context';
import { pantaThemes } from '@/design/panta-theme';
import { panta, tossBrand } from '@/design/tokens';
import { catalogFilters, prioritizeMarketDetail } from '@/features/panta/catalog-store';
import { ExploreScreen } from '@/features/panta/explore-screen';
import { MarketCreatorScreen } from '@/features/panta/market-creator-screen';
import { MarketDetailScreen } from '@/features/panta/market-detail-screen';
import { PantaButton, PantaIcon, PantaText } from '@/features/panta/panta-ui';
import { PortfolioScreen } from '@/features/panta/portfolio-screen';
import { PantaPrivyProvider } from '@/features/panta/privy-provider';
import { TossBrand } from '@/features/panta/toss-brand';
import { TossLaunchScreen } from '@/features/panta/toss-launch-screen';
import { WalletScreen } from '@/features/panta/wallet-screen';
import { type CatalogMarket } from '@/lib/panta-catalog';

import { usePantaIntentHandler } from './use-panta-intent-handler';

const tabs = [
  { key: 'explore', label: 'Explore' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'account', label: 'Account' },
] as const;
type Page = (typeof tabs)[number]['key'];

function PantaShell() {
  usePantaIntentHandler();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<Page>('explore');
  const [tradingReturn, setTradingReturn] = useState<{ market: CatalogMarket; page: Page } | null>(null);
  const [creating, setCreating] = useState(false);
  const creatorBack = useRef<(() => void) | null>(null);
  const [market, setMarket] = useState<CatalogMarket | null>(null);
  useEffect(() => {
    catalogFilters.setState({ foreground: AppState.currentState === 'active' });
    const listener = AppState.addEventListener('change', state => catalogFilters.setState({ foreground: state === 'active' }));
    return () => listener.remove();
  }, []);
  const closeMarket = () => {
    prioritizeMarketDetail(null);
    setMarket(null);
  };

  const openMarket = (selected: CatalogMarket) => {
    prioritizeMarketDetail(selected.marketId);
    setMarket(selected);
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[a.flex_1, t.atoms.bg]}>
      <SystemBars style="light" />
      <View style={[a.flex_row, a.justify_between, a.align_center, a.px_20, a.py_8]}>
        <TossBrand />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open account"
          onPress={() => setPage('account')}
          style={[a.align_center, a.justify_center, a.rounded_full, { width: 44, height: 44, backgroundColor: tossBrand.field }]}
        >
          <PantaIcon name="account" color={panta.accent} size={20} />
        </Pressable>
      </View>
      <View style={[a.flex_1]}>
        {page === 'explore' ? (
          <ExploreScreen onMarketPress={openMarket} onCreateMarket={() => setCreating(true)} />
        ) : page === 'portfolio' ? (
          <PortfolioScreen onMarketPress={openMarket} onOpenAccount={() => setPage('account')} />
        ) : (
          <View style={[a.flex_1]}>
            {tradingReturn && (
              <View style={[a.px_20, a.py_8]}>
                <PantaButton
                  label="Back to selected market"
                  variant="secondary"
                  onPress={() => {
                    setPage(tradingReturn.page);
                    openMarket(tradingReturn.market);
                    setTradingReturn(null);
                  }}
                />
              </View>
            )}
            <WalletScreen page="account" />
          </View>
        )}
      </View>
      <View
        accessibilityRole="tablist"
        style={[a.flex_row, a.border_t, a.pt_8, t.atoms.border_secondary, { paddingBottom: Math.max(insets.bottom, 12) }]}
      >
        {tabs.map(tab => (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: page === tab.key }}
            onPress={() => {
              setPage(tab.key);
              if (tab.key !== 'account') setTradingReturn(null);
            }}
            style={[a.flex_1, a.align_center, a.justify_center, a.gap_8, a.py_8, { minHeight: 52 }]}
          >
            <PantaIcon name={tab.key} color={page === tab.key ? panta.accent : panta.secondary} size={20} />
            <PantaText style={[a.text_11, a.font_medium, page === tab.key ? { color: panta.accent } : t.atoms.text_secondary]}>
              {tab.label}
            </PantaText>
          </Pressable>
        ))}
      </View>
      <Modal
        visible={creating}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => (creatorBack.current ? creatorBack.current() : setCreating(false))}
      >
        {creating && (
          <SafeAreaProvider>
            <SafeAreaView edges={['top', 'left', 'right']} style={[a.flex_1, t.atoms.bg]}>
              <MarketCreatorScreen
                onClose={() => setCreating(false)}
                onOpenAccount={() => {
                  setCreating(false);
                  setPage('account');
                }}
                onBackHandlerChange={handler => {
                  creatorBack.current = handler;
                }}
              />
            </SafeAreaView>
          </SafeAreaProvider>
        )}
      </Modal>
      <Modal visible={market !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={closeMarket}>
        {market && (
          <SafeAreaProvider>
            <SafeAreaView edges={['top', 'left', 'right']} style={[a.flex_1, t.atoms.bg]}>
              <MarketDetailScreen
                key={market.marketId}
                market={market}
                onClose={closeMarket}
                onOpenAccount={() => {
                  setTradingReturn({ market, page });
                  closeMarket();
                  setPage('account');
                }}
              />
            </SafeAreaView>
          </SafeAreaProvider>
        )}
      </Modal>
    </SafeAreaView>
  );
}

// In-memory only: new native process/JS session plays once; background resume does not.
let openingCompleted = false;

export function PantaRoot() {
  const [opening, setOpening] = useState(!openingCompleted);
  const splashHandled = useRef(false);
  const [splashFailed, setSplashFailed] = useState(false);
  const dismissSplash = useCallback(() => {
    if (splashHandled.current) return;
    splashHandled.current = true;
    if (Platform.OS === 'ios') NativeModules.RainbowSplashScreen?.hideAnimated?.();
    else void BootSplash.hide({ fade: false }).catch(() => setSplashFailed(true));
  }, []);
  const completeOpening = useCallback(() => {
    openingCompleted = true;
    setOpening(false);
  }, []);
  return (
    <SafeAreaProvider>
      <ThemeProvider theme="dark" themesOverride={pantaThemes}>
        <View style={[a.flex_1]} onLayout={opening ? undefined : dismissSplash}>
          <View
            style={[a.flex_1]}
            accessibilityElementsHidden={opening}
            importantForAccessibility={opening ? 'no-hide-descendants' : 'auto'}
          >
            <PantaPrivyProvider>
              <PantaShell />
            </PantaPrivyProvider>
          </View>
          {opening && <TossLaunchScreen onReady={dismissSplash} onComplete={completeOpening} />}
          {splashFailed && !opening && (
            <PantaText accessibilityRole="alert" style={[a.p_12, a.text_11, { color: panta.no }]}>
              The native loading screen could not be dismissed.
            </PantaText>
          )}
        </View>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
