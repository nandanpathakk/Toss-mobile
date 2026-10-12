import { AppRegistry } from 'react-native';

import { PantaRoot } from './panta-root';

// Internal native registration stays stable across visual rebrands and wallet integrations.
AppRegistry.registerComponent('Rainbow', () => PantaRoot);
