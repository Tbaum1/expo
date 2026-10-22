package expo.modules.lhcloud

import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Opens the Play Store APP's redeem-code screen. Pinning the Play Store package forces the app instead of a browser.
// Returns false if the Play Store can't handle it, so the caller falls back to the web page.
class LhRedeemModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LhRedeem")

    AsyncFunction("open") {
      val ctx = appContext.reactContext
      if (ctx == null) {
        false
      } else {
        try {
          val i = Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/redeem"))
          i.setPackage("com.android.vending")
          i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          ctx.startActivity(i)
          true
        } catch (e: Exception) {
          false
        }
      }
    }
  }
}
