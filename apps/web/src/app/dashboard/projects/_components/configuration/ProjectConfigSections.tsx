'use client'

import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { projectDeploymentStrategySchema } from '@repo/contracts-common'
import {
  useProjectDeploymentConfig,
  useProjectNotificationConfig,
  useProjectResourceConfig,
  useProjectSecurityConfig,
  useUpdateProjectDeploymentConfig,
  useUpdateProjectNotificationConfig,
  useUpdateProjectResourceConfig,
  useUpdateProjectSecurityConfig,
} from '@/domains/project/hooks'
import { ConfigSectionCard, Stat, parseNumber } from './ConfigSectionCard'

const STRATEGY_LABEL: Record<string, string> = { rolling: 'Rolling', blue_green: 'Blue-green', canary: 'Canary' }

function SwitchRow({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  )
}

function NumberField({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" value={value} onChange={(e) => { onChange(parseNumber(e.target.value, value)) }} />
    </div>
  )
}

export function DeploymentConfigCard({ projectId }: { projectId: string }) {
  const query = useProjectDeploymentConfig(projectId)
  const update = useUpdateProjectDeploymentConfig()
  return (
    <ConfigSectionCard
      title="Deployment defaults"
      description="Default strategy, timeouts and rollback behaviour for every service in this project."
      query={query}
      saving={update.isPending}
      onSave={async (draft) => { await update.mutateAsync({ params: { id: projectId }, body: draft }) }}
      renderView={(c) => (
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 md:grid-cols-4">
          <Stat label="Strategy">{STRATEGY_LABEL[c.deploymentStrategy] ?? c.deploymentStrategy}</Stat>
          <Stat label="Rollback">{c.enableRollback ? 'Enabled' : 'Disabled'}</Stat>
          <Stat label="Health timeout">{String(c.healthCheckTimeout)}s</Stat>
          <Stat label="Prod approval">{c.requireApprovalForProduction ? 'Required' : 'Not required'}</Stat>
        </div>
      )}
      renderEdit={(d, set) => (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumberField id="dep-cleanup" label="Auto cleanup (days)" value={d.autoCleanupDays} onChange={(v) => { set({ ...d, autoCleanupDays: v }) }} />
            <NumberField id="dep-maxprev" label="Max preview envs" value={d.maxPreviewEnvironments} onChange={(v) => { set({ ...d, maxPreviewEnvironments: v }) }} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="dep-strategy">Strategy</Label>
              <Select value={d.deploymentStrategy} onValueChange={(v) => { set({ ...d, deploymentStrategy: projectDeploymentStrategySchema.parse(v) }) }}>
                <SelectTrigger id="dep-strategy"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {projectDeploymentStrategySchema.options.map((s) => (<SelectItem key={s} value={s}>{STRATEGY_LABEL[s] ?? s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <NumberField id="dep-health" label="Health check timeout (s)" value={d.healthCheckTimeout} onChange={(v) => { set({ ...d, healthCheckTimeout: v }) }} />
          </div>
          <NumberField id="dep-timeout" label="Deployment timeout (s)" value={d.deploymentTimeout} onChange={(v) => { set({ ...d, deploymentTimeout: v }) }} />
          <SwitchRow id="dep-rollback" label="Enable rollback" checked={d.enableRollback} onChange={(v) => { set({ ...d, enableRollback: v }) }} />
          <SwitchRow id="dep-approval" label="Require approval for production" checked={d.requireApprovalForProduction} onChange={(v) => { set({ ...d, requireApprovalForProduction: v }) }} />
        </div>
      )}
    />
  )
}

export function SecurityConfigCard({ projectId }: { projectId: string }) {
  const query = useProjectSecurityConfig(projectId)
  const update = useUpdateProjectSecurityConfig()
  return (
    <ConfigSectionCard
      title="Security defaults"
      description="HTTPS redirect, allowed domains and basic auth applied to this project's public routes."
      query={query}
      saving={update.isPending}
      onSave={async (draft) => { await update.mutateAsync({ params: { id: projectId }, body: draft }) }}
      renderView={(c) => (
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 md:grid-cols-4">
          <Stat label="HTTPS redirect">{c.enableHttpsRedirect ? 'Enabled' : 'Disabled'}</Stat>
          <Stat label="Basic auth">{c.enableBasicAuth ? 'Enabled' : 'Disabled'}</Stat>
          <Stat label="Allowed domains">{c.allowedDomains.length}</Stat>
          <Stat label="IP allow-list">{c.ipWhitelist.length}</Stat>
        </div>
      )}
      renderEdit={(d, set) => (
        <div className="space-y-3">
          <SwitchRow id="sec-https" label="HTTPS redirect" checked={d.enableHttpsRedirect} onChange={(v) => { set({ ...d, enableHttpsRedirect: v }) }} />
          <SwitchRow id="sec-basic" label="Basic auth" checked={d.enableBasicAuth} onChange={(v) => { set({ ...d, enableBasicAuth: v }) }} />
        </div>
      )}
    />
  )
}

export function ResourceConfigCard({ projectId }: { projectId: string }) {
  const query = useProjectResourceConfig(projectId)
  const update = useUpdateProjectResourceConfig()
  return (
    <ConfigSectionCard
      title="Resource defaults"
      description="CPU, memory and storage limits new services start with. A service can override them in its Configuration → General."
      query={query}
      saving={update.isPending}
      onSave={async (draft) => { await update.mutateAsync({ params: { id: projectId }, body: draft }) }}
      renderView={(c) => (
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 md:grid-cols-4">
          <Stat label="CPU">{c.defaultCpuLimit}</Stat>
          <Stat label="Memory">{c.defaultMemoryLimit}</Stat>
          <Stat label="Storage">{c.defaultStorageLimit}</Stat>
          <Stat label="Max services">{c.maxServicesPerProject}</Stat>
        </div>
      )}
      renderEdit={(d, set) => (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5"><Label htmlFor="res-cpu">CPU limit</Label><Input id="res-cpu" value={d.defaultCpuLimit} onChange={(e) => { set({ ...d, defaultCpuLimit: e.target.value }) }} /></div>
            <div className="grid gap-1.5"><Label htmlFor="res-mem">Memory limit</Label><Input id="res-mem" value={d.defaultMemoryLimit} onChange={(e) => { set({ ...d, defaultMemoryLimit: e.target.value }) }} /></div>
            <div className="grid gap-1.5"><Label htmlFor="res-sto">Storage limit</Label><Input id="res-sto" value={d.defaultStorageLimit} onChange={(e) => { set({ ...d, defaultStorageLimit: e.target.value }) }} /></div>
          </div>
          <NumberField id="res-max" label="Max services per project" value={d.maxServicesPerProject} onChange={(v) => { set({ ...d, maxServicesPerProject: v }) }} />
        </div>
      )}
    />
  )
}

export function NotificationConfigCard({ projectId }: { projectId: string }) {
  const query = useProjectNotificationConfig(projectId)
  const update = useUpdateProjectNotificationConfig()
  // Preferences are persisted and read back, but NO transport consumes them yet.
  // Say what is true instead of rendering "Enabled" as a delivery guarantee.
  const pending = (on: boolean) => (on ? 'On (not delivered yet)' : 'Off')
  return (
    <ConfigSectionCard
      title="Notifications"
      description="Which project events (deployments, failures) you are notified about."
      notice="Delivery is not wired up yet — nothing sends email or posts to Slack. These preferences are saved and will take effect once notifications ship."
      query={query}
      saving={update.isPending}
      onSave={async (draft) => { await update.mutateAsync({ params: { id: projectId }, body: draft }) }}
      renderView={(c) => (
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 md:grid-cols-4">
          <Stat label="Email">{pending(c.enableEmailNotifications)}</Stat>
          <Stat label="Slack">{pending(c.enableSlackNotifications)}</Stat>
          <Stat label="Deploy success">{pending(c.notifyOnDeploymentSuccess)}</Stat>
          <Stat label="Deploy failure">{pending(c.notifyOnDeploymentFailure)}</Stat>
        </div>
      )}
      renderEdit={(d, set) => (
        <div className="space-y-3">
          <SwitchRow id="not-email" label="Email notifications" checked={d.enableEmailNotifications} onChange={(v) => { set({ ...d, enableEmailNotifications: v }) }} />
          <SwitchRow id="not-slack" label="Slack notifications" checked={d.enableSlackNotifications} onChange={(v) => { set({ ...d, enableSlackNotifications: v }) }} />
          <SwitchRow id="not-ok" label="Notify on deploy success" checked={d.notifyOnDeploymentSuccess} onChange={(v) => { set({ ...d, notifyOnDeploymentSuccess: v }) }} />
          <SwitchRow id="not-fail" label="Notify on deploy failure" checked={d.notifyOnDeploymentFailure} onChange={(v) => { set({ ...d, notifyOnDeploymentFailure: v }) }} />
        </div>
      )}
    />
  )
}
