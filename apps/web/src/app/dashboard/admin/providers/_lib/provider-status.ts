/**
 * Pure derivation of an integration's connection status from what the API really
 * reports. Nothing here invents a good state: a provider whose credentials were
 * stored but never verified is "Not verified", not "Connected".
 */

/** The status vocabulary understood by `StatusBadge` (see components/dashboard/status). */
export type IntegrationStatusKey = 'connected' | 'degraded' | 'error' | 'inactive' | 'unknown'

/** What the primary call to action should do for this state. */
export type IntegrationCta = 'connect' | 'review' | 'fix' | 'manage' | 'details'

export interface IntegrationStatus {
  status: IntegrationStatusKey
  /** Short badge label, e.g. "Connected as 1a2b3c4d…". */
  label: string
  /** One sentence of evidence or next step. */
  detail: string
  cta: IntegrationCta
}

export interface DnsAppLike {
  isActive: boolean
  state: {
    status: 'ok' | 'error' | 'unknown'
    accountId: string | null
    error: string | null
  } | null
}

/** Account ids are long opaque hashes: show enough to recognise, never the whole thing. */
export function shortAccountId(accountId: string): string {
  return accountId.length > 8 ? `${accountId.slice(0, 8)}…` : accountId
}

/** An integration the platform lists but cannot connect yet — said plainly, never faked. */
export function unavailableStatus(reason: string): IntegrationStatus {
  return { status: 'inactive', label: 'Not available yet', detail: reason, cta: 'details' }
}

/** Status of ONE DNS provider account, from its live runtime state. */
export function deriveDnsAppStatus(app: DnsAppLike): IntegrationStatus {
  if (!app.isActive) {
    return { status: 'inactive', label: 'Disabled', detail: 'Turned off — other modules cannot use this account.', cta: 'review' }
  }
  const state = app.state
  if (state?.status === 'ok') {
    return {
      status: 'connected',
      label: state.accountId ? `Connected as ${shortAccountId(state.accountId)}` : 'Connected',
      detail: 'The token was verified against the provider.',
      cta: 'manage',
    }
  }
  if (state?.status === 'error') {
    return {
      status: 'error',
      label: 'Needs attention',
      detail: state.error ?? 'The provider rejected the credentials. Replace the token.',
      cta: 'fix',
    }
  }
  return {
    status: 'unknown',
    label: 'Not verified',
    detail: 'Stored, but no live check has succeeded yet. Re-check to confirm it works.',
    cta: 'review',
  }
}

const SEVERITY: Record<IntegrationStatusKey, number> = { error: 4, unknown: 3, degraded: 2, inactive: 1, connected: 0 }

/** Roll several accounts up into one status — the worst one decides, so a problem is never hidden. */
export function summarizeAccounts(statuses: readonly IntegrationStatus[]): IntegrationStatus {
  if (statuses.length === 0) {
    return { status: 'inactive', label: 'Not connected', detail: 'No account added yet.', cta: 'connect' }
  }
  const worst = statuses.reduce((a, b) => (SEVERITY[b.status] > SEVERITY[a.status] ? b : a))
  if (worst.status === 'connected') {
    return statuses.length === 1
      ? worst
      : { ...worst, label: `${String(statuses.length)} accounts connected`, detail: 'Every account passed its live check.' }
  }
  const bad = statuses.filter((s) => s.status !== 'connected').length
  return statuses.length === 1 ? worst : { ...worst, label: worst.label, detail: `${String(bad)} of ${String(statuses.length)} accounts: ${worst.detail}` }
}

/**
 * GitHub and GitLab accounts expose no live check, only an active flag, so the
 * most we can honestly say is "configured".
 */
export function deriveStoredCredentialStatus(accounts: readonly { isActive: boolean }[]): IntegrationStatus {
  if (accounts.length === 0) {
    return { status: 'inactive', label: 'Not connected', detail: 'No account added yet.', cta: 'connect' }
  }
  const active = accounts.filter((a) => a.isActive).length
  if (active === 0) {
    return { status: 'inactive', label: 'Disabled', detail: 'Every account is switched off.', cta: 'review' }
  }
  return {
    status: 'connected',
    label: active === 1 ? '1 account configured' : `${String(active)} accounts configured`,
    detail: 'Credentials are stored. They are checked when used.',
    cta: 'manage',
  }
}

/** Does the stack's public edge run on this DNS account? (Such an account cannot be deleted.) */
export function isEdgeAccount(
  resources: readonly { kind: string; accountId?: string | null }[] | undefined,
  providerId: string,
): boolean {
  return (resources ?? []).some((r) => r.kind === 'tunnel' && r.accountId === providerId)
}
