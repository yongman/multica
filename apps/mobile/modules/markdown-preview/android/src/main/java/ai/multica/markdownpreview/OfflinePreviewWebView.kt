package ai.multica.markdownpreview

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.SystemClock
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream

internal interface PreviewBridge {
  fun supported(): Boolean
  fun install(view: WebView, receive: (String?, Uri, Boolean) -> Unit)
  fun remove(view: WebView)
}

private object MainFrameBridge : PreviewBridge {
  override fun supported() = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)

  override fun install(view: WebView, receive: (String?, Uri, Boolean) -> Unit) {
    WebViewCompat.addWebMessageListener(view, PREVIEW_BRIDGE, setOf(PREVIEW_ORIGIN)) { _, message, origin, main, _ ->
      if (message.type == WebMessageCompat.TYPE_STRING) receive(message.data, origin, main)
    }
  }

  override fun remove(view: WebView) = WebViewCompat.removeWebMessageListener(view, PREVIEW_BRIDGE)
}

@SuppressLint("SetJavaScriptEnabled")
internal class OfflinePreviewWebView(
  context: Context,
  private val bridge: PreviewBridge = MainFrameBridge,
) : WebView(context) {
  var onMessage: (String) -> Unit = {}
  var onFailure: (String) -> Unit = {}
  private val gate = PreviewMessageGate()
  private val bridgeSupported = bridge.supported()
  private var document: String? = null
  private var disposed = false

  init {
    settings.apply {
      // Do not use incognito or clearCache/removeAllCookies: those mutate
      // shared Android WebView state. This view never reads the network/cache.
      javaScriptEnabled = bridgeSupported
      javaScriptCanOpenWindowsAutomatically = false
      setSupportMultipleWindows(false)
      allowFileAccess = false
      allowContentAccess = false
      @Suppress("DEPRECATION")
      allowFileAccessFromFileURLs = false
      @Suppress("DEPRECATION")
      allowUniversalAccessFromFileURLs = false
      domStorageEnabled = false
      databaseEnabled = false
      setGeolocationEnabled(false)
      cacheMode = WebSettings.LOAD_NO_CACHE
      blockNetworkLoads = true
      blockNetworkImage = true
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      mediaPlaybackRequiresUserGesture = true
      displayZoomControls = false
      textZoom = 100
    }
    CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
    webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
      @Suppress("DEPRECATION")
      override fun shouldOverrideUrlLoading(view: WebView, url: String) = true
      override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url.toString()
        return if (request.url.scheme == "data" || url == "about:blank" || url == "about:srcdoc") null
        else blockedResponse()
      }
      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (request.isForMainFrame && !disposed) onFailure("failed")
      }
      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        if (!disposed) onFailure("failed")
        return true
      }
    }
    setDownloadListener { _, _, _, _, _ -> }
    if (bridgeSupported) {
      bridge.install(this) { data, origin, isMainFrame ->
        if (!disposed && gate.accept(data, origin, isMainFrame, SystemClock.elapsedRealtime())) {
          onMessage(data!!)
        }
      }
    }
    // There is deliberately no addJavascriptInterface fallback. Older
    // WebViews cannot prove the caller's frame/origin and show source instead.
  }

  fun loadDocument(html: String) {
    if (disposed || html == document) return
    document = html
    if (!bridgeSupported) {
      onFailure("unsupported")
      return
    }
    loadDataWithBaseURL("$PREVIEW_ORIGIN/", html, "text/html", "UTF-8", null)
  }

  fun setFullscreen(enabled: Boolean) {
    settings.setSupportZoom(enabled)
    settings.builtInZoomControls = enabled
    isVerticalScrollBarEnabled = enabled
    isHorizontalScrollBarEnabled = enabled
  }

  fun disposePreview() {
    if (disposed) return
    disposed = true
    onMessage = {}
    onFailure = {}
    stopLoading()
    if (bridgeSupported) bridge.remove(this)
    destroy()
  }

  companion object {
    internal fun blockedResponse() = WebResourceResponse(
      "text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)),
    )
  }
}
