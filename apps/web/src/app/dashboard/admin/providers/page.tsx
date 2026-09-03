'use client'

import { useMemo } from 'react'
import { AuthDashboardAdminProvidersCode, AuthDashboardAdminProvidersDns } from '@/routes'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { GitFork, Network, ArrowRight, CheckCircle2 } from 'lucide-react'
import { PageHeader, PageLoadingState } from '@/components/dashboard'
import { useGitHubApps } from '@/domains/github-apps/hooks'
import { useDNSProviders } from '@/domains/dns-providers/hooks'

interface ProviderCategory {
  id: string
  name: string
  description: string
  icon: React.ElementType
  color: string
  bgColor: string
  route: typeof AuthDashboardAdminProvidersCode
  providers: string[]
}

export default function AdminProvidersPage() {
  const { data: githubData, isLoading: githubLoading } = useGitHubApps()
  const { data: dnsData, isLoading: dnsLoading } = useDNSProviders()

  const githubCount = useMemo(() => githubData?.apps?.length ?? 0, [githubData])
  const dnsCount = useMemo(() => {
    const providers = dnsData?.providers
    if (!Array.isArray(providers)) return 0
    return providers.length
  }, [dnsData])

  const isLoading = githubLoading || dnsLoading

  const categories: ProviderCategory[] = [
    {
      id: 'code',
      name: 'Code Providers',
      description: 'Connect source code and container registry providers for service builds and automated deployments.',
      icon: GitFork,
      color: 'text-gray-700 dark:text-gray-300',
      bgColor: 'bg-gray-100 dark:bg-gray-800',
      route: AuthDashboardAdminProvidersCode,
      providers: ['GitHub', 'GitLab', 'Docker Hub'],
    },
    {
      id: 'dns',
      name: 'DNS Providers',
      description: 'Connect DNS providers for automated domain management, DNS record administration, and domain ownership verification.',
      icon: Network,
      color: 'text-blue-700 dark:text-blue-300',
      bgColor: 'bg-blue-100 dark:bg-blue-900/50',
      route: AuthDashboardAdminProvidersDns,
      providers: ['Cloudflare', 'Route53', 'Google DNS'],
    },
  ]

  const connectedCounts: Record<string, number> = {
    code: githubCount,
    dns: dnsCount,
  }

  if (isLoading) return <PageLoadingState />

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Providers"
        description="Manage external service providers organized by category. Each provider type has its own configuration."
      />

      <div className="grid gap-4 md:grid-cols-2">
        {categories.map((category) => {
          const Icon = category.icon
          const count = connectedCounts[category.id] ?? 0
          return (
            <Card key={category.id} className="hover:border-primary/40 transition-colors">
              <CardHeader className="flex flex-row items-start gap-4">
                <div className={`rounded-lg p-2.5 ${category.bgColor}`}>
                  <Icon className={`size-5 ${category.color}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg">{category.name}</CardTitle>
                    {count > 0 && (
                      <Badge variant="secondary" className="gap-1 text-xs">
                        <CheckCircle2 className="size-3 text-green-500" />
                        {count} connected
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-sm mt-1">
                    {category.description}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {category.providers.map((p) => (
                    <span key={p} className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {p}
                    </span>
                  ))}
                </div>
                <category.route.Link>
                  <Button size="sm" className="w-full">
                    Manage {category.name}
                    <ArrowRight className="ml-2 size-4" />
                  </Button>
                </category.route.Link>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
