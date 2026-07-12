/**
 * Insert "\n" at the cursor of a controlled textarea and report the new value.
 * Needed for Cmd/Ctrl+Enter, which (unlike Shift+Enter) has no native newline
 * behavior in a textarea.
 */
export function insertNewlineAtCursor(
  el: HTMLTextAreaElement,
  onChange: (value: string) => void,
) {
  const { selectionStart, selectionEnd, value } = el;
  onChange(value.slice(0, selectionStart) + "\n" + value.slice(selectionEnd));
  // Restore the caret after React re-renders the controlled value.
  requestAnimationFrame(() => {
    el.selectionStart = el.selectionEnd = selectionStart + 1;
  });
}
