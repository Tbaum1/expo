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
// Where the 'Redeem code' menu item sends the player. Google Play owns the
// redemption flow; we only open it.
const PLAY_REDEEM_URL = 'https://play.google.com/redeem';

// RevenueCat public SDK key (Android). Public/publishable by design - it ships in
// the client binary. Project "Loot Hollow", app "Loot Hollow (Play Store)".
const RC_ANDROID_KEY = 'goog_HruBjSADPBeuocKnIurdWmMibrR';

// AdMob rewarded ad unit - real unit "Free Spins Rewarded" on publisher
// pub-4697898246674003. Set LH_USE_TEST_ADS=true to fall back to Google's test
// ad while developing, so you never click a live ad on your own account.
const LH_USE_TEST_ADS = false;
const REWARDED_UNIT_ID =
  LH_USE_TEST_ADS && AdMob && AdMob.TestIds
    ? AdMob.TestIds.REWARDED
    : 'ca-app-pub-4697898246674003/5116879667';

// Product IDs — must match Play Console + RevenueCat exactly (see MONETIZATION-PLAN.md).
const PRODUCT_IDS = [
  'spins_small', 'spins_medium', 'spins_large', 'spins_mega',
  'gems_small', 'gems_medium', 'gems_large', 'gems_mega',
  'bank_break',
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
async function initSdks() {
  if (_sdkInit) return;
  _sdkInit = true;
  try {
    if (AdMob && AdMob.default && typeof AdMob.default === 'function') {
      await AdMob.default().initialize();
    }
  } catch (e) { /* ads best-effort */ }
  try {
    if (Purchases && RC_ANDROID_KEY.indexOf('PLACEHOLDER') === -1) {
      Purchases.configure({ apiKey: RC_ANDROID_KEY });
    }
  } catch (e) { /* iap best-effort */ }
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
    if (!Purchases || PRODUCT_IDS.indexOf(productId) === -1) { fail(); return; }
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
          'This item could not be loaded from Google Play (' + productId + '). Please try again later.'
        );
        return;
      }
      await Purchases.purchaseStoreProduct(p);
      ok();
    } catch (e) {
      fail();
      // A player backing out of the Play sheet is not an error - the game's own
      // 'Purchase canceled' popup covers it. Anything else used to be swallowed
      // silently, which is why this bug was invisible; surface the store's
      // code so a tester report says what actually went wrong.
      if (!(e && e.userCancelled)) {
        Alert.alert(
          'Purchase failed',
          'Google Play could not complete this purchase' +
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
  const grantOwnedEntitlements = useCallback(async () => {
    if (!Purchases) return;
    try {
      // Pull anything the store knows about but RevenueCat has not seen yet.
      try { await Purchases.syncPurchases(); } catch (e) { /* offline is fine */ }
      const info = await Purchases.getCustomerInfo();
      const txs = (info && info.nonSubscriptionTransactions) || [];
      if (!txs.length) return;
      const granted = await loadGrantedTx();
      const seen = {};
      granted.forEach((k) => { seen[k] = true; });
      let changed = false;
      for (let i = 0; i < txs.length; i++) {
        const pid = txProductId(txs[i]);
        const id = txId(txs[i]);
        if (!pid || !id) continue;
        if (PRODUCT_IDS.indexOf(pid) === -1) continue;
        if (seen[id]) continue;
        seen[id] = true;
        granted.push(id);
        changed = true;
        // The game defines LH_onPurchase in its main script, which may not have
        // run yet on a cold start - retry for up to 10s rather than dropping it.
        inject(
          '(function(){var n=0;function go(){' +
          'if(window.LH_onPurchase){window.LH_onPurchase(' +
          "'" + pid + "'" + ',true);return;}' +
          'if(++n<40)setTimeout(go,250);}go();})()'
        );
      }
      if (changed) await saveGrantedTx(granted);
    } catch (e) { /* best-effort - never block the game on this */ }
  }, [inject]);

  // Google Play owns code redemption; we just open its flow.
  const openRedeem = useCallback(() => {
    try { Linking.openURL(PLAY_REDEEM_URL).catch(() => {}); } catch (e) {}
  }, []);

  // Re-check owned purchases each time the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') grantOwnedEntitlements();
    });
    return () => { try { sub && sub.remove(); } catch (e) {} };
  }, [grantOwnedEntitlements]);

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
      }
    } catch (e) { /* ignore malformed messages */ }
  }, [showRewarded, buyProduct, openRedeem]);

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
    (Purchases && RC_ANDROID_KEY.indexOf('PLACEHOLDER') === -1 ? "window.LH_PAY=true;" : "") +
    (AdMob && AdMob.RewardedAd ? "window.LH_ADS=true;" : "") +
    (Platform.OS === 'android' ? "window.LH_REDEEM=true;" : "");

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#150a26" />
      <WebView
        ref={webRef}
        style={styles.web}
        source={{ html: LH_IS_TABLET ? GAME_HTML_TABLET : GAME_HTML, baseUrl: 'https://loothollow.local/' }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        onMessage={onWebMessage}
        onLoadEnd={grantOwnedEntitlements}
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
