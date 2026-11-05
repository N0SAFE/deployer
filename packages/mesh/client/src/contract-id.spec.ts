import { describe, expect, it } from 'vitest'

import { contractId } from './contract-id'

const procedure = () => ({ '~orpc': {} })

describe('contractId', () => {
    it('is the same for the same contract, whatever order its procedures were declared in', () => {
        const a = {
            user: { find: procedure(), list: procedure() },
            ping: procedure(),
        }
        const b = {
            ping: procedure(),
            user: { list: procedure(), find: procedure() },
        }

        expect(contractId(a)).toBe(contractId(b))
    })

    it('tells two contracts apart, even when they share a procedure name', () => {
        const project = { crud: { findById: procedure() } }
        const service = { findById: procedure(), crud: { list: procedure() } }

        expect(contractId(project)).not.toBe(contractId(service))
    })

    it('changes when a procedure is added, so a caller and a service on different contracts do not talk', () => {
        expect(contractId({ a: procedure() })).not.toBe(
            contractId({ a: procedure(), b: procedure() })
        )
    })

    it('is a fixed width, so it is a safe path segment', () => {
        expect(contractId({ a: procedure() })).toMatch(/^[0-9a-f]{8}$/)
        expect(contractId({})).toMatch(/^[0-9a-f]{8}$/)
    })
})
