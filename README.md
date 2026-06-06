# Loot Hollow — Android app (test on phone + ship to Google Play)

This folder wraps the game (`../game/lucky-lair.html`) in a tiny native Android app
using **Expo + react-native-webview**. The whole game is embedded inside the app
(`gameHtml.js`), so the app works offline except for the world background images,
which currently load from the web.

There are three stages, in order: **(A) test instantly on your phone**, then
**(B) make a real installable APK**, then **(C) build the Play Store bundle and publish**.

---

## What you need

- **Node.js 18+** on your PC (`node --version`).
- A **free Expo account** — sign up at https://expo.dev (needed for the cloud builds in B/C).
- Your Android phone.
- **For Google Play only:** a **Google Play Developer account** — a one-time **$25** fee at
  https://play.google.com/console . (You don't need this for A or B.)

First-time setup (run once, in this `expo` folder):

```powershell
cd C:\Users\antho\Downloads\lucky-lair-project\lucky-lair\expo
npm install
```

If `npm install` complains about version mismatches, run `npx expo install --fix` and try again.

---

## A. Test on your phone in ~2 minutes (Expo Go)

This is the fastest loop — no build, no Play account.

1. On your Android phone, install **"Expo Go"** from the Google Play Store.
2. On your PC, in this folder, run:
   ```powershell
   npx expo start
   ```
3. Make sure the **phone and PC are on the same Wi-Fi**. Open **Expo Go** on the phone and
   **scan the QR code** shown in the terminal. The game loads inside Expo Go.
4. Edit -> re-test: whenever I change the game, run `node sync-game.mjs` (regenerates the
   embed), then reload in Expo Go (shake the phone -> Reload).

> Note: progress saves on-device (localStorage). Reinstalling/clearing the app resets it.

---

## B. Make a real installable APK (sideload, no Play account)

A standalone `.apk` you can install directly on the phone — good for testing the *actual*
app (icon, splash, fullscreen) before paying for Play.

```powershell
npm install -g eas-cli      # one time
eas login                   # use your expo.dev account
eas build -p android --profile preview
```

EAS builds in the cloud (~10-20 min) and gives you a link to download the `.apk`.
On the phone: open the link, download, and install (you'll have to allow
"Install unknown apps" for your browser the first time).

---

## C. Build the Play Store bundle (.aab) and publish

1. **Build the signed app bundle:**
   ```powershell
   eas build -p android --profile production
   ```
   Let EAS generate and manage the signing key (say yes). This produces an `.aab`.

2. **Create the app in Play Console** (https://play.google.com/console, after the $25 signup):
   create an app, then upload the `.aab` to a track (start with **Internal testing**).
   You can also automate the upload with:
   ```powershell
   eas submit -p android --latest
   ```
   (the first `eas submit` walks you through linking a Google service-account key).

3. **Fill the required listing items** before Play will let you publish:
   - App name, short + full description, **app icon** (use `assets/icon.png` or a custom one),
     a **512x512** icon, a **feature graphic (1024x500)**, and **phone screenshots**.
   - **Privacy policy URL** (required — even a simple hosted page).
   - **Content rating** questionnaire, **Data safety** form, **Target audience** and ads declaration.

4. Start on the **Internal testing** track (instant, invite yourself), confirm everything works,
   then promote to **Closed -> Open -> Production**.

### Updating the app later
Bump both numbers in `app.json` every release: `expo.version` (e.g. `1.0.1`) and
`expo.android.versionCode` (e.g. `2`), run `node sync-game.mjs`, rebuild, re-submit.

---

## Important policy notes for a slot/spin game

- **Keep it play-money.** Google Play allows *simulated gambling* / social-casino games, but
  the app must never offer **real-money** wagering or real prizes. Loot Hollow is play-money/demo,
  which is fine — just declare "simulated gambling" honestly in the **content rating** questionnaire.
- **The spin packs and the "bank" are demo only** (no real charges) — keep them that way unless you
  add real in-app purchases through Google Play Billing (which has its own setup + policy).
- **The rewarded-ad feature is a placeholder** (no real ad network). If you later wire in a real ad
  SDK (AdMob, etc.), you must update the **Data safety** form and ads declarations.
- **Backgrounds load from the web.** For a polished offline store build, the world images should be
  **bundled into the app** instead of loaded from URLs. Tell me when the art is final and I'll switch
  `WORLD_BG` to bundled local assets.

---

## Files in this folder
- `App.js` — the native shell (a fullscreen WebView rendering the game).
- `gameHtml.js` — the entire game embedded as a string (auto-generated; don't hand-edit).
- `sync-game.mjs` — regenerates `gameHtml.js` from the game HTML. Run after any game change.
- `app.json` — app name, package id (`com.luckylair.app`), version, icon, splash, orientation.
- `eas.json` — build profiles: `preview` (APK) and `production` (AAB).
- `assets/` — icon, adaptive icon, splash (placeholder gem art; replace anytime).
