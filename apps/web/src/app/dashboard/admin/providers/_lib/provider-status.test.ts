import { describe, expect, it } from 'vitest'
import { deriveDnsAppStatus, deriveStoredCredentialStatus, isEdgeAccount, summarizeAccounts } from './provider-status'

const ok = { isActive: true, state: { status: 'ok' as const, accountId: 'abcdef1234567890', error: null } }

describe('deriveDnsAppStatus', () => {
  it('reports connected with a shortened account id', () => {
    const s = deriveDnsAppStatus(ok)
    expect(s.status).toBe('connected')
    expect(s.label).toBe('Connected as abcdef12…')
  })
  it('surfaces the provider error', () => {
    const s = deriveDnsAppStatus({ isActive: true, state: { status: 'error', accountId: null, error: 'token expired' } })
    expect(s).toMatchObject({ status: 'error', cta: 'fix', detail: 'token expired' })
  })
  it('never claims connected without evidence', () => {
    expect(deriveDnsAppStatus({ isActive: true, state: null }).status).toBe('unknown')
    expect(deriveDnsAppStatus({ isActive: true, state: { status: 'unknown', accountId: null, error: null } }).status).toBe('unknown')
  })
  it('disabled wins over state', () => {
    expect(deriveDnsAppStatus({ ...ok, isActive: false }).status).toBe('inactive')
  })
})

describe('summarizeAccounts', () => {
  it('empty means not connected with a connect CTA', () => {
    expect(summarizeAccounts([])).toMatchObject({ label: 'Not connected', cta: 'connect' })
  })
  it('the worst account decides', () => {
    const good = deriveDnsAppStatus(ok)
    const bad = deriveDnsAppStatus({ isActive: true, state: { status: 'error', accountId: null, error: 'x' } })
    expect(summarizeAccounts([good, bad]).status).toBe('error')
    expect(summarizeAccounts([good, good]).label).toBe('2 accounts connected')
  })
})

describe('deriveStoredCredentialStatus', () => {
  it('counts only active accounts', () => {
    expect(deriveStoredCredentialStatus([{ isActive: true }, { isActive: false }]).label).toBe('1 account configured')
    expect(deriveStoredCredentialStatus([{ isActive: false }]).status).toBe('inactive')
  })
})

describe('isEdgeAccount', () => {
  it('matches a tunnel resource on the account only', () => {
    expect(isEdgeAccount([{ kind: 'tunnel', accountId: 'a' }], 'a')).toBe(true)
    expect(isEdgeAccount([{ kind: 'record', accountId: 'a' }], 'a')).toBe(false)
    expect(isEdgeAccount(undefined, 'a')).toBe(false)
  })
})
