"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, ArrowRight, Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ConnectionStatus } from "@/components/setup/connection-status"
import { checkMeshReachability } from "@/lib/setup/mock-api"
import type { ConnectionState } from "@/lib/setup/types"

type Props = {
  initialUrl: string
  onBack: () => void
  onContinue: (data: { url: string; meshName: string; nodeCount: number }) => void
}

export function RemoteUrlStep({ initialUrl, onBack, onContinue }: Props) {
  const [url, setUrl] = useState(initialUrl)
  const [state, setState] = useState<ConnectionState>("idle")
  const [detail, setDetail] = useState<string | undefined>()
  const [meshInfo, setMeshInfo] = useState<{ name: string; nodeCount: number } | null>(null)

  useEffect(() => {
    setMeshInfo(null)
    if (!url.trim()) {
      setState("idle")
      setDetail(undefined)
      return
    }
    setState("checking")
    setDetail(undefined)
    let cancelled = false
    const handle = setTimeout(async () => {
      const result = await checkMeshReachability(url.trim())
      if (cancelled) return
      if (result.reachable) {
        setState("reachable")
        setDetail(`${result.meshName} • ${result.nodeCount} active nodes • ${result.latencyMs}ms`)
        setMeshInfo({ name: result.meshName!, nodeCount: result.nodeCount! })
      } else {
        setState("unreachable")
        setDetail(result.error)
        setMeshInfo(null)
      }
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [url])

  const canContinue = state === "reachable" && meshInfo !== null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">Point to a mesh</h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          Enter the URL of any active node in the mesh you want to join. We&apos;ll verify it&apos;s reachable before
          continuing.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Label htmlFor="mesh-url" className="text-sm font-medium">
          Mesh entry URL
        </Label>
        <div className="relative">
          <Globe
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="mesh-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://node-1.aurora-mesh.io"
            className="pl-9 font-mono text-sm"
            autoComplete="url"
            spellCheck={false}
          />
        </div>
        <ConnectionStatus
          state={state}
          idleLabel="Waiting for URL"
          checkingLabel="Probing mesh endpoint..."
          reachableLabel="Mesh is reachable"
          unreachableLabel="Cannot reach mesh"
          detail={detail}
        />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Tip: try a URL containing the word <span className="font-mono">fail</span> to see the failure state.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          disabled={!canContinue}
          onClick={() =>
            meshInfo &&
            onContinue({
              url: url.trim(),
              meshName: meshInfo.name,
              nodeCount: meshInfo.nodeCount,
            })
          }
          className="gap-2"
        >
          Continue to authentication
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
