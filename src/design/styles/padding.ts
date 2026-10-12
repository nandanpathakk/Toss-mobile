import { memoFn } from '@/lib/memo-fn';

import buildLayoutStyles, { type LayoutValue } from './build-layout-styles';

export default function padding(...options: LayoutValue[]) {
  return buildLayoutStyles(options, 'padding', true);
}

padding.object = memoFn((...options: LayoutValue[]) => {
  return buildLayoutStyles.object(options, 'padding');
});
