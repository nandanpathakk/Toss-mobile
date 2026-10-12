const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  resolver: {
    resolveRequest(context, name, platform) {
      // Pin noble's browser implementation; its legacy browser mapping points outside exports.
      if (
        name === '@noble/hashes/crypto' ||
        name === '@noble/hashes/crypto.js' ||
        name === `${__dirname}/node_modules/@noble/hashes/crypto.js` ||
        (name === './crypto.js' && context.originModulePath.startsWith(`${__dirname}/node_modules/@noble/hashes/`))
      ) {
        return { type: 'sourceFile', filePath: `${__dirname}/node_modules/@noble/hashes/crypto.js` };
      }
      if (name === 'isows') return context.resolveRequest({ ...context, unstable_enablePackageExports: false }, name, platform);
      if (name === 'jose') return context.resolveRequest({ ...context, unstable_conditionNames: ['browser'] }, name, platform);
      return context.resolveRequest(context, name, platform);
    },
    blockList: [/.*\/android\/build\/.*/, /.*\/android\/\.cxx\/.*/],
  },
  transformer: {
    allowOptionalDependencies: true,
    getTransformOptions: async () => ({ transform: { experimentalImportSupport: true, inlineRequires: true } }),
  },
});
