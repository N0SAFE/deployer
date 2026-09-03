'use client'

import { isDefinedORPCError, getErrorMessage } from "@/lib/orpc/typed-errors";
import { Suspense, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, GitFork, Loader2, XCircle, ArrowLeft } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { AuthDashboardAdminProvidersCodeGithub } from '@/routes'
import { useGitHubManifestCallback } from '@/domains/github-apps/hooks'

/**
 * GitHub App manifest callback — GitHub redirects the browser HERE (web app
 * origin, which holds the session cookie) after the user creates the app.
 * This page POSTs the `code` to the protected API with the session cookie.
 * After the app is stored, the user is sent to the INSTALL URL where they
 * grant repo access (All repositories / Only select repositories).
 */
function GithubManifestCallbackContent() {
  const search = useSearchParams()
  const callback = useGitHubManifestCallback()

  const code = useMemo(() => search.get('code') ?? '', [search])
  const state = useMemo(() => search.get('state') ?? '', [search])
  const missingParams = !code || !state

  useEffect(() => {
    if (missingParams) return
    if (callback.isSuccess || callback.isError) return
    callback.mutate({ code, state })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, state, missingParams, callback.isSuccess, callback.isError])

  // The install URL where the user grants the app repo access (all/subset).
  const installUrl = callback.data?.slug
    ? `https://github.com/apps/${encodeURIComponent(callback.data.slug)}/installations/new`
    : null

  // DIRECT flow: as soon as the app is stored, bounce straight to the GitHub
  // install page — no intermediate click. The user picks repos there, then
  // GitHub lands on the setup_url (install-callback) with installation_id.
  useEffect(() => {
    if (callback.isSuccess && installUrl) {
      const t = setTimeout(() => {
        window.location.replace(installUrl)
      }, 1200)
      return () => clearTimeout(t)
    }
  }, [callback.isSuccess, installUrl])

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
              <CardTitle>GitHub App creation</CardTitle>
              <CardDescription>Finishing GitHub App registration…</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {missingParams ? (
              <Alert variant="destructive">
                <XCircle className="size-4" />
                <AlertTitle>Missing callback parameters</AlertTitle>
                <AlertDescription>
                  GitHub did not provide a code/state. The App may not have been created, or the
                  callback URL was opened directly.
                </AlertDescription>
              </Alert>
            ) : callback.isPending ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <Loader2 className="size-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Storing your GitHub App credentials…
                </p>
              </div>
            ) : callback.isSuccess ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <Loader2 className="size-8 animate-spin text-primary" />
                <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
                  <CheckCircle2 className="size-4 text-green-600" />
                  <AlertTitle>GitHub App registered</AlertTitle>
                  <AlertDescription>
                    <strong>{callback.data.name}</strong> was created. Redirecting you to GitHub
                    to grant repository access…
                  </AlertDescription>
                </Alert>
                {installUrl && (
                  <a href={installUrl} className="text-xs text-muted-foreground underline">
                    Not redirected? Click here to continue
                  </a>
                )}
              </div>
            ) : callback.isError ? (
              <Alert variant="destructive">
                <XCircle className="size-4" />
                <AlertTitle>Failed to store GitHub App</AlertTitle>
                <AlertDescription>
                  {isDefinedORPCError(callback.error) ? getErrorMessage(callback.error, 'Unknown error while storing the GitHub App.') : 'Unknown error while storing the GitHub App.'}
                </AlertDescription>
              </Alert>
            ) : null}

            {(callback.isError || missingParams) && (
              <div className="flex justify-end">
                <AuthDashboardAdminProvidersCodeGithub.Link>
                  <Button size="sm" variant="outline">Go to GitHub providers</Button>
                </AuthDashboardAdminProvidersCodeGithub.Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function AdminProvidersGithubCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[60vh] w-full items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    }>
      <GithubManifestCallbackContent />
    </Suspense>
  )
}
