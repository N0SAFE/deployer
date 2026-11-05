import { describe, expect, it } from 'vitest'

import {
    deploymentLinkFromRecord,
    projectLinkFromRecord,
    resolveRoleTier,
    serviceLinkFromRecord,
    shouldIncludeProject,
    shouldIncludeService,
} from './container-link-redaction'

const at = new Date('2026-10-01T00:00:00.000Z')

const service = {
    id: 's1',
    projectId: 'p1',
    name: 'api',
    type: 'web',
    isActive: true,
    updatedAt: at,
    customDomains: ['a.example.com'],
    resourceLimits: { memory: '512m', cpu: '1' },
    environmentVariables: { SECRET: 'x' },
}

const deployment = {
    id: 'd1',
    serviceId: 's1',
    projectId: 'p1',
    environment: 'production',
    status: 'success',
    containerName: 'c',
    containerImage: 'img',
    domainUrl: 'https://a.example.com',
    healthCheckUrl: 'https://a.example.com/health',
    createdAt: at,
    updatedAt: at,
}

describe('container link redaction', () => {
    it('maps platform roles onto tiers, defaulting to viewer', () => {
        expect(resolveRoleTier('Super_Admin')).toBe('admin')
        expect(resolveRoleTier('maintainer')).toBe('developer')
        expect(resolveRoleTier('guest')).toBe('viewer')
        expect(resolveRoleTier(null)).toBe('viewer')
    })

    it('hides the environment from a developer and the limits too from a viewer', () => {
        const admin = serviceLinkFromRecord(service, 'admin')
        expect(admin.environmentVariables).toEqual({ SECRET: 'x' })
        expect(admin.redactedFields).toEqual([])

        const developer = serviceLinkFromRecord(service, 'developer')
        expect(developer.environmentVariables).toBeNull()
        expect(developer.resourceLimits).toEqual({
            memory: '512m',
            cpu: '1',
            storage: undefined,
        })
        expect(developer.redactedFields).toEqual(['environmentVariables'])

        const viewer = serviceLinkFromRecord(service, 'viewer')
        expect(viewer.resourceLimits).toBeNull()
        expect(viewer.redactedFields).toEqual([
            'resourceLimits',
            'environmentVariables',
        ])
    })

    it('hides production URLs from a developer and any URL from a viewer', () => {
        expect(deploymentLinkFromRecord(deployment, 'admin').domainUrl).toBe(
            'https://a.example.com'
        )
        expect(
            deploymentLinkFromRecord(deployment, 'developer').domainUrl
        ).toBeNull()
        expect(
            deploymentLinkFromRecord(
                { ...deployment, environment: 'preview' },
                'developer'
            ).domainUrl
        ).toBe('https://a.example.com')
        expect(
            deploymentLinkFromRecord(
                { ...deployment, environment: 'preview' },
                'viewer'
            ).redactedFields
        ).toEqual(['domainUrl', 'healthCheckUrl'])
    })

    it("hides the project's base domain from a viewer", () => {
        const project = {
            id: 'p1',
            name: 'p',
            baseDomain: 'example.com',
            updatedAt: at,
        }
        expect(projectLinkFromRecord(project, 'viewer')).toMatchObject({
            baseDomain: null,
            redactedFields: ['baseDomain'],
        })
        expect(projectLinkFromRecord(project, 'admin').baseDomain).toBe(
            'example.com'
        )
    })

    it('works out which links an include path needs', () => {
        expect(shouldIncludeService(new Set(['deployment.service']))).toBe(true)
        expect(shouldIncludeProject(new Set(['service']))).toBe(false)
    })
})
