'use client'

import { Siren } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@deployer/ui/components/shadcn/alert'
import { Button } from '@deployer/ui/components/shadcn/button'

/**
 * A settings card whose query failed: say what is missing and offer Retry.
 * Without it the card renders its empty values ("No active key", "—") as if the
 * API had answered "nothing", which is a claim the page has not earned.
 */
export function QueryError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <Siren className="size-4" />
      <AlertTitle>Could not load {what}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>The API did not return it, so the values below would be a guess. Check that the API is running, then retry.</p>
        <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
      </AlertDescription>
    </Alert>
  )
}
