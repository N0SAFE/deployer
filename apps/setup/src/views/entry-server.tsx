import { PageContextProvider, NavigationProvider } from '@nestjs-ssr/react/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { renderToString, renderToPipeableStream } from 'react-dom/server';

import ThemeProvider from '@deployer/ui/components/theme-provider';

import type { RenderContext } from '@nestjs-ssr/react';

/** What a page component receives: the controller's payload, already validated. */
export type SsrPageProps = Record<string, unknown>;

/** A component this entry can render: a page or a layout. */
export type SsrViewComponent = React.ComponentType<SsrPageProps>;

/** One layout plus the props its decorator carried. */
export interface SsrLayoutEntry {
  readonly layout: SsrViewComponent;
  readonly props?: Record<string, unknown>;
}

/** The payload the render interceptor hands to this entry. */
export interface SsrRenderPayload {
  readonly data?: SsrPageProps;
  /** The render context the interceptor built for this request; the provider requires it. */
  readonly __context: RenderContext;
  readonly __layouts?: readonly SsrLayoutEntry[];
}

/** Fresh React Query client per SSR render (no cross-request cache). */
function createSsrQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 0,
        gcTime: 0,
      },
    },
  });
}

// Auto-discover root layout using Vite's glob import
// This eagerly loads layout if it exists, null otherwise
const layoutModules = import.meta.glob<{ readonly default: SsrViewComponent }>('@/views/layout.tsx', {
  eager: true,
});

const RootLayout = Object.values(layoutModules).at(0)?.default ?? null;

/**
 * Get the root layout component.
 * Used by RenderService in production when dynamic import isn't available.
 */
export function getRootLayout(): SsrViewComponent | null {
  return RootLayout;
}

/**
 * Compose a component with its layouts from the interceptor.
 * Layouts are passed from the RenderInterceptor based on decorators.
 * Each layout is wrapped with data-layout and data-outlet attributes
 * for client-side navigation segment swapping.
 *
 * The layouts array is ordered [RootLayout, ControllerLayout, MethodLayout] (outer to inner).
 * We iterate in REVERSE order because wrapping happens inside-out:
 * - Start with Page
 * - Wrap with innermost layout first (MethodLayout)
 * - Then wrap with ControllerLayout
 * - Finally wrap with RootLayout (outermost)
 */
function composeWithLayouts(
  ViewComponent: SsrViewComponent,
  props: SsrPageProps,
  layouts: readonly SsrLayoutEntry[] = [],
  context?: unknown,
): React.ReactElement {
  // Start with the page component
  let result = <ViewComponent {...props} />;

  // Wrap with each layout in REVERSE order (innermost to outermost)
  // This produces the correct nesting: RootLayout > ControllerLayout > Page
  // Pass context to layouts so they can access path, params, etc. for navigation
  // Each layout gets data-layout attribute and children are wrapped in data-outlet
  for (const entry of [...layouts].reverse()) {
    const { layout: Layout, props: layoutProps } = entry;
    const layoutName = Layout.displayName ?? Layout.name;
    result = (
      <div data-layout={layoutName}>
        <Layout context={context} layoutProps={layoutProps}>
          <div data-outlet={layoutName}>{result}</div>
        </Layout>
      </div>
    );
  }

  return result;
}

/**
 * The provider stack every server render must use.
 *
 * WHY THIS EXISTS AS ONE COMPONENT: `entry-client.tsx` hydrates the tree it
 * renders, so the server and the client MUST produce the same element tree. If
 * a provider is added on one side only, the trees differ and React reports
 * "Hydration failed because the server rendered HTML didn't match the client".
 *
 * The dangerous case is `ThemeProvider` (next-themes): it renders an inline
 * `<script>` that sets the `dark` class before paint. Omitting it here meant the
 * server emitted no such script while the client expected one — which is exactly
 * how the wizard shipped a hydration mismatch. `NavigationProvider` follows the
 * same rule for the same reason.
 *
 * The order is IDENTICAL to `entry-client.tsx`. Keep the two in lockstep: this
 * component is the only place that should ever change.
 */
function ProviderStack({
  client,
  context,
  children,
}: {
  client: QueryClient;
  context: RenderContext;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={client}>
        <NavigationProvider>
          <PageContextProvider context={context}>
            {children}
          </PageContextProvider>
        </NavigationProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

/**
 * String-based SSR (mode: 'string')
 * Simple, synchronous rendering
 */
export function renderComponent(
  ViewComponent: SsrViewComponent,
  data: SsrRenderPayload,
) {
  const { data: pageData = {}, __context: context, __layouts: layouts } = data;
  const composedElement = composeWithLayouts(
    ViewComponent,
    pageData,
    layouts,
    context,
  );

  // Wrap with PageContextProvider to make context available via hooks
  const wrappedElement = (
    <ProviderStack client={createSsrQueryClient()} context={context}>
      {composedElement}
    </ProviderStack>
  );

  return renderToString(wrappedElement);
}

/**
 * Render a segment for client-side navigation.
 * Includes any layouts below the swap target (e.g., nested layouts).
 * The swap target's outlet will receive this rendered content.
 */
export function renderSegment(
  ViewComponent: SsrViewComponent,
  data: SsrRenderPayload,
) {
  const { data: pageData = {}, __context: context, __layouts: layouts } = data;

  // Compose with filtered layouts (layouts below the swap target)
  const composedElement = composeWithLayouts(
    ViewComponent,
    pageData,
    layouts,
    context,
  );

  // Wrap with PageContextProvider to make context available via hooks
  const element = (
    <ProviderStack client={createSsrQueryClient()} context={context}>
      {composedElement}
    </ProviderStack>
  );

  return renderToString(element);
}

/**
 * Streaming SSR (mode: 'stream' - default)
 * Modern approach with progressive rendering and Suspense support
 */
export function renderComponentStream(
  ViewComponent: SsrViewComponent,
  data: SsrRenderPayload,
  callbacks?: {
    nonce?: string;
    onShellReady?: () => void;
    onShellError?: (error: unknown) => void;
    onError?: (error: unknown) => void;
    onAllReady?: () => void;
  },
) {
  const { data: pageData = {}, __context: context, __layouts: layouts } = data;
  const composedElement = composeWithLayouts(
    ViewComponent,
    pageData,
    layouts,
    context,
  );

  // Wrap with PageContextProvider to make context available via hooks
  const wrappedElement = (
    <ProviderStack client={createSsrQueryClient()} context={context}>
      {composedElement}
    </ProviderStack>
  );

  return renderToPipeableStream(wrappedElement, callbacks);
}
