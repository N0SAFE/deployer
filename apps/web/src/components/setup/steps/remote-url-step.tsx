"use client"

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useState, useEffect, useRef } from "react"
import { useForm, useStore } from "@tanstack/react-form"
import { ArrowLeft, ArrowRight, Globe } from "lucide-react"
import { Button } from "@repo/ui/components/shadcn/button"
import { Input } from "@repo/ui/components/shadcn/input"
import { Label } from "@repo/ui/components/shadcn/label"
import { useProbeMesh } from "@/domains/setup/hooks"
import { ConnectionStatus, type ConnectionState } from "@/components/setup/connection-status"

type Props = {
  initialUrl: string
  onBack: () => void
  onContinue: (data: { url: string }) => void
}

export function RemoteUrlStep({ initialUrl, onBack, onContinue }: Props) {
  const [state, setState] = useState<ConnectionState>("idle")
  const [detail, setDetail] = useState<string | undefined>()
  const probeMesh = useProbeMesh()
  const probeMeshRef = useRef(probeMesh)
  probeMeshRef.current = probeMesh

  const urlForm = useForm({
    defaultValues: { url: initialUrl },
  })

  // The store.state is a plain object — NOT a React state. Reading
  // form.store.state.values.url directly never triggers re-renders, so the
  // useEffect([url]) never fires and the debounced probe never runs.
  // useFormStore subscribes to the store reactively → re-render on every
  // keystroke → url changes → probe fires.
  const url = useStore(urlForm.store, (s) => s.values.url)

  useEffect(() => {
    const trimmed = url.trim()
    if (!trimmed) {
      setState("idle")
      setDetail(undefined)
      return
    }
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      setState("unreachable")
      setDetail("Invalid URL")
      return
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setState("unreachable")
      setDetail("Mesh URL must be http(s)")
      return
    }

    setState("checking")
    setDetail(undefined)
    let cancelled = false
    const handle = setTimeout(() => {
      probeMeshRef.current.mutate(trimmed, {
        onSuccess: (result) => {
          if (cancelled) return
          if (result.reachable) {
            setState("reachable")
            setDetail(
              result.advertisedHost
                ? `Reachable · ${result.advertisedHost}`
                : "Reachable",
            )
          } else {
            setState("unreachable")
            // Normalize empty error detail so the UI never shows a blank reason.
            setDetail(result.error?.trim() ? result.error : "Not reachable")
          }
        },
        onError: (err) => {
          if (cancelled) return
          setState("unreachable")
          setDetail(isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE)
        },
      })
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [url])

  const urlValid = (() => {
    try {
      const parsed = new URL(url.trim())
      return parsed.protocol === "http:" || parsed.protocol === "https:"
    } catch {
      return false
    }
  })()

  // The probe is ADVISORY, not a hard gate: a valid mesh node whose mesh
  // controller isn't mounted yet (early bootstrap) or that only answers
  // /health (see ReachabilityService.checkMeshUrlReachability) can still be
  // a legitimate registration target. Blocking forever on "unreachable"
  // makes it impossible to join such a node. So we allow continuing when
  // the URL is well-formed AND the probe settled (reachable OR unreachable);
  // on unreachable the ConnectionStatus warning makes the risk explicit.
  const canContinue = urlValid && (state === "reachable" || state === "unreachable")

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">Connect to a mesh node</h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          Enter the URL of any node in the target cluster. We&apos;ll verify it&apos;s reachable and proceed to
          authentication.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="setup-mesh-url" className="text-sm font-medium">
            Mesh node URL
          </Label>
          <div className="relative">
            <Globe
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="setup-mesh-url"
              value={url}
              onChange={(e) => urlForm.setFieldValue('url', e.target.value)}
              onInput={(e) => urlForm.setFieldValue('url', (e.target as HTMLInputElement).value)}
              placeholder="https://node.example.com:3005"
              required
              autoComplete="url"
              className="pl-9"
            />
          </div>
        </div>

        {url.trim() ? <ConnectionStatus state={state} detail={detail} /> : null}
        {state === "unreachable" && urlValid ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            The node did not answer the reachability check. You can still continue — if the
            URL is correct for an existing node, authentication will confirm it.
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          type="button"
          className="flex-1 gap-2"
          disabled={!canContinue || probeMesh.isPending}
          onClick={() => onContinue({ url: url.trim() })}
        >
          Continue
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
