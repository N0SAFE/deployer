'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
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
import { zodFieldErrors } from '@/lib/forms/zod-field-errors'
import { toast } from 'sonner'
import { Network, PlusCircle, ShieldAlert } from 'lucide-react'

type ProvisioningMode = 'prompt' | 'local' | 'connect'

const localOrganizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  slug: z.string().min(1, 'Organization slug is required'),
  description: z.string().optional(),
})

const remoteConnectSchema = z.object({
  remoteServerUrl: z.string().min(1, 'Remote server URL is required'),
})

export default function CreateOrganizationPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { mutate: createOrganization, isPending } = useCreateOrganization()
  const connectPeer = useConnectMeshPeer()

  const [mode, setMode] = useState<ProvisioningMode>('prompt')
  const [handshakeInProgress, setHandshakeInProgress] = useState(false)

  const [localFormErrors, setLocalFormErrors] = useState<Partial<Record<keyof z.infer<typeof localOrganizationSchema>, string>>>({})
  const [connectFormErrors, setConnectFormErrors] = useState<Partial<Record<keyof z.infer<typeof remoteConnectSchema>, string>>>({})

  const localForm = useForm({
    defaultValues: {
      name: '',
      slug: '',
      description: '',
    },
    onSubmit: ({ value }) => {
      setLocalFormErrors({})

      const parsed = localOrganizationSchema.safeParse(value)
      if (!parsed.success) {
        setLocalFormErrors(zodFieldErrors(parsed.error))
        return
      }

      createOrganization(
        {
          name: parsed.data.name,
          slug: parsed.data.slug,
        },
        {
          onSuccess: (organization) => {
            router.push(`/dashboard/admin/organizations/${organization.id}`)
          },
        },
      )
    },
  })

  const connectForm = useForm({
    defaultValues: {
      remoteServerUrl: '',
    },
    onSubmit: async ({ value }) => {
      setConnectFormErrors({})

      const parsed = remoteConnectSchema.safeParse(value)
      if (!parsed.success) {
        setConnectFormErrors(zodFieldErrors(parsed.error))
        return
      }

      await handleConnectServer(parsed.data.remoteServerUrl)
    },
  })

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

  async function handleConnectServer(remoteServerUrl: string) {
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
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void connectForm.handleSubmit()
              }}
            >
              <connectForm.Field name="remoteServerUrl">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="remoteServerUrl">Remote server mesh URL *</Label>
                    <Input
                      id="remoteServerUrl"
                      value={field.state.value}
                      onChange={(event) => {
                        setConnectFormErrors((previous) => {
                          if (!previous.remoteServerUrl) return previous
                          return { ...previous, remoteServerUrl: undefined }
                        })
                        field.handleChange(event.target.value)
                      }}
                      placeholder="http://server-b:3000"
                      disabled={connectPeer.isPending || handshakeInProgress}
                    />
                    {connectFormErrors.remoteServerUrl ? (
                      <p className="text-sm font-medium text-destructive">{connectFormErrors.remoteServerUrl}</p>
                    ) : null}
                  </div>
                )}
              </connectForm.Field>

              <div className="flex gap-2">
                <Button type="submit" disabled={connectPeer.isPending || handshakeInProgress}>
                  {connectPeer.isPending || handshakeInProgress ? 'Starting handshake...' : 'Connect server'}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setMode('prompt') }} disabled={connectPeer.isPending || handshakeInProgress}>
                  Back
                </Button>
              </div>
            </form>
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
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void localForm.handleSubmit()
            }}
            className="space-y-6"
          >
            <localForm.Field name="name">
              {(field) => (
                <div>
                  <Label htmlFor="name">Organization Name *</Label>
                  <Input
                    id="name"
                    value={field.state.value}
                    onChange={(event) => {
                      setLocalFormErrors((previous) => {
                        if (!previous.name) return previous
                        return { ...previous, name: undefined }
                      })
                      field.handleChange(event.target.value)
                    }}
                    placeholder="Acme Corporation"
                    disabled={isPending}
                  />
                  {localFormErrors.name ? (
                    <p className="mt-1 text-sm font-medium text-destructive">{localFormErrors.name}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground mt-1">This is your organization&apos;s display name</p>
                </div>
              )}
            </localForm.Field>

            <localForm.Field name="slug">
              {(field) => (
                <div>
                  <Label htmlFor="slug">Organization Slug *</Label>
                  <Input
                    id="slug"
                    value={field.state.value}
                    onChange={(event) => {
                      setLocalFormErrors((previous) => {
                        if (!previous.slug) return previous
                        return { ...previous, slug: undefined }
                      })
                      field.handleChange(event.target.value)
                    }}
                    placeholder="acme-corp"
                    disabled={isPending}
                  />
                  {localFormErrors.slug ? (
                    <p className="mt-1 text-sm font-medium text-destructive">{localFormErrors.slug}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground mt-1">Used in URLs (e.g., /org/acme-corp)</p>
                </div>
              )}
            </localForm.Field>

            <localForm.Field name="description">
              {(field) => (
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    value={field.state.value}
                    onChange={(event) => {
                      setLocalFormErrors((previous) => {
                        if (!previous.description) return previous
                        return { ...previous, description: undefined }
                      })
                      field.handleChange(event.target.value)
                    }}
                    placeholder="What does your organization do?"
                    disabled={isPending}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Optional brief description of your organization</p>
                </div>
              )}
            </localForm.Field>

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
