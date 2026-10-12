import React, { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';
import { type P2POrder } from '@/lib/panta-p2p';

import { P2PFact as Fact } from './p2p-review-panel';
import { pantaFont, PantaText } from './panta-ui';
import { TradeOutcomeSelector } from './trade-outcome-selector';

export function P2POrderForm({
  intent,
  side,
  price,
  shares,
  busy,
  fresh,
  availableShares,
  offers,
  setIntent,
  setSide,
  setPrice,
  setShares,
}: {
  intent: 'buy' | 'sell';
  side: 'yes' | 'no';
  price: string;
  shares: string;
  busy: boolean;
  fresh: boolean;
  availableShares: string;
  offers: P2POrder[];
  setIntent: (value: 'buy' | 'sell') => void;
  setSide: (value: 'yes' | 'no') => void;
  setPrice: (value: string) => void;
  setShares: (value: string) => void;
}) {
  const t = useTheme();
  const [showOffers, setShowOffers] = useState(false);
  return (
    <View style={[a.gap_20]}>
      <View style={[a.flex_row, a.border_b, t.atoms.border_secondary]}>
        {(['buy', 'sell'] as const).map(item => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected: intent === item, disabled: busy }}
            disabled={busy}
            onPress={() => setIntent(item)}
            style={[
              a.flex_1,
              a.align_center,
              a.py_16,
              { borderBottomWidth: 2, borderBottomColor: intent === item ? panta.accent : 'transparent', minHeight: 48 },
            ]}
          >
            <PantaText style={[a.text_17, a.font_semibold, { color: intent === item ? panta.text : panta.secondary }]}>
              {item === 'buy' ? 'Buy' : 'Sell'}
            </PantaText>
          </Pressable>
        ))}
      </View>
      <TradeOutcomeSelector side={side} disabled={busy} onChange={setSide} />
      <View style={[a.p_20, a.gap_16, a.rounded_16, t.atoms.bg_elevated]}>
        <PantaText style={[a.text_15, a.font_semibold]}>Limit price</PantaText>
        <PantaText style={[a.text_11, t.atoms.text_secondary]}>USDC / share · exact price only</PantaText>
        <TextInput
          accessibilityLabel="Limit price in USDC per share"
          value={price}
          onChangeText={setPrice}
          editable={!busy}
          keyboardType="decimal-pad"
          placeholder="0.50"
          placeholderTextColor={panta.secondary}
          style={[a.py_12, { ...pantaFont, fontSize: 30, color: panta.text, minHeight: 48 }]}
        />
        <PantaText style={[a.text_15, a.font_semibold]}>Shares</PantaText>
        <TextInput
          accessibilityLabel="Number of shares"
          value={shares}
          onChangeText={setShares}
          editable={!busy}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={panta.secondary}
          style={[a.py_12, { ...pantaFont, fontSize: 30, color: panta.text, minHeight: 48 }]}
        />
        <PantaText style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>Minimum order value: 0.10 USDC.</PantaText>
        {intent === 'sell' && fresh && <Fact label="Available shares" value={availableShares} />}
      </View>
      <View style={[a.gap_12]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showOffers }}
          onPress={() => setShowOffers(!showOffers)}
          style={[a.flex_row, a.align_center, a.justify_between, a.gap_12, { minHeight: 44 }]}
        >
          <PantaText style={[a.flex_1, a.text_15, a.font_semibold]}>
            {intent === 'buy' ? 'Sell offers' : 'Buy offers'} · {fresh ? offers.length : '—'}
          </PantaText>
          <PantaText style={[a.text_13, { color: panta.accent }]}>{showOffers ? 'Hide' : 'View'}</PantaText>
        </Pressable>
        {showOffers &&
          (!fresh ? (
            <PantaText style={[a.text_13, t.atoms.text_secondary]}>A fresh book is required to show offers.</PantaText>
          ) : offers.length === 0 ? (
            <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
              No offers yet. Your order can stay open at your price.
            </PantaText>
          ) : (
            offers.slice(0, 8).map(order => (
              <Pressable
                key={order.address}
                accessibilityRole="button"
                accessibilityLabel={`Use price ${order.price} USDC, ${order.shares} shares available`}
                disabled={busy}
                onPress={() => setPrice(order.price)}
                style={[a.p_16, a.rounded_12, t.atoms.bg_elevated]}
              >
                <Fact label={`${order.shares} ${order.side.toUpperCase()} shares`} value={`${order.price} USDC`} />
              </Pressable>
            ))
          ))}
      </View>
      <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
        Unfilled buys reserve USDC and fees; sells reserve shares. Orders may fill partly. Withdraw sale proceeds from My orders.
      </PantaText>
    </View>
  );
}
