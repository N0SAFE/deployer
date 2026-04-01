'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { RequirePlatformRole } from '@/components/auth/RequirePlatformRole'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { useCreateOrganization } from '@/domains/organization/hooks'
import { useConnectMeshPeer } from '@/domains/mesh/hooks'
import {
  buildMeshEndpointUrl,
  buildRemoteSignInUrl,
  detectRemoteServer,
  fetchRemoteAuthSession,
  normalizeServerHttpUrl,
} from '@/domains/mesh/connect-flow'
import { toast } from 'sonner'
import { Network, PlusCircle, ShieldAlert } from 'lucide-react'

type ProvisioningMode = 'prompt' | 'local' | 'connect'

export default function CreateOrganizationPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { mutate: createOrganization, isPending } = useCreateOrganization()
  const connectPeer = useConnectMeshPeer()

  const [mode, setMode] = useState<ProvisioningMode>('prompt')
  const [remoteServerUrl, setRemoteServerUrl] = useState('')
  const [handshakeInProgress, setHandshakeInProgress] = useState(false)
  
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    createOrganization({
      name: formData.name,
      slug: formData.slug,
    }, {
      onSuccess: (organization) => {
        router.push(`/dashboard/admin/organizations/${organization.id}`)
      }
    })
  }

  const callbackHandshakeUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return null
    }

    const current = new URL(window.location.href)
    current.searchParams.delete('meshAuthReturn')
    current.searchParams.delete('meshServer')
    return current
  }, [])

  useEffect(() => {
    const shouldFinalize = searchParams.get('meshAuthReturn') === '1'
    const rawServer = searchParams.get('meshServer')

    if (!shouldFinalize || !rawServer || handshakeInProgress) {
      return
    }

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
          metadata: {
            authFlow: 'remote-signin-handoff',
            source: 'org-provisioning',
          },
        })

        if (!cancelled) {
          toast.success('Connected to remote server with authenticated session handoff.')
          router.replace('/dashboard/admin/servers')
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Unknown remote session handoff error'
          toast.error(`Unable to complete remote connect flow: ${message}`)
          router.replace('/dashboard/admin/organizations/new')
        }
      } finally {
        if (!cancelled) {
          setHandshakeInProgress(false)
        }
      }
    }

    void finalizeHandshake()

    return () => {
      cancelled = true
    }
  }, [connectPeer, handshakeInProgress, router, searchParams])

  const handleConnectServer = async () => {
    const serverHttpUrl = remoteServerUrl.trim()
    if (!serverHttpUrl) {
      toast.error('Remote server URL is required')
      return
    }

    try {
      const normalizedServerUrl = normalizeServerHttpUrl(serverHttpUrl)
      await detectRemoteServer(normalizedServerUrl)

      if (!callbackHandshakeUrl) {
        throw new Error('Unable to build callback URL in current environment')
      }

      callbackHandshakeUrl.searchParams.set('meshAuthReturn', '1')
      callbackHandshakeUrl.searchParams.set('meshServer', normalizedServerUrl)

      toast.success('Remote server detected. Redirecting to remote login...')
      window.location.assign(buildRemoteSignInUrl(normalizedServerUrl, callbackHandshakeUrl.toString()))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown server connection error'
      toast.error(`Failed to start remote connect flow: ${message}`)
    }
  }

  return (
    <RequirePlatformRole
      roles={['admin', 'superAdmin']}
      fallback={
        <div className="space-y-6">
          <h1 className="text-3xl font-bold tracking-tight">Create Organization</h1>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <ShieldAlert className="h-5 w-5" />
                Admin access required
              </CardTitle>
              <CardDescription>
                Only admins of this server instance can create or attach organizations.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      }
    >
      <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Create Organization</h1>
        <p className="text-muted-foreground mt-2">Set up a new organization to manage your team and projects</p>
      </div>

      {mode === 'prompt' ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>How do you want to provision this organization?</CardTitle>
            <CardDescription>
              Choose local creation on this server or connect this server to an existing remote instance.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Button
              variant="outline"
              className="h-auto py-6 flex flex-col items-start gap-2"
              onClick={() => { setMode('local') }}
            >
              <span className="flex items-center gap-2 text-base font-semibold">
                <PlusCircle className="h-4 w-4" />
                Create new local org
              </span>
              <span className="text-left text-xs text-muted-foreground">
                Create and host this organization on the current server instance.
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-6 flex flex-col items-start gap-2"
              onClick={() => { setMode('connect') }}
            >
              <span className="flex items-center gap-2 text-base font-semibold">
                <Network className="h-4 w-4" />
                Connect to existing server
              </span>
              <span className="text-left text-xs text-muted-foreground">
                Link this instance to an existing remote server/org topology.
              </span>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {mode === 'connect' ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Connect this server to an existing instance</CardTitle>
            <CardDescription>
              Provide remote mesh endpoint URL only. Peer identity is resolved during handshake/login.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="remoteServerUrl">Remote server mesh URL *</Label>
              <Input
                id="remoteServerUrl"
                value={remoteServerUrl}
                onChange={(e) => { setRemoteServerUrl(e.target.value) }}
                placeholder="http://server-b:3000"
                disabled={connectPeer.isPending || handshakeInProgress}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => { void handleConnectServer() }} disabled={connectPeer.isPending || handshakeInProgress}>
                {connectPeer.isPending || handshakeInProgress ? 'Starting handshake...' : 'Connect server'}
              </Button>
              <Button variant="outline" onClick={() => { setMode('prompt') }} disabled={connectPeer.isPending || handshakeInProgress}>
                Back
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Form Card */}
      {mode === 'local' ? (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Organization Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <Label htmlFor="name">Organization Name *</Label>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Acme Corporation"
                required
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground mt-1">This is your organization&apos;s display name</p>
            </div>

            <div>
              <Label htmlFor="slug">Organization Slug *</Label>
              <Input
                id="slug"
                name="slug"
                value={formData.slug}
                onChange={handleChange}
                placeholder="acme-corp"
                required
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground mt-1">Used in URLs (e.g., /org/acme-corp)</p>
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="What does your organization do?"
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground mt-1">Optional brief description of your organization</p>
            </div>

            <div className="flex gap-2 pt-4">
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Creating...' : 'Create Organization'}
              </Button>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => { router.back() }}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setMode('prompt') }}
                disabled={isPending}
              >
                Change provisioning mode
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      ) : null}
    </div>
    </RequirePlatformRole>
  )
}
