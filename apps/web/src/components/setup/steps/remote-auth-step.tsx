"use client"

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useEffect, useRef, useState } from "react"
import { useForm, useStore } from "@tanstack/react-form"
import { ArrowLeft, ArrowRight, Mail, Lock, LogIn, RotateCw } from "lucide-react"
import { Button } from "@repo/ui/components/shadcn/button"
import { Input } from "@repo/ui/components/shadcn/input"
import { Label } from "@repo/ui/components/shadcn/label"
import { useRemoteAuth } from "@/domains/setup/hooks"
import { ConnectionStatus, type ConnectionState } from "@/components/setup/connection-status"

type Props = {
  meshUrl: string
  onBack: () => void
  onAuthenticated: (data: { authToken: string }) => void
}

type AuthOutcome = {
  authToken: string
  userId: string
  email: string
  latencyMs?: number
}

const DEBOUNCE_MS = 500

export function RemoteAuthStep({ meshUrl, onBack, onAuthenticated }: Props) {
  // Validation state mirrors RemoteUrlStep's pattern.
  const [state, setState] = useState<ConnectionState>("idle")
  const [detail, setDetail] = useState<string | undefined>(undefined)
  // Captured session token. Set only after a successful validation.
  // `null` until the user proves they own these credentials.
  const [outcome, setOutcome] = useState<AuthOutcome | null>(null)

  const remoteAuth = useRemoteAuth()
  // Stable ref so the auto-validate effect doesn't refire on every render.
  const remoteAuthRef = useRef(remoteAuth)
  remoteAuthRef.current = remoteAuth

  const authForm = useForm({
    defaultValues: { email: '', password: '' },
  })

  // useFormStore subscribes to the TanStack store reactively — store.state
  // alone is NOT a React state and never triggers re-renders, so the
  // debounced probe effect never fires.
  const email = useStore(authForm.store, (s) => s.values.email)
  const password = useStore(authForm.store, (s) => s.values.password)

  // Track the last probed credentials so we only reset state when the input
  // actually changes, avoiding the flicker of idle → checking → idle on
  // every keystroke.
  const lastProbedRef = useRef({ email: '', password: '' })

  // Debounced real-time validation. Triggers as soon as both fields have
  // a non-empty value, and re-triggers whenever they change.
  useEffect(() => {
    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setState("idle")
      setDetail(undefined)
      return
    }
    // Only reset + re-probe when the input actually changed.
    if (lastProbedRef.current.email === trimmedEmail && lastProbedRef.current.password === password) return
    lastProbedRef.current = { email: trimmedEmail, password }

    // Cheap syntactic check on the email side so we don't waste a roundtrip
    // on obviously bad input.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setState("unreachable")
      setDetail("Enter a valid email address")
      return
    }

    setState("checking")
    setDetail(undefined)
    let cancelled = false
    const handle = setTimeout(() => {
      remoteAuthRef.current.mutate(
        { meshUrl, username: trimmedEmail, password },
        {
          onSuccess: (result) => {
            if (cancelled) return
            setState("reachable")
            setDetail(
              typeof result.latencyMs === "number"
                ? `Credentials valid · ${result.latencyMs.toString()}ms`
                : "Credentials valid",
            )
            setOutcome({
              authToken: result.authToken,
              userId: result.userId,
              email: result.email,
              latencyMs: result.latencyMs,
            })
          },
          onError: (err) => {
            if (cancelled) return
            setState("unreachable")
            setOutcome(null)
            setDetail(isDefinedORPCError(err) ? getErrorMessage(err, "Invalid credentials") : UNKNOWN_ORPC_ERROR_MESSAGE)
          },
        },
      )
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [email, password, meshUrl])

  const canContinue = state === "reachable" && outcome !== null
  const bothFilled = email.trim().length > 0 && password.length > 0

  const handleManualRecheck = () => {
    if (!bothFilled) return
    setState("checking")
    setDetail(undefined)
    remoteAuthRef.current.mutate(
      { meshUrl, username: email.trim(), password },
      {
        onSuccess: (result) => {
          setState("reachable")
          setDetail(
            typeof result.latencyMs === "number"
              ? `Credentials valid · ${result.latencyMs.toString()}ms`
              : "Credentials valid",
          )
          setOutcome({
            authToken: result.authToken,
            userId: result.userId,
            email: result.email,
            latencyMs: result.latencyMs,
          })
        },
        onError: (err) => {
          setState("unreachable")
          setOutcome(null)
          setDetail(isDefinedORPCError(err) ? getErrorMessage(err, "Invalid credentials") : UNKNOWN_ORPC_ERROR_MESSAGE)
        },
      },
    )
  }

  const handleContinue = () => {
    if (!outcome) return
    onAuthenticated({ authToken: outcome.authToken })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">Authenticate with the mesh</h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          Provide your credentials for{" "}
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{meshUrl}</code> to
          obtain a session token and join the cluster. We&apos;ll verify the
          credentials in real time before moving on.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="remote-email" className="text-sm font-medium">
            Email
          </Label>
          <div className="relative">
            <Mail
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="remote-email"
              type="email"
              value={email}
              onChange={(e) => authForm.setFieldValue('email', e.target.value)}
              onInput={(e) => authForm.setFieldValue('email', (e.target as HTMLInputElement).value)}
              placeholder="admin@example.com"
              autoComplete="email"
              className="pl-9"
              aria-invalid={state === "unreachable" && bothFilled ? true : undefined}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="remote-password" className="text-sm font-medium">
            Password
          </Label>
          <div className="relative">
            <Lock
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="remote-password"
              type="password"
              value={password}
              onChange={(e) => authForm.setFieldValue('password', e.target.value)}
              onInput={(e) => authForm.setFieldValue('password', (e.target as HTMLInputElement).value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="pl-9"
              aria-invalid={state === "unreachable" && bothFilled ? true : undefined}
            />
          </div>
        </div>

        {bothFilled ? (
          <ConnectionStatus
            state={state}
            idleLabel="Awaiting credentials"
            checkingLabel="Verifying credentials against the mesh…"
            reachableLabel="Credentials accepted"
            unreachableLabel="Credentials rejected"
            detail={detail}
          />
        ) : null}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        {state === "unreachable" && bothFilled ? (
          <Button
            type="button"
            variant="outline"
            onClick={handleManualRecheck}
            disabled={remoteAuth.isPending}
            className="gap-2"
          >
            <RotateCw className="h-4 w-4" />
            Retry
          </Button>
        ) : null}
        <Button
          type="button"
          className="flex-1 gap-2"
          disabled={!canContinue}
          onClick={handleContinue}
        >
          {remoteAuth.isPending ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Verifying…
            </>
          ) : (
            <>
              <LogIn className="h-4 w-4" />
              Continue
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
