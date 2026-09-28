import React from 'react';
import { renderToString, renderToPipeableStream } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PageContextProvider, NavigationProvider } from '@nestjs-ssr/react/client';
import ThemeProvider from '@repo/ui/components/theme-provider';

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
// @ts-ignore - Vite-specific API
const layoutModules = import.meta.glob('@/views/layout.tsx', {
  eager: true,
}) as Record<string, { default: React.ComponentType }>;

const layoutPath = Object.keys(layoutModules)[0];
const RootLayout = layoutPath ? (layoutModules[layoutPath]?.default ?? null) : null;

/**
 * Get the root layout component.
 * Used by RenderService in production when dynamic import isn't available.
 */
export function getRootLayout(): React.ComponentType<any> | null {
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
  ViewComponent: React.ComponentType<any>,
  props: any,
  layouts: Array<{ layout: React.ComponentType<any>; props?: any }> = [],
  context?: any,
): React.ReactElement {
  // Start with the page component
  let result = <ViewComponent {...props} />;

  // Wrap with each layout in REVERSE order (innermost to outermost)
  // This produces the correct nesting: RootLayout > ControllerLayout > Page
  // Pass context to layouts so they can access path, params, etc. for navigation
  // Each layout gets data-layout attribute and children are wrapped in data-outlet
  for (const entry of [...layouts].reverse()) {
    const { layout: Layout, props: layoutProps } = entry;
    const layoutName = Layout.displayName || Layout.name || 'Layout';
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
  context: any;
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
  ViewComponent: React.ComponentType<any>,
  data: any,
) {
  const { data: pageData, __context: context, __layouts: layouts } = data;
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
  ViewComponent: React.ComponentType<any>,
  data: any,
) {
  const { data: pageData, __context: context, __layouts: layouts } = data;

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
  ViewComponent: React.ComponentType<any>,
  data: any,
  callbacks?: {
    nonce?: string;
    onShellReady?: () => void;
    onShellError?: (error: unknown) => void;
    onError?: (error: unknown) => void;
    onAllReady?: () => void;
  },
) {
  const { data: pageData, __context: context, __layouts: layouts } = data;
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
