package expo.modules.lhcloud

import android.app.Activity
import android.content.pm.PackageManager
import com.google.android.gms.games.PlayGames
import com.google.android.gms.games.PlayGamesSdk
import com.google.android.gms.games.SnapshotsClient
import com.google.android.gms.games.snapshot.SnapshotMetadataChange
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Cloud save for Loot Hollow: one Play Games snapshot ("lh_main") holding the game's whole save string.
// Every call resolves (never throws into JS); problems come back as signed=false / a rejected promise the app catches.
class LhCloudModule : Module() {
  private val saveName = "lh_main"
  private var sdkReady = false

  // The Play Games project id is injected into the manifest by plugins/withPlayGames.js.
  // Until it is set we report "not signed in" instead of calling into the SDK.
  private fun configured(): Boolean {
    return try {
      val ctx = appContext.reactContext ?: return false
      val ai = ctx.packageManager.getApplicationInfo(ctx.packageName, PackageManager.GET_META_DATA)
      ai.metaData?.containsKey("com.google.android.gms.games.APP_ID") == true
    } catch (e: Throwable) {
      false
    }
  }

  private fun ensureSdk() {
    if (sdkReady) return
    val ctx = appContext.reactContext ?: return
    PlayGamesSdk.initialize(ctx)
    sdkReady = true
  }

  private fun activity(): Activity? = appContext.currentActivity

  override fun definition() = ModuleDefinition {
    Name("LhCloud")

    AsyncFunction("isConfigured") { promise: Promise ->
      promise.resolve(configured())
    }

    AsyncFunction("signIn") { promise: Promise ->
      val act = activity()
      if (act == null || !configured()) {
        promise.resolve(false)
      } else {
        try {
          ensureSdk()
          PlayGames.getGamesSignInClient(act).signIn().addOnCompleteListener { t ->
            promise.resolve(t.isSuccessful && t.result?.isAuthenticated == true)
          }
        } catch (e: Throwable) {
          promise.reject("E_SIGNIN", e.message, e)
        }
      }
    }

    // -> { signed: Boolean, data: String? }
    AsyncFunction("load") { promise: Promise ->
      val act = activity()
      if (act == null || !configured()) {
        promise.resolve(mapOf("signed" to false, "data" to null))
      } else {
        try {
          ensureSdk()
          PlayGames.getGamesSignInClient(act).isAuthenticated().addOnCompleteListener { t ->
            if (!t.isSuccessful || t.result?.isAuthenticated != true) {
              promise.resolve(mapOf("signed" to false, "data" to null))
            } else {
              val client = PlayGames.getSnapshotsClient(act)
              client.open(saveName, true, SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED)
                .addOnSuccessListener { r ->
                  try {
                    if (r.isConflict) {
                      promise.reject("E_CONFLICT", "snapshot conflict", null)
                    } else {
                      val snap = r.data
                      val bytes = snap?.snapshotContents?.readFully()
                      val text = if (bytes != null && bytes.isNotEmpty()) String(bytes, Charsets.UTF_8) else null
                      if (snap != null) client.discardAndClose(snap)
                      promise.resolve(mapOf("signed" to true, "data" to text))
                    }
                  } catch (e: Throwable) {
                    promise.reject("E_LOAD", e.message, e)
                  }
                }
                .addOnFailureListener { e -> promise.reject("E_OPEN", e.message, e) }
            }
          }
        } catch (e: Throwable) {
          promise.reject("E_LOAD", e.message, e)
        }
      }
    }

    // data = the JSON payload string from the game. Resolves true when committed (or queued offline by Play Games).
    AsyncFunction("save") { data: String, promise: Promise ->
      val act = activity()
      if (act == null || !configured()) {
        promise.reject("E_NOT_READY", "cloud save not configured", null)
      } else {
        try {
          ensureSdk()
          val client = PlayGames.getSnapshotsClient(act)
          client.open(saveName, true, SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED)
            .addOnSuccessListener { r ->
              try {
                if (r.isConflict) {
                  promise.reject("E_CONFLICT", "snapshot conflict", null)
                } else {
                  val snap = r.data
                  if (snap == null) {
                    promise.reject("E_SAVE", "no snapshot", null)
                  } else {
                    snap.snapshotContents.writeBytes(data.toByteArray(Charsets.UTF_8))
                    val change = SnapshotMetadataChange.Builder()
                      .setDescription("Loot Hollow progress")
                      .build()
                    client.commitAndClose(snap, change)
                      .addOnSuccessListener { promise.resolve(true) }
                      .addOnFailureListener { e -> promise.reject("E_COMMIT", e.message, e) }
                  }
                }
              } catch (e: Throwable) {
                promise.reject("E_SAVE", e.message, e)
              }
            }
            .addOnFailureListener { e -> promise.reject("E_OPEN", e.message, e) }
        } catch (e: Throwable) {
          promise.reject("E_SAVE", e.message, e)
        }
      }
    }
  }
}
