import { StyleSheet } from 'react-native';

import { css } from '@/design/styled';

import position from './position';

type FlexAlign = 'baseline' | 'center' | 'end' | 'start' | 'stretch';

export type FlexProps = {
  align?: FlexAlign;
  self?: FlexAlign;
  flex?: number | string;
  direction?: 'column' | 'column-reverse' | 'row' | 'row-reverse';
  grow?: number | string;
  shrink?: number | string;
  wrap?: boolean;
  justify?: 'center' | 'end' | 'space-around' | 'space-between' | 'space-evenly' | 'start';
  centered?: boolean;
  cover?: boolean;
};

const getFlexStylesFromShorthand = (style: string) => (style === 'end' || style === 'start' ? `flex-${style}` : style);

const flexCss = css<FlexProps>`
  /* Align Items */
  align-items: ${({ align = 'stretch' }) => getFlexStylesFromShorthand(align)};

  /* Align Self */
  ${({ self }) => (self ? `align-self: ${getFlexStylesFromShorthand(self)};` : '')}

  /* Flex */
  ${({ flex }) => (flex !== undefined ? `flex: ${flex};` : '')}

  /* Flex Direction */
  flex-direction: ${({ direction = 'row' }) => direction};

  /* Flex Grow */
  ${({ grow }) => (grow !== undefined ? `flex-grow: ${grow};` : '')}

  /* Flex Shrink */
  ${({ shrink }) => (shrink !== undefined ? `flex-shrink: ${shrink};` : '')}

  /* Flex Wrap */
  flex-wrap: ${({ wrap }) => (wrap ? 'wrap' : 'nowrap')};

  /* Justify Content */
  justify-content: ${({ justify = 'start' }) => getFlexStylesFromShorthand(justify)};

  /* Shorthand Shortcuts 💇‍♂️️ */
  ${({ centered }) => (centered ? position.centered : '')}
  ${({ cover }) => (cover ? position.cover : '')}
`;

const flexObject = ({
  align = 'stretch',
  self,
  flex,
  direction = 'row',
  justify = 'start',
  wrap,
  grow,
  shrink,
  centered,
  cover,
}: FlexProps) => {
  const props: Record<string, unknown> = {
    alignItems: getFlexStylesFromShorthand(align),
    flexDirection: direction,
    flexWrap: wrap ? 'wrap' : 'nowrap',
    justifyContent: getFlexStylesFromShorthand(justify),
  };

  if (self) {
    props.alignSelf = getFlexStylesFromShorthand(self);
  }

  if (typeof flex !== 'undefined') {
    props.flex = Number(flex);
  }

  if (typeof grow !== 'undefined') {
    props.flexGrow = Number(grow);
  }

  if (typeof shrink !== 'undefined') {
    props.flexShrink = Number(shrink);
  }

  if (centered) {
    props.alignItems = 'center';
    props.justifyContent = 'center';
  }

  if (cover) {
    Object.assign(props, StyleSheet.absoluteFillObject);
  }

  return props;
};

const buildFlexStyles = Object.assign(flexCss, { object: flexObject });

export default buildFlexStyles;
