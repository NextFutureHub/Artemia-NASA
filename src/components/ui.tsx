import * as Dialog from '@radix-ui/react-dialog'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger' }) {
  const styles = {
    primary: 'bg-accent text-canvas',
    secondary: 'bg-surface text-ink border border-line',
    quiet: 'bg-transparent text-ink border border-line',
    danger: 'bg-transparent text-danger border border-danger',
  }
  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-base font-medium disabled:opacity-50 ${styles[variant]} ${className}`}
    />
  )
}

export function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-xl">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function Banner({ tone, children }: { tone: 'attention' | 'danger' | 'neutral'; children: ReactNode }) {
  const styles = {
    attention: 'border-attention text-attention',
    danger: 'border-danger text-danger',
    neutral: 'border-line text-muted',
  }
  return <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${styles[tone]}`}>{children}</div>
}

export function AppDialog({
  open,
  title,
  description,
  onOpenChange,
  children,
}: {
  open: boolean
  title: string
  description: string
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-5">
          <Dialog.Title className="text-2xl">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted">{description}</Dialog.Description>
          <div className="mt-4 flex flex-wrap gap-2">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
