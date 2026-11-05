import { describe, expect, it } from 'vitest'

import { appContract } from './app-contract'

/**
 * No two procedures of the composed surface may answer the same request.
 *
 * Nest registers each `@Implement` as its own route, in class order, and Express serves the FIRST match. So a route like
 * `POST /deployments/{serviceId}` captures `POST /deployments/trigger` — the request is then validated against the wrong
 * procedure and answers `400`, and the real one is unreachable. It happened: `.params()` defines the WHOLE path, so a
 * `.path("/previews/promote")` written before it was silently dropped. A guard in front of the router answered `401` first
 * and hid it for as long as it existed; once authorization moved to the procedure, only an e2e test noticed.
 *
 * Two shapes are refused, both from the contracts alone (no server needed):
 * - two procedures with the same method and the same path once parameters are erased;
 * - a parametrised single-segment route (`POST /x/{id}`) beside a static sibling (`POST /x/trigger`) — the static one is
 *   reachable only if it happens to be registered first.
 */
type Route = { name: string; method: string; path: string }

function routesOf(
    node: unknown,
    trail: string[],
    routes: Route[],
    seen = new Set<unknown>()
): void {
    if (
        node === null ||
        (typeof node !== 'object' && typeof node !== 'function') ||
        seen.has(node)
    )
        return
    seen.add(node)

    const openapi = (
        node as {
            '~orpc'?: {
                meta?: {
                    '~openapi'?: {
                        prefix?: string
                        path?: string
                        method?: string
                    }
                }
            }
        }
    )['~orpc']?.meta?.['~openapi']
    if (openapi?.method !== undefined) {
        routes.push({
            name: trail.join('.'),
            method: openapi.method,
            path: `${openapi.prefix ?? ''}${openapi.path ?? ''}`,
        })
        return
    }
    for (const [key, child] of Object.entries(node))
        if (key !== '~orpc') routesOf(child, [...trail, key], routes, seen)
}

/**
 * COLLISIONS THAT EXIST TODAY — the to-do list, not an allowance. The spec compares the surface to these lists in BOTH
 * directions: a new collision fails it, and so does a fixed one that is still listed, so the list can only shrink.
 * Each is a real bug: the first procedure registered wins, and the other answers the wrong thing (or `400`).
 *
 * - SHADOWS: a parametrised route registered before its static sibling captures it (`GET /user/count` is validated as
 *   `findById("count")`). Fix by moving the static route first, or by giving the parameter a pattern that excludes it.
 * - DUPLICATES: project-scoped and service-scoped domains share one path; the second is unreachable. Fix by giving one a
 *   distinct path (`/domains/projects/{id}/domains`, say).
 */
const KNOWN_SHADOWS: string[] = [
    'GET /analytics/reports/{reportId} (analytics.getReport) shadows /analytics/reports/configurations (analytics.listReportConfigs)',
    'GET /deployments/{id} (deployment.findById) shadows /deployments/retry-policies (deployment.listRetryPolicies)',
    'GET /deployments/{id} (deployment.findById) shadows /deployments/streams (deployment.streamsList)',
    'GET /projects/{id}/environments/{environmentId} (project.getEnvironment) shadows /projects/{id}/environments/statuses (project.getAllEnvironmentStatuses)',
    'GET /templates/{id} (template.findById) shadows /templates/version-migrations (template.listVersionMigrations)',
    'GET /user/{id} (user.findById) shadows /user/count (user.count)',
]
const KNOWN_DUPLICATES: string[] = [
    'DELETE /domains/{}/domains/{}  <-  domain.removeProjectDomain, domain.removeServiceDomain',
    'GET /domains/{}/domains  <-  domain.listProjectDomains, domain.listServiceDomains',
    'GET /domains/{}/domains/available  <-  domain.getAvailableDomains, domain.getAvailableDomainsForService',
    'POST /domains/{}/domains  <-  domain.addProjectDomain, domain.addServiceDomain',
    'PUT /domains/{}/domains/{}  <-  domain.updateProjectDomain, domain.updateServiceDomain',
]

const routes: Route[] = []
routesOf(appContract, [], routes)

/** `/a/{id}/b` → `/a/{}/b`, trailing slash dropped. */
const shape = (path: string): string =>
    path.replace(/\{[^}]+\}/g, '{}').replace(/\/$/, '')

describe('the composed API surface', () => {
    it('is non-trivial (the walk really found the procedures)', () => {
        expect(routes.length).toBeGreaterThan(200)
    })

    it('has no two procedures on the same method and path, beyond the known ones', () => {
        const byRoute = new Map<string, string[]>()
        for (const route of routes)
            byRoute.set(`${route.method} ${shape(route.path)}`, [
                ...(byRoute.get(`${route.method} ${shape(route.path)}`) ?? []),
                route.name,
            ])

        const duplicates = [...byRoute]
            .filter(([, names]) => names.length > 1)
            .map(([key, names]) => `${key}  <-  ${names.join(', ')}`)
        expect(duplicates.sort()).toEqual(KNOWN_DUPLICATES)
    })

    it('has no parametrised route that shadows a static sibling, beyond the known ones', () => {
        const shadowed: string[] = []
        for (const route of routes) {
            const match = /^(.*)\/\{[^}]+\}$/.exec(route.path)
            if (match === null) continue
            const parent = match[1] ?? ''
            for (const other of routes) {
                const rest = other.path.startsWith(`${parent}/`)
                    ? other.path.slice(parent.length + 1)
                    : undefined
                if (
                    other.method === route.method &&
                    rest !== undefined &&
                    rest !== '' &&
                    !rest.includes('/') &&
                    !rest.includes('{')
                ) {
                    shadowed.push(
                        `${route.method} ${route.path} (${route.name}) shadows ${other.path} (${other.name})`
                    )
                }
            }
        }
        expect(shadowed.sort()).toEqual(KNOWN_SHADOWS)
    })
})
