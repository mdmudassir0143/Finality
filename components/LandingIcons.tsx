import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function IconBase({ children, className = '', ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {children}
    </svg>
  )
}

/** How it works */
export function IconRequest(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 12h11" />
      <path d="m12 7 5 5-5 5" />
      <path d="M20 5v14" />
    </IconBase>
  )
}

export function IconPay(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h3" />
    </IconBase>
  )
}

export function IconReceive(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 12.5 11 14.5 15.5 10" />
      <path d="M14 3.5h3.5A2.5 2.5 0 0 1 20 6v12a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18V6A2.5 2.5 0 0 1 6.5 3.5H10" />
      <path d="M10 3.5h4v2.5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V3.5Z" />
    </IconBase>
  )
}

/** Paid resource groups */
export function IconMarket(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 15v-3" />
      <path d="M12 15V9" />
      <path d="M16 15v-6" />
      <path d="M8 8l4-3 4 2" />
    </IconBase>
  )
}

export function IconIntelligence(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="M5.6 5.6 7.7 7.7" />
      <path d="M16.3 16.3 18.4 18.4" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="M5.6 18.4 7.7 16.3" />
      <path d="M16.3 7.7 18.4 5.6" />
      <circle cx="12" cy="12" r="3.5" />
    </IconBase>
  )
}

export function IconAgents(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="5" y="8" width="14" height="10" rx="2" />
      <path d="M9 8V6.5A3 3 0 0 1 12 3.5 3 3 0 0 1 15 6.5V8" />
      <circle cx="9.5" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="13" r="1" fill="currentColor" stroke="none" />
      <path d="M9 18v2" />
      <path d="M15 18v2" />
    </IconBase>
  )
}

export function IconAi(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3.5 13.2 8.3 18 9.5 13.2 10.7 12 15.5 10.8 10.7 6 9.5 10.8 8.3 12 3.5Z" />
      <path d="M18.5 14.5 19.1 16.8 21.5 17.5 19.1 18.2 18.5 20.5 17.9 18.2 15.5 17.5 17.9 16.8 18.5 14.5Z" />
      <path d="M6.2 13.8 6.7 15.6 8.5 16.2 6.7 16.8 6.2 18.6 5.7 16.8 3.9 16.2 5.7 15.6 6.2 13.8Z" />
    </IconBase>
  )
}

export function IconHedera(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3.5 18.5 17.5h-3.2L12 10.2 8.7 17.5H5.5L12 3.5Z" />
      <path d="M8.2 13.8h7.6" />
    </IconBase>
  )
}

export function IconHumans(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="9" cy="8" r="2.5" />
      <circle cx="16" cy="9" r="2" />
      <path d="M3.5 18.5c.4-3 2.6-4.5 5.5-4.5s5.1 1.5 5.5 4.5" />
      <path d="M13.2 14.2c1.7-.4 3.4.2 4.5 1.8.5.7.8 1.5.9 2.5" />
    </IconBase>
  )
}

export function IconBot(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4v2" />
      <rect x="5" y="6" width="14" height="11" rx="3" />
      <path d="M9 11h.01" />
      <path d="M15 11h.01" />
      <path d="M9 15h6" />
      <path d="M4 11H2.5" />
      <path d="M21.5 11H20" />
    </IconBase>
  )
}
