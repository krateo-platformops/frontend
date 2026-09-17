/**
 * Grow the Autopilot composer with its content, then let it scroll — frontend#182.
 *
 * The composer is a plain `<textarea rows={1}>`, which pins it at one line forever. A second line
 * therefore pushed the first out of sight with no way back to it; the report was "the first line
 * disappears, and it is not possible to scroll back up to read it, nor is it possible to see more
 * than a single line at once."
 *
 * CSS `field-sizing: content` on `.apTextarea` is the real fix and needs no JavaScript. This hook
 * covers the browsers that do not support it yet (everything outside Chromium, as of writing), so
 * the behaviour does not depend on which browser the portal happens to be open in.
 *
 * Lives in its own module rather than inside AutopilotRail because that file is already over the
 * 500-line lint cap; adding to it makes an existing violation worse.
 */
import { useEffect, type RefObject } from 'react'

/** Growth cap in px. MUST match `.apTextarea { max-height }` in AutopilotRail.module.css — past it
 * the textarea scrolls instead of growing, so a long draft never crowds out the transcript. */
export const MAX_COMPOSER_HEIGHT = 120

/**
 * Size `ref` to its content on every `value` change, capped at {@link MAX_COMPOSER_HEIGHT}.
 *
 * Height is reset to `auto` BEFORE measuring so the box shrinks as well as grows — `scrollHeight` of
 * an already-tall element never reports smaller, so without the reset, deleting text leaves the
 * composer stuck at its high-water mark.
 */
export const useComposerAutoGrow = (ref: RefObject<HTMLTextAreaElement | null>, value: string) => {
  useEffect(() => {
    const el = ref.current
    if (!el) { return }
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`
  }, [ref, value])
}
