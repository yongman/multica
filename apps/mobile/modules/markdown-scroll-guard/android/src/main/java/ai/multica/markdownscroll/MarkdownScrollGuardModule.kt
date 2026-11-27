package ai.multica.markdownscroll

import android.content.Context
import android.view.MotionEvent
import android.widget.HorizontalScrollView
import com.swmansion.enriched.markdown.views.HorizontalScrollGesture
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView

class MarkdownScrollGuardModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MarkdownScrollGuard")
    View(MarkdownScrollGuardView::class) {}
  }
}

// Yoga still measures and lays out the RN ScrollView and its complete code
// content. This host only arbitrates touch events, synchronously on the UI thread.
class MarkdownScrollGuardView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val gesture = HorizontalScrollGesture(this) { getChildAt(0) as? HorizontalScrollView }

  init {
    isNestedScrollingEnabled = true
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean =
    gesture.dispatch(event) { super.dispatchTouchEvent(it) }
}
