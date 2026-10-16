// Adds the Google Play Games Services project id to the Android build.
//
// Set it in app.json -> expo.extra.playGamesAppId (the numeric "Project ID" shown in Play Console >
// Grow users > Play Games Services > Configuration). While it is empty this plugin does nothing and the
// cloud-save module reports "not configured", so the game runs exactly as before.
const { withAndroidManifest, withStringsXml, AndroidConfig } = require('expo/config-plugins');

const STRING_NAME = 'game_services_project_id';
const META_NAME = 'com.google.android.gms.games.APP_ID';

module.exports = function withPlayGames(config) {
  const id = String((config.extra && config.extra.playGamesAppId) || '').trim();
  if (!id) return config;

  config = withStringsXml(config, (cfg) => {
    cfg.modResults = AndroidConfig.Strings.setStringItem(
      [{ $: { name: STRING_NAME, translatable: 'false' }, _: id }],
      cfg.modResults
    );
    return cfg;
  });

  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults && cfg.modResults.manifest;
    const app =
      manifest && Array.isArray(manifest.application) && manifest.application.length
        ? manifest.application[0]
        : null;
    if (!app) return cfg;
    app['meta-data'] = app['meta-data'] || [];
    const existing = app['meta-data'].find((m) => m && m.$ && m.$['android:name'] === META_NAME);
    if (existing) {
      existing.$['android:value'] = '@string/' + STRING_NAME;
    } else {
      app['meta-data'].push({
        $: { 'android:name': META_NAME, 'android:value': '@string/' + STRING_NAME },
      });
    }
    return cfg;
  });
};
