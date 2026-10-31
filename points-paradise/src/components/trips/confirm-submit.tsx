'use client'

import type { ReactNode } from 'react'

/** Submit button that asks first, for destructive form actions. */
export function ConfirmSubmit({ message, className, children, ...rest }: { message: string; className?: string; children: ReactNode; 'aria-label'?: string }) {
  return (
    <button
      type="submit"
      className={className}
      {...rest}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault()
      }}
    >
      {children}
    </button>
  )
}
