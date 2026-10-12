import { StyleSheet, type StyleProp } from 'react-native';

/** `StyleSheet.flatten` with a narrower return type and `{}` instead of `undefined`. */
export function flatten<T>(style?: StyleProp<T>): T extends (infer U)[] ? U : T {
  return (StyleSheet.flatten(style as unknown as Parameters<typeof StyleSheet.flatten>[0]) ?? {}) as T extends (infer U)[] ? U : T;
}
