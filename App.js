import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet, View, StatusBar, Text, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { GAME_HTML } from './gameHtml';

const AGE_KEY = 'lh_age_ok_v1';

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

export default function App() {
  // loading | gate | blocked | game
  const [screen, setScreen] = useState('loading');

  // Messages posted by the game (window.ReactNativeWebView.postMessage).
  const onWebMessage = useCallback((event) => {
    try {
      const d = JSON.parse(event.nativeEvent.data);
      if (d && d.t === 'notif' && typeof d.spinsFullMin === 'number') {
        scheduleSpinsFull(d.spinsFullMin);
      }
    } catch (e) { /* ignore malformed messages */ }
  }, []);

  useEffect(() => {
    (async () => {
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

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#150a26" />
      <WebView
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
        injectedJavaScript={`(function(){try{document.documentElement.style.setProperty('--sbtop',(${StatusBar.currentHeight || 0})+'px');}catch(e){}try{${Platform.OS === 'ios' ? "window.LH_BOOT_VILLAGE=true;" : ''}}catch(e){}})();true;`}
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
