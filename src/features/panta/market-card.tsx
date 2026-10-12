import React, { useId } from 'react';
import { Pressable, View } from 'react-native';

import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { atoms as a } from '@/design/atoms';
import { panta } from '@/design/tokens';

import { PantaText } from './panta-ui';

type MarketSide = 'YES' | 'NO';

type ArtworkMarket = { artwork: 'crypto' | 'science' | 'world'; headline: string; category: string };
export function MarketArtwork({ market, sample = false }: { market: ArtworkMarket; sample?: boolean }) {
  const gradientId = `artwork-${useId().replace(/:/g, '')}`;
  const colors =
    market.artwork === 'crypto' ? panta.cryptoArtwork : market.artwork === 'science' ? panta.scienceArtwork : panta.worldArtwork;
  return (
    <View style={[a.overflow_hidden, a.p_16, a.justify_between, { height: 138 }]}>
      <View
        pointerEvents="none"
        style={[a.absolute, { top: 0, right: 0, bottom: 0, left: 0 }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              {colors.map((color, index) => (
                <Stop key={index} offset={`${(index * 100) / (colors.length - 1)}%`} stopColor={color} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
        </Svg>
      </View>
      <View style={[a.absolute, { right: -10, bottom: -22 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg width={166} height={166} viewBox="0 0 160 160" fill="none">
          <Circle cx={80} cy={80} r={61} stroke="#FFFFFF16" />
          <Circle cx={80} cy={80} r={48} stroke="#FFFFFF20" />
          {market.artwork === 'science' ? (
            <Path d="M80 35Q86 74 120 80Q86 86 80 125Q74 86 40 80Q74 74 80 35" fill="#FFFFFF99" />
          ) : (
            <>
              <Circle cx={80} cy={80} r={34} stroke="#FFFFFF99" strokeWidth={3} />
              <Circle cx={80} cy={80} r={26} stroke="#FFFFFF99" strokeWidth={3} />
            </>
          )}
        </Svg>
      </View>
      <View style={[a.self_start, a.px_8, a.py_4, a.rounded_6, { backgroundColor: panta.scrim }]}>
        <PantaText style={[a.text_10, a.font_medium]}>
          {market.category.toUpperCase()}
          {sample ? ' · SAMPLE' : ''}
        </PantaText>
      </View>
      <PantaText style={[a.text_26, a.font_heavy, { letterSpacing: -0.7 }]}>{market.headline}</PantaText>
    </View>
  );
}

export function Outcome({ side, price, onPress }: { side: MarketSide; price: number | null; onPress?: () => void }) {
  const color = side === 'YES' ? panta.yes : panta.no;
  const body = (
    <>
      <PantaText tabular style={[a.text_13, a.font_semibold, { color }]}>
        {onPress ? `Buy ${side}` : side}
      </PantaText>
      <PantaText style={[a.text_20, a.font_bold, { color }]}>
        {price === null ? '—' : price <= 1 ? `${(price * 100).toFixed(1)}%` : `${price.toFixed(4)} USDC`}
      </PantaText>
    </>
  );
  const styles = [
    a.flex_1,
    a.flex_row,
    a.align_center,
    a.justify_between,
    a.p_12,
    a.rounded_10,
    { backgroundColor: side === 'YES' ? panta.yesBackground : panta.noBackground, minHeight: 48 },
  ];
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Choose ${side}${price === null ? '' : `, indicative price ${price.toFixed(4)} USDC per share`}`}
      onPress={onPress}
      style={({ pressed }) => [...styles, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={styles}>{body}</View>
  );
}
