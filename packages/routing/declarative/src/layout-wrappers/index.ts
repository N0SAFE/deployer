/**
 * Layout wrappers for session hydration at the layout level.
 * 
 * This module provides wrappers that hydrate session data into React Query
 * at the layout level, ensuring all components (including MainNavigation)
 * have access to the cached session immediately.
 * 
 * @packageDocumentation
 */

export { createSessionLayout, configureLayoutAuth } from '@repo/declarative-routing/layout-wrappers/server'
export type { SessionLayoutProps, SessionLayoutOptions, NextLayoutProps } from '@repo/declarative-routing/layout-wrappers/server'
