import React, { useState } from 'react';
import { Image, Pressable, useWindowDimensions, View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta, pantaLayout } from '@/design/tokens';
import { type CatalogMarket } from '@/lib/panta-catalog';

import { MarketArtwork } from './market-card';
import { currentMarketPrices } from './market-price-status';
import { PantaBadge, PantaIcon, PantaText } from './panta-ui';
import { useMarketPriceClock } from './use-market-price-clock';

export function categoryLabel(category: string) {
  return category.replace(/[_-]/g, ' ').replace(/^./, letter => letter.toUpperCase());
}

export function CatalogArtwork({ market }: { market: CatalogMarket }) {
  const [failed, setFailed] = useState(false);
  const image = market.images[0];
  if (image && !failed) {
    return (
      <Image
        accessible={false}
        source={{ uri: image }}
        resizeMode="contain"
        onError={() => setFailed(true)}
        style={{ height: 220, width: '100%', backgroundColor: panta.surface }}
      />
    );
  }
  return (
    <MarketArtwork
      sample={false}
      market={{
        category: market.category,
        artwork: market.category === 'crypto' ? 'crypto' : market.category === 'science' ? 'science' : 'world',
        headline: `${categoryLabel(market.category)}.\nWhat’s next?`,
      }}
    />
  );
}

function MarketThumbnail({ market }: { market: CatalogMarket }) {
  const [failed, setFailed] = useState(false);
  return (
    <View
      style={[
        a.overflow_hidden,
        a.rounded_16,
        a.align_center,
        a.justify_center,
        { width: 64, height: 64, backgroundColor: panta.elevated },
      ]}
    >
      {market.images[0] && !failed ? (
        <Image source={{ uri: market.images[0] }} accessible={false} onError={() => setFailed(true)} style={{ width: 64, height: 64 }} />
      ) : (
        <PantaIcon name="explore" color={panta.secondary} size={26} />
      )}
    </View>
  );
}

function CardPrice({ side, price }: { side: 'YES' | 'NO'; price: number | null }) {
  const color = side === 'YES' ? panta.yes : panta.no;
  return (
    <View
      style={[a.flex_1, a.p_12, a.gap_12, a.rounded_12, { backgroundColor: side === 'YES' ? panta.yesBackground : panta.noBackground }]}
    >
      <View style={[a.flex_row, a.align_center, a.justify_between, a.gap_8]}>
        <PantaText allowFontScaling style={[a.text_13, a.font_semibold, { color }]}>
          {side}
        </PantaText>
        <PantaText allowFontScaling tabular style={[a.text_20, a.font_bold, { color, letterSpacing: -0.5 }]}>
          {price === null ? '—' : price.toFixed(4)}
        </PantaText>
      </View>
      <PantaText allowFontScaling style={[a.text_11, { color: panta.secondary }]}>
        {price === null ? 'Price unavailable' : 'USDC / share'}
      </PantaText>
    </View>
  );
}

export function CatalogCard({ market: snapshot, onPress }: { market: CatalogMarket; onPress: () => void }) {
  const market = currentMarketPrices(snapshot, useMarketPriceClock(snapshot.priceObservedAt));
  const t = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const phase = market.phase === 'secondary' ? 'P2P' : categoryLabel(market.phase);
  const date = market.endTime === null ? null : new Date(market.endTime * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${market.title}. ${phase}. YES ${market.yesPrice === null ? 'unavailable' : market.yesPrice.toFixed(4) + ' USDC per share'}. NO ${market.noPrice === null ? 'unavailable' : market.noPrice.toFixed(4) + ' USDC per share'}.`}
      onPress={onPress}
      style={({ pressed }) => [
        a.p_20,
        a.gap_20,
        t.atoms.bg_elevated,
        { borderRadius: pantaLayout.cardRadius, opacity: pressed ? 0.65 : 1 },
      ]}
    >
      <View style={[a.flex_row, a.align_center, a.justify_between, a.gap_12]}>
        <PantaText allowFontScaling style={[a.flex_1, a.text_11, a.font_medium, t.atoms.text_secondary]}>
          {categoryLabel(market.category)}
        </PantaText>
        <PantaBadge label={phase} accent={market.phase === 'secondary'} />
      </View>
      <View style={[a.flex_row, a.gap_16, a.align_start]}>
        <MarketThumbnail key={market.images[0] ?? market.marketId} market={market} />
        <PantaText allowFontScaling style={[a.flex_1, a.text_17, a.font_semibold, a.leading_135]}>
          {market.title}
        </PantaText>
      </View>
      <View style={[width < 360 || fontScale > 1.3 ? a.flex_col : a.flex_row, a.gap_8]}>
        <CardPrice side="YES" price={market.yesPrice} />
        <CardPrice side="NO" price={market.noPrice} />
      </View>
      {market.priceObservedAt != null && (market.yesPrice !== null || market.noPrice !== null) && (
        <PantaText allowFontScaling style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
          Price snapshot {new Date(market.priceObservedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </PantaText>
      )}
      <View style={[a.flex_row, a.flex_wrap, a.align_center, a.justify_between, a.gap_12]}>
        <PantaText allowFontScaling tabular style={[a.text_11, t.atoms.text_secondary]}>
          {market.volumeUsdc === null
            ? 'Volume unavailable'
            : `${Number(market.volumeUsdc).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 })} USDC volume`}
        </PantaText>
        {date && (
          <PantaText allowFontScaling style={[a.text_11, t.atoms.text_secondary]}>
            {market.phase === 'resolved' || market.phase === 'cancelled' ? 'Ended' : 'Ends'} {date}
          </PantaText>
        )}
      </View>
    </Pressable>
  );
}
