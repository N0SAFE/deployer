'use client'

import { ShieldAlert } from 'lucide-react'
import { PageHeader, ScopeLabel } from '@/components/dashboard'
import { Alert, AlertDescription, AlertTitle } from '@deployer/ui/components/shadcn/alert'
import { NodeNetworkConfig } from '@/components/dashboard/system/NodeNetworkConfig'
import { AuthDashboardSettingsSecurity } from '@/routes'
import { useIsPlatformAdmin } from '../_components/use-is-admin'
import { DatabaseTestCard } from './_components/database-test-card'
import { SettingsSection } from './_components/field'
import { MeshSecretCard } from './_components/mesh-secret-card'
import { NodeConfigCard } from './_components/node-config-card'

/**
 * Settings → This node. The identity, address, database and persisted
 * configuration of the node serving this dashboard. Trust keys and strict mode
 * are mesh-wide and live under Security.
 */
export default function SettingsNodePage() {
  const isAdmin = useIsPlatformAdmin()

  if (!isAdmin) {
    return (
      <Alert>
        <ShieldAlert className="size-4" />
        <AlertTitle>Administrators only</AlertTitle>
        <AlertDescription>Only platform administrators can view or change this node&apos;s configuration.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Settings"
        title="This node"
        badge={<ScopeLabel scope="node" />}
        description="The node serving this dashboard: who it is, how it is reached and which database it uses. Most changes are written to the node's configuration and apply on the next service restart."
      />

      <SettingsSection
        title="Identity & address"
        description="The address other nodes and clients use to reach this node, and whether it is reachable. The tunnel is a stack-wide setting and lives under Network."
      >
        <NodeNetworkConfig />
      </SettingsSection>

      <SettingsSection
        title="Configuration file"
        description="Identity, region, roles and routing defaults persisted for this node. Editing does not restart anything; restart the service to apply."
      >
        <NodeConfigCard />
      </SettingsSection>

      <SettingsSection title="Database" description="Verify a database before you commit it to the configuration file.">
        <DatabaseTestCard />
      </SettingsSection>

      <SettingsSection
        title="Danger zone"
        description="Actions that cut peers off from this node. Mesh-wide trust keys and strict mode are under Security."
      >
        <MeshSecretCard />
        <p className="text-sm text-muted-foreground">
          Looking for the trust keyring or strict mode? They are in{' '}
          <AuthDashboardSettingsSecurity.Link className="font-medium text-primary hover:underline">Security</AuthDashboardSettingsSecurity.Link>.
        </p>
      </SettingsSection>
    </div>
  )
}
