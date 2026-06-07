import React from 'react';
import { StyleSheet, View, StatusBar } from 'react-native';
import { WebView } from 'react-native-webview';
import { GAME_HTML } from './gameHtml';

export default function App() {
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#150a26" />
      <WebView
        style={styles.web}
        // baseUrl gives the page a real origin so the game's localStorage saving works
        source={{ html: GAME_HTML, baseUrl: 'https://luckylair.local/' }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled            // Android: enables localStorage
        allowFileAccess
        scrollEnabled={false}
        overScrollMode="never"
        bounces={false}
        // keep the dark game background while it loads
        containerStyle={styles.web}
        androidLayerType="hardware"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#150a26',
    // SDK 52 lays content out below the status bar already; no manual pad needed
    // (avoids a redundant gap above the header).
  },
  web: { flex: 1, backgroundColor: '#150a26' },
});
