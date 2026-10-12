import { type ExpoConfig } from 'expo/config';

// Public native metadata only. This file is evaluated during native builds; never load dotenv or server configuration here.
const config: ExpoConfig = {
  name: 'Toss',
  icon: './src/assets/toss/app-icon.png',
  slug: 'panta-mobile',
  scheme: 'panta-hackathon',
  ios: { bundleIdentifier: 'me.rainbow' },
  android: { package: 'dev.pantamobile.hackathon' },
};
export default config;
