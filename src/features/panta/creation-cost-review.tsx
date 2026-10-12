import React, { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';
import { type CreationBuild, type CreationQuote } from '@/lib/panta-creation';
import { formatWalletUnits } from '@/lib/panta-portfolio';
import { type PreparedPurchase } from '@/lib/panta-purchase';

import { P2PFact } from './p2p-review-panel';
import { PantaButton, PantaText } from './panta-ui';

export function CreationCostReview({
  quote,
  build,
  prepared,
  now,
  busy,
  canPrepare,
  onPrepare,
  onApprove,
}: {
  quote: CreationQuote;
  build: CreationBuild | null;
  prepared: PreparedPurchase | null;
  now: number;
  busy: boolean;
  canPrepare: boolean;
  onPrepare: () => void;
  onApprove: (accepted: boolean) => void;
}) {
  const t = useTheme();
  const { fontScale } = useWindowDimensions();
  const [acceptedTicket, setAcceptedTicket] = useState<string | null>(null);
  const expired =
    Date.parse(quote.expiresAt) <= now ||
    (build !== null && Date.parse(build.expiresAt) <= now) ||
    (prepared !== null && Date.parse(prepared.expiresAt) <= now);
  if (expired)
    return (
      <View style={[a.gap_12]}>
        <PantaText
          maxFontSizeMultiplier={2}
          accessibilityRole="alert"
          style={[a.text_17, a.font_semibold, { marginTop: 0, marginBottom: 0 }]}
        >
          Creation review expired
        </PantaText>
        <PantaText maxFontSizeMultiplier={2} style={[a.text_13, a.leading_150, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}>
          Check costs again. Old fees and approval are no longer available.
        </PantaText>
      </View>
    );
  const cost = prepared?.cost ?? build?.creation.cost;
  const accepted = !!prepared && acceptedTicket === prepared.ticket;
  return (
    <View style={[a.gap_20, a.p_20, a.rounded_16, t.atoms.bg_elevated]}>
      <View style={[a.gap_12]}>
        <PantaText
          maxFontSizeMultiplier={2}
          allowFontScaling
          accessibilityRole="header"
          style={[fontScale > 1.3 ? a.text_17 : a.text_22, a.font_bold, { marginTop: 0, marginBottom: 0 }]}
        >
          {prepared ? 'Publish market' : 'Creation costs'}
        </PantaText>
        <PantaText
          maxFontSizeMultiplier={2}
          allowFontScaling
          style={[a.text_11, { color: panta.accent }, { marginTop: 0, marginBottom: 0 }]}
        >
          STANDARD MARKET · SOLANA MAINNET
        </PantaText>
        <PantaText maxFontSizeMultiplier={2} allowFontScaling tabular style={[a.text_30, a.font_bold, { marginTop: 0, marginBottom: 0 }]}>
          {formatWalletUnits(quote.paymentUsdc, 6)} USDC
        </PantaText>
        <PantaText
          maxFontSizeMultiplier={2}
          allowFontScaling
          style={[a.text_13, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}
        >
          Total creation payment
        </PantaText>
      </View>
      <P2PFact
        maxFontSizeMultiplier={2}
        label="Included liquidity contribution"
        value={`${formatWalletUnits(quote.liquidityInjectionUsdc, 6)} USDC`}
      />
      <P2PFact maxFontSizeMultiplier={2} label="Included platform fee" value={`${formatWalletUnits(quote.platformRevenueUsdc, 6)} USDC`} />
      {cost ? (
        <>
          <View style={[a.border_t, t.atoms.border_secondary]} />
          <P2PFact maxFontSizeMultiplier={2} label="Network fee" value={`${formatWalletUnits(cost.networkFeeLamports, 9)} SOL`} />
          <P2PFact maxFontSizeMultiplier={2} label="New account rent" value={`${formatWalletUnits(cost.accountRentLamports, 9)} SOL`} />
          <P2PFact maxFontSizeMultiplier={2} label="Total SOL required" value={`${formatWalletUnits(cost.totalSolLamports, 9)} SOL`} />
        </>
      ) : (
        <PantaText
          maxFontSizeMultiplier={2}
          allowFontScaling
          style={[a.text_13, a.leading_150, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}
        >
          Network fee and account rent have not been verified. Publication is unavailable until all costs pass the transaction check.
        </PantaText>
      )}
      <PantaText
        maxFontSizeMultiplier={2}
        allowFontScaling
        style={[a.text_13, a.leading_150, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}
      >
        The liquidity contribution is part of the creation payment. It is not a promised refund or payout. Network fees may still be charged
        if a submitted transaction fails.
      </PantaText>
      {build && (
        <PantaText
          maxFontSizeMultiplier={2}
          allowFontScaling
          selectable
          style={[a.text_11, a.leading_150, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}
        >
          Creator wallet: {build.wallet}
        </PantaText>
      )}
      {prepared ? (
        <>
          <PantaText
            maxFontSizeMultiplier={2}
            allowFontScaling
            style={[a.text_17, a.font_semibold, a.leading_135, { marginTop: 0, marginBottom: 0 }]}
          >
            {build?.creation.request.question}
          </PantaText>
          <PantaText maxFontSizeMultiplier={2} allowFontScaling style={[a.text_13, a.leading_150, { marginTop: 0, marginBottom: 0 }]}>
            Publishing writes the question, timeline, criteria and sources publicly on Solana. These on-chain details cannot be edited
            through Toss. Approval applies to this transaction only.
          </PantaText>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="I approve publishing this market and paying the displayed USDC and SOL costs"
            accessibilityState={{ checked: accepted, disabled: busy }}
            disabled={busy}
            onPress={() => setAcceptedTicket(accepted ? null : prepared.ticket)}
            style={[fontScale > 1.3 ? a.flex_col : a.flex_row, a.align_center, a.gap_12, a.py_12, { minHeight: 48 }]}
          >
            <View style={[a.align_center, a.justify_center, a.border, a.rounded_8, t.atoms.border_secondary, { width: 28, height: 28 }]}>
              <PantaText>{accepted ? '✓' : ''}</PantaText>
            </View>
            <PantaText
              maxFontSizeMultiplier={2}
              allowFontScaling
              style={[a.flex_1, a.text_13, a.leading_150, { marginTop: 0, marginBottom: 0 }]}
            >
              I approve publishing this market and paying the costs above.
            </PantaText>
          </Pressable>
          <PantaButton
            maxFontSizeMultiplier={2}
            label={`Publish · ${formatWalletUnits(quote.paymentUsdc, 6)} USDC`}
            disabled={!accepted || busy}
            onPress={() => onApprove(accepted)}
          />
        </>
      ) : (
        build && (
          <PantaButton
            maxFontSizeMultiplier={2}
            label={busy ? 'Checking final costs…' : 'Review final costs'}
            disabled={!canPrepare || busy}
            onPress={onPrepare}
          />
        )
      )}
    </View>
  );
}
