'use client'

import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@deployer/ui/components/shadcn/input'

type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>

/** Password field with an explicit show/hide control (keyboard reachable). */
export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = React.useState(false)
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className={`pr-12 ${className ?? ''}`} />
      <button
        type="button"
        onClick={() => {
          setVisible((v) => !v)
        }}
        aria-label={visible ? 'Hide password text' : 'Show password text'}
        aria-pressed={visible}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md focus-visible:ring-2 focus-visible:outline-none"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  )
}
