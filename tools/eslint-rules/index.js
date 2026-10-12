'use strict';

/**
 * Local ESLint plugin for repo-specific rules. eslint.config.mjs imports it and
 * registers it as `rainbow-local`.
 */
module.exports = {
  rules: {
    'use-root-alias': require('./use-root-alias'),
  },
};
