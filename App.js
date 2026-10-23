import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet, View, StatusBar, Text, TouchableOpacity,
  ActivityIndicator, Platform, Linking, AppState, Dimensions, Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as ScreenOrientation from 'expo-screen-orientation';
import appJson from './app.json';
import LhCloud, { LhRedeem } from './modules/lh-cloud';
import { GAME_HTML } from './gameHtml';
import { GAME_HTML_TABLET } from './gameHtmlTablet';

// Tablet/large-screen detection. Same threshold Android itself uses for the
// sw600dp resource qualifier, so this lines up with how the OS already
// classifies "tablet" for this device. Computed once from the screen's
// shortest side (not the current window, which changes with rotation) so a
// phone rotated to landscape never gets misclassified as a tablet.
const { width: LH_SCR_W, height: LH_SCR_H } = Dimensions.get('screen');
const LH_IS_TABLET = Math.min(LH_SCR_W, LH_SCR_H) >= 600;

// Single source of truth for the version the game shows: app.json, the same
// file EAS/Codemagic reads when it builds. Bump app.json and the label follows.
const LH_VERSION_LABEL =
  String(appJson?.expo?.version || '') +
  ' (' + String(appJson?.expo?.android?.versionCode || '') + ')';

// app.json's native orientation lock had to become "default" (unlocked) so a
// tablet can be forced into landscape here - a single manifest-level setting
// can't be "portrait for phone, landscape for tablet" on its own. This is the
// ONLY place orientation gets locked now, and it runs before anything else on
// mount so phones still land in portrait exactly like before (same lock, just
// requested from JS instead of the manifest) and tablets land in landscape.
async function lockOrientationForDevice() {
  try {
    await ScreenOrientation.lockAsync(
      LH_IS_TABLET
        ? ScreenOrientation.OrientationLock.LANDSCAPE
        : ScreenOrientation.OrientationLock.PORTRAIT_UP
    );
  } catch (e) { /* best-effort - worst case the device rotates freely */ }
}

// --- Ads + IAP SDKs. Loaded defensively so a web/dev context without the native
// modules (or a build where they failed to link) never crashes the app. ---
let AdMob = null, Purchases = null;
try { AdMob = require('react-native-google-mobile-ads'); } catch (e) { AdMob = null; }
try { Purchases = require('react-native-purchases').default; } catch (e) { Purchases = null; }

const AGE_KEY = 'lh_age_ok_v1';
// Transaction ids we have already handed to the game. Prevents a relaunch from
// granting the same pre-registration reward / promo code twice.
const GRANTED_TX_KEY = 'lh_granted_tx_v1';
// TESTING ONLY. While true, a grant check that finds nothing to hand the game
// pops an Alert listing what Google Play / RevenueCat actually returned, so a
// promo code that "redeems but does nothing" can be diagnosed from one launch.
// SET TO false BEFORE THE PUBLIC PRODUCTION RELEASE.
const PROMO_DIAG = true;
// When the player last opened the Play redeem screen (ms). Persisted so the
// diagnostics can say how long after a redeem the item showed up, and so
// foreground checks keep looking for a day afterwards (Play can be slow).
const REDEEM_AT_KEY = 'lh_redeem_at_v1';
const REDEEM_WATCH_MS = 24 * 60 * 60 * 1000;
// First launch time of this install. A pre-registration reward arrives on a
// brand-new install, so the first day after install gets the same patient
// (long) checking as a redeem does.
const FIRST_RUN_KEY = 'lh_first_run_v1';
async function getFirstRun() {
  try {
    let v = parseInt(await AsyncStorage.getItem(FIRST_RUN_KEY), 10) || 0;
    if (!v) { v = Date.now(); await AsyncStorage.setItem(FIRST_RUN_KEY, String(v)); }
    return v;
  } catch (e) { return 0; }
}
async function getRedeemAt() { try { return parseInt(await AsyncStorage.getItem(REDEEM_AT_KEY), 10) || 0; } catch (e) { return 0; } }
async function setRedeemAt(t) { try { await AsyncStorage.setItem(REDEEM_AT_KEY, String(t)); } catch (e) {} }
function fmtSince(ms) { if (!ms) return 'n/a'; const m = Math.round((Date.now() - ms) / 60000); return m < 90 ? m + ' min' : (m / 60).toFixed(1) + ' h'; }
// Where the 'Redeem code' menu item sends the player. Google Play owns the
// redemption flow; we only open it.
const PLAY_REDEEM_URL = 'https://play.google.com/redeem';

// RevenueCat public SDK key (Android). Public/publishable by design - it ships in
// the client binary. Project "Loot Hollow", app "Loot Hollow (Play Store)".
const RC_ANDROID_KEY = 'goog_HruBjSADPBeuocKnIurdWmMibrR';
// RevenueCat public SDK key (iOS, app "Loot Hollow (App Store)"). Starts with appl_.
// While it still contains PLACEHOLDER, iOS runs with purchases OFF (the Codemagic
// iOS workflow refuses to build with the placeholder, so it can never ship).
const RC_IOS_KEY = 'appl_PLACEHOLDER';
const RC_KEY = Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY;
const STORE_NAME = Platform.OS === 'ios' ? 'the App Store' : 'Google Play';

// AdMob rewarded ad unit - real unit "Free Spins Rewarded" on publisher
// pub-4697898246674003. Set LH_USE_TEST_ADS=true to fall back to Google's test
// ad while developing, so you never click a live ad on your own account.
const LH_USE_TEST_ADS = false;
// iOS rewarded unit (AdMob app "Loot Hollow (iOS)"). Empty = Google test ad on iOS.
const IOS_REWARDED_UNIT = 'ca-app-pub-4697898246674003/1553924623';
const ANDROID_REWARDED_UNIT = 'ca-app-pub-4697898246674003/5116879667';
const REWARDED_UNIT_ID =
  (LH_USE_TEST_ADS || (Platform.OS === 'ios' && !IOS_REWARDED_UNIT)) && AdMob && AdMob.TestIds
    ? AdMob.TestIds.REWARDED
    : (Platform.OS === 'ios' ? IOS_REWARDED_UNIT : ANDROID_REWARDED_UNIT);

// Product IDs — must match Play Console + RevenueCat exactly (see MONETIZATION-PLAN.md).
const PRODUCT_IDS = [
  'spins_small', 'spins_medium', 'spins_large', 'spins_mega',
  'gems_small', 'gems_medium', 'gems_large', 'gems_mega',
  'bank_break',
  'realm_skip',
];

// Show a banner if a scheduled notification fires while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Local daily reminder — no push server / APNs certificate needed.
async function scheduleDailyReminder() {
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return;
    // Keep the daily reminder but do not clobber the one-off spinsFull notif.
    await Notifications.cancelScheduledNotificationAsync('dailyReminder').catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: 'dailyReminder',
      content: {
        title: 'Loot Hollow',
        body: 'Your free spins are ready! Come collect your coins and gems. 🪙',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 19,
        minute: 0,
      },
    });
  } catch (e) { /* notifications are best-effort */ }
}

// Schedule a one-off "your spins are full" nudge. The game reports minutes-to-full
// when the app is backgrounded; we (re)schedule a single local notification.
async function scheduleSpinsFull(mins) {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status !== 'granted') return;
    await Notifications.cancelScheduledNotificationAsync('spinsFull').catch(() => {});
    if (!mins || mins < 1) return;
    await Notifications.scheduleNotificationAsync({
      identifier: 'spinsFull',
      content: { title: 'Loot Hollow', body: 'Your spins are full — time to play! 🎰' },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(60, Math.round(mins * 60)),
      },
    });
  } catch (e) { /* best-effort */ }
}

// One-time SDK init. Safe to call when the modules are missing (web/dev).
let _sdkInit = false;
let _rcConfigured = false;
// Idempotent and synchronous. RevenueCat used to be configured only AFTER the
// slow AdMob init finished, so on a cold start the WebView's onLoadEnd could
// run grantOwnedEntitlements() first: getCustomerInfo() threw 'not configured',
// the catch swallowed it, and a redeemed promo code was never handed to the
// game. Every caller that needs Purchases now calls this first.
function configurePurchases() {
  if (_rcConfigured) return true;
  try {
    if (Purchases && RC_KEY.indexOf('PLACEHOLDER') === -1) {
      Purchases.configure({ apiKey: RC_KEY });
      _rcConfigured = true;
    }
  } catch (e) { /* iap best-effort */ }
  return _rcConfigured;
}

// Build 54 experiment: Play only seems to surface a redeemed promo item to a NEW
// billing connection. Configuring RevenueCat again replaces the SDK instance (and
// its billing client) without killing the app; the anonymous user id is kept.
function reconfigurePurchases() {
  try {
    if (Purchases && _rcConfigured && RC_KEY.indexOf('PLACEHOLDER') === -1) {
      Purchases.configure({ apiKey: RC_KEY });
      return true;
    }
  } catch (e) { /* best-effort */ }
  return false;
}

async function initSdks() {
  if (_sdkInit) return;
  _sdkInit = true;
  configurePurchases();
  try {
    if (AdMob && AdMob.default && typeof AdMob.default === 'function') {
      await AdMob.default().initialize();
    }
  } catch (e) { /* ads best-effort */ }
}

// --- Owned-entitlement grant ------------------------------------------------
//
// Some purchases never pass through buyProduct(): a Google Play
// pre-registration reward, a redeemed Play promo code, a purchase that
// completed while the app was being killed, or a reinstall. All of them land
// on the account as an owned transaction that the app has to find for itself.
//
// Play states that a pre-registration reward MUST be delivered, so this is not
// optional polish - a silent miss here is an app-removal risk.
//
// Dedupe is by TRANSACTION id, not product id: the same product can be bought
// or granted more than once and each occurrence is owed to the player.
//
// NOTE ON THE ONE TRADE-OFF HERE: RevenueCat keeps non-subscription
// transactions forever, including consumables the app already consumed. We do
// NOT seed a 'baseline' of pre-existing transactions on first run, because a
// pre-registration player's FIRST run is exactly when their reward arrives -
// baselining would swallow the one grant we are required to deliver. The cost
// is that a player who already owned consumables before this build shipped can
// be re-granted them once. With production not yet launched that population is
// the closed-test group only, so the compliance risk is the one worth avoiding.
async function loadGrantedTx() {
  try {
    const raw = await AsyncStorage.getItem(GRANTED_TX_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

async function saveGrantedTx(list) {
  try {
    const trimmed = list.slice(-200);
    await AsyncStorage.setItem(GRANTED_TX_KEY, JSON.stringify(trimmed));
  } catch (e) { /* best-effort */ }
}

// RevenueCat has renamed these fields across major versions; accept any shape
// rather than assuming one.
function txProductId(t) {
  return (t && (t.productIdentifier || t.productId || t.product_id)) || null;
}
function txId(t) {
  if (!t) return null;
  return (
    t.transactionIdentifier ||
    t.storeTransactionId ||
    t.revenueCatId ||
    t.transactionId ||
    t.id ||
    null
  );
}

export default function App() {
  // loading | gate | blocked | game
  const [screen, setScreen] = useState('loading');
  const webRef = useRef(null);
  // Bumping this remounts the WebView (a clean reload). The page can't use location.reload(): its source is an HTML string with a fake baseUrl, so a reload tries to fetch that host and shows ERR_NAME_NOT_RESOLVED.
  const [wvKey, setWvKey] = useState(0);
  // True while a store purchase sheet is open. The app returning to the foreground
  // when the sheet closes must not run the owned-purchase sweep until buyProduct
  // has recorded its own transaction, or the same purchase is granted twice.
  const buyingRef = useRef(false);
  // True while a grantOwnedEntitlements() sweep is running, so a foreground
  // event during a retry cannot start a second sweep and double-grant.
  const grantingRef = useRef(false);
  const pendingLongRef = useRef(false);
  const redeemUntilRef = useRef(0);
  const redeemNoteRef = useRef(0);   // time of the Redeem tap, until the reminder note has been shown
  const lastGrantRef = useRef(0);
  const reconfRef = useRef('no');
  const silentRef = useRef(false);
  const grantFnRef = useRef(null);

  // Push a snippet of JS into the game (used for native->web callbacks).
  const inject = useCallback((js) => {
    try { webRef.current && webRef.current.injectJavaScript(js + ';true;'); } catch (e) {}
  }, []);

  // Show a rewarded ad; on earned reward tell the game to grant spins.
  const showRewarded = useCallback(() => {
    if (!AdMob || !AdMob.RewardedAd) {
      inject('window.LH_onAdReward && window.LH_onAdReward(0)');
      return;
    }
    try {
      const { RewardedAd, RewardedAdEventType, AdEventType } = AdMob;
      const ad = RewardedAd.createForAdRequest(REWARDED_UNIT_ID, {
        requestNonPersonalizedAdsOnly: true,
      });
      let earned = false;
      const unsubLoaded = ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        try { ad.show(); } catch (e) {
          inject('window.LH_onAdReward && window.LH_onAdReward(0)');
        }
      });
      const unsubEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      });
      const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
        inject('window.LH_onAdReward && window.LH_onAdReward(' + (earned ? 1 : 0) + ')');
        unsubLoaded(); unsubEarned(); unsubClosed();
      });
      const unsubErr = ad.addAdEventListener(AdEventType.ERROR, () => {
        inject('window.LH_onAdReward && window.LH_onAdReward(0)');
        try { unsubLoaded(); unsubEarned(); unsubClosed(); unsubErr(); } catch (e) {}
      });
      ad.load();
    } catch (e) {
      inject('window.LH_onAdReward && window.LH_onAdReward(0)');
    }
  }, [inject]);

  // Run a purchase for a product id via RevenueCat; report ok/fail back to the game.
  const buyProduct = useCallback(async (productId) => {
    const fail = () => inject("window.LH_onPurchase && window.LH_onPurchase('" + productId + "',false)");
    const ok = () => inject("window.LH_onPurchase && window.LH_onPurchase('" + productId + "',true)");
    if (!Purchases || !configurePurchases() || PRODUCT_IDS.indexOf(productId) === -1) { fail(); return; }
    try {
      // NON_SUBSCRIPTION is required. getProducts() defaults to SUBSCRIPTION,
      // and every Loot Hollow product is a one-time consumable, so without it
      // Play returns an empty list, no product is found, and fail() fires
      // before the Google Play purchase sheet ever opens - for every player,
      // tester or not.
      const products = await Purchases.getProducts(
        PRODUCT_IDS,
        Purchases.PRODUCT_CATEGORY.NON_SUBSCRIPTION
      );
      const p = (products || []).find((x) => x.identifier === productId);
      if (!p) {
        fail();
        Alert.alert(
          'Store unavailable',
          'This item could not be loaded from ' + STORE_NAME + ' (' + productId + '). Please try again later.'
        );
        return;
      }
      buyingRef.current = true;
      const res = await Purchases.purchaseStoreProduct(p);
      // This purchase is delivered right here, so record its transaction as
      // granted. Otherwise grantOwnedEntitlements() finds it in the customer's
      // transaction list on the next foreground and grants it a second time.
      try {
        const granted = await loadGrantedTx();
        const seen = {};
        granted.forEach((k) => { seen[k] = true; });
        const list = (res && res.customerInfo && res.customerInfo.nonSubscriptionTransactions) || [];
        let best = null;
        for (let i = 0; i < list.length; i++) {
          if (txProductId(list[i]) !== productId) continue;
          const id = txId(list[i]);
          if (!id || seen[id]) continue;
          if (!best || String(list[i].purchaseDate || '') >= String(best.purchaseDate || '')) best = list[i];
        }
        const recId = (best && txId(best)) || txId(res && res.transaction);
        if (recId && !seen[recId]) { granted.push(recId); await saveGrantedTx(granted); }
      } catch (e2) { /* best-effort */ }
      buyingRef.current = false;
      ok();
    } catch (e) {
      buyingRef.current = false;
      // Google says the player already owns this item (code 6) - typically a
      // promo-code redemption that RevenueCat has not picked up yet. Do not
      // call that a failed purchase: re-check what is owned (long mode) so the
      // item is delivered and RevenueCat records/consumes it.
      if (e && !e.userCancelled && String(e.code) === '6' && grantFnRef.current) {
        grantFnRef.current(true);
        return;
      }
      fail();
      // A player backing out of the Play sheet is not an error - the game's own
      // 'Purchase canceled' popup covers it. Anything else used to be swallowed
      // silently, which is why this bug was invisible; surface the store's
      // code so a tester report says what actually went wrong.
      if (!(e && e.userCancelled)) {
        Alert.alert(
          'Purchase failed',
          STORE_NAME.charAt(0).toUpperCase() + STORE_NAME.slice(1) + ' could not complete this purchase' +
            (e && e.code ? ' (code ' + e.code + ')' : '') +
            '. You have not been charged.'
        );
      }
    }
  }, [inject]);

  // Hand the game any owned purchase it has not been told about yet.
  // Runs when the WebView finishes loading and again whenever the app returns
  // to the foreground - a player can redeem a promo code in the Play Store
  // while we are backgrounded, so coming back is exactly when to re-check.
  // One pass. Returns 'granted' (handed >=1 purchase to the game), 'empty'
  // (RevenueCat answered but there was nothing new) or 'error' (not ready /
  // offline - worth retrying).
  const sweepOwned = useCallback(async (mode, d) => {
    d = d || {};
    const errText = (e) => String((e && (e.message || e.code || e.userInfo && e.userInfo.readableErrorCode)) || e).slice(0, 140);
    try {
      // Pull anything the store knows about but RevenueCat has not seen yet.
      // 'restore' re-queries every purchase the store still reports as owned
      // (a promo-code item is exactly that: owned, never consumed), which is
      // the stronger of the two calls.
      try {
        if (mode === 'restore' && Purchases.restorePurchases) {
          const ci = await Purchases.restorePurchases();
          d.restoreTx = ((ci && ci.nonSubscriptionTransactions) || []).length;
        } else {
          await Purchases.syncPurchases();
        }
      } catch (e) { d.syncErr = errText(e); }
      try { if (Purchases.invalidateCustomerInfoCache) await Purchases.invalidateCustomerInfoCache(); } catch (e) {}
      try { d.uid = String(await Purchases.getAppUserID()); } catch (e) {}
      const info = await Purchases.getCustomerInfo();
      const txs = (info && info.nonSubscriptionTransactions) || [];
      d.txCount = txs.length;
      d.txProducts = txs.map(txProductId).join(',');
      if (!txs.length) return 'empty';
      const granted = await loadGrantedTx();
      const seen = {};
      granted.forEach((k) => { seen[k] = true; });
      let changed = false;
      let already = 0;
      for (let i = 0; i < txs.length; i++) {
        const pid = txProductId(txs[i]);
        const id = txId(txs[i]);
        if (!pid || !id) continue;
        if (PRODUCT_IDS.indexOf(pid) === -1) continue;
        if (seen[id]) { already++; continue; }
        seen[id] = true;
        granted.push(id);
        changed = true;
        // The game defines LH_onPurchase in its main script, which may not have
        // run yet on a cold start - retry for up to 10s rather than dropping it.
        inject(
          '(function(){var n=0;function go(){' +
          'if(window.LH_onPurchase){window.LH_onPurchase(' +
          "'" + pid + "'" + ',true,true);return;}' +
          'if(++n<40)setTimeout(go,250);}go();})()'
        );
      }
      d.alreadyGranted = already;
      if (changed) { await saveGrantedTx(granted); return 'granted'; }
      return 'empty';
    } catch (e) { d.infoErr = errText(e); return 'error'; }
  }, [inject]);

  // grantOwnedEntitlements(true) = long mode (about a minute of retries), used
  // after a promo redeem / an 'already owned' answer. Any other argument (e.g.
  // the WebView onLoadEnd event) = the normal short check.
  const grantOwnedEntitlements = useCallback(async (longMode) => {
    const long = longMode === true;
    if (!Purchases || buyingRef.current) return;
    if (grantingRef.current) { if (long) pendingLongRef.current = true; return; }
    if (!configurePurchases()) return;
    grantingRef.current = true;
    const log = [];
    let done = false;
    try {
      // A freshly redeemed promo code can take a few seconds to show up in the
      // store's purchase list, and the first call after a cold start can fail
      // while the network/billing client comes up, so try a few times. The
      // first pass uses syncPurchases, later passes restorePurchases.
      const waits = long ? [0, 3000, 5000, 7000, 10000, 15000, 20000] : [0, 4000, 12000];
      const modes = waits.map((w, i) => (i === 0 ? 'sync' : 'restore'));
      for (let i = 0; i < waits.length; i++) {
        if (waits[i]) await new Promise((r) => setTimeout(r, waits[i]));
        if (buyingRef.current) { done = true; return; }
        const d = { n: i + 1, mode: modes[i] };
        const res = await sweepOwned(modes[i], d);
        d.res = res;
        log.push(d);
        if (res === 'granted') {
          done = true;
          lastGrantRef.current = Date.now();
          if (PROMO_DIAG && !silentRef.current) {
            try {
              const at = await getRedeemAt();
              Alert.alert('Purchase check (test build)', 'Item received.\nSince redeem tap: ' + fmtSince(at) +
                '\nReconnect: ' + reconfRef.current + '\nPass ' + d.n + ' (' + d.mode + ') tx=' + d.txCount + (d.txProducts ? ' [' + d.txProducts + ']' : '') +
                '\nid: ' + (d.uid || '?'));
            } catch (e) {}
          }
          return;
        }
      }
    } catch (e) { /* best-effort - never block the game on this */ }
    finally {
      grantingRef.current = false;
      if (pendingLongRef.current && !done) {
        pendingLongRef.current = false;
        setTimeout(() => { grantFnRef.current && grantFnRef.current(true); }, 300);
        return;
      }
      pendingLongRef.current = false;
      if (PROMO_DIAG && !done && log.length) {
        try {
          const last = log[log.length - 1];
          const lines = log.map((d) =>
            d.n + ') ' + d.mode + ': ' + d.res +
            ' tx=' + (d.txCount === undefined ? '?' : d.txCount) +
            (d.txProducts ? ' [' + d.txProducts + ']' : '') +
            (d.restoreTx !== undefined ? ' restored=' + d.restoreTx : '') +
            (d.alreadyGranted ? ' already=' + d.alreadyGranted : '') +
            (d.syncErr ? ' syncErr=' + d.syncErr : '') +
            (d.infoErr ? ' infoErr=' + d.infoErr : '')
          );
          Alert.alert(
            'Purchase check (test build)',
            'Nothing new to grant.\nReconnect: ' + reconfRef.current + '\n' + lines.join('\n') + '\nid: ' + (last.uid || '?')
          );
        } catch (e) { /* diagnostics must never break the game */ }
      }
    }
  }, [sweepOwned]);
  grantFnRef.current = grantOwnedEntitlements;

  // Google Play owns code redemption; we just open its flow.
  const openRedeem = useCallback(() => {
    // Try the Play Store app's own redeem screen first (market://redeem); if
    // nothing handles it, fall back to the web redeem page.
    redeemUntilRef.current = Date.now() + 5 * 60 * 1000;
    redeemNoteRef.current = Date.now();
    setRedeemAt(Date.now());
    const web = () => { try { Linking.openURL(PLAY_REDEEM_URL).catch(() => {}); } catch (e) {} };
    // 1) native: open the Play Store app's redeem screen directly (package pinned to the Play Store);
    // 2) if that's unavailable, market://redeem; 3) last resort, the web page.
    const viaMarket = () => {
      try { Linking.openURL('market://redeem').catch(web); } catch (e) { web(); }
    };
    if (LhRedeem && LhRedeem.open) {
      try {
        LhRedeem.open().then((ok) => { if (!ok) viaMarket(); }).catch(viaMarket);
      } catch (e) { viaMarket(); }
    } else {
      viaMarket();
    }
  }, []);

  // Re-check owned purchases each time the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        // Back from the Play redeem screen: Play only hands the item over on a fresh app start.
        const tapped = redeemNoteRef.current;
        if (tapped && Date.now() - tapped > 2500) {
          redeemNoteRef.current = 0;
          setTimeout(() => {
            if (lastGrantRef.current > tapped) return;
            try {
              Alert.alert('Almost there!', 'If you redeemed a code, close the game completely and reopen it to receive your item.');
            } catch (e) {}
          }, 1200);
        }
        Promise.all([getRedeemAt(), getFirstRun()]).then(([at, first]) => {
          const now = Date.now();
          // Within 30 min of a Redeem tap: open a fresh billing connection first.
          reconfRef.current = 'no';
          if (at > 0 && now - at < 30 * 60 * 1000 && !buyingRef.current && !grantingRef.current) {
            reconfRef.current = reconfigurePurchases() ? 'yes' : 'failed';
          }
          grantOwnedEntitlements(
            now < redeemUntilRef.current ||
            (at > 0 && now - at < REDEEM_WATCH_MS) ||
            (first > 0 && now - first < REDEEM_WATCH_MS)
          );
        });
      }
    });
    return () => { try { sub && sub.remove(); } catch (e) {} };
  }, [grantOwnedEntitlements]);


  // ---- Cloud save (Google Play Games saved games, Android only) ----
  // The game owns the rules (which save has more progress wins); native only reads/writes the one snapshot.
  const cloudReply = useCallback((o) => {
    inject('window.__lhCloud&&window.__lhCloud(' + JSON.stringify(o) + ')');
  }, [inject]);

  const cloudPull = useCallback(async () => {
    if (!LhCloud) return;
    try {
      const r = await LhCloud.load();
      if (!r || r.signed === false) cloudReply({ k: 'error', signed: false });
      else cloudReply({ k: 'found', data: r.data || null });
    } catch (e) {
      cloudReply({ k: 'error' });
    }
  }, [cloudReply]);

  const cloudPush = useCallback(async (data) => {
    if (!LhCloud) return;
    try {
      await LhCloud.save(data);
      cloudReply({ k: 'saved' });
    } catch (e) {
      cloudReply({ k: 'error' });
    }
  }, [cloudReply]);

  const cloudSignIn = useCallback(async () => {
    if (!LhCloud) return;
    try {
      const ok = await LhCloud.signIn();
      if (ok) cloudPull();
    } catch (e) { /* the game shows its own message */ }
  }, [cloudPull]);

  // Messages posted by the game (window.ReactNativeWebView.postMessage).
  const onWebMessage = useCallback((event) => {
    try {
      const d = JSON.parse(event.nativeEvent.data);
      if (!d || !d.t) return;
      if (d.t === 'notif' && typeof d.spinsFullMin === 'number') {
        scheduleSpinsFull(d.spinsFullMin);
      } else if (d.t === 'ad') {
        showRewarded();
      } else if (d.t === 'buy' && typeof d.productId === 'string') {
        buyProduct(d.productId);
      } else if (d.t === 'redeem') {
        openRedeem();
      } else if (d.t === 'restore') {
        grantFnRef.current && grantFnRef.current(true);
      } else if (d.t === 'cloud_pull') {
        cloudPull();
      } else if (d.t === 'cloud_push' && typeof d.data === 'string') {
        cloudPush(d.data);
      } else if (d.t === 'cloud_signin') {
        cloudSignIn();
      } else if (d.t === 'reload') {
        setWvKey((k) => k + 1);
      }
    } catch (e) { /* ignore malformed messages */ }
  }, [showRewarded, buyProduct, openRedeem, cloudPull, cloudPush, cloudSignIn]);

  useEffect(() => {
    (async () => {
      lockOrientationForDevice();
      initSdks();
      // Apple requires an age gate for simulated-gambling apps. Android keeps
      // its existing 13+ rating flow, so we only gate on iOS.
      if (Platform.OS !== 'ios') {
        setScreen('game');
        scheduleDailyReminder();
        return;
      }
      try {
        const ok = await AsyncStorage.getItem(AGE_KEY);
        if (ok === '1') {
          setScreen('game');
          scheduleDailyReminder();
        } else {
          setScreen('gate');
        }
      } catch (e) {
        setScreen('gate');
      }
    })();
  }, []);

  const confirmAge = useCallback(async () => {
    try { await AsyncStorage.setItem(AGE_KEY, '1'); } catch (e) {}
    setScreen('game');
    scheduleDailyReminder();
  }, []);

  if (screen === 'loading') {
    return (
      <View style={styles.center}>
        <StatusBar barStyle="light-content" backgroundColor="#150a26" />
        <ActivityIndicator color="#f5c542" size="large" />
      </View>
    );
  }

  if (screen === 'gate') {
    return (
      <View style={styles.center}>
        <StatusBar barStyle="light-content" backgroundColor="#150a26" />
        <Text style={styles.title}>Before you play</Text>
        <Text style={styles.body}>
          Loot Hollow features simulated gambling — slot-machine style play using
          virtual coins only. There is no real-money wagering and no real prizes.
          {'\n\n'}You must be 18 or older to play.
        </Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={confirmAge} activeOpacity={0.85}>
          <Text style={styles.btnPrimaryText}>I am 18 or older</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnSecondary} onPress={() => setScreen('blocked')} activeOpacity={0.85}>
          <Text style={styles.btnSecondaryText}>I am under 18</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (screen === 'blocked') {
    return (
      <View style={styles.center}>
        <StatusBar barStyle="light-content" backgroundColor="#150a26" />
        <Text style={styles.title}>Sorry!</Text>
        <Text style={styles.body}>
          You must be 18 or older to play Loot Hollow. Come back when you're old enough!
        </Text>
      </View>
    );
  }

  // Tell the game the native money bridge is present so it routes buys/ads to us
  // (web build lacks this and keeps its demo fallback).
  // Version label comes straight out of app.json so the in-game "v1.0.3 (38)"
  // can never drift from what the store is actually serving. The game keeps a
  // baked fallback for the web build and exposes lhSetVersion() because this
  // script is injected after the page has already parsed.
  const nativeFlags =
    "window.LH_NATIVE=true;" +
    "window.LH_APP_VERSION='" + LH_VERSION_LABEL + "';" +
    "if(window.lhSetVersion)window.lhSetVersion(window.LH_APP_VERSION);" +
    (Purchases && RC_KEY.indexOf('PLACEHOLDER') === -1 ? "window.LH_PAY=true;" : "") +
    (AdMob && AdMob.RewardedAd ? "window.LH_ADS=true;" : "") +
    (Platform.OS === 'android' ? "window.LH_REDEEM=true;" : "") +
    (Platform.OS === 'android' && PROMO_DIAG ? "window.LH_DIAG=true;" : "") +
    (Platform.OS === 'android' && LhCloud ? "window.LH_CLOUD=true;if(window.lhCloudInit)window.lhCloudInit();" : "");

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#150a26" />
      <WebView
        key={wvKey}
        ref={webRef}
        style={styles.web}
        source={{ html: LH_IS_TABLET ? GAME_HTML_TABLET : GAME_HTML, baseUrl: 'https://loothollow.local/' }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        onMessage={onWebMessage}
        onLoadEnd={() => { getFirstRun().then((first) => grantOwnedEntitlements(first > 0 && Date.now() - first < REDEEM_WATCH_MS)); }}
        scrollEnabled={false}
        overScrollMode="never"
        bounces={false}
        containerStyle={styles.web}
        androidLayerType="hardware"
        injectedJavaScript={`(function(){try{document.documentElement.style.setProperty('--sbtop',(${StatusBar.currentHeight || 0})+'px');}catch(e){}try{${nativeFlags}${Platform.OS === 'ios' ? "window.LH_BOOT_VILLAGE=true;" : ''}}catch(e){}})();true;`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#150a26' },
  web: { flex: 1, backgroundColor: '#150a26' },
  center: {
    flex: 1,
    backgroundColor: '#150a26',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    color: '#f5c542',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 18,
    textAlign: 'center',
  },
  body: {
    color: '#e8e0f5',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 32,
  },
  btnPrimary: {
    backgroundColor: '#f5c542',
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 14,
    marginBottom: 16,
    minWidth: 240,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#150a26', fontSize: 18, fontWeight: '800' },
  btnSecondary: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  btnSecondaryText: {
    color: '#9a8fb5',
    fontSize: 15,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
