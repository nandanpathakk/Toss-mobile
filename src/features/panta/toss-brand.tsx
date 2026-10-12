import React from 'react';
import { View } from 'react-native';

import Svg, { Path } from 'react-native-svg';

import { atoms as a } from '@/design/atoms';
import { tossBrand } from '@/design/tokens';

import { PantaText } from './panta-ui';

export function TossMark({ size = 32, color = tossBrand.ivory }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessible={false} importantForAccessibility="no">
      <Path
        fill={color}
        d="M27 18H82Q87 18 85 23L79 38Q78 41 74 41H19Q14 41 16 36L22 22Q23 18 27 18ZM40 49H65L53 80Q51 85 46 85H32Q27 85 29 80Z"
      />
    </Svg>
  );
}

/** The letters tuck under the T’s overhang, forming one accessible wordmark. */
export function TossBrand() {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Toss" style={[a.flex_row, a.align_center, a.gap_0]}>
      <TossMark />
      <PantaText
        maxFontSizeMultiplier={1.4}
        style={[a.text_30, a.font_heavy, { color: tossBrand.ivory, letterSpacing: -1.6, marginLeft: -7 }]}
      >
        oss
      </PantaText>
    </View>
  );
}
