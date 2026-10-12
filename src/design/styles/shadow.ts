import { isNumber } from 'lodash';

import { type LayoutValue } from './build-layout-styles';
import colors from './palette';

const addUnitToNumberValues = (value: LayoutValue) => (isNumber(value) ? `${value}px` : value);

const color: string = colors.black;
const opacity = 0.4;

const shadow = {
  color,
  opacity,
  build: (x: LayoutValue = 0, y: LayoutValue = 0, radius = 0, shadowColor: string = color, shadowOpacity: number = opacity) => `
  shadow-color: ${shadowColor};
  shadow-offset: ${addUnitToNumberValues(x)} ${addUnitToNumberValues(y)};
  shadow-opacity: ${shadowOpacity};
  shadow-radius: ${addUnitToNumberValues(radius / 2)};
`,
  buildAsObject: (x: number, y: number, radius: number, shadowColor: string = color, shadowOpacity: number = opacity) => ({
    shadowColor,
    shadowOffset: {
      height: y,
      width: x,
    },
    shadowOpacity,
    shadowRadius: radius,
  }),
};

export default shadow;
