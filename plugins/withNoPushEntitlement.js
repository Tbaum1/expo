// Loot Hollow uses LOCAL notifications only (daily reward reminders).
// expo-notifications adds the iOS `aps-environment` (Push Notifications) entitlement,
// which forces the provisioning profile to include the Push Notifications capability.
// We don't send remote push, so we strip that entitlement — local notifications
// keep working, and the App Store build no longer needs a push-capable profile.
const { withEntitlementsPlist } = require('@expo/config-plugins');

module.exports = function withNoPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    if (cfg.modResults && 'aps-environment' in cfg.modResults) {
      delete cfg.modResults['aps-environment'];
    }
    return cfg;
  });
};
