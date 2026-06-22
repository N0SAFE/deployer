"use client"

import { useState, useEffect, useRef } from "react"
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
  const [url, setUrl] = useState(initialUrl)
  const [state, setState] = useState<ConnectionState>("idle")
  const [detail, setDetail] = useState<string | undefined>()
  // Keep a stable ref to the mutation object so the probe effect
  // doesn't refire on every render (TanStack returns a new object
  // every render, which would otherwise cause an infinite re-probe
  // loop when listed in a useEffect dependency array).
  const probeMesh = useProbeMesh()
  const probeMeshRef = useRef(probeMesh)
  probeMeshRef.current = probeMesh

  useEffect(() => {
    const trimmed = url.trim()
    if (!trimmed) {
      setState("idle")
      setDetail(undefined)
      return
    }
    // Only probe HTTP(S) URLs. Anything else (postgresql://, malformed
    // strings, …) is just unparseable from the mesh-probe perspective
    // and we treat it as "unreachable" without spamming the API.
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
            setDetail(result.error ?? "Not reachable")
          }
        },
        onError: (err) => {
          if (cancelled) return
          setState("unreachable")
          setDetail(err.message)
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

  const canContinue = urlValid && state === "reachable"

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
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mesh.example.com"
              required
              autoComplete="url"
              className="pl-9"
            />
          </div>
        </div>

        {url.trim() ? <ConnectionStatus state={state} detail={detail} /> : null}
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
