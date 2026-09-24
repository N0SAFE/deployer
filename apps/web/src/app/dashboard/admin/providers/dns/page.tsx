'use client'

import React from 'react'
import { AuthDashboardAdminProvidersDnsCloudflare, AuthDashboardAdminProvidersDnsRoute53, AuthDashboardAdminProvidersDnsGoogleDns, AuthDashboardAdminProviders } from '@/routes'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { ArrowLeft, Cloud, Plus, Globe, Shield } from 'lucide-react'
import { PageHeader } from '@/components/dashboard'

/**
 * The only part of a route builder this grid renders: a typed `Link`.
 *
 * Declaring it structurally is what removes the `as unknown as` assertion this
 * used to need to reach `.Link` off a route builder.
 */
interface ProviderRoute {
  Link: React.ComponentType<{ children?: React.ReactNode }>
}

/**
 * Every provider listed here has a working configuration page. The "coming
 * soon" state this grid used to carry marked Route53 and Google Cloud DNS as
 * unfinished while both had complete CRUD pages — a disabled button is not a
 * neutral placeholder when the thing behind it already works.
 */
const dnsProviderTypes: {
  id: string
  name: string
  description: string
  icon: React.ElementType
  color: string
  bgColor: string
  route: ProviderRoute
}[] = [
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'Configure Cloudflare API tokens for DNS record management, zone administration, and automated domain verification.',
    icon: Cloud,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-950/50',
    route: AuthDashboardAdminProvidersDnsCloudflare,
  },
  {
    id: 'route53',
    name: 'Route53',
    description: 'Connect AWS Route53 for DNS management.',
    icon: Globe,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-100 dark:bg-amber-950/50',
    route: AuthDashboardAdminProvidersDnsRoute53,
  },
  {
    id: 'google-dns',
    name: 'Google Cloud DNS',
    description: 'Connect Google Cloud DNS for zone and record management.',
    icon: Shield,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-950/50',
    route: AuthDashboardAdminProvidersDnsGoogleDns,
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
