// Large-screen / adaptive-device manifest setup for Loot Hollow.
//
// WHY THIS EXISTS
// ---------------
// Apps targeting Android 16 (API 36) have their orientation, resizability and
// aspect-ratio restrictions IGNORED on any display whose smallest width is
// >= 600dp - i.e. every tablet and unfolded foldable. android:screenOrientation,
// android:resizableActivity, min/maxAspectRatio and setRequestedOrientation()
// all stop applying there.
//
// Loot Hollow targets API 36 and asks for "portrait" in app.json, so on a
// tablet that request is currently ignored and the game is handed a landscape
// window its CSS was never built for.
//
// Apps that declare android:appCategory="game" are exempt from that change, so
// declaring it (which is also just correct metadata - this IS a game) puts the
// orientation decision back in our hands. The alternative escape hatch,
// PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY, is explicitly temporary and
// stops working at API 37, so we do not rely on it.
//
// Also set here:
//   android:resizeableActivity="true"  - split-screen, ChromeOS, desktop windows
//   uses-feature touchscreen required="false" - makes the app eligible on
//   Chromebooks and other non-touch Play devices (default is required="true",
//   which silently excludes them).
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withGameCategory(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults && cfg.modResults.manifest;
    if (!manifest) return cfg;

    // --- <application> attributes ---
    const app =
      Array.isArray(manifest.application) && manifest.application.length
        ? manifest.application[0]
        : null;
    if (app) {
      app.$ = app.$ || {};
      app.$['android:appCategory'] = 'game';
      app.$['android:resizeableActivity'] = 'true';
    }

    // --- <uses-feature> touchscreen not required ---
    const NAME = 'android.hardware.touchscreen';
    const feats = Array.isArray(manifest['uses-feature'])
      ? manifest['uses-feature']
      : [];
    const existing = feats.filter(
      (f) => f && f.$ && f.$['android:name'] === NAME
    );
    if (existing.length) {
      existing.forEach((f) => {
        f.$['android:required'] = 'false';
      });
    } else {
      feats.push({
        $: { 'android:name': NAME, 'android:required': 'false' },
      });
    }
    manifest['uses-feature'] = feats;

    return cfg;
  });
};
