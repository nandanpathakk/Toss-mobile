import React, { useState } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';
import { type CatalogTrade } from '@/lib/panta-catalog';

import { DetailField, DetailHeading, DetailSheet, DetailSurface } from './detail-ui';
import { PantaButton, PantaIcon, PantaText } from './panta-ui';

export function TradeActivityRow({ trade, onPress }: { trade: CatalogTrade; onPress?: (trade: CatalogTrade) => void }) {
  const t = useTheme();
  const [opened, setOpened] = useState(false);
  const yes = /[1-9]/.test(trade.yesAmount);
  const no = /[1-9]/.test(trade.noAmount);
  const side = yes && no ? 'YES + NO' : yes ? 'YES' : no ? 'NO' : 'Trade';
  const color = yes && !no ? panta.yes : no && !yes ? panta.no : panta.text;
  const background = yes && !no ? panta.yesBackground : no && !yes ? panta.noBackground : panta.elevated;
  const shortDate =
    trade.blockTime === null
      ? 'Time unavailable'
      : new Date(trade.blockTime * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${side} trade by ${trade.wallet}`}
        accessibilityHint="Opens transaction details"
        onPress={() => {
          if (onPress) onPress(trade);
          else setOpened(true);
        }}
        style={({ pressed }) => [a.p_20, a.gap_12, a.border_b, t.atoms.border_secondary, { opacity: pressed ? 0.6 : 1 }]}
      >
        <View style={[a.flex_row, a.align_center, a.gap_12]}>
          <View style={[a.align_center, a.justify_center, a.rounded_full, { width: 36, height: 36, backgroundColor: background }]}>
            <PantaIcon name="activity" color={color} size={18} />
          </View>
          <PantaText allowFontScaling style={[a.flex_1, a.text_17, a.font_semibold, { color }]}>
            {side}
          </PantaText>
          <PantaIcon name="chevron" size={16} color={panta.secondary} />
        </View>
        <View style={[a.flex_row, a.gap_12, a.justify_between, a.flex_wrap]}>
          <PantaText allowFontScaling style={[a.text_13, t.atoms.text_secondary]}>
            {trade.wallet.slice(0, 6)}…{trade.wallet.slice(-4)}
          </PantaText>
          <PantaText allowFontScaling style={[a.text_13, t.atoms.text_secondary]}>
            {trade.isPrimary ? 'Primary' : 'P2P'}
          </PantaText>
        </View>
        <PantaText allowFontScaling style={[a.text_11, t.atoms.text_secondary]}>
          {shortDate}
        </PantaText>
      </Pressable>
      <DetailSheet visible={opened} title="Trade details" onClose={() => setOpened(false)}>
        <TradeDetailContent trade={trade} />
      </DetailSheet>
    </>
  );
}

export function TradeDetailContent({ trade }: { trade: CatalogTrade }) {
  const t = useTheme();
  const yes = /[1-9]/.test(trade.yesAmount);
  const no = /[1-9]/.test(trade.noAmount);
  const side = yes && no ? 'YES + NO' : yes ? 'YES' : no ? 'NO' : 'Trade';
  const color = yes && !no ? panta.yes : no && !yes ? panta.no : panta.text;
  const background = yes && !no ? panta.yesBackground : no && !yes ? panta.noBackground : panta.elevated;
  const date = trade.blockTime === null ? 'Time unavailable' : new Date(trade.blockTime * 1000).toLocaleString();
  return (
    <>
      <View style={[a.align_center, a.py_12, a.gap_16]}>
        <View style={[a.align_center, a.justify_center, a.rounded_full, { width: 64, height: 64, backgroundColor: background }]}>
          <PantaIcon name="activity" color={color} size={30} />
        </View>
        <PantaText allowFontScaling style={[a.text_30, a.font_bold, { color }]}>
          {side}
        </PantaText>
        <PantaText allowFontScaling style={[a.text_15, t.atoms.text_secondary]}>
          {trade.isPrimary ? 'Primary market trade' : 'P2P market trade'}
        </PantaText>
        <PantaText allowFontScaling style={[a.text_13, a.leading_150, t.atoms.text_secondary, { textAlign: 'center' }]}>
          {date}
        </PantaText>
      </View>
      <View style={[a.gap_16]}>
        <DetailHeading title="Reported amounts" subtitle="Quantities as recorded by Panta." />
        <DetailSurface>
          <DetailField label="YES shares" value={trade.yesAmount} />
          <DetailField label="NO shares" value={trade.noAmount} />
          <DetailField label="Fee" value={trade.feePaid} />
          <DetailField label="Quote asset" value={trade.quoteAsset} last />
        </DetailSurface>
      </View>
      <View style={[a.gap_16]}>
        <DetailHeading title="Transaction" />
        <DetailSurface>
          <DetailField label="Wallet" value={trade.wallet} selectable />
          <DetailField label="Market" value={trade.marketId} selectable />
          <DetailField label="Signature" value={trade.signature} selectable last />
        </DetailSurface>
      </View>
      <PantaButton
        label="View transaction on Solscan"
        onPress={() => {
          void Linking.openURL(`https://solscan.io/tx/${trade.signature}`).catch(() =>
            Alert.alert('Couldn’t open transaction', 'Please try again.')
          );
        }}
      />
    </>
  );
}
