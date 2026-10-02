/** Inline instrument-style SVGs matching the autopilot mockup's stroke set
 * (not antd icons — these carry the exact petrol line weight/shape). */

type IconProps = { className?: string; size?: number }

const stroke = (size: number, className: string | undefined, children: React.ReactNode) => (
  <svg className={className} fill='none' height={size} stroke='currentColor' strokeWidth={2} viewBox='0 0 24 24' width={size}>
    {children}
  </svg>
)

// SparkIcon is DELIBERATELY solid-fill (not the shared stroke() outline set): it's the Autopilot
// identity mark — carried by the header toggle and the rail title — so the filled spark reads as a
// brand glyph, not a generic action icon. Intentional exception, not an oversight (see issue #56 §1.4).
export const SparkIcon = ({ className, size = 16 }: IconProps) => (
  <svg className={className} fill='currentColor' height={size} viewBox='0 0 24 24' width={size}>
    <path d='M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z' />
  </svg>
)

export const PlusIcon = ({ className, size = 15 }: IconProps) => stroke(size, className, <path d='M12 5v14M5 12h14' />)

export const CollapseIcon = ({ className, size = 15 }: IconProps) => stroke(size, className, <path d='M13 5l7 7-7 7M4 5l7 7-7 7' />)

export const EyeIcon = ({ className, size = 12 }: IconProps) => stroke(size, className, (
  <>
    <path d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z' />
    <circle cx='12' cy='12' r='3' />
  </>
))

export const SendIcon = ({ className, size = 14 }: IconProps) => stroke(size, className, <path d='M22 2L11 13M22 2l-7 20-4-9-9-4z' />)

export const StopIcon = ({ className, size = 12 }: IconProps) => stroke(size, className, <rect height='12' rx='2' width='12' x='6' y='6' />)

export const LinkIcon = ({ className, size = 11 }: IconProps) => stroke(size, className, (
  <path d='M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1' />
))

export const CopyIcon = ({ className, size = 11 }: IconProps) => stroke(size, className, (
  <>
    <rect height='13' rx='2' width='13' x='9' y='9' />
    <path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' />
  </>
))

export const CheckIcon = ({ className, size = 15 }: IconProps) => (
  <svg className={className} fill='none' height={size} stroke='currentColor' strokeWidth={2.5} viewBox='0 0 24 24' width={size}>
    <path d='M20 6L9 17l-5-5' />
  </svg>
)

// A circle with an exclamation — the chip of a verb the portal refused, where CheckIcon would read as done.
export const RefusedIcon = ({ className, size = 15 }: IconProps) => stroke(size, className, (
  <>
    <circle cx='12' cy='12' r='9' />
    <path d='M12 7.5v5.5M12 16.5h.01' />
  </>
))

export const EvidenceIcon = ({ className, size = 12 }: IconProps) => stroke(size, className, (
  <>
    <circle cx='11' cy='11' r='7' />
    <path d='M20 20l-4.6-4.6' />
  </>
))

// A clock-with-counterclockwise-arrow — the session-history affordance in the rail head.
export const HistoryIcon = ({ className, size = 15 }: IconProps) => stroke(size, className, (
  <>
    <path d='M3 3v5h5' />
    <path d='M3.05 13A9 9 0 1 0 6 5.3L3 8' />
    <path d='M12 7v5l3 2' />
  </>
))

// Four corners pointing outward — "expand to full width" (NOT the browser Fullscreen API,
// just the rail's own width going to 100%, so the icon reads as "widen", not "go fullscreen").
export const ExpandIcon = ({ className, size = 15 }: IconProps) => stroke(size, className, (
  <path d='M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3' />
))

// Speak-back (voice spec FR 76): a speaker cone with sound waves — answers to SPOKEN
// questions are read aloud. Its off state (below) is the same cone with the waves struck
// through, so the two read as one control in two states rather than two different glyphs.
export const SpeakerIcon = ({ className, size = 15 }: IconProps) => stroke(size, className, (
  <>
    <path d='M11 5L6 9H3v6h3l5 4z' />
    <path d='M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13' />
  </>
))

export const SpeakerOffIcon = ({ className, size = 15 }: IconProps) => stroke(size, className, (
  <>
    <path d='M11 5L6 9H3v6h3l5 4z' />
    <path d='M16 9l5 6M21 9l-5 6' />
  </>
))

// Dictation (voice spec FR 30): a capsule microphone on a stand. Its blocked state is the
// same microphone struck through, so the two read as one control in two states — the same
// pairing SpeakerIcon/SpeakerOffIcon uses above, for the same reason.
export const MicIcon = ({ className, size = 14 }: IconProps) => stroke(size, className, (
  <>
    <rect height='11' rx='3' width='6' x='9' y='2' />
    <path d='M5 11a7 7 0 0 0 14 0M12 18v3' />
  </>
))

export const MicOffIcon = ({ className, size = 14 }: IconProps) => stroke(size, className, (
  <>
    <path d='M9 5a3 3 0 0 1 6 0v5m-6 1a3 3 0 0 0 5 2' />
    <path d='M5 11a7 7 0 0 0 11 5M19 11a7 7 0 0 1-1 3.5M12 18v3' />
    <path d='M3 3l18 18' />
  </>
))

// The transcribing spinner: a 3/4 arc that the CSS rotates (no antd Spin — same reason the
// rest of this file exists). Static under prefers-reduced-motion; see .apVoiceSpin.
export const SpinnerIcon = ({ className, size = 14 }: IconProps) => stroke(size, className, (
  <path d='M21 12a9 9 0 1 1-6.2-8.6' />
))

// The inverse of ExpandIcon — corners pointing inward — "restore width".
export const ShrinkIcon = ({ className, size = 15 }: IconProps) => stroke(size, className, (
  <path d='M9 3v4a2 2 0 0 1-2 2H3M21 9h-4a2 2 0 0 1-2-2V3M3 15h4a2 2 0 0 1 2 2v4M15 21v-4a2 2 0 0 1 2-2h4' />
))
