'use client'

import { isDefinedORPCError, getErrorMessage } from "@/lib/orpc/typed-errors";
import { Suspense, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, GitFork, Loader2, XCircle, ArrowLeft } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { AuthDashboardAdminProvidersCodeGithub } from '@/routes'
import { useGitHubInstallCallback } from '@/domains/github-apps/hooks'

/**
 * GitHub App installation callback — GitHub redirects here (the manifest's
 * `setup_url`) AFTER the user installs the app and chooses which repos to
 * grant access (All repositories / Only select repositories). GitHub appends
 * `installation_id` + `setup_action`; the appName is embedded in the setup
 * URL so we can correlate back to the stored app row. This page persists the
 * installation id so repos become immediately listable.
 */
function InstallCallbackContent() {
  const search = useSearchParams()
  const installCallback = useGitHubInstallCallback()

  const appName = useMemo(() => search.get('appName') ?? '', [search])
  const installationId = useMemo(() => search.get('installation_id') ?? '', [search])
  const setupAction = useMemo(() => search.get('setup_action') ?? '', [search])
  const missing = !appName || !installationId

  useEffect(() => {
    if (missing) return
    if (installCallback.isSuccess || installCallback.isError) return
    installCallback.mutate({ appName, installationId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appName, installationId, missing, installCallback.isSuccess, installCallback.isError])

  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <AuthDashboardAdminProvidersCodeGithub.Link>
          <Button variant="ghost" size="sm" className="-ml-2 mb-4">
            <ArrowLeft className="mr-1 size-4" />Back to GitHub providers
          </Button>
        </AuthDashboardAdminProvidersCodeGithub.Link>

        <Card>
          <CardHeader className="flex flex-row items-start gap-4 pb-3">
            <div className="rounded-lg bg-gray-100 p-2 dark:bg-gray-800">
              <GitFork className="size-5 text-gray-700 dark:text-gray-300" />
            </div>
            <div>
              <CardTitle>GitHub App installation</CardTitle>
              <CardDescription>Recording repository access…</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {missing ? (
              <Alert variant="destructive">
                <XCircle className="size-4" />
                <AlertTitle>Missing installation parameters</AlertTitle>
                <AlertDescription>
                  GitHub did not provide an installation id. The app may not have been installed,
                  or this page was opened directly.
                </AlertDescription>
              </Alert>
            ) : installCallback.isPending ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <Loader2 className="size-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Saving repository access for <strong>{appName}</strong>…
                </p>
              </div>
            ) : installCallback.isSuccess ? (
              <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
                <CheckCircle2 className="size-4 text-green-600" />
                <AlertTitle>GitHub App installed</AlertTitle>
                <AlertDescription>
                  <strong>{appName}</strong> now has access to your repositories. You can select it
                  as a source provider and pick a repo.
                </AlertDescription>
              </Alert>
            ) : installCallback.isError ? (
              <Alert variant="destructive">
                <XCircle className="size-4" />
                <AlertTitle>Failed to record installation</AlertTitle>
                <AlertDescription>
                  {isDefinedORPCError(installCallback.error) ? getErrorMessage(installCallback.error, 'Unknown error while recording the installation.') : 'Unknown error while recording the installation.'}
                </AlertDescription>
              </Alert>
            ) : null}

            {(installCallback.isSuccess || installCallback.isError || missing) && (
              <div className="flex justify-end">
                <AuthDashboardAdminProvidersCodeGithub.Link>
                  <Button size="sm">Go to GitHub providers</Button>
                </AuthDashboardAdminProvidersCodeGithub.Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function AdminProvidersGithubInstallCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[60vh] w-full items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    }>
      <InstallCallbackContent />
    </Suspense>
  )
}
