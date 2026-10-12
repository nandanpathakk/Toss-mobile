import { Platform } from 'react-native';

/**
 * `ios` and `android` return the value on the matching platform and `undefined`
 * elsewhere, so they can sit directly in a style array: `[a.flex_1, ios({paddingTop: 2})]`.
 */

export const isIOS = Platform.OS === 'ios';
