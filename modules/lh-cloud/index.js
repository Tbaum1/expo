// JS handle for the native cloud-save module (Google Play Games saved games).
// null on iOS / Expo Go / any build where the native module is missing, so callers must check it.
import { requireOptionalNativeModule } from 'expo-modules-core';

export default requireOptionalNativeModule('LhCloud');

// Native "open the Play Store app's redeem screen" helper (null when the native module is missing).
export const LhRedeem = requireOptionalNativeModule('LhRedeem');
