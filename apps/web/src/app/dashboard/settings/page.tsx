'use client'

import { Boxes, FolderKanban, Gauge, Network, Plug, Server, ShieldCheck, User, Users } from 'lucide-react'
import { PageHeader } from '@/components/dashboard'
import {
  AuthDashboardAdminProviders,
  AuthDashboardCluster,
  AuthDashboardNetwork,
  AuthDashboardNodesCapacity,
  AuthDashboardProjects,
  AuthDashboardSettingsAccount,
  AuthDashboardSettingsNode,
  AuthDashboardSettingsSecurity,
  AuthDashboardSettingsUsers,
} from '@/routes'
import { SettingsCard } from './_components/settings-card'
import { useIsPlatformAdmin } from './_components/use-is-admin'
import { useMeshTrustStrictReadiness } from '@/domains/mesh/hooks'
import { useIntegrationSummary } from '../admin/providers/_components/integration-list'

function GroupHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

/**
 * The Settings hub: every settings area in one list, plus pointers to the settings
 * that deliberately live next to what they configure. This page is what makes
 * settings findable — if you do not know where something is, start here.
 */
export default function SettingsPage() {
  const isAdmin = useIsPlatformAdmin()
  const integrations = useIntegrationSummary()
  const { data: readiness, isLoading: readinessLoading } = useMeshTrustStrictReadiness({ enabled: isAdmin })
  const integrationsStatus = integrations.loading || integrations.failed
    ? null
    : `${String(integrations.connected)} of ${String(integrations.total)} connected${integrations.attention > 0 ? ` · ${String(integrations.attention)} need a look` : ''}`
  const securityStatus = !isAdmin || readinessLoading || !readiness ? null : readiness.strictEnforced ? 'Strict mode is on' : 'Strict mode is off'

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        description="Everything you can configure about your account, your team, your integrations and this node — and where to find the settings that live elsewhere."
      />

      <section className="space-y-3">
        <GroupHeading title="Settings" description="Configured from this section." />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <SettingsCard
            title="Account"
            icon={User}
            route={AuthDashboardSettingsAccount}
            description="Your name, email, password, sessions and personal preferences."
          />
          {isAdmin ? (
            <SettingsCard
              title="Users & access"
              icon={Users}
              route={AuthDashboardSettingsUsers}
              description="Who can sign in, which role each person has, and pending invitations."
            />
          ) : null}
          <SettingsCard
            title="Integrations"
            icon={Plug}
            route={AuthDashboardAdminProviders}
            status={integrationsStatus}
            description="Connect GitHub or GitLab to deploy from, and Cloudflare for DNS records and the public edge tunnel."
          />
          {isAdmin ? (
            <SettingsCard
              title="This node"
              icon={Server}
              route={AuthDashboardSettingsNode}
              description="This server's identity, address, region, database and persisted configuration. Most changes apply after a restart."
            />
          ) : null}
          {isAdmin ? (
            <SettingsCard
              title="Security"
              icon={ShieldCheck}
              route={AuthDashboardSettingsSecurity}
              status={securityStatus}
              description="The mesh trust keyring and strict mode: how nodes prove they belong together, and how hard that is enforced."
            />
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <GroupHeading
          title="Configured elsewhere, on purpose"
          description="These settings sit next to the thing they change, so you see the effect while you edit."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <SettingsCard
            title="Network"
            icon={Network}
            route={AuthDashboardNetwork}
            cta="Go to Network"
            description="Lanes, the public edge, the mesh between nodes, DNS records and domains."
            why="they are one connected system; changing a lane without seeing the mesh and DNS would be guesswork."
          />
          <SettingsCard
            title="Cluster"
            icon={Boxes}
            route={AuthDashboardCluster}
            cta="Go to Cluster"
            description="Whether this stack takes part in a swarm cluster, and how."
            why="joining or leaving a cluster changes where services run, so it sits with the cluster's live state."
          />
          <SettingsCard
            title="Capacity & admissions"
            icon={Gauge}
            route={AuthDashboardNodesCapacity}
            cta="Go to Capacity"
            description="How much CPU and memory each node offers, and which nodes may join."
            why="capacity decisions depend on what each node is currently running."
          />
          <SettingsCard
            title="Projects & services"
            icon={FolderKanban}
            route={AuthDashboardProjects}
            cta="Go to Projects"
            description="Environment variables, domains, build and deploy options for each project and service."
            why="they belong to the project or service they configure, and are not global."
          />
        </div>
      </section>
    </div>
  )
}
