import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { panta, tossBrand } from '@/design/tokens';

import { PantaText } from './panta-ui';
import { TossMark } from './toss-brand';

/** A bounded brand opening. Market and account initialization continue underneath. */
export function TossLaunchScreen({ onReady, onComplete }: { onReady: () => void; onComplete: () => void }) {
  const [laidOut, setLaidOut] = useState(false);
  const turn = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!laidOut) return;
    let disposed = false;
    let animation: Animated.CompositeAnimation | undefined;
    let finished = false;
    const finish = () => {
      if (disposed || finished) return;
      finished = true;
      onComplete();
    };
    // Native accessibility lookup or an interrupted animation must never trap the user.
    const deadline = setTimeout(finish, 2600);
    const start = (reduceMotion: boolean) => {
      if (disposed || finished) return;
      if (reduceMotion) {
        turn.setValue(1);
        reveal.setValue(1);
        animation = Animated.sequence([Animated.delay(450), Animated.timing(exit, { toValue: 0, duration: 120, useNativeDriver: true })]);
      } else {
        animation = Animated.sequence([
          Animated.delay(100),
          Animated.parallel([
            Animated.timing(turn, { toValue: 1, duration: 680, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }),
            Animated.sequence([
              Animated.delay(380),
              Animated.timing(reveal, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            ]),
          ]),
          Animated.delay(220),
          Animated.timing(exit, { toValue: 0, duration: 300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]);
      }
      animation.start(({ finished: completed }) => {
        if (completed) finish();
      });
    };
    // Unknown accessibility preferences use the quieter, static treatment.
    void AccessibilityInfo.isReduceMotionEnabled().then(start, () => start(true));
    const motionListener = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => {
      if (enabled) finish();
    });
    return () => {
      disposed = true;
      clearTimeout(deadline);
      animation?.stop();
      motionListener.remove();
    };
  }, [exit, laidOut, onComplete, reveal, turn]);

  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Toss"
      accessibilityViewIsModal
      onLayout={() => {
        onReady();
        setLaidOut(true);
      }}
      style={[a.absolute, a.inset_0, a.align_center, a.justify_center, { backgroundColor: panta.background, opacity: exit }]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[a.align_center, a.justify_center, { width: 280, height: 160 }]}
      >
        <Animated.View
          style={[
            a.absolute,
            {
              left: 84,
              opacity: 1,
              transform: [
                { perspective: 900 },
                { translateX: reveal.interpolate({ inputRange: [0, 1], outputRange: [0, -66.5] }) },
                { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [0, -12] }) },
                { rotateY: turn.interpolate({ inputRange: [0, 1], outputRange: ['-72deg', '0deg'] }) },
                { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '0deg'] }) },
                { scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [1.25, 1] }) },
              ],
            },
          ]}
        >
          <TossMark size={112} color={tossBrand.ivory} />
        </Animated.View>
        <View style={[a.absolute, a.flex_row, { left: 92.5 }]}>
          {['o', 's', 's'].map((letter, index) => {
            const inputRange = [index * 0.15, 0.7 + index * 0.15];
            return (
              <Animated.View
                key={index}
                style={{
                  opacity: reveal.interpolate({ inputRange, outputRange: [0, 1], extrapolate: 'clamp' }),
                  transform: [{ translateY: reveal.interpolate({ inputRange, outputRange: [10, 0], extrapolate: 'clamp' }) }],
                }}
              >
                <PantaText
                  allowFontScaling={false}
                  style={[
                    a.font_heavy,
                    { fontSize: 76, lineHeight: 100, letterSpacing: -4, color: tossBrand.ivory, marginTop: 0, marginBottom: 0 },
                  ]}
                >
                  {letter}
                </PantaText>
              </Animated.View>
            );
          })}
        </View>
      </View>
    </Animated.View>
  );
}
