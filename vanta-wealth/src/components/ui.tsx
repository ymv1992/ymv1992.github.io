import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { signedPct, signedUsd } from '@/lib/format'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

const BUTTON_BASE = 'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap'
const BUTTON_VARIANTS = {
  primary: 'bg-gold text-gold-ink hover:opacity-90',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
  danger: 'bg-danger-soft text-danger hover:opacity-90',
} as const
const BUTTON_SIZES = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' } as const
type Variant = keyof typeof BUTTON_VARIANTS
type Size = keyof typeof BUTTON_SIZES

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra?: string) {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], extra)
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button {...props} className={buttonClass(variant, size, className)} />
}

export function LinkButton({ variant = 'primary', size = 'md', className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />
}

export function Card({ className, children, ...rest }: ComponentProps<'div'>) {
  return (
    <div {...rest} className={cx('rounded-2xl border border-line bg-surface shadow-card', className)}>
      {children}
    </div>
  )
}

export function Section({ title, hint, actions, children, className, id }: { title: string; hint?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <Card className={cx('p-5 sm:p-6', className)} id={id}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-ink">{title}</h2>
          {hint && <p className="mt-1 max-w-2xl text-sm text-muted">{hint}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Card>
  )
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="eyebrow !text-gold">{eyebrow}</p>}
        <h1 className="font-display text-3xl leading-tight text-ink sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'danger' }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className={cx('num mt-1 truncate text-2xl', tone === 'ok' ? 'text-ok' : tone === 'danger' ? 'text-danger' : 'text-ink')}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  )
}

const BADGE_TONES = {
  neutral: 'border-line bg-surface-2 text-muted',
  gold: 'border-transparent bg-gold-soft text-gold',
  ok: 'border-transparent bg-ok-soft text-ok',
  warn: 'border-transparent bg-warn-soft text-warn',
  danger: 'border-transparent bg-danger-soft text-danger',
} as const

export function Badge({ tone = 'neutral', children, title }: { tone?: keyof typeof BADGE_TONES; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', BADGE_TONES[tone])}>
      {children}
    </span>
  )
}

/** Signed money or percent, with an arrow so direction never depends on color alone. */
export function Delta({ value, kind = 'usd', cents = false, className }: { value: number | null | undefined; kind?: 'usd' | 'pct'; cents?: boolean; className?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className={cx('num text-faint', className)}>—</span>
  const up = value > 0
  const flat = value === 0
  return (
    <span className={cx('num whitespace-nowrap', flat ? 'text-muted' : up ? 'text-ok' : 'text-danger', className)}>
      <span aria-hidden="true">{flat ? '' : up ? '▲ ' : '▼ '}</span>
      {kind === 'usd' ? signedUsd(value, cents) : signedPct(value)}
    </span>
  )
}

export function Notice({ tone = 'neutral', children }: { tone?: 'neutral' | 'warn' | 'danger' | 'ok'; children: ReactNode }) {
  const tones = { neutral: 'border-line bg-surface-2 text-muted', warn: 'border-transparent bg-warn-soft text-warn', danger: 'border-transparent bg-danger-soft text-danger', ok: 'border-transparent bg-ok-soft text-ok' }
  return <div className={cx('rounded-xl border px-4 py-3 text-sm', tones[tone])}>{children}</div>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-5 py-8 text-center">
      <p className="font-display text-lg text-ink">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</div>}
    </div>
  )
}

export function Disclaimer() {
  return <p className="mt-10 text-xs leading-relaxed text-faint">Vanta Wealth is an educational decision-support tool. It shows data, calculations and flags; it does not give buy or sell instructions and is not a substitute for a licensed financial, tax or legal adviser.</p>
}
