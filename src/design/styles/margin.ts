import { memoFn } from '@/lib/memo-fn';

import buildLayoutStyles, { type LayoutValue } from './build-layout-styles';

export default function margin(...options: LayoutValue[]) {
  return buildLayoutStyles(options, 'margin', true);
}

margin.object = memoFn((...options: LayoutValue[]) => {
  return buildLayoutStyles.object(options, 'margin');
});
