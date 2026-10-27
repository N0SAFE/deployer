import { createElement, forwardRef, type AnchorHTMLAttributes, type ComponentType, type ReactNode } from 'react'

/**
 * Stand-in for the generated `@/routes` module.
 *
 * The real module imports every `route.info.ts` plus the declarative-routing
 * page wrappers (which resolve through built `dist/`), none of which a unit test
 * should load. Pages only need a route to (a) build an href with `Route(params,
 * search)`, (b) render `Route.Link`, and (c) for `page.tsx` files, wrap the page
 * (`Route.Page`/`SessionRoute`). Any export name is answered, so a page that
 * starts using a new route needs no change here.
 *
 *   vi.mock('@/routes', async () => (await import('@/test-support')).routesModule())
 */

type Dict = Record<string, unknown>

function hrefFor(name: string, params?: Dict, search?: Dict): string {
	const path = `/${name}${params && Object.keys(params).length ? `/${Object.values(params).map(String).join('/')}` : ''}`
	const qs = search ? new URLSearchParams(Object.entries(search).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString() : ''
	return qs ? `${path}?${qs}` : path
}

function makeRoute(name: string) {
	const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { params?: Dict; search?: Dict; children?: ReactNode }>(
		function RouteLink({ params, search, children, ...rest }, ref) {
			return createElement('a', { ...rest, ref, href: hrefFor(name, params, search) }, children)
		},
	)
	const route = (params?: Dict, search?: Dict) => hrefFor(name, params, search)
	// Wrappers return the component itself: tests render the inner page directly.
	const wrap = (component: unknown) => component
	return Object.assign(route, { Link, Route: wrap, Page: wrap, SessionRoute: wrap, SessionPage: wrap, routeName: name })
}

export function routesModule(): Record<string, unknown> {
	const cache = new Map<string, unknown>()
	const target: Record<string, unknown> = {}
	return new Proxy(target, {
		has: () => true,
		get(_t, prop) {
			if (typeof prop !== 'string' || prop === 'then' || prop === '__esModule' || prop === 'default') return undefined
			let route = cache.get(prop)
			if (!route) {
				route = makeRoute(prop)
				cache.set(prop, route)
			}
			return route
		},
	})
}

/**
 * Pages wrapped by `Route.Route(...)` / `Route.SessionRoute(...)` are typed as Next page
 * components (`{ params, searchParams }`). The stub `@/routes` returns the wrapped
 * component unchanged, so at runtime it takes the inner props; this re-types it for a spec.
 */
export function asComponent<P extends object = object>(page: unknown): ComponentType<P> {
	return page as ComponentType<P>
}
