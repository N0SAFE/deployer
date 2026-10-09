'use client'

import { useState } from 'react'
import { Cloud, Network, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Button } from '@repo/ui/components/shadcn/button'
import { EmptyState, PageHeader } from '@/components/dashboard'
import { AuthDashboardNetworkIngress } from '@/routes'
import { useCheckProviderState, useDeleteDNSProvider, useDNSProviders } from '@/domains/dns-providers/hooks'
import { useIngress } from '@/domains/reachability/hooks'
import { getErrorMessage } from '@/lib/orpc/typed-errors'
import { isEdgeAccount } from '../../_lib/provider-status'
import { ProviderLoadError, ProviderPageSkeleton } from '../../_components/states'
import { RemoveAccountDialog } from '../../_components/remove-account-dialog'
import { CloudflareAccountCard, type TestResult } from './_components/cloudflare-account-card'
import { CloudflareAddDialog } from './_components/cloudflare-add-dialog'
import { CloudflareConfigureDialog } from './_components/cloudflare-configure-dialog'

export default function CloudflareIntegrationPage() {
  const { data, isLoading, error, refetch, isRefetching } = useDNSProviders()
  const { data: ingress } = useIngress()
  const deleteProvider = useDeleteDNSProvider()
  const checkState = useCheckProviderState()

  // Route 53 / Google rows must never render as Cloudflare accounts.
  const accounts = (data?.providers ?? []).filter((p) => p.providerType === 'cloudflare')
  const edgeResources = ingress?.edge.active?.status.resources
  const tunnelAccounts = accounts.filter((a) => a.isActive && a.features.tunnelManagement && a.state?.status === 'ok').length

  const [addOpen, setAddOpen] = useState(false)
  const [configureId, setConfigureId] = useState<string | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, TestResult>>({})

  const configureAccount = accounts.find((a) => a.id === configureId)
  const removeAccount = accounts.find((a) => a.id === removeId)

  const test = async (id: string) => {
    setTestingId(id)
    try {
      const state = await checkState.mutateAsync({ params: { id } })
      const ok = state.status === 'ok'
      setResults((r) => ({
        ...r,
        [id]: { ok, message: ok ? 'Cloudflare accepted the token.' : (state.error ?? 'No answer from Cloudflare. Try again, or replace the token.') },
      }))
    } catch (err) {
      setResults((r) => ({ ...r, [id]: { ok: false, message: getErrorMessage(err, 'The check could not run.') } }))
    } finally {
      setTestingId(null)
      void refetch()
    }
  }

  const confirmRemove = async () => {
    if (!removeAccount) return
    setRemoveError(null)
    try {
      await deleteProvider.mutateAsync({ params: { id: removeAccount.id } })
      toast.success(`Cloudflare account “${removeAccount.name}” removed`)
      setRemoveId(null)
    } catch (err) {
      setRemoveError(getErrorMessage(err, 'The account could not be removed.'))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings › Integrations"
        title="Cloudflare"
        description="Each account is one API token. Accounts manage DNS records for your domains and can host Cloudflare Tunnels, including the stack's public edge."
        actions={
          accounts.length > 0 ? (
            <Button size="sm" onClick={() => { setAddOpen(true); }}>
              <Plus className="mr-2 size-4" />
              Add Cloudflare account
            </Button>
          ) : null
        }
      />

      {error ? (
        <ProviderLoadError what="Cloudflare accounts" message={getErrorMessage(error, 'The API did not answer.')} onRetry={() => void refetch()} retrying={isRefetching} />
      ) : isLoading ? (
        <ProviderPageSkeleton />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Cloud}
          title="No Cloudflare account connected"
          description="Connect one API token to manage DNS records, and optionally to run the public edge through a Cloudflare Tunnel."
          action={{ label: 'Connect Cloudflare', onClick: () => { setAddOpen(true); } }}
        />
      ) : (
        <>
          <Alert>
            <Network className="size-4" />
            <AlertTitle>{tunnelAccounts > 0 ? 'Public edge tunnel available' : 'Public edge tunnel not set up'}</AlertTitle>
            <AlertDescription>
              {tunnelAccounts > 0 ? (
                <>The Cloudflare Tunnel public edge can run on this account. Choose it in </>
              ) : (
                <>Turn on Tunnel management in an account&apos;s settings (its token needs the Cloudflare Tunnel permission), then choose it in </>
              )}
              <AuthDashboardNetworkIngress.Link className="font-medium text-primary hover:underline">Network → Ingress &amp; edge</AuthDashboardNetworkIngress.Link>.
            </AlertDescription>
          </Alert>
          <div className="grid gap-4 xl:grid-cols-2">
            {accounts.map((account) => (
              <CloudflareAccountCard
                key={account.id}
                account={account}
                usedByEdge={isEdgeAccount(edgeResources, account.id)}
                testing={testingId === account.id}
                testResult={results[account.id]}
                onTest={() => void test(account.id)}
                onConfigure={() => { setConfigureId(account.id); }}
                onRemove={() => {
                  setRemoveError(null)
                  setRemoveId(account.id)
                }}
              />
            ))}
          </div>
        </>
      )}

      <CloudflareAddDialog open={addOpen} onOpenChange={setAddOpen} />
      {configureAccount ? <CloudflareConfigureDialog key={configureAccount.id} account={configureAccount} onClose={() => { setConfigureId(null); }} /> : null}
      <RemoveAccountDialog
        open={removeAccount !== undefined}
        onOpenChange={(open) => {
          if (!open) setRemoveId(null)
        }}
        kind="Cloudflare account"
        name={removeAccount?.name ?? ''}
        consequences="DNS records already on Cloudflare stay, but this platform can no longer create or check them, and tunnels created through this account lose their management here."
        blockedReason={
          removeAccount && isEdgeAccount(edgeResources, removeAccount.id) ? (
            <>
              The stack&apos;s public edge runs on this account. Switch or tear down the public edge in{' '}
              <AuthDashboardNetworkIngress.Link className="font-medium underline">Network → Ingress &amp; edge</AuthDashboardNetworkIngress.Link> first.
            </>
          ) : undefined
        }
        pending={deleteProvider.isPending}
        error={removeError}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  )
}
