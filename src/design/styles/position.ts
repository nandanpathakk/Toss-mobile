import { StyleSheet } from 'react-native';

import { upperFirst } from 'lodash';

import { memoFn } from '@/lib/memo-fn';

import buildLayoutStyles, { type LayoutValue } from './build-layout-styles';

type SizePrefix = '' | 'max' | 'min';

const buildSizeKey = (prefix: SizePrefix, key: string) => (prefix ? upperFirst(key) : key);

const size = (value: LayoutValue, prefix: SizePrefix = '') => `
  ${prefix}${buildSizeKey(prefix, 'height')}: ${value};
  ${prefix}${buildSizeKey(prefix, 'width')}: ${value};
`;

const sizeAsObject = memoFn((value: LayoutValue, prefix: SizePrefix = ''): Record<string, LayoutValue> => ({
  [`${prefix}${buildSizeKey(prefix, 'height')}`]: value,
  [`${prefix}${buildSizeKey(prefix, 'width')}`]: value,
}));

const position = {
  cover: `
  bottom: 0,
  left: 0;
  position: 'absolute',
  right: 0;
  top: 0;
`,
  centered: `
  alignItems: 'center',
  justifyContent: 'center',
`,
  centeredAsObject: {
    alignItems: 'center',
    justifyContent: 'center',
  } as const,
  coverAsObject: StyleSheet.absoluteFillObject,
  layout: (...args: LayoutValue[]) => buildLayoutStyles(args),
  size,
  sizeAsObject,
  maxSize: (value: LayoutValue) => size(value, 'max'),
  minSize: (value: LayoutValue) => size(value, 'min'),
  maxSizeAsObject: (value: LayoutValue) => sizeAsObject(value, 'max'),
  minSizeAsObject: (value: LayoutValue) => sizeAsObject(value, 'min'),
};

export default position;
