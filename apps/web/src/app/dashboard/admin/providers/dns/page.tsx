'use client'

import React from 'react'
import { AuthDashboardAdminProvidersDnsCloudflare, AuthDashboardAdminProvidersDnsRoute53, AuthDashboardAdminProvidersDnsGoogleDns, AuthDashboardAdminProviders } from '@/routes'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { ArrowLeft, Cloud, Plus, Globe, Shield } from 'lucide-react'
import { PageHeader } from '@/components/dashboard'

const dnsProviderTypes: Array<{
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
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'Configure Cloudflare API tokens for DNS record management, zone administration, and automated domain verification.',
    icon: Cloud,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-950/50',
    route: AuthDashboardAdminProvidersDnsCloudflare,
    status: 'active',
  },
  {
    id: 'route53',
    name: 'Route53',
    description: 'Connect AWS Route53 for DNS management.',
    icon: Globe,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-100 dark:bg-amber-950/50',
    route: AuthDashboardAdminProvidersDnsRoute53,
    status: 'coming-soon',
  },
  {
    id: 'google-dns',
    name: 'Google Cloud DNS',
    description: 'Connect Google Cloud DNS for zone and record management.',
    icon: Shield,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-950/50',
    route: AuthDashboardAdminProvidersDnsGoogleDns,
    status: 'coming-soon',
  },
]

export default function AdminDnsProvidersPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <AuthDashboardAdminProviders.Link>
          <Button variant="ghost" size="sm" className="-ml-2"><ArrowLeft className="mr-1 size-4" />All Providers</Button>
        </AuthDashboardAdminProviders.Link>
      </div>

      <PageHeader
        eyebrow="Admin / Providers"
        title="DNS Providers"
        description="Select a DNS provider to configure API keys and provider-specific settings."
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {dnsProviderTypes.map((provider) => {
          const Icon = provider.icon
          const isComingSoon = provider.status === 'coming-soon'
          return (
            <Card key={provider.id} className={`hover:border-border/80 transition-colors ${isComingSoon ? 'opacity-60' : ''}`}>
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
                  <Button size="sm" className="w-full" disabled>
                    <Plus className="mr-2 size-4" />
                    Coming Soon
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
