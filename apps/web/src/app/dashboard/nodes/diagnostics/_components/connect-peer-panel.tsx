'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { PlugZap } from 'lucide-react'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { useConnectMeshPeer } from '@/domains/mesh/hooks'
import {
  buildMeshEndpointUrl,
  buildRemoteSignInUrl,
  detectRemoteServer,
  fetchRemoteAuthSession,
  normalizeServerHttpUrl,
} from '@/domains/mesh/connect-flow'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import { AuthDashboardNodesDiagnostics } from '@/routes'

function errorText(error: unknown, fallback: string): string {
  return isDefinedORPCError(error) ? getErrorMessage(error) : fallback
}

/**
 * Link another instance as a control-mesh peer.
 *
 * HTTP-first: detect the remote server, send the operator to its login, then
 * come back to THIS page (`meshAuthReturn` / `meshServer` query params) to finish
 * the authenticated handoff.
 */
export function ConnectPeerPanel() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const connectPeer = useConnectMeshPeer()
  const [serverUrl, setServerUrl] = useState('')
  const [handshakeInProgress, setHandshakeInProgress] = useState(false)

  const callbackHandshakeUrl = useMemo(() => {
    if (typeof window === 'undefined') return null
    const current = new URL(window.location.href)
    current.searchParams.delete('meshAuthReturn')
    current.searchParams.delete('meshServer')
    return current
  }, [])

  useEffect(() => {
    const shouldFinalize = searchParams.get('meshAuthReturn') === '1'
    const rawServer = searchParams.get('meshServer')
    if (!shouldFinalize || !rawServer || handshakeInProgress) return

    let cancelled = false
    const finalizeHandshake = async () => {
      setHandshakeInProgress(true)
      try {
        const normalizedServerUrl = normalizeServerHttpUrl(rawServer)
        const remoteAuthSession = await fetchRemoteAuthSession(normalizedServerUrl)
        await connectPeer.mutateAsync({
          serverUrl: normalizedServerUrl,
          endpointUrl: buildMeshEndpointUrl(normalizedServerUrl),
          remoteAuthSession,
          metadata: { authFlow: 'remote-signin-handoff' },
        })
        if (!cancelled) {
          toast.success('Remote session retrieved and peer connection requested with authenticated context.')
          router.replace(AuthDashboardNodesDiagnostics())
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(`Unable to complete remote auth handoff: ${errorText(error, 'Unknown mesh auth handoff error')}`)
          router.replace(AuthDashboardNodesDiagnostics())
        }
      } finally {
        if (!cancelled) setHandshakeInProgress(false)
      }
    }
    void finalizeHandshake()
    return () => {
      cancelled = true
    }
  }, [connectPeer, handshakeInProgress, router, searchParams])

  const handleConnectPeer = async () => {
    const trimmed = serverUrl.trim()
    if (!trimmed) {
      toast.error('HTTP server URL is required to connect a peer')
      return
    }
    try {
      const normalizedServerUrl = normalizeServerHttpUrl(trimmed)
      await detectRemoteServer(normalizedServerUrl)
      if (!callbackHandshakeUrl) throw new Error('Unable to build callback URL in current environment')
      callbackHandshakeUrl.searchParams.set('meshAuthReturn', '1')
      callbackHandshakeUrl.searchParams.set('meshServer', normalizedServerUrl)
      toast.success('Remote server detected. Redirecting to remote login...')
      window.location.assign(buildRemoteSignInUrl(normalizedServerUrl, callbackHandshakeUrl.toString()))
    } catch (error) {
      toast.error(`Failed to start remote auth handshake: ${errorText(error, 'Unknown mesh connect preflight error')}`)
    }
  }

  const busy = connectPeer.isPending || handshakeInProgress

  return (
    <div className="rounded-xl border border-border/60 bg-card/30 p-4">
      <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,2fr)_auto_minmax(0,3fr)]">
        <div className="space-y-1">
          <Label htmlFor="peer-url" className="text-xs text-muted-foreground">Link another instance</Label>
          <Input id="peer-url" placeholder="Server URL, e.g. http://server-b:3000" value={serverUrl} onChange={(e) => { setServerUrl(e.target.value) }} />
        </div>
        <Button type="button" className="gap-2" disabled={busy} onClick={() => { void handleConnectPeer() }}>
          <PlugZap className="size-4" />
          {busy ? 'Starting handshake…' : 'Connect peer'}
        </Button>
        <p className="text-xs text-muted-foreground">
          The platform detects the server, sends you to its login, then completes an authenticated handoff and returns here.
        </p>
      </div>
    </div>
  )
}
