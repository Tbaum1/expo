// Opt out of Android 15 (API 35) edge-to-edge enforcement.
//
// When the app targets API 35, Android 15 devices (e.g. the Galaxy S25) force
// "edge-to-edge": content draws behind the status bar and the gesture/nav bar.
// For our full-screen WebView game that would push the top event buttons under
// the status bar and hide the bottom Village Shop button behind the nav pill.
//
// Setting android:windowOptOutEdgeToEdgeEnforcement="true" on the app theme
// keeps the old behavior (opaque system bars, content inset normally), so the
// current layout is preserved exactly.
//
// NOTE: this opt-out is valid for targetSdk 35 only. API 36 (required by Google
// after Aug 31, 2026) removes it -- moving to 36 will need a full Expo SDK
// upgrade plus proper safe-area inset handling.
const { withAndroidStyles } = require('expo/config-plugins');

const ATTR = 'android:windowOptOutEdgeToEdgeEnforcement';

module.exports = function withEdgeToEdgeOptOut(config) {
  return withAndroidStyles(config, (cfg) => {
    const res = cfg.modResults && cfg.modResults.resources;
    const styles = (res && res.style) || [];
    styles.forEach((style) => {
      const name = style && style.$ && style.$.name;
      // Apply to the main app theme(s) RN/Expo generate.
      if (name === 'AppTheme' || name === 'Theme.App.SplashScreen') {
        style.item = (style.item || []).filter(
          (i) => !(i && i.$ && i.$.name === ATTR)
        );
        style.item.push({ $: { name: ATTR }, _: 'true' });
      }
    });
    return cfg;
  });
};
