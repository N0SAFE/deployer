/**
 * Plugin Exports - Context-Aware Permission Wrappers
 * 
 * Each plugin wraps Better Auth plugin methods with automatic header injection.
 * This provides a clean API for ORPC handlers that don't require manual header passing.
 */

// System registry and types
export * from '@repo/auth/permissions/plugins/system/index';

// Admin permissions plugin — the mesh is the single tenant, so the admin
// plugin is the only scoped wrapper we ship.
export { 
  AdminPermissionsPlugin, 
  type AdminPlugin,
  type AdminPluginInstance,
  type AuthWithAdminPlugin,
  type AdminPluginWrapperOptions,
  type ApiMethodsWithAdminPlugin,
} from '@repo/auth/permissions/plugins/admin.permissions.plugin';
