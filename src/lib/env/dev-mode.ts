/** Build-time development flag; never reads app credentials or environment files. */
export const IS_DEV = typeof __DEV__ === 'boolean' && __DEV__;
