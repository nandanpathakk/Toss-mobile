module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['module:@react-native/babel-preset'],
    plugins: [
      [
        'module-resolver',
        { alias: { '@': './src' }, extensions: ['.ios.ts', '.ios.tsx', '.android.ts', '.android.tsx', '.js', '.ts', '.tsx', '.json'] },
      ],
      'react-native-reanimated/plugin',
    ],
  };
};
