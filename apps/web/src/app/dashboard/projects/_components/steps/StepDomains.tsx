'use client'

import { Field } from '@repo/ui/components/shadcn/field'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Globe, ShieldCheck, Cloud, Rocket, Loader2, Plus, CheckCircle2, XCircle, Radio } from 'lucide-react'
import { useDNSProviders } from '@/domains/dns-providers/hooks'
import { AuthDashboardAdminDomains } from '@/routes'
import type { CreateServiceFormApi } from '../CreateService.hook'
import { DomainPicker } from '../DomainPicker'
import { ServiceDomainConfig } from '../ServiceDomainConfig'

const PROVIDER_LABELS: Record<string, string> = {
  cloudflare: 'Cloudflare',
  route53: 'AWS Route53',
  'google-dns': 'Google Cloud DNS',
  digitalocean: 'DigitalOcean',
  other: 'Other',
}

const PROVIDER_COLORS: Record<string, string> = {
  cloudflare: 'text-orange-500',
  route53: 'text-amber-500',
  'google-dns': 'text-blue-500',
  digitalocean: 'text-sky-500',
  other: 'text-muted-foreground',
}

/** DNS providers status card — shows configured providers + their capabilities. */
function DnsProvidersCard() {
  const { data, isLoading } = useDNSProviders()
  const providers = data?.providers ?? []

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Cloud className="size-4" /> DNS providers
        </CardTitle>
        <CardDescription className="text-xs">
          The DNS providers connected to your account. Providers with DNS management can
          auto-verify domains and create records; tunnel-capable providers can expose
          services without a public IP.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading providers…
          </div>
        ) : providers.length === 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              No DNS provider connected. Connect one to auto-verify domains and create DNS records.
            </p>
            <AuthDashboardAdminDomains.Link>
              <Button type="button" size="sm" variant="outline" className="h-7 w-fit gap-1.5 text-xs">
                <Plus className="size-3.5" /> Connect a DNS provider
              </Button>
            </AuthDashboardAdminDomains.Link>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {providers.map((p) => (
              <div key={p.id} className="flex items-start justify-between gap-2 rounded-lg border p-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Cloud className={PROVIDER_COLORS[p.providerType] ?? 'text-muted-foreground'} />
                    <span className="truncate text-xs font-medium">{PROVIDER_LABELS[p.providerType] ?? p.providerType}</span>
                    {p.state?.status === 'ok'
                      ? <CheckCircle2 className="size-3.5 text-emerald-500" />
                      : p.state?.status === 'error'
                        ? <XCircle className="size-3.5 text-destructive" />
                        : <Radio className="size-3.5 text-muted-foreground" />}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{p.name}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {p.features.dnsManagement && <Badge variant="outline" className="text-[10px]">DNS mgmt</Badge>}
                  {p.features.tunnelManagement && <Badge variant="outline" className="text-[10px] text-primary">Tunnels</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
        {providers.some((p) => p.features.tunnelManagement) && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Rocket className="size-3" /> A tunnel-capable provider is connected — services can be exposed via tunnel without a public IP.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Step 7 — Domains. Modern domain & subdomain configuration: DNS provider
 * status, custom domains, and subdomain/base-path/SSL bindings with tunnels.
 *
 * HIERARCHY: when the runner is an orchestrator that owns sub-services, the
 * orchestrator shell itself has no domains — each sub-service configures its
 * own custom domains in the Runner step. This step then only surfaces the
 * DNS provider status + a redirect note.
 */
export function StepDomains({ form, projectId }: { form: CreateServiceFormApi; projectId: string }) {
  return (
    <form.Subscribe
      selector={(s) => ({
        runnerId: s.values.runner.runnerId,
        subServiceCount: s.values.runner.runnerId === 'orchestrator'
          ? ((s.values.runner.config as { subServices?: unknown[] }).subServices ?? []).length
          : 0,
      })}
      children={({ runnerId, subServiceCount }) => {
        const orchestratorWithSubs = runnerId === 'orchestrator' && subServiceCount > 0
        return (
          <div className="space-y-4">
            <DnsProvidersCard />

            {orchestratorWithSubs ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Globe className="size-4" /> Domains are per sub-service
                  </CardTitle>
                  <CardDescription className="text-xs">
                    This orchestrator owns <strong>{String(subServiceCount)} sub-service(s)</strong>.
                    Custom domains and routing are configured inside each sub-service in the
                    Runner step — the orchestrator shell itself has no domain.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : (<>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Globe className="size-4" /> Custom domains
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Attach one or more registered project domains to this service.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form.Field name="network.customDomains" children={(f) => (
                    <Field>
                      <DomainPicker projectId={projectId} value={(f.state.value as never as string[] | undefined) ?? []} onChange={(next) => { f.handleChange(next) }} />
                    </Field>
                  )} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ShieldCheck className="size-4" /> Subdomain &amp; routing
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Expose this service on a configured domain: pick a domain, choose a subdomain
                    (constrained by the domain&apos;s configuration) and a base path. Enable SSL per binding.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form.Field name="network.domainEntries" children={(f) => (
                    <Field>
                      <ServiceDomainConfig
                        projectId={projectId}
                        value={f.state.value ?? []}
                        onChange={(next) => { f.handleChange(next) }}
                      />
                    </Field>
                  )} />
                </CardContent>
              </Card>
            </>)}
          </div>
        )
      }}
    />
  )
}
