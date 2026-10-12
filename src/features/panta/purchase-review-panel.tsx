import React, { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';
import { type OrderBuild } from '@/lib/panta-order-build';
import { formatWalletUnits } from '@/lib/panta-portfolio';
import { type PreparedPurchase, type PurchaseReceipt } from '@/lib/panta-purchase';

import { PantaButton, PantaText } from './panta-ui';
import { TradeSwipeConfirm } from './trade-swipe-confirm';

function ReviewRow({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale > 1.3;
  return (
    <View style={[stacked ? a.flex_col : a.flex_row, a.justify_between, a.gap_12]}>
      <PantaText
        maxFontSizeMultiplier={2}
        allowFontScaling
        style={[!stacked && a.flex_1, a.text_13, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}
      >
        {label}
      </PantaText>
      <PantaText
        maxFontSizeMultiplier={2}
        allowFontScaling
        tabular
        style={[!stacked && a.flex_1, a.text_13, { textAlign: stacked ? 'left' : 'right' }, { marginTop: 0, marginBottom: 0 }]}
      >
        {value}
      </PantaText>
    </View>
  );
}
export function PurchaseReviewPanel({
  prepared,
  marketTitle,
  build,
  now,
  busy,
  onApprove,
}: {
  prepared: PreparedPurchase;
  marketTitle: string;
  build: OrderBuild;
  now: number;
  busy: boolean;
  onApprove: (accepted: boolean) => void;
}) {
  const t = useTheme();
  const [acceptedTicket, setAcceptedTicket] = useState<string | null>(null);
  const accepted = acceptedTicket === prepared.ticket;
  const confirmationExpiry = new Date(Math.min(Date.parse(build.expiresAt), Date.parse(prepared.expiresAt))).toISOString();
  const expired = Date.parse(confirmationExpiry) <= now;
  if (expired)
    return (
      <View style={[a.p_20, a.gap_12, a.rounded_16, a.border, t.atoms.border_secondary]}>
        <PantaText
          maxFontSizeMultiplier={2}
          accessibilityRole="alert"
          style={[a.text_17, a.font_semibold, { color: panta.no }, { marginTop: 0, marginBottom: 0 }]}
        >
          Purchase review expired
        </PantaText>
        <PantaText maxFontSizeMultiplier={2} style={[a.text_13, a.leading_150, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}>
          Edit your order to check fresh prices and costs.
        </PantaText>
      </View>
    );
  const cost = prepared.cost;
  return (
    <View style={[a.p_20, a.gap_16, a.rounded_16, a.border, t.atoms.border_secondary]}>
      <PantaText maxFontSizeMultiplier={2} allowFontScaling style={[a.text_22, a.font_bold, { marginTop: 0, marginBottom: 0 }]}>
        Review buy {build.side.toUpperCase()}
      </PantaText>
      <PantaText
        maxFontSizeMultiplier={2}
        allowFontScaling
        style={[a.text_17, a.font_semibold, a.leading_135, { marginTop: 0, marginBottom: 0 }]}
      >
        {marketTitle}
      </PantaText>
      <PantaText maxFontSizeMultiplier={2} allowFontScaling style={[a.text_13, a.font_semibold, { marginTop: 0, marginBottom: 0 }]}>
        Solana mainnet · {build.side.toUpperCase()}
      </PantaText>
      <PantaText maxFontSizeMultiplier={2} allowFontScaling tabular style={[a.text_26, a.font_bold, { marginTop: 0, marginBottom: 0 }]}>
        {formatWalletUnits(cost.totalUsdcBaseUnits, 6)} USDC
      </PantaText>
      <PantaText maxFontSizeMultiplier={2} allowFontScaling style={[a.text_13, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}>
        Total from your wallet
      </PantaText>
      <ReviewRow label="Order amount" value={`${formatWalletUnits(cost.amountBaseUnits, 6)} USDC`} />
      <ReviewRow label="Protocol fee" value={`${formatWalletUnits(cost.protocolFeeBaseUnits, 6)} USDC`} />
      <ReviewRow label="Network fee" value={`${formatWalletUnits(cost.networkFeeLamports, 9)} SOL`} />
      <ReviewRow label="Account rent" value={`${formatWalletUnits(cost.accountRentLamports, 9)} SOL`} />
      <ReviewRow label="Total SOL" value={`${formatWalletUnits(cost.totalSolLamports, 9)} SOL`} />
      <ReviewRow label="Estimated shares" value={build.expectedShares} />
      <PantaText
        maxFontSizeMultiplier={2}
        allowFontScaling
        selectable
        style={[a.text_11, a.leading_150, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}
      >
        Wallet: {build.wallet}
      </PantaText>
      <PantaText maxFontSizeMultiplier={2} allowFontScaling style={[a.text_13, a.leading_150, { marginTop: 0, marginBottom: 0 }]}>
        Price can change. Final shares may be lower; no minimum is guaranteed.
      </PantaText>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted, disabled: busy || expired }}
        accessibilityLabel="I accept that the price and final shares can change"
        disabled={busy || expired}
        onPress={() => setAcceptedTicket(accepted ? null : prepared.ticket)}
        style={[a.flex_row, a.align_center, a.gap_12, a.py_12]}
      >
        <View style={[a.align_center, a.justify_center, a.border, a.rounded_8, t.atoms.border_secondary, { width: 28, height: 28 }]}>
          <PantaText>{accepted ? '✓' : ''}</PantaText>
        </View>
        <PantaText
          maxFontSizeMultiplier={2}
          allowFontScaling
          style={[a.flex_1, a.text_13, a.leading_150, { marginTop: 0, marginBottom: 0 }]}
        >
          I accept price changes and fewer shares.
        </PantaText>
      </Pressable>
      <PantaText
        maxFontSizeMultiplier={2}
        allowFontScaling
        style={[a.text_11, a.leading_150, t.atoms.text_secondary, { marginTop: 0, marginBottom: 0 }]}
      >
        {expired
          ? 'Review expired. Request a new quote.'
          : `Confirm within ${Math.max(0, Math.ceil((Date.parse(confirmationExpiry) - now) / 1000))}s · signs and sends this purchase.`}
      </PantaText>
      <TradeSwipeConfirm
        key={prepared.ticket}
        ticket={prepared.ticket}
        expiresAt={confirmationExpiry}
        label={`buy ${build.side.toUpperCase()}`}
        disabled={!accepted || busy || expired}
        onConfirm={() => onApprove(accepted)}
      />
    </View>
  );
}
export function PurchaseReceiptPanel({
  receipt,
  allowCreationDismiss = false,
  transactionLabel = receipt.orderId.startsWith('p2p_') || receipt.orderId.startsWith('cr_') ? 'Transaction' : 'Purchase',
  checking,
  onCheck,
  onDismiss,
}: {
  receipt: PurchaseReceipt;
  transactionLabel?: 'Purchase' | 'Transaction';
  allowCreationDismiss?: boolean;
  checking: boolean;
  onCheck: () => void;
  onDismiss: () => void;
}) {
  const t = useTheme();
  return (
    <View style={[a.p_20, a.gap_16, a.rounded_16, a.border, t.atoms.border_secondary]}>
      <PantaText allowFontScaling accessibilityRole="header" style={[a.text_22, a.font_bold]}>
        {receipt.status === 'confirmed'
          ? `${transactionLabel} confirmed`
          : receipt.status === 'not-sent'
            ? `${transactionLabel} wasn’t sent`
            : receipt.status === 'failed'
              ? 'Transaction failed'
              : `${transactionLabel} pending`}
      </PantaText>
      <PantaText allowFontScaling style={[a.text_13, a.leading_150]}>
        {receipt.status === 'confirmed'
          ? receipt.orderId.startsWith('cr_')
            ? 'Finalized on Solana mainnet. Finish catalog registration in the market creator using this same receipt.'
            : 'Finalized on Solana mainnet. Your portfolio may take a little longer to update.'
          : receipt.status === 'not-sent'
            ? 'A final safety check stopped this transaction before it was sent. Start a new review to try again.'
            : receipt.status === 'failed'
              ? 'Solana recorded a failed transaction. Network fees may still have been charged.'
              : 'The result is not confirmed yet. Check this transaction before trading again. Closing the app preserves its status and will not send another transaction.'}
      </PantaText>
      <PantaText allowFontScaling selectable style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
        Market: {receipt.marketId}
      </PantaText>
      <PantaText allowFontScaling selectable style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
        Signature: {receipt.signature}
      </PantaText>
      {receipt.status === 'pending' ? (
        <PantaButton label={checking ? 'Checking transaction…' : 'Check transaction status'} disabled={checking} onPress={onCheck} />
      ) : receipt.status === 'confirmed' && receipt.orderId.startsWith('cr_') && !allowCreationDismiss ? null : (
        <PantaButton label="Done · start a new review" disabled={checking} onPress={onDismiss} />
      )}
    </View>
  );
}
