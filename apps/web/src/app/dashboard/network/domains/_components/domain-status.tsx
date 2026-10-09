import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import type { ReachabilityState } from './domain-types'

/** Ownership verification as a badge: colour, icon and text. */
export function VerificationBadge({ status }: { status: string }) {
  if (status === 'verified') {
    return <Badge className="gap-1"><CheckCircle2 className="size-3" />Verified</Badge>
  }
  if (status === 'failed') {
    return <Badge variant="destructive" className="gap-1"><XCircle className="size-3" />Failed</Badge>
  }
  return <Badge variant="secondary" className="gap-1"><Clock className="size-3" />{status === 'pending' ? 'Pending' : status}</Badge>
}

/** The single next step for a domain, so a status is never a dead end. */
export function nextStep(status: string, reachable: ReachabilityState | undefined): string {
  if (status === 'failed') return 'Check that the DNS record matches exactly, then verify again.'
  if (status !== 'verified') return 'Add the DNS record below at your DNS host, wait for it to propagate, then verify.'
  if (reachable === undefined || reachable.loading) return 'Checking that the domain points at this stack…'
  if (reachable.reachable === true) return 'Ready — assign it to a service from the project’s domain settings.'
  return 'Verified, but it does not reach this stack yet. Point its A/AAAA or CNAME record at the public address (Network → DNS).'
}

/** Whether the domain answers on this stack's public address. */
export function ReachabilityBadge({ state }: { state: ReachabilityState | undefined }) {
  if (state === undefined || state.loading) {
    return <Badge variant="outline" className="gap-1"><Loader2 className="size-3 animate-spin motion-reduce:animate-none" />Checking…</Badge>
  }
  if (state.reachable === true) {
    return <Badge className="gap-1"><CheckCircle2 className="size-3" />Reachable</Badge>
  }
  return <Badge variant="destructive" className="gap-1"><XCircle className="size-3" />Unreachable</Badge>
}
