/// <reference types="@nestjs-ssr/react/global" />

import {
    PageContextProvider,
    NavigationProvider,
    buildComponentRegistry,
    resolveViewComponent,
} from '@nestjs-ssr/react/client'
import { QueryClientProvider } from '@tanstack/react-query'
import React, { StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'

import ThemeProvider from '@deployer/ui/components/theme-provider'

import { viewQueryClient } from './lib/query-client'

import type { RenderContext } from '@nestjs-ssr/react'

/** What a page component receives: the server-rendered payload. */
type PageProps = Record<string, unknown>

/** A component this entry can hydrate: a page or a layout. */
type ViewComponent = React.ComponentType<PageProps>

/** One layout plus the props its decorator carried. */
interface LayoutEntry {
    layout: ViewComponent
    props?: Record<string, unknown>
}

/** A view that carries its own layout chain (the `@Layout` decorator's shape). */
type LayoutBearingView = ViewComponent & {
    readonly layout: ViewComponent
    readonly layoutProps?: Record<string, unknown>
}

/** Vite's eager `import.meta.glob`, narrowed once because this app has no `vite` types. */
interface ViteImportMeta extends ImportMeta {
    readonly glob: (
        pattern: string | readonly string[],
        options: { readonly eager: true }
    ) => Record<string, { readonly default: ViewComponent }>
}

// Shared Tailwind v4 theme (same as the web app): @deployer/ui globals.
import './global.css'

const componentName = window.__COMPONENT_NAME__
const initialProps = window.__INITIAL_STATE__
// Server-injected context; fall back to a client-derived shape (direct
// navigation) instead of {} so PageContextProvider always receives a valid
// RenderContext during hydration.
const renderContext: RenderContext = window.__CONTEXT__ ?? {
    url: window.location.href,
    path: window.location.pathname,
    query: Object.fromEntries(new URLSearchParams(window.location.search)),
    params: {},
    method: 'GET',
}

// Auto-discover root layout using Vite's glob import (must match server-side discovery)
const { glob } = import.meta as ViteImportMeta
const layoutModules = glob('@/views/layout.tsx', { eager: true })
const RootLayout = Object.values(layoutModules)[0]?.default ?? null

// Auto-import all view components using Vite's glob feature.
// Match any `views` directory under the source root (`@`), so views colocated
// inside feature modules (e.g. `@/products/views/list.tsx`) are discovered too,
// not just the top-level `@/views` folder. Exclude entry-* files in any views dir.
const modules = glob(['@/**/views/**/*.tsx', '!@/**/views/entry-*.tsx'], {
    eager: true,
})

// Export modules globally for segment hydration after client-side navigation
window.__MODULES__ = modules

// Build the component registry once (used below for layout lookups).
const componentMap = buildComponentRegistry(modules)

// Resolve the page component the server rendered. The shared resolver matches by
// displayName/name, then normalized (PascalCase) filename, then minified default
// exports — and logs a clear error if the name collides across views directories.
const ViewComponent = resolveViewComponent(componentName, modules)

if (!ViewComponent) {
    const availableComponents = Object.entries(modules)
        .map(([path, m]) => {
            const filename = path.split('/').pop()?.replace('.tsx', '')
            const name = m.default.displayName ?? m.default.name
            return `${filename ?? 'unknown'} (${name})`
        })
        .join(', ')
    throw new Error(
        `Component "${componentName}" not found in views directory. Available: ${availableComponents}`
    )
}

/**
 * Check if a component has a layout property
 */
function hasLayout(component: unknown): component is LayoutBearingView {
    return (
        typeof component === 'object' &&
        component !== null &&
        'layout' in component &&
        typeof component.layout === 'function'
    )
}

/**
 * Compose a component with its layout (and nested layouts if any).
 * This must match the server-side composition in entry-server.tsx.
 *
 * The layouts array is ordered [RootLayout, ControllerLayout, MethodLayout] (outer to inner).
 * We iterate in REVERSE order because wrapping happens inside-out:
 * - Start with Page
 * - Wrap with innermost layout first (MethodLayout)
 * - Then wrap with ControllerLayout
 * - Finally wrap with RootLayout (outermost)
 */
function composeWithLayout(
    ViewComponent: ViewComponent,
    props: PageProps,
    context?: unknown,
    layouts: LayoutEntry[] = []
): React.ReactElement {
    // Start with the page component
    let result = <ViewComponent {...props} />

    // If no layouts passed, check if component has its own layout chain
    if (layouts.length === 0 && hasLayout(ViewComponent)) {
        let currentComponent: ViewComponent = ViewComponent
        while (hasLayout(currentComponent)) {
            layouts.push({
                layout: currentComponent.layout,
                props: currentComponent.layoutProps ?? {},
            })
            currentComponent = currentComponent.layout
        }
    }

    // Wrap with each layout in REVERSE order (innermost to outermost)
    // This produces the correct nesting: RootLayout > ControllerLayout > Page
    // Must match server-side wrapping with data-layout and data-outlet attributes
    for (const entry of [...layouts].reverse()) {
        const { layout: Layout, props: layoutProps } = entry
        const layoutName = Layout.displayName ?? Layout.name
        result = (
            <div data-layout={layoutName}>
                <Layout context={context} layoutProps={layoutProps}>
                    <div data-outlet={layoutName}>{result}</div>
                </Layout>
            </div>
        )
    }

    return result
}

// Build layouts array from server-provided __LAYOUTS__ data
// This ensures controller-level layouts (e.g., @Layout(RecipesLayout)) are
// included during hydration on hard refresh, not just the auto-discovered root layout
//
// The server ALWAYS injects this (`buildInlineScripts` in @nestjs-ssr/react
// writes `window.__LAYOUTS__ = ...` on every render path), so there is no
// "missing data" case to fall back from — and inferring a default here was
// actively wrong.
//
// WHY: a route opts OUT of layouts with `@SsrRender(View, { layout: null })`
// (see `setup-done.controller.ts` in apps/api), which makes the server's
// `resolveLayoutChain` return `[]` so the page renders bare. The old fallback
// treated that `[]` as "no data" and wrapped the tree in `RootLayout`, so the
// client rendered a header the server never emitted:
//
//   Hydration failed because the server rendered HTML didn't match the client
//
// The server's array is the whole truth; this loop only maps names to components.
const layoutsData = window.__LAYOUTS__
const layouts: LayoutEntry[] = []

for (const { name: layoutName, props: layoutProps } of layoutsData) {
    const layoutEntry = componentMap.find(
        (c) =>
            c.name === layoutName ||
            c.normalizedFilename === layoutName ||
            c.filename === layoutName.toLowerCase()
    )
    if (layoutEntry) {
        layouts.push({
            layout: layoutEntry.component,
            props: layoutProps ?? {},
        })
    } else if (layoutName === 'RootLayout' && RootLayout) {
        // Fallback: if the auto-discovered root layout wasn't in componentMap by name
        layouts.push({ layout: RootLayout, props: layoutProps ?? {} })
    }
}

// NOTE: there is deliberately NO fallback to `RootLayout` here. The server
// ALWAYS injects `window.__LAYOUTS__` (`buildInlineScripts` in
// `@nestjs-ssr/react` writes it on every render path), so there is no
// "missing data" case — and inferring a default was actively wrong.
//
// A route opts OUT of layouts with `@SsrRender(View, { layout: null })` (see
// `setup-done.controller.ts` in apps/api), which makes the server's
// `resolveLayoutChain` return `[]` so the page renders bare. The old fallback
// read that `[]` as "no data" and wrapped the tree in `RootLayout`, so the
// client rendered a header the server never emitted:
//
//   Hydration failed because the server rendered HTML didn't match the client

// Compose the component with its layout (if any)
const composedElement = composeWithLayout(
    ViewComponent,
    initialProps,
    renderContext,
    layouts
)

// Wrap with providers to make context and navigation state available via hooks.
//
// `ThemeProvider` (next-themes) drives the `dark` class + `color-scheme` on
// <html>, so the API-served pages honour the operator's light/dark choice.
// `defaultTheme="system"` is the required behaviour: a fresh install follows
// the OS preference until the user picks explicitly (the picked value is
// persisted by next-themes, and `enableSystem` keeps "System" selectable).
const wrappedElement = (
    <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
    >
        <QueryClientProvider client={viewQueryClient}>
            <NavigationProvider>
                <PageContextProvider context={renderContext}>
                    {composedElement}
                </PageContextProvider>
            </NavigationProvider>
        </QueryClientProvider>
    </ThemeProvider>
)

const rootElement = document.getElementById('root')
if (rootElement === null) {
    throw new Error(
        'Cannot hydrate: the #root element is missing from the document.'
    )
}

hydrateRoot(rootElement, <StrictMode>{wrappedElement}</StrictMode>)

// Track if initial hydration is complete to ignore false popstate events
let hydrationComplete = false
requestAnimationFrame(() => {
    hydrationComplete = true
})

// Handle browser back/forward navigation
async function onPopState(): Promise<void> {
    // Ignore popstate events that fire before hydration is complete
    // (some browsers fire popstate on initial page load)
    if (!hydrationComplete) return

    // Dynamically import navigate to avoid circular dependency with hydrate-segment
    const { navigate } = await import('@nestjs-ssr/react/client')
    // Re-navigate to the current URL (browser already updated location)
    await navigate(location.href, { replace: true, scroll: false })
}

// `void`: the listener cannot be awaited by the browser, and `onPopState` reports its own failures through navigate.
window.addEventListener('popstate', () => {
    void onPopState()
})
