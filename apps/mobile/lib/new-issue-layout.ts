/** Keep a visible input row and the measured mode controls above the keyboard.
 * Heights come from the content inside KeyboardAvoidingView, after its padding. */
export function newIssueMentionMaxHeight(
  contentHeight: number,
  footerHeight: number,
) {
  const inputHeight = 64;
  return Math.max(0, Math.min(220, contentHeight - footerHeight - inputHeight));
}
