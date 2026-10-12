import { isString } from 'lodash';

export type Direction = 'down' | 'left' | 'right' | 'up';

export default (directionValue: Direction | { direction: Direction } = 'right') => {
  const direction = isString(directionValue) ? directionValue : directionValue.direction;

  if (direction === 'down') return '90';
  if (direction === 'left') return '180';
  if (direction === 'up') return '270';
  return '0';
};
