'use client'

import React from 'react'
import { AuthDashboardAdminProvidersCodeGithub, AuthDashboardAdminProvidersCodeGitlab, AuthDashboardAdminProvidersCodeDockerHub, AuthDashboardAdminProviders } from '@/routes'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { ArrowLeft, GitFork, Plus, Code2, Container } from 'lucide-react'
import { PageHeader } from '@/components/dashboard'

/**
 * The only part of a route builder this grid renders: a typed `Link`.
 *
 * Declaring it structurally is what removes the `as unknown as` assertion this
 * used to need to reach `.Link` off a route builder. A route builder's `Link`
 * takes optional props plus its own params, so it satisfies this shape directly.
 */
interface ProviderRoute {
  Link: React.ComponentType<{ children?: React.ReactNode }>
}

/**
 * Every provider listed here has a working configuration page. There is
 * deliberately no "coming soon" state: the four providers that used to carry
 * one (GitLab, Docker Hub, and the same stale marker on the DNS grid) had
 * complete CRUD pages behind a disabled button, so the UI advertised a
 * finished feature as unfinished and left it unreachable.
 */
const codeProviders: {
  id: string
  name: string
  description: string
  icon: React.ElementType
  color: string
  bgColor: string
  route: ProviderRoute
}[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Configure GitHub App credentials for source code integration, OAuth, webhooks, and repository access.',
    icon: GitFork,
    color: 'text-gray-700 dark:text-gray-300',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    route: AuthDashboardAdminProvidersCodeGithub,
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'Connect GitLab repositories for CI/CD integration.',
    icon: Code2,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-950/50',
    route: AuthDashboardAdminProvidersCodeGitlab,
  },
  {
    id: 'docker-hub',
    name: 'Docker Hub',
    description: 'Configure Docker Hub credentials for container registry access.',
    icon: Container,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-950/50',
    route: AuthDashboardAdminProvidersCodeDockerHub,
  },
]

export default function AdminProvidersCodePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <AuthDashboardAdminProviders.Link>
          <Button variant="ghost" size="sm" className="-ml-2"><ArrowLeft className="mr-1 size-4" />All Providers</Button>
        </AuthDashboardAdminProviders.Link>
      </div>

      <PageHeader
        eyebrow="Admin / Providers"
        title="Code Providers"
        description="Configure source code and registry providers for service builds and deployments."
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {codeProviders.map((provider) => {
          const Icon = provider.icon
          const ConfigureLink = provider.route.Link
          return (
            <Card key={provider.id} className="cursor-pointer transition-colors hover:border-border/80">
              <CardHeader className="flex flex-row items-start gap-4">
                <div className={`rounded-lg p-2.5 ${provider.bgColor}`}>
                  <Icon className={`size-5 ${provider.color}`} />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-lg">{provider.name}</CardTitle>
                  <CardDescription className="text-sm mt-1">
                    {provider.description}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <ConfigureLink>
                  <Button size="sm" className="w-full">
                    <Plus className="mr-2 size-4" />
                    Configure
                  </Button>
                </ConfigureLink>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
