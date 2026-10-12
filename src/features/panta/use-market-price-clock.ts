import { useEffect, useState } from 'react';

import { catalogFilters } from './catalog-store';

/** Wake at price expiry or a detail's event end, without ticking the list every second. */
export function useMarketPriceClock(observedAt?: number | null, endTime?: number | null) {
  const foreground = catalogFilters(state => state.foreground);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (foreground) setNow(Date.now());
  }, [foreground, observedAt, endTime]);
  useEffect(() => {
    if (!foreground) return;
    const current = Date.now();
    const deadlines = [
      observedAt != null && observedAt <= current ? observedAt + 30000 : null,
      endTime != null ? endTime * 1000 : null,
    ].filter((deadline): deadline is number => deadline !== null && Number.isFinite(deadline) && deadline > current);
    if (!deadlines.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(Math.min(...deadlines) - current + 1, 2147483647));
    return () => clearTimeout(timer);
  }, [foreground, observedAt, endTime, now]);
  return Math.max(now, Date.now());
}
