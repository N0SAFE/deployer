'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { Globe, Network } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { buttonVariants } from '@repo/ui/components/shadcn/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { PageHeader } from '@/components/dashboard'
import { AuthDashboardAdminProvidersDnsCloudflare } from '@/routes'
import { useDNSProviders } from '@/domains/dns-providers/hooks'
import { getErrorMessage } from '@/lib/orpc/typed-errors'
import { deriveDnsAppStatus } from '../../../_lib/provider-status'
import { IntegrationStatusBadge } from '../../../_components/status-line'
import { ProviderLoadError, ProviderPageSkeleton } from '../../../_components/states'
import CloudflareDetailLoading from './loading'
import { RecordsTab } from './_components/records-tab'
import { TunnelsTab } from './_components/tunnels-tab'

export default function CloudflareAccountPage() {
  return (
    // `useParams` and the records tab's filter hook read the URL, which is not
    // available while the route is prerendered; the boundary lets the shell commit
    // behind the same skeleton `loading.tsx` renders.
    <Suspense fallback={<CloudflareDetailLoading />}>
      <CloudflareAccountInner />
    </Suspense>
  )
}

function CloudflareAccountInner() {
  const { providerId } = useParams<{ providerId: string }>()
  const { data, isLoading, error, refetch, isRefetching } = useDNSProviders()
  const account = data?.providers.find((p) => p.id === providerId && p.providerType === 'cloudflare')

  if (isLoading) return <ProviderPageSkeleton label="Loading Cloudflare account" />
  if (error) return <ProviderLoadError what="this Cloudflare account" message={getErrorMessage(error, 'The API did not answer.')} onRetry={() => void refetch()} retrying={isRefetching} />
  if (!account) {
    return (
      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertTitle>Cloudflare account not found</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>It may have been removed. Pick one of the connected accounts instead.</p>
            <AuthDashboardAdminProvidersDnsCloudflare.Link className={buttonVariants({ size: 'sm', variant: 'outline' })}>Back to Cloudflare accounts</AuthDashboardAdminProvidersDnsCloudflare.Link>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const status = deriveDnsAppStatus(account)
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            Settings › Integrations ›{' '}
            <AuthDashboardAdminProvidersDnsCloudflare.Link className="underline-offset-2 hover:underline">Cloudflare</AuthDashboardAdminProvidersDnsCloudflare.Link>
          </>
        }
        title={account.name}
        badge={<IntegrationStatusBadge status={status} />}
        description={status.status === 'error' ? `${status.detail} Fix it from the Cloudflare accounts page.` : 'DNS records and tunnels of this Cloudflare account.'}
      />

      <Tabs defaultValue="records">
        <TabsList>
          <TabsTrigger value="records" className="gap-2"><Globe className="size-4" />DNS records</TabsTrigger>
          <TabsTrigger value="tunnels" className="gap-2"><Network className="size-4" />Tunnels</TabsTrigger>
        </TabsList>
        <TabsContent value="records" className="mt-4">
          {account.features.dnsManagement ? (
            <RecordsTab providerId={account.id} />
          ) : (
            <Alert><Globe className="size-4" /><AlertTitle>DNS management is off for this account</AlertTitle><AlertDescription>Turn it on in the account&apos;s settings to browse zones and records.</AlertDescription></Alert>
          )}
        </TabsContent>
        <TabsContent value="tunnels" className="mt-4">
          {account.features.tunnelManagement ? (
            <TunnelsTab providerId={account.id} />
          ) : (
            <Alert><Network className="size-4" /><AlertTitle>Tunnel management is off for this account</AlertTitle><AlertDescription>Turn it on in the account&apos;s settings (the token needs the Cloudflare Tunnel permission) to create and manage tunnels.</AlertDescription></Alert>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
