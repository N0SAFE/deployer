'use client'

import type { ReactNode } from 'react'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Sparkles, Globe, Layers, Rocket, Server, GitBranch, Package, KeyRound, Activity, Lock } from 'lucide-react'
import { useProjectDomains } from '@/domains/domain/hooks'
import type { CreateServiceFormApi } from '../CreateService.hook'
import { ReviewSubServiceCard, type SubServiceSummary } from './review/ReviewSubServiceCard'
import { describeBinding, describeTls, describeVisibility, serviceTypeFor, stringifyValue, type DomainBindingInput, type TlsInput } from './review/review-helpers'

/* ─── Small helpers ────────────────────────────────────────────────── */

/** Label/value row inside a section. */
function Row({ label, value, defaultVal }: { label: string; value: unknown; defaultVal?: unknown }) {
  const display = value ?? defaultVal ?? '—'
  return (
    <div className="flex items-start justify-between gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right font-medium">{stringifyValue(display)}</span>
    </div>
  )
}

function ReviewSection({ title, icon, badge, children }: {
  title: string
  icon?: ReactNode
  badge?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2 rounded-lg border bg-background/40 p-3.5">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}{title}
        {badge ? <Badge variant="outline" className="ml-auto text-xs">{badge}</Badge> : null}
      </h4>
      {children}
    </div>
  )
}

/** Names (never values) of a key/value record, so secrets are not echoed back. */
function KeyList({ label, keys }: { label: string; keys: string[] }) {
  if (keys.length === 0) return null
  return (
    <div className="mt-2 border-t pt-2">
      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <KeyRound className="size-3" /> {label} ({String(keys.length)})
      </p>
      <p className="mt-1 break-words font-mono text-xs">{keys.join(', ')}</p>
    </div>
  )
}

interface ReviewValues {
  basicInfo: { name: string; type?: string; description?: string; tags?: string[] }
  provider: { providerId: string; config: Record<string, unknown> }
  runner: {
    runnerId: string
    build: {
      method?: string
      rootPath?: string
      buildContext?: string
      dockerfilePath?: string
      composeFile?: string
      buildCommand?: string
      runCommand?: string
    }
    config: Record<string, unknown>
  }
  network: {
    port?: number
    visibility?: 'private' | 'public'
    tls?: TlsInput
    healthCheck: { type: string; interval?: number; timeout?: number; retries?: number; path?: string; port?: number; command?: string }
    customDomains?: string[]
    domainEntries?: DomainBindingInput[]
  }
  advanced: { resourceLimits?: { memory?: string; cpu?: string }; environmentVariables?: { key: string; value: string }[] }
}

/* ─── Main step ────────────────────────────────────────────────────── */

/**
 * Step 9 — Review. Summarises exactly what Create service will send:
 * source, build, runner, network exposure (visibility, TLS, domains) and
 * environment. Env var VALUES are never printed, only their names.
 */
export function StepReview({ form, projectId }: { form: CreateServiceFormApi; projectId?: string }) {
  const domainsQuery = useProjectDomains(projectId ?? '')
  const domainNameById = new Map((domainsQuery.data ?? []).map((d) => [d.id, d.domain]))

  return (
    <form.Subscribe selector={(s) => s.values} children={(rawValues) => {
      const v = rawValues as unknown as ReviewValues
      const { basicInfo: basic, provider, runner, network, advanced } = v
      const pc = provider.config
      const rc = runner.config
      const build = runner.build
      const isGit = ['github', 'gitlab', 'bitbucket'].includes(provider.providerId)
      const hasBuildFields = build.method !== 'external'
      const subServices = (Array.isArray(rc.subServices) ? rc.subServices : []) as SubServiceSummary[]
      const isOrchestrator = runner.runnerId === 'orchestrator'
      const perSubService = isOrchestrator && subServices.length > 0
      const hc = network.healthCheck
      const runnerEnvKeys = rc.environment && typeof rc.environment === 'object' ? Object.keys(rc.environment) : []
      const platformEnvKeys = (advanced.environmentVariables ?? []).map((e) => e.key).filter(Boolean)
      const customDomains = network.customDomains ?? []
      const bindings = network.domainEntries ?? []

      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Check what will be created. Use Back to change anything; nothing is deployed until you confirm.
          </p>

          {/* ── Header ── */}
          <div className="rounded-lg border bg-linear-to-br from-primary/5 to-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold">{basic.name || 'Unnamed service'}</h3>
                {basic.description ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{basic.description}</p> : null}
              </div>
              <Badge variant="secondary" className="shrink-0 text-xs capitalize">{serviceTypeFor(runner.runnerId)}</Badge>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Badge variant="outline" className="gap-1 text-xs"><GitBranch className="size-3" /> {provider.providerId}</Badge>
              <Badge variant="outline" className="gap-1 text-xs"><Rocket className="size-3" /> {runner.runnerId}</Badge>
              <Badge variant="outline" className="gap-1 text-xs"><Package className="size-3" /> {stringifyValue(build.method ?? 'auto')}</Badge>
              {basic.tags?.map((t) => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}
            </div>
          </div>

          {/* ── Source ── */}
          <ReviewSection title={`Source — ${provider.providerId}`} icon={<GitBranch className="size-3.5" />}>
            <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
              {Boolean(pc.providerAppId) && <Row label="GitHub App" value={pc.providerAppId} />}
              <Row label="URL" value={pc.sourceUrl} />
              {isGit && <Row label="Branch" value={pc.branch} defaultVal="main" />}
              <Row label="Auth secret" value={pc.authSecretRef} defaultVal="default" />
              {isGit && <><Row label="Auto-sync on push" value={pc.autoSyncEnabled ? 'Yes' : 'No'} /><Row label="Webhook" value={pc.webhookEnabled ? 'Registered' : 'Not registered'} /></>}
            </div>
          </ReviewSection>

          {/* ── Build ── */}
          <ReviewSection title={`Build — ${stringifyValue(build.method ?? 'auto')}`} icon={<Package className="size-3.5" />}>
            {hasBuildFields ? (
              <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                <Row label="Root path" value={build.rootPath} defaultVal="/" />
                <Row label="Build context" value={build.buildContext} defaultVal="." />
                {build.dockerfilePath ? <Row label="Dockerfile" value={build.dockerfilePath} /> : null}
                {build.composeFile ? <Row label="Compose" value={build.composeFile} /> : null}
                {build.buildCommand ? <Row label="Build command" value={build.buildCommand} /> : null}
                {build.runCommand ? <Row label="Run command" value={build.runCommand} /> : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Prebuilt image: nothing is built on the node.</p>
            )}
          </ReviewSection>

          {/* ── Runner ── */}
          <ReviewSection title={`Runner — ${runner.runnerId}`} icon={<Server className="size-3.5" />} badge={isOrchestrator ? `${String(subServices.length)} sub-service${subServices.length === 1 ? '' : 's'}` : undefined}>
            <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
              {'startCommand' in rc && <Row label="Start command" value={rc.startCommand} />}
              {'ports' in rc && <Row label="Ports" value={rc.ports} />}
              {'strategy' in rc && <Row label="Rollout strategy" value={rc.strategy} />}
              {'networkMode' in rc && <Row label="Network mode" value={rc.networkMode} />}
              {'gracefulShutdownSeconds' in rc && <Row label="Graceful shutdown (s)" value={rc.gracefulShutdownSeconds} defaultVal={30} />}
              {'composeFile' in rc && <Row label="Compose file" value={rc.composeFile} />}
              {'profiles' in rc && <Row label="Profiles" value={rc.profiles} />}
              {'namespace' in rc && <Row label="Namespace" value={rc.namespace} />}
              {'deploymentName' in rc && <Row label="Deployment" value={rc.deploymentName} />}
              {'replicas' in rc && <Row label="Replicas" value={rc.replicas} />}
              {'jobName' in rc && <Row label="Job" value={rc.jobName} />}
              {'queueName' in rc && <Row label="Queue" value={rc.queueName} />}
              {'outputDir' in rc && <Row label="Output directory" value={rc.outputDir} />}
              {'indexFile' in rc && <Row label="Index file" value={rc.indexFile} />}
            </div>
            <KeyList label={isOrchestrator ? 'Environment shared by all sub-services' : 'Runner environment'} keys={runnerEnvKeys} />
          </ReviewSection>

          {/* ── Sub-services (deployable cards) ── */}
          {perSubService && (
            <div className="space-y-2">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Layers className="size-3.5" /> Services to deploy
                <Badge variant="outline" className="ml-auto text-xs">{String(subServices.length)}</Badge>
              </h4>
              <div className="space-y-1.5">
                {subServices.map((s, i) => <ReviewSubServiceCard key={s.name || `svc-${String(i)}`} svc={s} index={i} />)}
              </div>
            </div>
          )}

          {/* ── Network & health ── */}
          <ReviewSection title="Network & health" icon={<Globe className="size-3.5" />}>
            {perSubService ? (
              <p className="text-xs text-muted-foreground">Ports, visibility, TLS and domains are set on each sub-service above.</p>
            ) : (
              <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                <Row label="Container port" value={network.port} />
                <Row label="Visibility" value={describeVisibility(network.visibility)} />
                {network.visibility !== 'private' && <Row label="TLS" value={describeTls(network.tls)} />}
                <Row label="Health check" value={hc.type === 'none' ? 'None' : hc.type} />
                {hc.type === 'http' && <Row label="Probe path" value={hc.path} />}
                {hc.type === 'tcp' && <Row label="Probe port" value={hc.port} />}
                {hc.type === 'command' && <Row label="Probe command" value={hc.command} />}
                {hc.type !== 'none' && (<>
                  <Row label="Interval (s)" value={hc.interval} defaultVal={30} />
                  <Row label="Timeout (s)" value={hc.timeout} defaultVal={10} />
                  <Row label="Retries" value={hc.retries} defaultVal={3} />
                </>)}
              </div>
            )}
          </ReviewSection>

          {/* ── Domains ── */}
          {!perSubService && (
            <ReviewSection title="Domains" icon={<Lock className="size-3.5" />}>
              {customDomains.length === 0 && bindings.length === 0 ? (
                <p className="text-xs text-muted-foreground">No custom domain. The service is reachable through the ingress lanes only; you can add domains later.</p>
              ) : (
                <div className="space-y-1">
                  {customDomains.length > 0 && <Row label="Custom domains" value={customDomains} />}
                  {bindings.map((e, i) => (
                    <Row key={`${e.projectDomainId}-${String(i)}`} label={`Binding ${String(i + 1)}`} value={describeBinding(e, domainNameById)} />
                  ))}
                </div>
              )}
            </ReviewSection>
          )}

          {/* ── Advanced ── */}
          {(advanced.resourceLimits && (advanced.resourceLimits.memory ?? advanced.resourceLimits.cpu)) || platformEnvKeys.length > 0 ? (
            <ReviewSection title="Advanced" icon={<Activity className="size-3.5" />}>
              <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {advanced.resourceLimits?.memory && <Row label="Memory limit" value={advanced.resourceLimits.memory} />}
                {advanced.resourceLimits?.cpu && <Row label="CPU limit" value={`${advanced.resourceLimits.cpu} CPU`} />}
              </div>
              <KeyList label="Platform environment variables" keys={platformEnvKeys} />
            </ReviewSection>
          ) : null}

          <p className="text-center text-xs text-muted-foreground">
            <Sparkles className="mr-1 inline size-3" />Empty fields will be filled with sensible defaults on the server.
          </p>
        </div>
      )
    }} />
  )
}
