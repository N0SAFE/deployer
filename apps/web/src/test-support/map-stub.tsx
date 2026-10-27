import { createElement, type ReactNode } from 'react'

/** Stand-in for `@/components/ui/map`: MapLibre cannot initialise without WebGL (jsdom has none). */
export function mapModule(): Record<string, unknown> {
	const Container = ({ children }: { children?: ReactNode }) => createElement('div', { 'data-testid': 'map-stub' }, children)
	const Nothing = () => null
	const target: Record<string, unknown> = {}
	return new Proxy(target, {
		has: () => true,
		get(_t, prop) {
			if (typeof prop !== 'string' || prop === 'then' || prop === '__esModule' || prop === 'default') return undefined
			if (prop === 'useMap') return () => ({ map: null, isLoaded: false })
			return prop === 'Map' || prop.startsWith('Marker') || prop === 'MapMarker' ? Container : Nothing
		},
	})
}
