import React from 'react';
import { View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { formatWalletUnits, type WalletBalances } from '@/lib/panta-portfolio';

import { CatalogFailure, CatalogLoading } from './catalog-feedback';
import { PantaText } from './panta-ui';

export function WalletBalancesPanel({
  data,
  loading,
  error,
  onRetry,
}: {
  data: WalletBalances | null;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const t = useTheme();
  return (
    <View style={[a.gap_16]}>
      {loading && !data && <CatalogLoading label="Checking wallet balances" />}
      {error && (
        <CatalogFailure
          title="Wallet balances couldn’t update"
          description="The network balance could not be verified. Try again later."
          error={error}
          onRetry={onRetry}
          stale={!!data}
        />
      )}
      {data && (
        <View style={[a.p_20, a.gap_20, a.rounded_16, t.atoms.bg_elevated]}>
          <View style={[a.gap_8]}>
            <PantaText allowFontScaling style={[a.text_13, t.atoms.text_secondary]}>
              Wallet USDC
            </PantaText>
            <PantaText
              allowFontScaling
              tabular
              selectable
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
              style={[a.text_30, a.font_bold, a.leading_135]}
            >
              {formatWalletUnits(data.usdcBaseUnits, 6)}
            </PantaText>
          </View>
          <View style={[a.gap_8, a.pt_16, a.border_t, t.atoms.border_secondary]}>
            <PantaText allowFontScaling style={[a.text_13, t.atoms.text_secondary]}>
              SOL · network fees
            </PantaText>
            <PantaText
              allowFontScaling
              tabular
              selectable
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
              style={[a.text_20, a.font_semibold, a.leading_150]}
            >
              {formatWalletUnits(data.solLamports, 9)} SOL
            </PantaText>
          </View>
          <PantaText allowFontScaling style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
            {data.usdcState === 'frozen' ? 'This USDC account is frozen. Its funds cannot be transferred. ' : ''}
            USDC shown is held in the wallet’s standard trading token account. Other token accounts and Panta positions are separate.
          </PantaText>
          <PantaText allowFontScaling style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
            {error ? 'Last balance check' : loading ? 'Updating · last balance check' : 'Balances checked'}{' '}
            {new Date(data.fetchedAt).toLocaleString()} · confirmed Solana network state
          </PantaText>
        </View>
      )}
    </View>
  );
}
