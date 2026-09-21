/**
 * Driving a dnd-kit gesture under jsdom.
 *
 * WHY THIS EXISTS AT ALL. The canvas used the browser's native drag, which `fireEvent.dragStart` /
 * `fireEvent.drop` reproduce exactly, because those ARE the events the implementation listened to.
 * dnd-kit listens to pointer events and decides what you are over by GEOMETRY, and jsdom supplies
 * neither: `setPointerCapture` is undefined and every `getBoundingClientRect` returns 0x0, so a
 * gesture driven naively hits nothing and every test would pass by dropping on nothing.
 *
 * So this supplies the two missing pieces and nothing else. It does not stub dnd-kit, and it does
 * not fake the outcome: the real sensors, the real collision detection and the real `onDragEnd`
 * run. What is faked is the layout the browser would have measured.
 *
 * THE LAYOUT IS DELIBERATELY CRUDE — every droppable gets a 40px band stacked in DOM order. That is
 * enough for `pointerWithin` to resolve exactly one target and it keeps the fixture readable; it is
 * NOT enough to prove anything about real hit areas, and a test about target SIZE has to be written
 * against the rendered CSS instead.
 */
import { act, fireEvent } from '@testing-library/react'

const BAND = 40

/** jsdom has no pointer capture; dnd-kit calls it on the activated element. */
const installPointerCapture = (): void => {
  const proto = Element.prototype as unknown as Record<string, unknown>
  const noop = (): void => undefined
  proto.setPointerCapture ??= noop
  proto.releasePointerCapture ??= noop
  proto.hasPointerCapture ??= (): boolean => false
}

/**
 * Give every element dnd-kit measures a real band, stacked in document order.
 *
 * Returns a restore function. Applied per test rather than globally: a stub this crude leaking into
 * an unrelated suite would make its layout assertions quietly meaningless.
 */
export const stubLayout = (): (() => void) => {
  installPointerCapture()
  // Captured to be PUT BACK, never called through this reference — which is the case the
  // unbound-method rule exists to catch and the one thing a restore function must do.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: void): DOMRect {
    const measured = Array.from(document.querySelectorAll('[data-testid]'))
    const index = measured.indexOf(this as unknown as Element)
    const top = index < 0 ? 0 : index * BAND
    return {
      bottom: top + BAND,
      height: BAND,
      left: 0,
      right: 200,
      toJSON: () => ({}),
      top,
      width: 200,
      x: 0,
      y: top,
    }
  }
  return () => { Element.prototype.getBoundingClientRect = original }
}

const centre = (element: Element) => {
  const box = element.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

/**
 * One complete gesture: press on `source`, move onto `target`, release.
 *
 * The first move clears the 6px activation distance the composer's PointerSensor asks for — without
 * it the sensor never starts and the drop is a click.
 */
export const dragOnto = (source: Element, target: Element): void => {
  const from = centre(source)
  const to = centre(target)
  // ONE act PER PHASE, not one around the gesture. dnd-kit measures its droppables when the drag
  // STARTS, and that measurement happens in an effect — so batching the press and the move into a
  // single act means the move is processed against a context that has not yet registered anything
  // to collide with, and the drop resolves to nothing. Every assertion would then pass for the
  // wrong reason, which is the failure mode this driver exists to avoid.
  act(() => {
    fireEvent.pointerDown(source, { clientX: from.x, clientY: from.y, isPrimary: true, pointerId: 1 })
  })
  act(() => {
    fireEvent.pointerMove(document, { clientX: from.x + 12, clientY: from.y + 12, pointerId: 1 })
  })
  act(() => {
    fireEvent.pointerMove(document, { clientX: to.x, clientY: to.y, pointerId: 1 })
  })
  act(() => {
    fireEvent.pointerUp(document, { clientX: to.x, clientY: to.y, pointerId: 1 })
  })
}
