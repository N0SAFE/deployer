import { AuthDashboard, AuthDashboardProjects, AuthDashboardDeployments, AuthDashboardAdminOrganizations, AuthDashboardAdminSystem } from '@/routes'
import { PageTimingLogger } from '@/lib/timing'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Separator } from '@repo/ui/components/shadcn/separator'
import { ArrowRight, Bell, Boxes, Building2, Database, FolderKanban, Gauge, GitBranch, HardDrive, Layers3, LayoutGrid, Rocket, ServerCog, ShieldCheck, Workflow } from 'lucide-react'

type CapabilityStatus = 'available' | 'in-progress' | 'planned'

interface PlatformCapability {
  name: string
  area: string
  coolify: boolean
  dokploy: boolean
  deployerTarget: CapabilityStatus
  note: string
}

const platformCapabilities: PlatformCapability[] = [
  {
    name: 'Application deployment',
    area: 'Runtime',
    coolify: true,
    dokploy: true,
    deployerTarget: 'in-progress',
    note: 'Core deployment module migration is critical-path in v3.',
  },
  {
    name: 'Managed databases',
    area: 'Data',
    coolify: true,
    dokploy: true,
    deployerTarget: 'planned',
    note: 'Database surfaces mapped as high-value parity for project-centric dashboard.',
  },
  {
    name: 'Backups & restore',
    area: 'Data',
    coolify: false,
    dokploy: true,
    deployerTarget: 'planned',
    note: 'Storage module migration includes backup operations and restore workflows.',
  },
  {
    name: 'Docker Compose / orchestration',
    area: 'Infra',
    coolify: true,
    dokploy: true,
    deployerTarget: 'in-progress',
    note: 'Orchestration is implemented; dashboard-level workflows still expanding.',
  },
  {
    name: 'Multi-node fleet',
    area: 'Infra',
    coolify: true,
    dokploy: true,
    deployerTarget: 'planned',
    note: 'Swarm + fleet control requires broader non-Docker dashboard operations UI.',
  },
  {
    name: 'Templates / one-click installs',
    area: 'Provisioning',
    coolify: true,
    dokploy: true,
    deployerTarget: 'planned',
    note: 'Template-driven provisioning mapped to setup/provider schema domains.',
  },
  {
    name: 'Real-time monitoring',
    area: 'Observability',
    coolify: true,
    dokploy: true,
    deployerTarget: 'in-progress',
    note: 'Health and websocket modules are migration targets for live operations.',
  },
  {
    name: 'Notifications',
    area: 'Operations',
    coolify: true,
    dokploy: true,
    deployerTarget: 'planned',
    note: 'Notification stream can be layered into deployment and incident UX.',
  },
]

function capabilityBadgeVariant(status: CapabilityStatus): 'default' | 'secondary' | 'outline' {
  if (status === 'available') return 'default'
  if (status === 'in-progress') return 'secondary'
  return 'outline'
}

/**
 * Dashboard Overview Page using SessionRoute pattern
 * 
 * Uses AuthDashboard.SessionRoute to:
 * 1. Fetch session ONCE on the server
 * 2. Pass it as a prop to this component
 * 3. Hydrate it to React Query cache
 * 4. Client components read from cache without refetching
 */
export default AuthDashboard.SessionRoute(({ session }) => {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Platform Command Center</h1>
          <p className="text-muted-foreground mt-2">
            Welcome back, {session?.user.name ?? 'Operator'}. Manage projects, deployments, and platform operations from one place.
          </p>
        </div>
        <Badge variant="outline">v3 Dashboard</Badge>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle>Operations at a glance</CardTitle>
          <CardDescription>
            Core surfaces for daily deployment and project management workflows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground mb-1 text-xs uppercase tracking-wide">Projects</p>
              <p className="text-2xl font-semibold">24</p>
              <p className="text-muted-foreground mt-2 text-sm">12 active • 3 archived</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground mb-1 text-xs uppercase tracking-wide">Deployments</p>
              <p className="text-2xl font-semibold">86</p>
              <p className="text-muted-foreground mt-2 text-sm">Last 7 days</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground mb-1 text-xs uppercase tracking-wide">Success rate</p>
              <p className="text-2xl font-semibold">98.4%</p>
              <p className="text-muted-foreground mt-2 text-sm">Stable over 30 days</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground mb-1 text-xs uppercase tracking-wide">Runtime health</p>
              <p className="text-2xl font-semibold">Healthy</p>
              <p className="text-muted-foreground mt-2 text-sm">Mesh + control plane synced</p>
            </div>
          </div>

          <Separator />

          <div className="grid gap-3 md:grid-cols-2">
            <Button asChild variant="default" className="justify-between">
              <AuthDashboardProjects.Link>
                Open projects workspace
                <ArrowRight className="size-4" />
              </AuthDashboardProjects.Link>
            </Button>
            <Button asChild variant="outline" className="justify-between">
              <AuthDashboardDeployments.Link>
                Review deployment timeline
                <ArrowRight className="size-4" />
              </AuthDashboardDeployments.Link>
            </Button>
            <Button asChild variant="outline" className="justify-between">
              <AuthDashboardAdminOrganizations.Link>
                Manage organizations
                <ArrowRight className="size-4" />
              </AuthDashboardAdminOrganizations.Link>
            </Button>
            <Button asChild variant="outline" className="justify-between">
              <AuthDashboardAdminSystem.Link>
                Open control plane
                <ArrowRight className="size-4" />
              </AuthDashboardAdminSystem.Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Competitive capability alignment</CardTitle>
          <CardDescription>
            Dashboard enhancements are now steered by feature parity targets inspired by Coolify and Dokploy, aligned with v1 migration inventory.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Tracked capabilities</p>
              <p className="text-2xl font-semibold">{platformCapabilities.length}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">In progress</p>
              <p className="text-2xl font-semibold">{platformCapabilities.filter((item) => item.deployerTarget === 'in-progress').length}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Planned</p>
              <p className="text-2xl font-semibold">{platformCapabilities.filter((item) => item.deployerTarget === 'planned').length}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Coolify + Dokploy overlap</p>
              <p className="text-2xl font-semibold">{platformCapabilities.filter((item) => item.coolify && item.dokploy).length}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left">Capability</th>
                  <th className="px-3 py-2 text-left">Area</th>
                  <th className="px-3 py-2 text-left">Coolify</th>
                  <th className="px-3 py-2 text-left">Dokploy</th>
                  <th className="px-3 py-2 text-left">Deployer v3 target</th>
                  <th className="px-3 py-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {platformCapabilities.map((capability) => (
                  <tr key={capability.name} className="border-t">
                    <td className="px-3 py-2 font-medium">{capability.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{capability.area}</td>
                    <td className="px-3 py-2">
                      <Badge variant={capability.coolify ? 'secondary' : 'outline'}>{capability.coolify ? 'yes' : 'no'}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={capability.dokploy ? 'secondary' : 'outline'}>{capability.dokploy ? 'yes' : 'no'}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={capabilityBadgeVariant(capability.deployerTarget)}>{capability.deployerTarget}</Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{capability.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enhancement runway (outside Docker module)</CardTitle>
          <CardDescription>
            High-impact product surfaces to build next from documented migration targets: projects, services, deployments, domains, teams, and observability.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border p-3 space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium"><LayoutGrid className="size-4" /> Project workspace</p>
            <p className="text-xs text-muted-foreground">Project-centric IA with service/deployment tabs, ownership, and release signals.</p>
            <Badge variant="secondary">next priority</Badge>
          </div>
          <div className="rounded-lg border p-3 space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium"><GitBranch className="size-4" /> Deployment control</p>
            <p className="text-xs text-muted-foreground">Timeline, retries, logs, rollback, and multi-environment rollout controls.</p>
            <Badge variant="secondary">critical path</Badge>
          </div>
          <div className="rounded-lg border p-3 space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium"><Database className="size-4" /> Data + backups</p>
            <p className="text-xs text-muted-foreground">Database lifecycle, backup schedules, restore actions, and storage health.</p>
            <Badge variant="outline">planned</Badge>
          </div>
          <div className="rounded-lg border p-3 space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium"><Gauge className="size-4" /> Runtime observability</p>
            <p className="text-xs text-muted-foreground">Cross-service health scoring, incidents, notifications, and live event streams.</p>
            <Badge variant="secondary">in progress</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderKanban className="size-4" /> Project delivery
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Track environments, domains, and service ownership per project with clear release visibility.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Rocket className="size-4" /> Deployment pipeline
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Centralize preview, staging, and production rollout status across your fleet.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" /> Governance & access
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Keep organization and platform-level permissions auditable and easy to operate.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Core modules</CardTitle>
          <CardDescription>Platform domains available in the redesigned dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {[
            { label: 'Projects', icon: FolderKanban },
            { label: 'Deployments', icon: Rocket },
            { label: 'Organizations', icon: Building2 },
            { label: 'Infrastructure', icon: Boxes },
            { label: 'Automation', icon: Workflow },
            { label: 'Storage & Backups', icon: HardDrive },
            { label: 'Service Topology', icon: Layers3 },
            { label: 'Fleet Operations', icon: ServerCog },
            { label: 'Runtime Monitoring', icon: Gauge },
            { label: 'Alerting', icon: Bell },
          ].map((module) => (
            <div key={module.label} className="rounded-lg border p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <module.icon className="size-4" />
                {module.label}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <PageTimingLogger pageName="Dashboard" />
    </div>
  )
})
