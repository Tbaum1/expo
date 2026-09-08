import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet, View, StatusBar, Text, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { GAME_HTML } from './gameHtml';

// --- Ads + IAP SDKs. Loaded defensively so a web/dev context without the native
// modules (or a build where they failed to link) never crashes the app. ---
let AdMob = null, Purchases = null;
try { AdMob = require('react-native-google-mobile-ads'); } catch (e) { AdMob = null; }
try { Purchases = require('react-native-purchases').default; } catch (e) { Purchases = null; }

const AGE_KEY = 'lh_age_ok_v1';

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
      const products = await Purchases.getProducts(PRODUCT_IDS);
      const p = (products || []).find((x) => x.identifier === productId);
      if (!p) { fail(); return; }
      await Purchases.purchaseStoreProduct(p);
      ok();
    } catch (e) {
      // user cancel or store error -> treat as a non-grant
      fail();
    }
  }, [inject]);

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
      }
    } catch (e) { /* ignore malformed messages */ }
  }, [showRewarded, buyProduct]);

  useEffect(() => {
    (async () => {
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
  const nativeFlags =
    "window.LH_NATIVE=true;" +
    (Purchases && RC_ANDROID_KEY.indexOf('PLACEHOLDER') === -1 ? "window.LH_PAY=true;" : "") +
    (AdMob && AdMob.RewardedAd ? "window.LH_ADS=true;" : "");

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#150a26" />
      <WebView
        ref={webRef}
        style={styles.web}
        source={{ html: GAME_HTML, baseUrl: 'https://loothollow.local/' }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        onMessage={onWebMessage}
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
