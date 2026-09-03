"use client"

import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { ArrowLeft, ArrowRight, Eye, EyeOff, User, Mail, Lock } from "lucide-react"
import { Button } from "@repo/ui/components/shadcn/button"
import { Input } from "@repo/ui/components/shadcn/input"
import { Label } from "@repo/ui/components/shadcn/label"
import { cn } from "@/lib/utils"
import { z } from "zod/v4"

type Props = {
  initial: { username: string; email: string; password: string }
  onBack: () => void
  onContinue: (data: { username: string; email: string; password: string }) => void
}

const accountSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
})

function passwordStrength(password: string) {
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++
  return Math.min(score, 4)
}

const strengthLabels = ["Too weak", "Weak", "Fair", "Strong", "Excellent"]

export function LocalAccountStep({ initial, onBack, onContinue }: Props) {
  const [showPassword, setShowPassword] = useState(false)

  const form = useForm({
    defaultValues: {
      username: initial.username,
      email: initial.email,
      password: initial.password,
    },
    validators: {
      onChange: accountSchema,
    },
    onSubmit: ({ value }) => {
      onContinue({
        username: value.username.trim(),
        email: value.email.trim(),
        password: value.password,
      })
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">Create the admin account</h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          This account will own the new mesh and have full administrative privileges over future nodes.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
        className="flex flex-col gap-4"
      >
        <form.Field name="username">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="setup-username" className="text-sm font-medium">Username</Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="setup-username"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="admin"
                  required
                  autoComplete="username"
                  className="pl-9"
                />
              </div>
              {field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
                <p className="text-xs text-destructive">{field.state.meta.errors[0]?.message}</p>
              )}
            </div>
          )}
        </form.Field>

        <form.Field name="email">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="setup-email" className="text-sm font-medium">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="setup-email"
                  type="email"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="admin@example.com"
                  required
                  autoComplete="email"
                  className="pl-9"
                />
              </div>
              {field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
                <p className="text-xs text-destructive">{field.state.meta.errors[0]?.message}</p>
              )}
            </div>
          )}
        </form.Field>

        <form.Field name="password">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="setup-password" className="text-sm font-medium">Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="setup-password"
                  type={showPassword ? "text" : "password"}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  autoComplete="new-password"
                  className="pl-9 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {field.state.value ? (
                <div className="flex flex-col gap-1.5 mt-1">
                  <div className="flex gap-1">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "h-1 flex-1 rounded-full transition-colors",
                          i < passwordStrength(field.state.value)
                            ? passwordStrength(field.state.value) <= 1
                              ? "bg-destructive"
                              : passwordStrength(field.state.value) === 2
                                ? "bg-amber-500"
                                : "bg-emerald-500"
                            : "bg-border",
                        )}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {strengthLabels[passwordStrength(field.state.value)]}
                  </span>
                </div>
              ) : null}
              {field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
                <p className="text-xs text-destructive">{field.state.meta.errors[0]?.message}</p>
              )}
            </div>
          )}
        </form.Field>

        <form.Subscribe selector={(s) => s.canSubmit}>
          {(canSubmit) => (
            <div className="flex items-center gap-3 pt-2">
              <Button type="button" variant="ghost" onClick={onBack} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button type="submit" className="flex-1 gap-2" disabled={!canSubmit}>
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </form.Subscribe>
      </form>
    </div>
  )
}
