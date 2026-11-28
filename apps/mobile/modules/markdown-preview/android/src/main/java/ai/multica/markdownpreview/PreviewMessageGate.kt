package ai.multica.markdownpreview

import android.net.Uri
import org.json.JSONObject

const val PREVIEW_ORIGIN = "https://markdown-preview.multica.invalid"
const val PREVIEW_BRIDGE = "MulticaPreviewBridge"

/** Admission happens before an Expo/React event is allocated or queued. */
internal class PreviewMessageGate {
  private var windowStart = -1L
  private var received = 0

  fun accept(data: String?, origin: Uri, isMainFrame: Boolean, now: Long): Boolean {
    if (!isMainFrame || origin.scheme != "https" ||
      origin.host != "markdown-preview.multica.invalid" ||
      (origin.port != -1 && origin.port != 443)) return false
    if (data == null || data.length > 2048 || data.toByteArray(Charsets.UTF_8).size > 2048) return false
    if (windowStart < 0 || now - windowStart >= 1000) {
      windowStart = now
      received = 0
    }
    if (received >= 10) return false
    // Count malformed attempts too, before JSON parsing.
    received++
    return try {
      val message = JSONObject(data)
      message.opt("__multicaMobilePreview") == 1 && when (message.opt("type")) {
        "height" -> (message.opt("height") as? Number)?.toDouble()?.isFinite() == true
        "error" -> message.opt("message") is String
        else -> false
      }
    } catch (_: Exception) {
      false
    }
  }
}
