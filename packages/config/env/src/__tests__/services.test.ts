import { afterEach, describe, expect, it } from 'vitest'

import {
    API_SERVICE_NAMES,
    apiServiceName,
    apiServicePort,
    apiServiceUrl,
} from '../services'

/**
 * The catalog is read by BOTH the API tier and `apps/setup`, which cannot import
 * each other — so the naming and override rules are the only thing keeping the
 * name a service is scheduled under and the name the BFF dials identical. A drift
 * here is an `ENOTFOUND` on every call, on a tier that reports healthy.
 */
describe('apiServiceName', () => {
    it('is svc-<name> with no prefix', () => {
        expect(apiServiceName('project')).toBe('svc-project')
        expect(apiServiceName('project', '')).toBe('svc-project')
        expect(apiServiceName('project', null)).toBe('svc-project')
        expect(apiServiceName('project', undefined)).toBe('svc-project')
    })

    it('applies a prefix, including for the BFF (not an ApiServiceName)', () => {
        expect(apiServiceName('project', 'acme')).toBe('svc-project-acme')
        expect(apiServiceName('bff', 'acme')).toBe('svc-bff-acme')
        expect(apiServiceName('bff')).toBe('svc-bff')
    })

    it('is the host apiServiceUrl dials', () => {
        expect(apiServiceUrl('project')).toBe(
            `http://${apiServiceName('project')}:${String(apiServicePort('project'))}`
        )
    })
})

describe('apiServicePort', () => {
    afterEach(() => {
        delete process.env.API_SERVICE_PORTS
    })

    it('defaults to the catalog port', () => {
        expect(API_SERVICE_NAMES).toContain('node-agent')
        expect(apiServicePort('node-agent')).toBe(3106)
    })

    it('honours the JSON override', () => {
        process.env.API_SERVICE_PORTS = JSON.stringify({ project: 3203 })
        expect(apiServicePort('project')).toBe(3203)
        expect(apiServicePort('fleet')).toBe(3104)
    })

    it('falls back to the default on a malformed override', () => {
        process.env.API_SERVICE_PORTS = '{not json'
        expect(apiServicePort('project')).toBe(3103)
    })
})
