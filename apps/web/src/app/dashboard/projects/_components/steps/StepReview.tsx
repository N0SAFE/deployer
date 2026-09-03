'use client'

import { useState } from 'react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@repo/ui/components/shadcn/collapsible'
import {
  Sparkles, ChevronDown, ChevronRight, Globe, Boxes, Layers, Rocket, Server,
  GitBranch, Package, Cpu, MemoryStick, KeyRound, ShieldCheck, Activity, Box,
} from 'lucide-react'
import type { CreateServiceFormApi } from '../CreateService.hook'

/* ─── Small helpers ────────────────────────────────────────────────── */

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return '\u2014'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (Array.isArray(v)) return v.map(stringifyValue).filter(Boolean).join(', ') || '\u2014'
    return JSON.stringify(v)  }
/** Label/value row inside a section. */
function Row({ label, value, defaultVal }: { label: string; value: unknown; defaultVal?: unknown }) {
  const display = value ?? defaultVal ?? '\u2014'
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-52 truncate font-medium">{stringifyValue(display)}</span>
    </div>
  )
}

function Section({ title, icon, badge, children }: {
  title: string
  icon?: React.ReactNode
  badge?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2 rounded-lg border bg-background/40 p-3.5">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}{title}
        {badge ? <Badge variant="outline" className="ml-auto text-[9px]">{badge}</Badge> : null}
      </h4>
      {children}
    </div>
  )
}

/* ─── Sub-service deployable card ─────────────────────────────────── */

interface SubServiceSummary {
  name: string
  image: string
  port?: number
  ports?: number[]
  expose?: boolean
  tls?: { enabled?: boolean }
  replicas?: number
  restart?: string
  environment?: Record<string, string>
  volumes?: string[]
  dependsOn?: string[]
  healthCheck?: { test?: string[] }
  resources?: { cpus?: number; memory?: string }
  networks?: string[]
}

function SubServiceCard({ svc, index }: { svc: SubServiceSummary; index: number }) {
  const [open, setOpen] = useState(false)
  const facts: { label: string; value: string; icon?: React.ReactNode }[] = []
  if (svc.port || (svc.ports && svc.ports.length > 0)) {
    const p = svc.port ?? svc.ports?.[0]
    facts.push({ label: 'Port', value: p ? String(p) : '\u2014', icon: <Box className="size-3" /> })
  }
  if (svc.expose) facts.push({ label: 'Exposed', value: 'Internet', icon: <Globe className="size-3" /> })
  if (svc.replicas && svc.replicas > 1) facts.push({ label: 'Replicas', value: String(svc.replicas), icon: <Boxes className="size-3" /> })
  if (svc.restart && svc.restart !== 'no') facts.push({ label: 'Restart', value: svc.restart, icon: <RefreshIcon /> })
  if (svc.environment && Object.keys(svc.environment).length > 0) facts.push({ label: 'Env', value: String(Object.keys(svc.environment).length), icon: <KeyRound className="size-3" /> })
  if (svc.volumes && svc.volumes.length > 0) facts.push({ label: 'Volumes', value: String(svc.volumes.length), icon: <MemoryStick className="size-3" /> })
  if (svc.dependsOn && svc.dependsOn.length > 0) facts.push({ label: 'Depends', value: String(svc.dependsOn.length), icon: <GitBranch className="size-3" /> })
  if (svc.resources?.cpus || svc.resources?.memory) facts.push({ label: 'Limits', value: [svc.resources.cpus ? `${String(svc.resources.cpus)} CPU` : '', svc.resources.memory ?? ''].filter(Boolean).join(' / '), icon: <Cpu className="size-3" /> })

  return (
    <div className="overflow-hidden rounded-lg border bg-background/40">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/30">
            {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              {String(index + 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{svc.name || `service-${String(index + 1)}`}</span>
              {svc.image ? <code className="block truncate font-mono text-[10px] text-muted-foreground">{svc.image}</code> : null}
            </span>
            {svc.expose && <Badge variant="outline" className="shrink-0 text-[9px] text-primary">internet</Badge>}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t px-3 py-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {facts.map((f) => (
              <div key={f.label} className="flex items-center gap-1.5 text-[11px]">
                <span className="text-muted-foreground">{f.icon}{f.label}</span>
                <span className="truncate font-medium">{f.value}</span>
              </div>
            ))}
            {facts.length === 0 && <p className="col-span-full text-[11px] text-muted-foreground">No extra configuration.</p>}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

/** Inline refresh icon (avoids importing the whole lucide set twice). */
function RefreshIcon() {
  return <RotateIcon />
}
function RotateIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
  )
}

/* ─── Main step ────────────────────────────────────────────────────── */

export function StepReview({ form }: { form: CreateServiceFormApi }) {
  return (
    <form.Subscribe selector={(s) => s.values} children={(rawValues) => {
      const v = rawValues as unknown as {
        basicInfo: { name: string; type: string; description?: string; tags?: string[] }
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
          expose?: boolean
          tls?: { enabled?: boolean }
          healthCheck: { type: string; interval?: number; timeout?: number; retries?: number }
          customDomains?: string[]
          domainEntries?: { subdomain: string | null; basePath: string | null; isPrimary: boolean }[]
        }
        advanced: { resourceLimits?: { memory?: string; cpu?: string }; environmentVariables?: unknown[] }
      }
      const basic = v.basicInfo
      const provider = v.provider
      const runner = v.runner
      const network = v.network
      const advanced = v.advanced
      const pc = provider.config
      const rc = runner.config
      const build = runner.build
      const isGit = ['github', 'gitlab', 'bitbucket'].includes(provider.providerId)
      const hasBuildFields = build.method !== 'external'
      const subServices = (Array.isArray(rc.subServices) ? rc.subServices : []) as SubServiceSummary[]
      const isOrchestrator = runner.runnerId === 'orchestrator'

      // Service type is DERIVED from the runner (dokploy-style), not a
      // freeform category anymore.
      const serviceType = runner.runnerId === 'manual' ? 'application'
        : runner.runnerId === 'compose' ? 'compose'
        : runner.runnerId === 'orchestrator' ? 'sub-services'
        : runner.runnerId === 'worker-runtime' ? 'worker'
        : runner.runnerId

      const summary = {
        name: basic.name || 'Unnamed service',
        type: serviceType,
        provider: provider.providerId,
        runner: runner.runnerId,
        build: stringifyValue(build.method ?? 'auto'),
        subCount: subServices.length,
      }

      return (
        <div className="space-y-3">
          {/* ── Header ── */}
          <div className="rounded-lg border bg-linear-to-br from-primary/5 to-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold">{summary.name}</h3>
                {basic.description ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{basic.description}</p> : null}
              </div>
              <Badge variant="secondary" className="shrink-0 text-[10px] capitalize">{summary.type}</Badge>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Badge variant="outline" className="gap-1 text-[10px]"><GitBranch className="size-3" /> {summary.provider}</Badge>
              <Badge variant="outline" className="gap-1 text-[10px]"><Rocket className="size-3" /> {summary.runner}</Badge>
              <Badge variant="outline" className="gap-1 text-[10px]"><Package className="size-3" /> {summary.build}</Badge>
              {basic.tags && basic.tags.length > 0 && basic.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
            </div>
          </div>

          {/* ── Source ── */}
          <Section title={`Source — ${provider.providerId}`} icon={<GitBranch className="size-3.5" />}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {Boolean(pc.providerAppId) && <Row label="GitHub App" value={pc.providerAppId} />}
              <Row label="URL" value={pc.sourceUrl} />
              {isGit && <Row label="Branch" value={pc.branch} defaultVal="main" />}
              <Row label="Auth secret" value={pc.authSecretRef} defaultVal="default" />
              {isGit && <><Row label="Auto-sync" value={pc.autoSyncEnabled} /><Row label="Webhook" value={pc.webhookEnabled} /></>}
            </div>
          </Section>

          {/* ── Build ── */}
          <Section title={`Build — ${stringifyValue(build.method ?? 'auto')}`} icon={<Package className="size-3.5" />}>
            {hasBuildFields ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <Row label="Root path" value={build.rootPath} defaultVal="/" />
                <Row label="Build context" value={build.buildContext} defaultVal="." />
              {build.dockerfilePath ? <Row label="Dockerfile" value={build.dockerfilePath} /> : null}
              {build.composeFile ? <Row label="Compose" value={build.composeFile} /> : null}
              {build.buildCommand ? <Row label="Build cmd" value={build.buildCommand} /> : null}
              {build.runCommand ? <Row label="Run cmd" value={build.runCommand} /> : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Prebuilt image — no build step on the node.</p>
            )}
          </Section>

          {/* ── Runner ── */}
          <Section title={`Runner — ${runner.runnerId}`} icon={<Server className="size-3.5" />} badge={isOrchestrator ? `${String(subServices.length)} sub-service${subServices.length === 1 ? '' : 's'}` : undefined}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {'startCommand' in rc && <Row label="Start command" value={rc.startCommand} />}
              {'ports' in rc && <Row label="Ports" value={rc.ports} />}
              {'strategy' in rc && <Row label="Strategy" value={rc.strategy} />}
              {'networkMode' in rc && <Row label="Network" value={rc.networkMode} />}
              {'gracefulShutdownSeconds' in rc && <Row label="Graceful shutdown" value={rc.gracefulShutdownSeconds} defaultVal={30} />}
              {'composeFile' in rc && <Row label="Compose file" value={rc.composeFile} />}
              {'profiles' in rc && <Row label="Profiles" value={rc.profiles} />}
              {'namespace' in rc && <Row label="Namespace" value={rc.namespace} />}
              {'deploymentName' in rc && <Row label="Deployment" value={rc.deploymentName} />}
              {'replicas' in rc && <Row label="Replicas" value={rc.replicas} />}
              {'jobName' in rc && <Row label="Job" value={rc.jobName} />}
              {'queueName' in rc && <Row label="Queue" value={rc.queueName} />}
              {'outputDir' in rc && <Row label="Output" value={rc.outputDir} />}
              {'indexFile' in rc && <Row label="Index" value={rc.indexFile} />}
            </div>
            {(() => {
              const env = rc.environment
              if (!env || typeof env !== 'object' || Object.keys(env).length === 0) return null
              return (
                <div className="mt-2 border-t pt-2">
                  <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                    <KeyRound className="size-3" /> Cascaded environment ({String(Object.keys(env).length)})
                  </p>
                </div>
              )
            })()}
          </Section>

          {/* ── Sub-services (deployable cards) ── */}
          {isOrchestrator && subServices.length > 0 && (
            <div className="space-y-2">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Layers className="size-3.5" /> Services to deploy
                <Badge variant="outline" className="ml-auto text-[9px]">{String(subServices.length)}</Badge>
              </h4>
              <div className="space-y-1.5">
                {subServices.map((s, i) => <SubServiceCard key={s.name || `svc-${String(i)}`} svc={s} index={i} />)}
              </div>
            </div>
          )}

          {/* ── Network & health ── */}
          <Section title="Network & health" icon={<Globe className="size-3.5" />}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <Row label="Port" value={network.port} />
              <Row label="Exposed" value={network.expose ? 'Yes' : 'No'} />
              {network.expose && <Row label="TLS" value={network.tls?.enabled ? 'Enabled' : 'Disabled'} />}
              <Row label="Health check" value={network.healthCheck.type} />
              {network.healthCheck.type && network.healthCheck.type !== 'none' && (<>
                <Row label="Interval" value={network.healthCheck.interval} defaultVal={30} />
                <Row label="Timeout" value={network.healthCheck.timeout} defaultVal={10} />
                <Row label="Retries" value={network.healthCheck.retries} defaultVal={3} />
              </>)}
              <Row label="Custom domains" value={network.customDomains} />
            </div>
            {network.domainEntries && network.domainEntries.length > 0 && (
              <div className="mt-2 space-y-1 border-t pt-2">
                {network.domainEntries.map((e, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1 text-muted-foreground"><ShieldCheck className="size-3" /> Binding {i + 1}</span>
                    <code className="truncate font-mono">
                      {e.subdomain ? `${e.subdomain}.` : ''}…{e.basePath ? `/${e.basePath}` : ''}
                      {e.isPrimary ? ' (primary)' : ''}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── Advanced ── */}
          {(advanced.resourceLimits && (advanced.resourceLimits.memory ?? advanced.resourceLimits.cpu)) || (advanced.environmentVariables && advanced.environmentVariables.length > 0) ? (
            <Section title="Advanced" icon={<Activity className="size-3.5" />}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {advanced.resourceLimits?.memory && <Row label="Memory limit" value={advanced.resourceLimits.memory} />}
                {advanced.resourceLimits?.cpu && <Row label="CPU limit" value={advanced.resourceLimits.cpu} />}
                {advanced.environmentVariables && advanced.environmentVariables.length > 0 && (
                  <Row label="Platform env" value={String(advanced.environmentVariables.length)} />
                )}
              </div>
            </Section>
          ) : null}

          <p className="text-center text-xs text-muted-foreground">
            <Sparkles className="mr-1 inline size-3" />Empty fields will be filled with sensible defaults on the server.
          </p>
        </div>
      )
    }} />
  )
}
