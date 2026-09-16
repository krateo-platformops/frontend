/**
 * The blast-radius confirm modal — its props built as pure, testable data.
 *
 * This is the ONE HITL gate every mutating write passes through (useHandleActions'
 * `ctx.confirm`, reached by runRest / runRestSet / runRestOps / runRestFanOut). It is
 * split out of the hook so the props — chiefly the raised zIndex — can be unit-tested
 * without rendering the hook, and to keep useHandleActions.ts under its line cap.
 */
import type { ModalFuncProps } from 'antd/es/modal/interface'
import { createElement } from 'react'

import BlastRadiusConfirm, { VERB_INTENT } from '../components/BlastRadius/BlastRadiusConfirm'
import { LAYER } from '../theme/layers'

import type { BlastRadius, BlastRadiusSet } from './blastRadius.types'

/**
 * The blast-radius confirm modal's z-index. It MUST sit above the Autopilot preview
 * Drawer (previewSurface.tsx). Root cause of the "confirm opens BEHIND the preview"
 * bug (item Q): in antd 6 BOTH surfaces default to `token.zIndexPopupBase`
 * (1000) — the persistent, mask-less preview Drawer and the confirm Modal wrapper get
 * the SAME z-index, so DOM source order decides stacking and the always-mounted drawer
 * (rendered by AutopilotProvider) wins, trapping the confirm beneath the `size='large'`
 * panel where the user can neither see nor click it. Raising ONLY the confirm to 1100
 * guarantees it paints above the 1000 drawer regardless of stacking context, for EVERY
 * mutating path (apply via runRest, publish/set via runRestSet, runRestOps, runRestFanOut)
 * — all of which route through the one `ctx.confirm` gate. Kept below the
 * SessionResumeModal's 2000 so nothing else is displaced.
 */
export const ABOVE_PREVIEW_DRAWER_Z_INDEX = LAYER.CONFIRM

/**
 * The blast-radius confirm's z-index, and an alias kept because this gate is not the only
 * one. The reasoning above is about the DRAWER, not about blast radius: ANY modal that can
 * open while the preview is up needs to clear it. Naming the general value separately is
 * what stops the next gate from being written at the default and inheriting this bug — as
 * the publish-destination form (publishTargetForm.tsx) did, which was raised only after a
 * tester photographed it trapped behind the drawer with its buttons unreachable.
 */
export const BLAST_RADIUS_CONFIRM_Z_INDEX = ABOVE_PREVIEW_DRAWER_Z_INDEX

/**
 * Pure builder for the blast-radius confirm modal's props (the single HITL gate).
 * Extracted so the raised zIndex — the fix that keeps the confirm above the preview
 * Drawer — is unit-testable without rendering the hook. `radius` undefined = the plain
 * "Are you sure?" read-only opt-in; a scalar/set radius renders the structured
 * BlastRadiusConfirm as the body and titles the intent. The Confirm button goes danger
 * for anything irreversible (a DELETE, or a set containing one).
 */
export const buildConfirmModalProps = (
  radius: BlastRadius | BlastRadiusSet | undefined,
  onOk: () => void,
  onCancel: () => void
): ModalFuncProps => {
  const isSet = radius !== undefined && 'ops' in radius
  const irreversible = radius !== undefined
    && (isSet ? radius.ops.some((op) => op.irreversible) : radius.verb === 'DELETE')
  let title = radius ? 'Confirm write' : 'Are you sure?'
  if (isSet) {
    title = `Confirm ${radius.count} writes`
  }

  // P18: the button names the outcome it confirms. This is the ONE gate every mutating write
  // passes through, on a platform whose premise is that blast radius is visible BEFORE you commit
  // — so a button reading "Confirm" makes the reader carry the verb in their head from the body
  // to the button. VERB_INTENT is the same map the body renders, imported rather than restated so
  // the two cannot drift: the body says "delete", the button says "Confirm delete".
  let okText = 'Confirm'
  if (isSet) {
    okText = `Confirm ${radius.count} writes`
  } else if (radius) {
    okText = `Confirm ${VERB_INTENT[radius.verb]}`
  }

  return {
    cancelText: 'Cancel',
    content: radius ? createElement(BlastRadiusConfirm, { radius }) : undefined,
    okButtonProps: irreversible ? { danger: true } : undefined,
    okText,
    onCancel,
    onOk,
    title,
    width: radius ? 560 : undefined,
    // Above the preview Drawer (1000) so the gate is never trapped behind it.
    zIndex: BLAST_RADIUS_CONFIRM_Z_INDEX,
  }
}

/** The minimum an antd modal instance must expose for the timeout to clean up after itself. */
export interface DismissableModal { destroy: () => void }

/**
 * Open a confirm dialog that DENIES if nobody answers.
 *
 * The confirm promise otherwise settles only on a click, so an unanswered dialog hung forever.
 * That is worse than it sounds: the caller holds a re-entrancy flag while a confirm is open and
 * resolves any LATER confirm false, so walking away from the screen silently turned every
 * subsequent action into a no-op with no dialog on screen to explain why.
 *
 * On timeout it denies (never confirms), destroys the dialog so the screen matches the decision,
 * and lets the caller clear its flag through the same settle path as a click.
 *
 * Extracted from the hook so it can be tested: inside the closure it needed a full render
 * harness, and "deny on silence" is a safety property that should not rest on an untested
 * setTimeout.
 */
export const confirmWithTimeout = (
  open: (onOk: () => void, onCancel: () => void) => DismissableModal,
  timeoutMs: number,
  onSettled?: () => void,
): Promise<boolean> => new Promise<boolean>((resolve) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  // `settled` rather than relying on clearTimeout alone: `open` may invoke its callback
  // SYNCHRONOUSLY (a test double does; a future modal could), in which case settle runs before
  // `timer` is even assigned, nothing is cleared, and the timer later destroys a dialog that is
  // already gone. Guarding the state rather than the timer makes the order irrelevant.
  let settled = false
  const settle = (value: boolean) => {
    if (settled) {
      return
    }
    settled = true
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    onSettled?.()
    resolve(value)
  }
  const onOk = () => { settle(true) }
  const onCancel = () => { settle(false) }
  const instance = open(onOk, onCancel)
  if (!settled) {
    timer = setTimeout(() => {
      instance.destroy()
      settle(false)
    }, timeoutMs)
  }
})
