import { describe, expect, it } from 'vitest'
import { confirmationFor, quorumInfo, type GuardNode } from './node-change-guard'

const node = (id: string, over: Partial<GuardNode> = {}): GuardNode => ({
	nodeId: id, hostname: id, swarmRole: 'manager', platformRole: 'both', isMaster: false, isIngress: false, ...over,
})

describe('quorumInfo', () => {
	it('computes majority and tolerated failures', () => {
		expect(quorumInfo(1)).toEqual({ majority: 1, tolerated: 0 })
		expect(quorumInfo(3)).toEqual({ majority: 2, tolerated: 1 })
		expect(quorumInfo(4)).toEqual({ majority: 3, tolerated: 1 })
		expect(quorumInfo(5)).toEqual({ majority: 3, tolerated: 2 })
	})
})

describe('confirmationFor', () => {
	const nodes = [node('a'), node('b'), node('c', { swarmRole: 'worker' })]
	it('asks before demoting a manager and states the quorum change', () => {
		const c = confirmationFor(nodes[0]!, { kind: 'platformRole', role: 'worker' }, nodes)
		expect(c?.consequence).toContain('Managers go from 2 to 1')
	})
	it('warns about the last manager', () => {
		const solo = [node('a')]
		expect(confirmationFor(solo[0]!, { kind: 'platformRole', role: 'worker' }, solo)?.consequence).toContain('last manager')
	})
	it('does not ask for harmless changes', () => {
		expect(confirmationFor(nodes[2]!, { kind: 'platformRole', role: 'worker' }, nodes)).toBeNull()
		expect(confirmationFor(nodes[0]!, { kind: 'platformRole', role: 'control' }, nodes)).toBeNull()
		expect(confirmationFor(nodes[0]!, { kind: 'ingress', ingress: true }, nodes)).toBeNull()
	})
	it('asks before removing the only ingress node', () => {
		const withIngress = [node('a', { isIngress: true }), node('b')]
		expect(confirmationFor(withIngress[0]!, { kind: 'ingress', ingress: false }, withIngress)).not.toBeNull()
		const two = [node('a', { isIngress: true }), node('b', { isIngress: true })]
		expect(confirmationFor(two[0]!, { kind: 'ingress', ingress: false }, two)).toBeNull()
	})
})
