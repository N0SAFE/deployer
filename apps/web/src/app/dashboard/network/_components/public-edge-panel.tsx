'use client'

import { useMemo, useState } from 'react'
import { Globe, Pencil, Power, Trash2, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Checkbox } from '@repo/ui/components/shadcn/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/shadcn/dialog'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { cn } from '@repo/ui/lib/utils'
import type {
  EdgeOptionField,
  EdgeOptions,
  EdgeProviderDescriptor,
  IngressState,
} from '@repo/api-contracts/modules/reachability/index'
import { useDNSProviders } from '@/domains/dns-providers/hooks'
import { useTeardownPublicEdge, useUpdateIngress } from '@/domains/reachability/hooks'
import { AuthDashboardAdminProvidersDns } from '@/routes'
import { EdgeHealthBadge, KindBadge, Mono } from './network-copy'
import { useNetworkAction } from './use-network-action'

/**
 * The public lane — rendered ENTIRELY from the provider catalog the API sends
 * (`edge.providers`). The page knows no provider by name: a new edge plugin
 * registered in the API shows up here, with its options form, without a change
 * to this file. That is the contract that keeps the edge pluggable end to end.
 */
export function PublicEdgePanel({ ingress, canEdit }: { ingress: IngressState; canEdit: boolean }) {
  const [editing, setEditing] = useState(false)
  const [confirmTeardown, setConfirmTeardown] = useState(false)
  const update = useUpdateIngress()
  const teardown = useTeardownPublicEdge()
  const { run } = useNetworkAction()

  const lane = ingress.lanes.public
  const active = ingress.edge.active

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2">
            <Globe className="size-4" />
            Public lane
          </CardTitle>
          <CardDescription>
            The internet, carried by ONE edge provider for the whole stack. Only routes marked public ride it.
          </CardDescription>
        </div>
        {canEdit && !editing ? (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" onClick={() => { setEditing(true); }}>
              <Pencil className="size-4" />
              {lane === null ? 'Turn on' : 'Change'}
            </Button>
            {lane !== null ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={update.isPending}
                  onClick={() => void run('Public lane turned off', () => update.mutateAsync({ public: null }))}
                >
                  <Power className="size-4" />
                  Turn off
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setConfirmTeardown(true); }}>
                  <Trash2 className="size-4" />
                  Tear down
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {editing ? (
          <EdgeEditor ingress={ingress} onDone={() => { setEditing(false); }} />
        ) : lane === null || active === null ? (
          <p className="text-sm text-muted-foreground">
            Off — nothing about this stack is on the internet. Apps are reachable on the local lane
            {ingress.lanes.private.enabled ? ' and from mesh members on the private lane' : ''}.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{active.provider?.label ?? active.providerId}</span>
              {active.provider !== null ? <KindBadge kind={active.provider.kind} /> : null}
              <EdgeHealthBadge health={active.status.health} />
              {active.status.provisioned ? null : <Badge variant="outline">not provisioned</Badge>}
            </div>
            <div className="text-sm">
              Serves <Mono>{`*.${lane.domain}`}</Mono>
            </div>
            {active.status.detail !== null ? (
              <Alert variant={active.status.health === 'down' ? 'destructive' : 'default'}>
                <TriangleAlert className="size-4" />
                <AlertTitle>{active.status.provisioned ? 'Attention' : 'Not ready yet'}</AlertTitle>
                <AlertDescription>{active.status.detail}</AlertDescription>
              </Alert>
            ) : null}
            {active.status.facts.length > 0 ? (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {active.status.facts.map((fact) => (
                  <div key={fact.label} className="flex flex-col">
                    <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                    <dd className="break-all">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        )}
      </CardContent>

      <Dialog open={confirmTeardown} onOpenChange={setConfirmTeardown}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tear down the public edge?</DialogTitle>
            <DialogDescription>
              {active?.provider?.label ?? 'The provider'} deletes what it created for this stack (a tunnel and its routing, for
              example), its DNS records are removed, and the public lane turns off. To only stop serving publicly and keep
              the edge for later, use “Turn off” instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmTeardown(false); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={teardown.isPending}
              onClick={() =>
                void run('Public edge torn down', () => teardown.mutateAsync({})).then((ok) => {
                  if (ok) setConfirmTeardown(false)
                })
              }
            >
              Tear down
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function initialOptions(descriptor: EdgeProviderDescriptor, current: EdgeOptions | null): EdgeOptions {
  const options: EdgeOptions = {}
  for (const field of descriptor.options) {
    const value = current?.[field.key]
    options[field.key] = value ?? (field.type === 'boolean' ? field.defaultValue : '')
  }
  return options
}

function EdgeEditor({ ingress, onDone }: { ingress: IngressState; onDone: () => void }) {
  const providers = ingress.edge.providers
  const current = ingress.lanes.public
  const update = useUpdateIngress()
  const { run } = useNetworkAction()

  const [providerId, setProviderId] = useState(current?.provider ?? providers[0]?.id ?? '')
  const descriptor = providers.find((provider) => provider.id === providerId) ?? null
  const [domain, setDomain] = useState(current?.domain ?? '')
  const [optionsByProvider, setOptionsByProvider] = useState<Record<string, EdgeOptions>>(() =>
    Object.fromEntries(providers.map((provider) => [provider.id, initialOptions(provider, current?.provider === provider.id ? current.options : null)])),
  )
  const [acknowledged, setAcknowledged] = useState(current?.acknowledgedInboundPorts ?? false)

  const options = optionsByProvider[providerId] ?? {}
  const setOption = (key: string, value: EdgeOptions[string]) => { setOptionsByProvider((all) => ({ ...all, [providerId]: { ...(all[providerId] ?? {}), [key]: value } })); }

  const missingRequired =
    descriptor?.options.some((field) => field.type !== 'boolean' && field.required && (options[field.key] ?? '') === '') ?? true
  const blocked = descriptor === null || domain.trim() === '' || missingRequired || (descriptor.opensInboundPorts && !acknowledged)

  const save = async () => {
    if (descriptor === null) return
    const ok = await run(`Public lane now served by ${descriptor.label}`, () =>
      update.mutateAsync({
        public: {
          provider: descriptor.id,
          domain: domain.trim().toLowerCase(),
          acknowledgedInboundPorts: descriptor.opensInboundPorts && acknowledged,
          // Empty text means "unset": the API treats a missing optional option as null.
          options: Object.fromEntries(Object.entries(options).filter(([, value]) => value !== '')),
        },
      }),
    )
    if (ok) onDone()
  }

  if (providers.length === 0) {
    return <p className="text-sm text-muted-foreground">No edge provider is available on this API.</p>
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label>Edge provider</Label>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2" role="radiogroup">
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              role="radio"
              aria-checked={provider.id === providerId}
              onClick={() => { setProviderId(provider.id); }}
              className={cn(
                'flex flex-col gap-1 rounded-md border p-3 text-left transition-colors',
                provider.id === providerId ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{provider.label}</span>
                <KindBadge kind={provider.kind} />
              </div>
              <span className="text-sm text-muted-foreground">{provider.summary}</span>
              <div className="flex flex-wrap gap-1 pt-1">
                {provider.opensInboundPorts ? <Badge variant="destructive">opens inbound ports</Badge> : <Badge variant="secondary">no inbound port</Badge>}
                {provider.usesProviderAccount ? <Badge variant="outline">needs an account</Badge> : null}
                {provider.servesHttps ? <Badge variant="outline">HTTPS</Badge> : null}
              </div>
            </button>
          ))}
        </div>
        {descriptor !== null ? <p className="text-sm text-muted-foreground">{descriptor.description}</p> : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="edge-domain">Public domain</Label>
        <Input id="edge-domain" value={domain} onChange={(event) => { setDomain(event.target.value); }} placeholder="apps.example.com" />
        <p className="text-xs text-muted-foreground">
          Apps are published as <Mono>{`<app>.${domain.trim() === '' ? 'apps.example.com' : domain.trim()}`}</Mono>; the edge serves the
          whole wildcard, so adding an app never touches the provider.
        </p>
      </div>

      {descriptor?.options.map((field) => (
        <EdgeOptionInput key={`${descriptor.id}:${field.key}`} field={field} value={options[field.key] ?? null} onChange={(value) => { setOption(field.key, value); }} />
      ))}

      {descriptor?.opensInboundPorts === true ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>This edge opens inbound ports on every node</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            Every node will accept connections from the internet on the ports this edge needs. Every other lane works with
            no open port at all.
            <label className="flex items-center gap-2 text-foreground">
              <Checkbox checked={acknowledged} onCheckedChange={(checked) => { setAcknowledged(checked === true); }} />
              I understand and want the nodes to open these ports.
            </label>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={blocked || update.isPending} onClick={() => void save()}>
          {update.isPending ? 'Provisioning…' : 'Save public lane'}
        </Button>
      </div>
    </div>
  )
}

/** One provider option, rendered from its descriptor field. */
function EdgeOptionInput({
  field,
  value,
  onChange,
}: {
  field: EdgeOptionField
  value: EdgeOptions[string] | null
  onChange: (value: EdgeOptions[string]) => void
}) {
  if (field.type === 'boolean') {
    return (
      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor={`edge-opt-${field.key}`}>{field.label}</Label>
          {field.description !== null ? <span className="text-xs text-muted-foreground">{field.description}</span> : null}
        </div>
        <Switch id={`edge-opt-${field.key}`} checked={value === true} onCheckedChange={(checked) => { onChange(checked); }} />
      </div>
    )
  }
  if (field.type === 'text') {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={`edge-opt-${field.key}`}>
          {field.label}
          {field.required ? '' : ' (optional)'}
        </Label>
        <Input
          id={`edge-opt-${field.key}`}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder ?? undefined}
          onChange={(event) => { onChange(event.target.value); }}
        />
        {field.description !== null ? <span className="text-xs text-muted-foreground">{field.description}</span> : null}
      </div>
    )
  }
  return <DnsAccountInput field={field} value={typeof value === 'string' ? value : ''} onChange={onChange} />
}

function DnsAccountInput({
  field,
  value,
  onChange,
}: {
  field: Extract<EdgeOptionField, { type: 'dns-account' }>
  value: string
  onChange: (value: string) => void
}) {
  const { data } = useDNSProviders()
  const accounts = useMemo(
    () =>
      (data?.providers ?? []).filter((account) => {
        if (account.providerType !== field.providerType || !account.isActive) return false
        if (field.requiredFeature === null) return true
        const features = account.features as Record<string, unknown> | null | undefined
        return features?.[field.requiredFeature] === true
      }),
    [data, field.providerType, field.requiredFeature],
  )
  return (
    <div className="flex flex-col gap-2">
      <Label>{field.label}</Label>
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active {field.providerType} account
          {field.requiredFeature === null ? '' : ` with ${field.requiredFeature} enabled`} yet.{' '}
          <AuthDashboardAdminProvidersDns.Link className="underline">Add one under DNS providers</AuthDashboardAdminProvidersDns.Link>.
        </p>
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Choose an account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {field.description !== null ? <span className="text-xs text-muted-foreground">{field.description}</span> : null}
    </div>
  )
}
