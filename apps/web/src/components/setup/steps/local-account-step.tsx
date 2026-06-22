"use client"

import { useState } from "react"
import { ArrowLeft, ArrowRight, Eye, EyeOff, User, Mail, Lock } from "lucide-react"
import { Button } from "@repo/ui/components/shadcn/button"
import { Input } from "@repo/ui/components/shadcn/input"
import { Label } from "@repo/ui/components/shadcn/label"
import { cn } from "@/lib/utils"

type Props = {
  initial: { username: string; email: string; password: string }
  onBack: () => void
  onContinue: (data: { username: string; email: string; password: string }) => void
}

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
  const [username, setUsername] = useState(initial.username)
  const [email, setEmail] = useState(initial.email)
  const [password, setPassword] = useState(initial.password)
  const [showPassword, setShowPassword] = useState(false)

  const strength = passwordStrength(password)
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const usernameValid = username.trim().length >= 3
  const passwordValid = password.length >= 8

  const canContinue = emailValid && usernameValid && passwordValid

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canContinue) return
    onContinue({ username: username.trim(), email: email.trim(), password })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">Create the admin account</h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          This account will own the new mesh and have full administrative privileges over future nodes.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="setup-username" className="text-sm font-medium">
            Username
          </Label>
          <div className="relative">
            <User
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="setup-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
              autoComplete="username"
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="setup-email" className="text-sm font-medium">
            Email
          </Label>
          <div className="relative">
            <Mail
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="setup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
              autoComplete="email"
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="setup-password" className="text-sm font-medium">
            Password
          </Label>
          <div className="relative">
            <Lock
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="setup-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
          {password ? (
            <div className="flex flex-col gap-1.5 mt-1">
              <div className="flex gap-1">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-1 flex-1 rounded-full transition-colors",
                      i < strength
                        ? strength <= 1
                          ? "bg-destructive"
                          : strength === 2
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                        : "bg-border",
                    )}
                  />
                ))}
              </div>
              <span className="text-xs text-muted-foreground">{strengthLabels[strength]}</span>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button type="submit" className="flex-1 gap-2" disabled={!canContinue}>
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  )
}
