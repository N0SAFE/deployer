'use client'

import { ExternalLink, GitFork, Key, Wrench } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { cn } from '@/lib/utils'

/** The three ways to connect, in order of preference. The first is the recommended path. */
export function GithubSetup({
  recommended,
  blockedReason,
  preparing,
  onManifest,
  onPat,
  onManual,
}: {
  recommended: boolean
  /** Why the recommended flow cannot start right now (e.g. API not publicly reachable). */
  blockedReason: string | null
  preparing: boolean
  onManifest: () => void
  onPat: () => void
  onManual: () => void
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className={cn(recommended && 'border-primary/40')}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><GitFork className="size-4" aria-hidden />Create GitHub App{recommended ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">Recommended</span> : null}</CardTitle>
          <CardDescription>GitHub pre-fills the app with the right permissions. After you confirm there, credentials come back and are stored automatically. Gives you webhooks and per-branch previews.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button size="sm" className="w-full" onClick={onManifest} disabled={preparing || blockedReason !== null}>
            <ExternalLink className="mr-2 size-4" />{preparing ? 'Preparing…' : 'Create on GitHub'}
          </Button>
          {blockedReason ? <p className="text-sm text-muted-foreground">{blockedReason}</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Key className="size-4" aria-hidden />Personal access token</CardTitle>
          <CardDescription>Fastest to set up and needs no public URL, but has no webhooks: pushes will not trigger deploys.</CardDescription>
        </CardHeader>
        <CardContent><Button size="sm" variant="outline" className="w-full" onClick={onPat}>Use a token</Button></CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Wrench className="size-4" aria-hidden />I already have an app</CardTitle>
          <CardDescription>Enter the credentials of a GitHub App you created yourself.</CardDescription>
        </CardHeader>
        <CardContent><Button size="sm" variant="outline" className="w-full" onClick={onManual}>Enter credentials</Button></CardContent>
      </Card>
    </div>
  )
}
