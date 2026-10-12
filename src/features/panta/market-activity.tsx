import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { type CatalogTrade } from '@/lib/panta-catalog';

import { CatalogFailure, CatalogLoading } from './catalog-feedback';
import { createMarketActivityStore } from './catalog-store';
import { DetailSurface } from './detail-ui';
import { PantaButton, PantaText } from './panta-ui';
import { TradeActivityRow } from './trade-activity-row';

export function marketDate(timestamp: number | null) {
  return timestamp === null
    ? 'Not available'
    : new Date(timestamp * 1000).toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });
}

export function MarketActivity({
  marketId,
  refreshVersion,
  onTradePress,
}: {
  marketId: string;
  refreshVersion: number;
  onTradePress?: (trade: CatalogTrade) => void;
}) {
  const t = useTheme();
  const [limit, setLimit] = useState(20);
  const useActivityStore = useMemo(() => createMarketActivityStore(marketId, limit), [marketId, limit]);
  const state = useActivityStore();
  const activity = state.getData();
  const previousRefresh = useRef(refreshVersion);
  useEffect(() => {
    if (previousRefresh.current !== refreshVersion) {
      previousRefresh.current = refreshVersion;
      void useActivityStore.getState().fetch(undefined, { force: true });
    }
  }, [refreshVersion, useActivityStore]);
  const retry = () => void state.fetch(undefined, { force: true });
  return (
    <View style={[a.gap_16]}>
      <View style={[a.flex_row, a.align_center, a.justify_between]}>
        <PantaText accessibilityRole="header" style={[a.text_20, a.font_semibold]}>
          Recent activity
        </PantaText>
        {activity && <PantaText style={[a.text_11, t.atoms.text_secondary]}>{activity.items.length} trades</PantaText>}
      </View>
      {state.error && <CatalogFailure title="Activity couldn’t load" error={state.error} stale={Boolean(activity)} onRetry={retry} />}
      {!activity && !state.error && <CatalogLoading label="Loading recent activity" />}
      {activity && (
        <DetailSurface>
          {activity.items.length ? (
            activity.items.map(trade => <TradeActivityRow key={trade.id} trade={trade} onPress={onTradePress} />)
          ) : (
            <View style={[a.p_20, a.gap_12]}>
              <PantaText style={[a.text_15, a.font_semibold]}>No recent activity</PantaText>
              <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
                Recent trades will appear here when recorded by Panta.
              </PantaText>
            </View>
          )}
        </DetailSurface>
      )}
      {activity?.disclaimer && <PantaText style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>{activity.disclaimer}</PantaText>}
      {activity && activity.items.length === limit && (
        <PantaText style={[a.text_11, t.atoms.text_secondary]}>Showing up to {limit} recorded trades.</PantaText>
      )}
      {activity && activity.items.length === limit && limit < 200 && (
        <PantaButton label="Show more activity" onPress={() => setLimit(value => Math.min(200, value + 50))} />
      )}
      {state.status === 'loading' && activity && <CatalogLoading label="Updating activity" />}
    </View>
  );
}
