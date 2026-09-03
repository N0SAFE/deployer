'use client'

import React from 'react'
import { AuthDashboardAdminProvidersCodeGithub, AuthDashboardAdminProvidersCodeGitlab, AuthDashboardAdminProvidersCodeDockerHub, AuthDashboardAdminProviders } from '@/routes'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { ArrowLeft, GitFork, Plus, Code2, Container } from 'lucide-react'
import { PageHeader } from '@/components/dashboard'

const codeProviders: Array<{
  id: string
  name: string
  description: string
  icon: React.ElementType
  color: string
  bgColor: string
  route: React.ElementType | null
  status: 'active' | 'coming-soon'
}> = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Configure GitHub App credentials for source code integration, OAuth, webhooks, and repository access.',
    icon: GitFork,
    color: 'text-gray-700 dark:text-gray-300',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    route: AuthDashboardAdminProvidersCodeGithub,
    status: 'active',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'Connect GitLab repositories for CI/CD integration.',
    icon: Code2,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-950/50',
    route: AuthDashboardAdminProvidersCodeGitlab,
    status: 'coming-soon',
  },
  {
    id: 'docker-hub',
    name: 'Docker Hub',
    description: 'Configure Docker Hub credentials for container registry access.',
    icon: Container,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-950/50',
    route: AuthDashboardAdminProvidersCodeDockerHub,
    status: 'coming-soon',
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
          const isComingSoon = provider.status === 'coming-soon'
          return (
            <Card key={provider.id} className={`hover:border-border/80 transition-colors ${isComingSoon ? 'opacity-60' : 'cursor-pointer'}`}>
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
                {!isComingSoon && provider.route ? (() => {
                  const RouteLink = provider.route as unknown as { Link: React.ElementType }
                  return (
                    <RouteLink.Link>
                      <Button size="sm" className="w-full">
                        <Plus className="mr-2 size-4" />
                        Configure
                      </Button>
                    </RouteLink.Link>
                  )
                })() : (
                  <Button size="sm" className="w-full" disabled>Coming Soon</Button>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
