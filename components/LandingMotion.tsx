'use client'

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react'

type RevealProps = {
  children: ReactNode
  className?: string
  /** Extra delay after entering viewport (ms) */
  delay?: number
  /** Start visible immediately (hero / above the fold) */
  eager?: boolean
  as?: 'div' | 'li' | 'section' | 'span'
}

export function Reveal({
  children,
  className = '',
  delay = 0,
  eager = false,
  as = 'div',
}: RevealProps) {
  const Tag = as as ElementType
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(eager)

  useEffect(() => {
    if (eager) return
    const node = ref.current
    if (!node) return

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [eager])

  const style = delay ? ({ '--reveal-delay': `${delay}ms` } as CSSProperties) : undefined

  return (
    <Tag
      ref={ref}
      className={`landing-io ${visible ? 'landing-io-visible' : ''} ${className}`.trim()}
      style={style}
    >
      {children}
    </Tag>
  )
}

type CountUpProps = {
  value: number
  className?: string
  durationMs?: number
}

export function CountUp({ value, className = '', durationMs = 1100 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [display, setDisplay] = useState(0)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setStarted(true)
          io.disconnect()
        }
      },
      { threshold: 0.4 },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!started) return
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setDisplay(value)
      return
    }

    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(value * eased))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [started, value, durationMs])

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  )
}

type AnimatedTextProps = {
  text: string
  className?: string
  mode?: 'words' | 'chars'
  delay?: number
  stagger?: number
  onceInView?: boolean
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3'
}

export function AnimatedText({
  text,
  className = '',
  mode = 'words',
  delay = 0,
  stagger = 45,
  onceInView = false,
  as = 'span',
}: AnimatedTextProps) {
  const Tag = as as ElementType
  const ref = useRef<HTMLElement | null>(null)
  const [active, setActive] = useState(!onceInView)

  useEffect(() => {
    if (!onceInView) return
    const node = ref.current
    if (!node) return

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setActive(true)
          io.disconnect()
        }
      },
      { threshold: 0.25, rootMargin: '0px 0px -6% 0px' },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [onceInView])

  const units =
    mode === 'chars'
      ? Array.from(text)
      : text.split(/(\s+)/).filter((part) => part.length > 0)

  let index = 0

  return (
    <Tag
      ref={ref}
      className={`landing-text ${active ? 'landing-text-active' : ''} ${className}`.trim()}
      aria-label={text}
      style={
        {
          '--text-delay': `${delay}ms`,
          '--text-stagger': `${stagger}ms`,
        } as CSSProperties
      }
    >
      {units.map((unit, i) => {
        if (mode === 'words' && /^\s+$/.test(unit)) {
          return <span key={`s-${i}`}>{unit}</span>
        }
        const n = index++
        return (
          <span
            key={`${unit}-${i}`}
            className={mode === 'chars' ? 'landing-char' : 'landing-word'}
            style={{ '--i': n } as CSSProperties}
            aria-hidden="true"
          >
            {unit === ' ' ? '\u00a0' : unit}
          </span>
        )
      })}
    </Tag>
  )
}

type TypeLineProps = {
  text: string
  className?: string
  delayMs?: number
  charMs?: number
  showCaret?: boolean
}

/** Types characters once on mount (hero accent line). */
export function TypeLine({
  text,
  className = '',
  delayMs = 400,
  charMs = 38,
  showCaret = true,
}: TypeLineProps) {
  const [shown, setShown] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setShown(text)
      setDone(true)
      return
    }

    let i = 0
    let interval: ReturnType<typeof setInterval> | undefined
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1
        setShown(text.slice(0, i))
        if (i >= text.length) {
          clearInterval(interval)
          setDone(true)
        }
      }, charMs)
    }, delayMs)

    return () => {
      clearTimeout(start)
      if (interval) clearInterval(interval)
    }
  }, [text, delayMs, charMs])

  return (
    <span className={`landing-type ${className}`.trim()} aria-label={text}>
      <span aria-hidden="true">{shown}</span>
      {showCaret && !done ? <span className="landing-caret" aria-hidden="true" /> : null}
    </span>
  )
}
