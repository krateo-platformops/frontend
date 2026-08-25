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

export const CheckIcon = ({ className, size = 15 }: IconProps) => (
  <svg className={className} fill='none' height={size} stroke='currentColor' strokeWidth={2.5} viewBox='0 0 24 24' width={size}>
    <path d='M20 6L9 17l-5-5' />
  </svg>
)

export const EvidenceIcon = ({ className, size = 12 }: IconProps) => stroke(size, className, (
  <>
    <circle cx='11' cy='11' r='7' />
    <path d='M20 20l-4.6-4.6' />
  </>
))
