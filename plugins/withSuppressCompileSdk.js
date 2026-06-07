// Expo SDK 51 ships Android Gradle Plugin 8.2.1, which officially supports
// compileSdk up to 34. We compile against SDK 35 (required to target API 35
// for Google Play). AGP 8.2.1 treats that as an unsupported-compileSdk error
// unless suppressed. This flag is exactly what AGP's own message recommends
// and lets the build proceed against SDK 35.
//
// (When we later upgrade Expo SDK for API 36, AGP will natively support the
// newer SDK and this flag can be removed.)
const { withGradleProperties } = require('expo/config-plugins');

const KEY = 'android.suppressUnsupportedCompileSdk';

module.exports = function withSuppressCompileSdk(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = (cfg.modResults || []).filter(
      (p) => !(p.type === 'property' && p.key === KEY)
    );
    cfg.modResults.push({ type: 'property', key: KEY, value: '35' });
    return cfg;
  });
};
