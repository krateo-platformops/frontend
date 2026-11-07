import { useId } from 'react'

/** Inline instrument-style SVGs matching the agentiko mockup's stroke set
 * (not antd icons — these carry the exact petrol line weight/shape). */

type IconProps = { className?: string; size?: number }

const stroke = (size: number, className: string | undefined, children: React.ReactNode) => (
  <svg className={className} fill='none' height={size} stroke='currentColor' strokeWidth={2} viewBox='0 0 24 24' width={size}>
    {children}
  </svg>
)

// The Agentiko monogram — the "A" fused with a gecko — from the brand's own vector artwork
// (Brand Guidelines AGENTIKO, "Pittogramma"; EPS → SVG, geometry untouched). It is the agent's
// identity mark, carried by the header toggle, the rail title and every `intent: agentiko` Button,
// and it is DELIBERATELY solid-fill (not the shared stroke() outline set): a brand glyph, not a
// generic action icon. The guidelines forbid recolouring outside the palette, rotating, stroking
// or adding effects — so it is `currentColor` (callers pass an Agentiko token) or the brand
// gradient, and nothing else.
const AGENTIKO_MARK_PATHS = [
  'M5930.74 10481.4C6204.53 10537.1 6545.77 10489.1 6958.99 10229.7 6958.99 10229.7 6380.94 8838.78 5058.78 9746.74 5058.78 9746.74 5334.76 10360.1 5930.72 10481.4M6627.9 11124C6254.87 11443.1 5948.22 11550.3 5704.55 11550.3 5205.62 11550.3 4970.78 11100.9 4970.78 11100.9 4970.78 11100.9 3448.04 10545.6 2791.09 8433.08L0 0H1880.57L3238.85 4209.1 3328.39 4477.78 3510.09 5039.6 4226.57 4519.62C4226.57 4519.62 4553 4205.77 4882.94 4653.38 5212.88 5100.99 5376.55 5356.15 5657.5 5241.59L5944.71 5088.9C5925.08 4924.53 6040.3 4774.11 6204.95 4751.55 6371.37 4728.78 6524.73 4845.21 6547.52 5011.61 6570.29 5178.03 6453.87 5331.39 6287.47 5354.18 6200.53 5366.06 6117.69 5339.37 6054.63 5288.01L5805.47 5496.71C5614.52 5627.25 5860.01 5837.99 5860.01 5837.99L6175.63 6070.84C6218.47 6034.16 6271.62 6008.5 6331.66 6000.27 6498.06 5977.51 6651.44 6093.93 6674.21 6260.33 6697.01 6426.76 6580.57 6580.12 6414.15 6602.91 6247.75 6625.68 6094.38 6509.25 6071.6 6342.85 6067.3 6311.51 6069.38 6281.07 6074.37 6251.43L5689.84 6051.13C5470.82 5976.7 5506.94 6171.09 5506.94 6171.09L5584.91 6610.45C5715.17 6629.84 5822.91 6731.59 5841.68 6868.66 5864.46 7035.06 5748.02 7188.44 5581.62 7211.21 5415.21 7234 5261.84 7117.57 5239.06 6951.15 5222.38 6829.36 5280.72 6715.11 5378.21 6653.37 5331.6 6505.23 4894.3 5165.66 4410.88 5457.04 4012.55 5697.13 3955.76 6150.08 3973.24 6471.71L4404.79 7806.1C4672.7 8500.71 4922.31 8741.05 5473.48 8741.05 5540.66 8741.05 5610.08 8738.28 5681.71 8733.4 5748.39 8728.87 5810.04 8726.77 5867.09 8726.77 6373.97 8726.77 6521.45 8892.71 6703.11 8989.09 6905.2 9096.34 8258.63 10032.2 8403.39 10393.9 8548.14 10755.6 6627.9 11124 6627.9 11124',
  'M9704.66 4500.76 9455.72 5252.95 8403.21 8433.06C8306.36 8723.43 8199.83 8983 8083.56 9212.06 8038.24 9176.19 7990.88 9139.25 7940.62 9100.74 7551.03 8802.11 7132.92 8518.49 6986.84 8440.97 6970.96 8432.56 6946.71 8417.39 6921.05 8401.35 6849.58 8356.69 6757.82 8299.74 6635.08 8248.01 6658.15 8188.79 6680.57 8126.89 6701.63 8059.91 6711.45 8039.89 6716.54 8027.5 6716.54 8022.65 6716.54 8017.51 6721.51 8005.08 6731.49 7985.34L7665.26 5097.99 8359.13 2938.65C8963.25 3019.92 9899.56 3332.47 9704.66 4500.76',
  'M8359.13 2938.65C8084.56 2901.71 7878.61 2912.53 7878.61 2912.53H5185.47C4391.44 2912.53 3747.78 2268.84 3747.78 1474.8H8411.19C8411.19 1474.8 8585.03 1470 8827.01 1497.4L8406.54 2791.09 8359.13 2938.65',
  'M10311.1 2668.68H10311C10311 1796.69 9386.1 1560.6 8827.01 1497.4L9313.66 0H11194.3L10311.1 2668.68',
  'M5930.91 10481.3C5930.91 10481.3 5532.68 9974.68 6125.69 9465.81 6125.69 9465.81 6513.27 10120.7 5930.91 10481.3',
]

type MarkProps = IconProps & {
  /** Paint the brand "sfumatura" (violet → blue, bottom-left → top-right of each shape) instead of
   * currentColor. Reads the Agentiko gradient tokens, so it follows the theme mode. */
  gradient?: boolean
  /** Accessible name; omit when the mark sits beside a visible "Agentiko" label. */
  title?: string
}

export const AgentikoMark = ({ className, gradient = false, size = 16, title }: MarkProps) => {
  const gradientId = `agentiko-mark-${useId().replace(/:/g, '')}`
  return (
    <svg
      aria-hidden={title ? undefined : true}
      className={className}
      height={size}
      role={title ? 'img' : undefined}
      viewBox='0 0 1119.43 1155.03'
      width={size}
    >
      {title ? <title>{title}</title> : null}
      {gradient ? (
        <defs>
          {/* In the group's user space y runs upward (the matrix flips it), so y1=0 is the BOTTOM. */}
          <linearGradient id={gradientId} x1='0' x2='1' y1='0' y2='1'>
            <stop offset='0' stopColor='var(--krateo-color-agentiko-gradient-start)' />
            <stop offset='1' stopColor='var(--krateo-color-agentiko-gradient-end)' />
          </linearGradient>
        </defs>
      ) : null}
      <g fill={gradient ? `url(#${gradientId})` : 'currentColor'} transform='matrix(.1,0,0,-.1,0,1155.03)'>
        {AGENTIKO_MARK_PATHS.map((path) => <path d={path} key={path.slice(0, 16)} />)}
      </g>
    </svg>
  )
}

export const LockIcon = ({ className, size = 14 }: IconProps) => stroke(size, className, (
  <>
    <rect height='10' rx='2' width='14' x='5' y='11' />
    <path d='M8 11V8a4 4 0 0 1 8 0v3' />
  </>
))

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
