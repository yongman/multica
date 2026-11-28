package ai.multica.markdownpreview

import android.content.Context
import android.view.ViewGroup.LayoutParams
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class MarkdownPreviewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MarkdownPreview")
    View(MarkdownPreviewView::class) {
      Events("onMessage", "onFailure")
      Prop("document") { view: MarkdownPreviewView, document: String -> view.document = document }
      Prop("fullscreen") { view: MarkdownPreviewView, fullscreen: Boolean -> view.webView.setFullscreen(fullscreen) }
      OnViewDidUpdateProps { view: MarkdownPreviewView -> view.document?.let(view.webView::loadDocument) }
      OnViewDestroys { view: MarkdownPreviewView -> view.disposePreview() }
    }
  }
}

class MarkdownPreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private val onMessage by EventDispatcher()
  private val onFailure by EventDispatcher()
  internal val webView = OfflinePreviewWebView(context)
  var document: String? = null

  init {
    webView.onMessage = { data -> onMessage(mapOf("data" to data)) }
    webView.onFailure = { reason -> onFailure(mapOf("reason" to reason)) }
    addView(webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun disposePreview() {
    removeView(webView)
    webView.disposePreview()
  }
}
