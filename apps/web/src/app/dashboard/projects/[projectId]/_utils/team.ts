/** Pure helpers for the project team page. */

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: 'Full control — manage settings, members, and deployments.',
  maintainer: 'Manage services, environments, and deployments.',
  deployer: 'Trigger and manage deployments.',
  viewer: 'Read-only access.',
}

interface MemberLike { role: string; acceptedAt: string | null }

/** A member who has not accepted yet is a pending invitation, not an active member. */
export function memberState(member: Pick<MemberLike, 'acceptedAt'>): 'active' | 'pending' {
  return member.acceptedAt ? 'active' : 'pending'
}

export function countOwners(members: readonly Pick<MemberLike, 'role'>[]): number {
  return members.filter((m) => m.role === 'owner').length
}

/** The last remaining owner can be neither demoted nor removed. */
export function isSoleOwner(member: Pick<MemberLike, 'role'>, ownerCount: number): boolean {
  return member.role === 'owner' && ownerCount <= 1
}

/** "3 members (1 pending invite)" */
export function memberSummary(members: readonly Pick<MemberLike, 'acceptedAt'>[]): string {
  const pending = members.filter((m) => memberState(m) === 'pending').length
  const base = `${String(members.length)} ${members.length === 1 ? 'member' : 'members'}`
  return pending > 0 ? `${base} (${String(pending)} pending ${pending === 1 ? 'invite' : 'invites'})` : base
}
