import { describe, expect, it } from 'vitest'

import { PLATFORM_ROLES } from '@deployer/auth/permissions'

import {
	isPlatformAdminRole,
	isPlatformRole,
	isPlatformRoleAtLeast,
	platformRolesByPrivilege,
} from './platform-role.rules'

describe('platform role vocabulary', () => {
	it('recognises every role the permission builder defines', () => {
		for (const role of PLATFORM_ROLES) {
			expect(isPlatformRole(role)).toBe(true)
		}
	})

	/**
	 * The session's `role` arrives from the server as an untyped string, so an
	 * unrecognised value has to be rejected rather than trusted.
	 */
	it('rejects values that are not roles', () => {
		for (const value of [undefined, null, '', 'user', 'ADMIN', 'root', 42, {}]) {
			expect(isPlatformRole(value)).toBe(false)
		}
	})
})

describe('isPlatformRoleAtLeast', () => {
	/**
	 * The regression this module exists for. `PLATFORM_ROLES` is ordered by
	 * declaration, and the MOST privileged role comes first:
	 *
	 *     ['superAdmin', 'admin', 'operator', 'viewer']
	 *
	 * The old implementation ranked by `indexOf`, so a higher index meant less
	 * privilege while the comparison asserted "at least" — it reported that a
	 * viewer satisfied `minimumRole: 'superAdmin'`.
	 *
	 * This asserts the ORDER OF THE ARRAY, so that if the builder is ever
	 * reordered the test fails loudly instead of the policy silently inverting.
	 */
	it('is ranking roles of a declaration-ordered list, highest privilege first', () => {
		expect([...PLATFORM_ROLES]).toEqual(['superAdmin', 'admin', 'operator', 'viewer'])
	})

	it('grants a role its own level', () => {
		for (const role of PLATFORM_ROLES) {
			expect(isPlatformRoleAtLeast(role, role)).toBe(true)
		}
	})

	it('grants higher roles a lower minimum', () => {
		expect(isPlatformRoleAtLeast('superAdmin', 'admin')).toBe(true)
		expect(isPlatformRoleAtLeast('superAdmin', 'operator')).toBe(true)
		expect(isPlatformRoleAtLeast('admin', 'operator')).toBe(true)
		expect(isPlatformRoleAtLeast('admin', 'viewer')).toBe(true)
		expect(isPlatformRoleAtLeast('operator', 'viewer')).toBe(true)
	})

	/** The inversion: a lower role must NOT satisfy a higher minimum. */
	it('refuses lower roles a higher minimum', () => {
		expect(isPlatformRoleAtLeast('viewer', 'superAdmin')).toBe(false)
		expect(isPlatformRoleAtLeast('viewer', 'admin')).toBe(false)
		expect(isPlatformRoleAtLeast('operator', 'admin')).toBe(false)
		expect(isPlatformRoleAtLeast('admin', 'superAdmin')).toBe(false)
		expect(isPlatformRoleAtLeast('operator', 'superAdmin')).toBe(false)
	})

	it('treats an unknown role as least privileged', () => {
		expect(isPlatformRoleAtLeast('root', 'viewer')).toBe(false)
		expect(isPlatformRoleAtLeast(undefined, 'viewer')).toBe(false)
	})
})

describe('isPlatformAdminRole', () => {
	it('accepts exactly the administering roles', () => {
		expect(isPlatformAdminRole('admin')).toBe(true)
		expect(isPlatformAdminRole('superAdmin')).toBe(true)
	})

	it('refuses the roles that do not administer the platform', () => {
		for (const role of ['operator', 'viewer', 'user', undefined]) {
			expect(isPlatformAdminRole(role)).toBe(false)
		}
	})
})

describe('platformRolesByPrivilege', () => {
	it('orders highest privilege first, and covers every role', () => {
		expect([...platformRolesByPrivilege]).toEqual([
			'superAdmin',
			'admin',
			'operator',
			'viewer',
		])
		expect(platformRolesByPrivilege).toHaveLength(PLATFORM_ROLES.length)
	})
})
