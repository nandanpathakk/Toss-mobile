import React, { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';
import { type P2PBuild } from '@/lib/panta-p2p';
import { formatWalletUnits } from '@/lib/panta-portfolio';
import { type PreparedPurchase } from '@/lib/panta-purchase';

import { PantaButton, PantaText } from './panta-ui';
import { TradeSwipeConfirm } from './trade-swipe-confirm';

export function P2PFact({ label, value, maxFontSizeMultiplier = 2 }: { label: string; value: string; maxFontSizeMultiplier?: number }) {
  const t = useTheme();
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width - 80);
  const stacked = width < 280 || window.fontScale > 1.3;
  return (
    <View
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={[stacked ? a.flex_col : a.flex_row, a.justify_between, stacked ? a.gap_4 : a.gap_16]}
    >
      <PantaText
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        style={[
          !stacked && a.flex_1,
          a.text_13,
          a.leading_150,
          t.atoms.text_secondary,
          maxFontSizeMultiplier !== undefined && { marginTop: 0, marginBottom: 0 },
        ]}
      >
        {label}
      </PantaText>
      <PantaText
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        tabular
        style={[
          !stacked && a.flex_1,
          stacked ? a.text_15 : a.text_13,
          a.leading_150,
          { textAlign: stacked ? 'left' : 'right' },
          maxFontSizeMultiplier !== undefined && { marginTop: 0, marginBottom: 0 },
        ]}
      >
        {value}
      </PantaText>
    </View>
  );
}
export function P2PReviewPanel({
  build,
  now,
  prepared,
  busy,
  canPrepare,
  onPrepare,
  onApprove,
  prepareError = false,
}: {
  build: P2PBuild;
  now: number;
  prepared: PreparedPurchase | null;
  busy: boolean;
  canPrepare: boolean;
  prepareError?: boolean;
  onPrepare: () => void;
  onApprove: () => void;
}) {
  const t = useTheme();
  const [acceptedTicket, setAcceptedTicket] = useState<string | null>(null);
  const facts = build.p2p.facts;
  const selectedIntent = build.p2p.request.intent;
  const shares = (value: string) => `${value} ${value === '1' ? 'share' : 'shares'}`;
  const confirmationExpiry = prepared
    ? new Date(Math.min(Date.parse(build.expiresAt), Date.parse(prepared.expiresAt))).toISOString()
    : build.expiresAt;
  const expired = Date.parse(confirmationExpiry) <= now;
  if (expired)
    return (
      <View style={[a.p_20, a.gap_12, a.rounded_16, a.border, t.atoms.border_secondary]}>
        <PantaText
          maxFontSizeMultiplier={2}
          accessibilityRole="alert"
          style={[a.text_17, a.font_semibold, { color: panta.no }, { marginTop: 0, marginBottom: 0 }]}
        >
          Review expired
        </PantaText>
        <PantaText maxFontSizeMultiplier={2} style={[a.text_13, a.leading_150, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}>
          Review your order again to check current balances, orders and costs.
        </PantaText>
      </View>
    );
  return (
    <View style={[a.p_20, a.gap_16, a.rounded_16, a.border, t.atoms.border_secondary]}>
      <PantaText maxFontSizeMultiplier={2} style={[a.text_22, a.font_bold, { marginTop: 0, marginBottom: 0 }]}>
        {selectedIntent === 'cancel'
          ? 'Cancel order'
          : selectedIntent === 'withdraw'
            ? 'Withdraw market cash'
            : `Review ${selectedIntent} ${build.side.toUpperCase()}`}
      </PantaText>
      <View style={[a.gap_8]}>
        <PantaText maxFontSizeMultiplier={2} tabular style={[a.text_30, a.font_bold, { marginTop: 0, marginBottom: 0 }]}>
          {selectedIntent === 'sell'
            ? shares(build.p2p.request.shares)
            : `${selectedIntent === 'cancel' || selectedIntent === 'withdraw' ? facts.refundUsdc : formatWalletUnits(build.p2p.cost.totalUsdcBaseUnits, 6)} USDC`}
        </PantaText>
        <PantaText maxFontSizeMultiplier={2} style={[a.text_13, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}>
          {selectedIntent === 'sell'
            ? 'Shares offered at your limit price'
            : selectedIntent === 'cancel' || selectedIntent === 'withdraw'
              ? 'Returned to your wallet'
              : 'Total reserved · includes fee allowance'}
        </PantaText>
      </View>
      {['buy', 'sell'].includes(selectedIntent) && (
        <>
          <P2PFact label="Limit price" value={`${build.p2p.request.price} USDC / share`} />
          <P2PFact label="Quantity" value={shares(build.p2p.request.shares)} />
          <P2PFact label="Simulated fill" value={shares(facts.filledShares)} />
          <P2PFact label="May remain open" value={shares(facts.remainingShares)} />
        </>
      )}
      {selectedIntent !== 'buy' && (
        <P2PFact label="USDC debit / escrow" value={`${formatWalletUnits(build.p2p.cost.totalUsdcBaseUnits, 6)} USDC`} />
      )}
      <P2PFact label="Included fee allowance" value={`${formatWalletUnits(build.p2p.cost.protocolFeeBaseUnits, 6)} USDC`} />
      {facts.cashCreditUsdc !== '0' && <P2PFact label="Simulated market cash credit" value={`${facts.cashCreditUsdc} USDC`} />}
      {facts.refundUsdc !== '0' && <P2PFact label="USDC returned to wallet" value={`${facts.refundUsdc} USDC`} />}
      <P2PFact label="Network fee" value={`${formatWalletUnits(build.p2p.cost.networkFeeLamports, 9)} SOL`} />
      <P2PFact label="New account rent" value={`${formatWalletUnits(build.p2p.cost.accountRentLamports, 9)} SOL`} />
      <P2PFact label="Total SOL" value={`${formatWalletUnits(build.p2p.cost.totalSolLamports, 9)} SOL`} />
      {facts.rentRefundLamports !== '0' && (
        <P2PFact label="Account rent returned" value={`${formatWalletUnits(facts.rentRefundLamports, 9)} SOL`} />
      )}
      <PantaText
        selectable
        accessibilityLabel={`Selected wallet ${build.wallet}`}
        style={[a.text_11, a.leading_150, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}
      >
        Selected wallet: {build.wallet}
      </PantaText>
      <PantaText maxFontSizeMultiplier={2} style={[a.text_11, a.leading_150, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}>
        Estimates use the current order book. Changed orders or balances require a new review.
      </PantaText>
      {expired ? (
        <PantaText
          maxFontSizeMultiplier={2}
          accessibilityRole="alert"
          style={[a.text_13, { color: panta.no }, { marginTop: 0, marginBottom: 0 }]}
        >
          Review expired. Review the order again.
        </PantaText>
      ) : !prepared ? (
        prepareError ? (
          <PantaButton
            label="Retry cost check"
            disabled={!canPrepare || busy}
            onPress={() => {
              onPrepare();
            }}
          />
        ) : (
          <PantaText maxFontSizeMultiplier={2} style={[a.text_13, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}>
            Checking final costs…
          </PantaText>
        )
      ) : (
        <>
          <PantaText maxFontSizeMultiplier={2} style={[a.text_11, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}>
            Approval expires in {Math.max(0, Math.ceil((Date.parse(confirmationExpiry) - now) / 1000))}s
          </PantaText>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acceptedTicket === prepared.ticket, disabled: busy }}
            accessibilityLabel="I approve this transaction and its displayed costs"
            disabled={busy}
            onPress={() => setAcceptedTicket(acceptedTicket === prepared!.ticket ? null : prepared!.ticket)}
            style={[a.flex_row, a.align_center, a.gap_12, a.py_12, { minHeight: 48 }]}
          >
            <PantaText maxFontSizeMultiplier={2} style={[a.text_22, { color: panta.accent }, { marginTop: 0, marginBottom: 0 }]}>
              {acceptedTicket === prepared.ticket ? '☑' : '☐'}
            </PantaText>
            <PantaText maxFontSizeMultiplier={2} style={[a.flex_1, a.text_13, a.leading_150, { marginTop: 0, marginBottom: 0 }]}>
              {['buy', 'sell'].includes(selectedIntent)
                ? 'I accept the costs and that unfilled orders lock funds or shares.'
                : `I approve this ${selectedIntent === 'cancel' ? 'cancellation' : 'withdrawal'} and its displayed costs.`}
            </PantaText>
          </Pressable>
          <TradeSwipeConfirm
            key={prepared.ticket}
            ticket={prepared.ticket}
            expiresAt={confirmationExpiry}
            label={
              selectedIntent === 'cancel'
                ? 'cancel order'
                : selectedIntent === 'withdraw'
                  ? 'withdraw cash'
                  : `${selectedIntent} ${build.side.toUpperCase()}`
            }
            disabled={busy || acceptedTicket !== prepared.ticket || Date.parse(prepared.expiresAt) <= now}
            onConfirm={onApprove}
          />
        </>
      )}
    </View>
  );
}
