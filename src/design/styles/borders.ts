import { upperFirst } from 'lodash';

import { css } from '@/design/styled';

import colors from './palette';
import position from './position';

type RadiusDirection = 'bottom' | 'left' | 'right' | 'top' | undefined;

const color: string = colors.lighterGrey;
const radius = 6;
const width = 1;

const border = {
  color,
  radius,
  width,
  default: css`
    border-color: ${color};
    border-width: ${width};
  `,
  buildCircle: (size: number) => `
  ${position.size(size)};
  border-radius: ${size / 2};
`,
  buildCircleAsObject: (size: number) => ({
    ...position.sizeAsObject(size),
    borderRadius: size / 2,
  }),
  buildRadius: (direction?: RadiusDirection, value: number = radius) => {
    if (direction === 'bottom' || direction === 'top') {
      return `
      border-${direction}-left-radius: ${value};
      border-${direction}-right-radius: ${value};
    `;
    }
    if (direction === 'left' || direction === 'right') {
      return `
      border-bottom-${direction}-radius: ${value};
      border-top-${direction}-radius: ${value};
    `;
    }

    return `
    border-bottom-left-radius: ${value};
    border-bottom-right-radius: ${value};
    border-top-left-radius: ${value};
    border-top-right-radius: ${value};
  `;
  },
  buildRadiusAsObject: (direction?: RadiusDirection, value: number = radius): Record<string, number> => {
    if (direction === 'bottom' || direction === 'top') {
      return {
        [`border${upperFirst(direction)}LeftRadius`]: value,
        [`border${upperFirst(direction)}RightRadius`]: value,
      };
    }
    if (direction === 'left' || direction === 'right') {
      return {
        [`borderBottom${upperFirst(direction)}Radius`]: value,
        [`borderTop${upperFirst(direction)}Radius`]: value,
      };
    }

    return {
      borderBottomLeftRadius: value,
      borderBottomRightRadius: value,
      borderTopLeftRadius: value,
      borderTopRightRadius: value,
    };
  },
};

export default border;
