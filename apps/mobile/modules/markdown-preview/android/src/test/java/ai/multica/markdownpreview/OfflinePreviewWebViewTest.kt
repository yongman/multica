package ai.multica.markdownpreview

import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [32], manifest = Config.NONE)
class OfflinePreviewWebViewTest {
  private val context get() = RuntimeEnvironment.getApplication()
  private val height = """{"__multicaMobilePreview":1,"type":"height","height":120}"""
  private val origin = Uri.parse(PREVIEW_ORIGIN)

  private class RecordingBridge(private val available: Boolean = true) : PreviewBridge {
    var receive: ((String?, Uri, Boolean) -> Unit)? = null
    var removed = false
    override fun supported() = available
    override fun install(view: WebView, receive: (String?, Uri, Boolean) -> Unit) { this.receive = receive }
    override fun remove(view: WebView) { removed = true }
  }

  @Test fun mountingReloadingAndDestroyingPreserveAnotherWebViewsCookieAndCache() {
    val other = WebView(context)
    val cookies = CookieManager.getInstance()
    cookies.setCookie("https://portal.example", "session=keep-me; Path=/")
    val preview = OfflinePreviewWebView(context, RecordingBridge())
    preview.loadDocument("<p>inline</p>")
    preview.setFullscreen(true)
    preview.loadDocument("<p>fullscreen</p>")
    assertEquals("session=keep-me", cookies.getCookie("https://portal.example"))
    assertFalse(shadowOf(preview).wasClearCacheCalled())
    assertFalse(shadowOf(other).wasClearCacheCalled())
    preview.disposePreview()
    assertEquals("session=keep-me", cookies.getCookie("https://portal.example"))
    assertFalse(shadowOf(preview).wasClearCacheCalled())
    other.destroy()
  }

  @Test fun blocksNetworkAndFileResourcesWithoutChangingGlobalCookiePolicy() {
    val cookies = CookieManager.getInstance()
    cookies.setAcceptCookie(true)
    val preview = OfflinePreviewWebView(context, RecordingBridge())
    val settings = preview.settings
    assertTrue(settings.blockNetworkLoads)
    assertTrue(settings.blockNetworkImage)
    assertFalse(settings.allowFileAccess)
    assertFalse(settings.allowContentAccess)
    assertFalse(settings.domStorageEnabled)
    assertFalse(cookies.acceptThirdPartyCookies(preview))
    assertTrue(cookies.acceptCookie())
    assertEquals(WebSettings.LOAD_NO_CACHE, settings.cacheMode)
    for (url in listOf("https://tracking.example/read", "file:///private/token", "content://contacts")) {
      val request = request(url)
      assertEquals(403, preview.webViewClient.shouldInterceptRequest(preview, request)!!.statusCode)
      assertTrue(preview.webViewClient.shouldOverrideUrlLoading(preview, request))
    }
    preview.disposePreview()
  }

  @Test fun onlyTrustedMainFrameDisplayMessagesReachTheEventCallback() {
    val bridge = RecordingBridge()
    val preview = OfflinePreviewWebView(context, bridge)
    val delivered = mutableListOf<String>()
    preview.onMessage = { delivered.add(it) }
    bridge.receive!!(height, origin, false)
    bridge.receive!!(height, Uri.parse("https://evil.example"), true)
    bridge.receive!!(height, Uri.parse("https://markdown-preview.multica.invalid.evil.example"), true)
    bridge.receive!!(height, Uri.parse("$PREVIEW_ORIGIN:444"), true)
    bridge.receive!!("x".repeat(2049), origin, true)
    bridge.receive!!("""{"__multicaMobilePreview":1,"type":"open","url":"file:///token"}""", origin, true)
    assertTrue(delivered.isEmpty())
    bridge.receive!!(height, origin, true)
    assertEquals(listOf(height), delivered)
    preview.disposePreview()
    bridge.receive!!(height, origin, true)
    assertEquals(1, delivered.size)
    assertTrue(bridge.removed)
  }

  @Test fun messageGateBoundsUtf8BytesAndRateBeforeDispatch() {
    val gate = PreviewMessageGate()
    assertFalse(gate.accept("汉".repeat(800), origin, true, 0))
    assertFalse(gate.accept(null, origin, true, 0))
    repeat(10) { assertTrue(gate.accept(height, origin, true, 100)) }
    assertFalse(gate.accept(height, origin, true, 999))
    assertTrue(gate.accept(height, origin, true, 1100))
    val malformedGate = PreviewMessageGate()
    repeat(10) { assertFalse(malformedGate.accept("{", origin, true, 0)) }
    assertFalse(malformedGate.accept(height, origin, true, 999))
    assertTrue(malformedGate.accept(height, origin, true, 1000))
  }

  @Test fun unsupportedWebViewsUseSourceFallbackWithoutAnyLegacyJavascriptInterface() {
    val bridge = RecordingBridge(false)
    val preview = OfflinePreviewWebView(context, bridge)
    val failures = mutableListOf<String>()
    preview.onFailure = { failures.add(it) }
    preview.loadDocument("<script>while(true){}</script>")
    assertEquals(listOf("unsupported"), failures)
    assertFalse(preview.settings.javaScriptEnabled)
    assertNull(bridge.receive)
    assertNull(shadowOf(preview).getJavascriptInterface(PREVIEW_BRIDGE))
    assertNull(shadowOf(preview).getJavascriptInterface("ReactNativeWebView"))
    assertNull(shadowOf(preview).lastLoadedUrl)
    preview.disposePreview()
  }

  @Test fun stableDocumentsDoNotReloadAndDisposalIsIdempotent() {
    val preview = OfflinePreviewWebView(context, RecordingBridge())
    preview.loadDocument("<p>same</p>")
    val initial = shadowOf(preview).lastLoadDataWithBaseURL
    assertEquals("$PREVIEW_ORIGIN/", initial.baseUrl)
    preview.loadDocument("<p>same</p>")
    assertSame(initial, shadowOf(preview).lastLoadDataWithBaseURL)
    preview.disposePreview()
    preview.disposePreview()
  }

  private fun request(url: String) = object : WebResourceRequest {
    override fun getUrl() = Uri.parse(url)
    override fun isForMainFrame() = false
    override fun isRedirect() = false
    override fun hasGesture() = false
    override fun getMethod() = "GET"
    override fun getRequestHeaders() = emptyMap<String, String>()
  }
}
