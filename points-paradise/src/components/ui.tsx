import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { EVIDENCE_LABELS, type EvidenceStatus } from '@/lib/domain/constants'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap'
const BUTTON_VARIANTS = {
  primary: 'bg-primary text-primary-ink hover:opacity-90',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
  ghost: 'text-ink hover:bg-surface-2',
  gold: 'bg-gold text-white hover:opacity-90 dark:text-navy',
  danger: 'bg-danger-soft text-danger hover:opacity-90',
} as const
const BUTTON_SIZES = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' } as const

export function buttonClass(variant: keyof typeof BUTTON_VARIANTS = 'primary', size: keyof typeof BUTTON_SIZES = 'md', extra?: string) {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], extra)
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: keyof typeof BUTTON_VARIANTS; size?: keyof typeof BUTTON_SIZES }) {
  return <button {...props} className={buttonClass(variant, size, className)} />
}

export function LinkButton({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof BUTTON_VARIANTS; size?: keyof typeof BUTTON_SIZES }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />
}

export function Card({ className, children, ...rest }: ComponentProps<'div'>) {
  return (
    <div {...rest} className={cx('rounded-2xl border border-line bg-surface shadow-card', className)}>
      {children}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="text-xs font-semibold tracking-[0.18em] text-gold uppercase">{eyebrow}</p>}
        <h1 className="font-display text-3xl leading-tight text-ink sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-display text-xl text-ink">{children}</h2>
      {aside}
    </div>
  )
}

const TONES = {
  neutral: 'bg-surface-2 text-muted',
  primary: 'bg-primary-soft text-primary',
  gold: 'bg-gold-soft text-gold',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
} as const
export type Tone = keyof typeof TONES

export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide', TONES[tone], className)}>
      {children}
    </span>
  )
}

export function statusTone(s: EvidenceStatus): Tone {
  switch (s) {
    case 'verified_live':
      return 'ok'
    case 'recently_verified':
      return 'primary'
    case 'cached':
      return 'warn'
    case 'demo':
      return 'gold'
    case 'expired':
    case 'unavailable':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function StatusBadge({ status, className }: { status: EvidenceStatus; className?: string }) {
  return (
    <Badge tone={statusTone(status)} className={className} title="How strong the evidence for this deal is">
      <span aria-hidden className="inline-block size-1.5 rounded-full bg-current" />
      {EVIDENCE_LABELS[status]}
    </Badge>
  )
}

export function Stat({ label, value, hint, emphasis }: { label: string; value: ReactNode; hint?: ReactNode; emphasis?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-semibold tracking-wider text-faint uppercase">{label}</div>
      <div className={cx('tabular', emphasis ? 'text-2xl font-semibold text-ink' : 'text-base font-semibold text-ink')}>{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div aria-hidden className="font-display text-4xl text-gold">✦</div>
      <h3 className="font-display text-xl">{title}</h3>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action}
    </Card>
  )
}

export function Notice({ tone = 'neutral', title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <div role="note" className={cx('rounded-xl px-4 py-3 text-sm', TONES[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={cx(title && 'mt-0.5', 'opacity-95')}>{children}</div>
    </div>
  )
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={cx('text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary', className)}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
