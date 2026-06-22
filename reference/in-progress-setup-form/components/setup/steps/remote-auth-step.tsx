"use client"

import { useState } from "react"
import { ArrowLeft, ArrowRight, ExternalLink, Lock, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { mockRemoteAuthenticate } from "@/lib/setup/mock-api"
import type { RemoteUser } from "@/lib/setup/types"

type Props = {
  meshUrl: string
  meshName: string
  onBack: () => void
  onAuthenticated: (data: { user: RemoteUser; sessionToken: string }) => void
}

export function RemoteAuthStep({ meshUrl, meshName, onBack, onAuthenticated }: Props) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await mockRemoteAuthenticate(meshUrl)
      onAuthenticated(result)
    } catch {
      setError("Authentication failed. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">Authenticate with the mesh</h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          You&apos;ll be redirected to a member node to sign in. After approval, the mesh returns a session token used
          to retrieve the database URL and register this node.
        </p>
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Redirecting to</span>
            <span className="font-mono text-sm break-all">{meshUrl}/auth</span>
            <span className="text-xs text-muted-foreground mt-1">
              Mesh: <span className="font-medium text-foreground">{meshName}</span>
            </span>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="auth-email" className="text-sm font-medium">
            Email
          </Label>
          <Input
            id="auth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
            disabled={submitting}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="auth-password" className="text-sm font-medium">
            Password
          </Label>
          <div className="relative">
            <Lock
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              disabled={submitting}
              className="pl-9"
            />
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Credentials are sent directly to the member node and never stored on this device.</span>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onBack} disabled={submitting} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button type="submit" disabled={submitting || !email || !password} className="gap-2">
            {submitting ? "Authenticating..." : "Authenticate & continue"}
            {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
          </Button>
        </div>
      </form>
    </div>
  )
}
