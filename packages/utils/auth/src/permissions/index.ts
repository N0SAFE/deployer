import { admin, organization } from "better-auth/plugins";
import { statement, ac, roles, schemas } from "./config";
import { adminClient, organizationClient } from "better-auth/client/plugins";

// Export all system classes and types
export * from "./system";

// Export built configuration
export { statement, ac, roles, schemas };

// Export common permissions
export { commonPermissions, type CommonPermissionKeys, type CommonPermission } from "./common";

// Export utilities
export * from './utils';

// Export invite helper
export { useInvite } from './invite';

export function useAdminClient(
  options: Omit<Parameters<typeof adminClient>[0], "ac" | "roles"> = {}
) {
  return adminClient({
    ac,
    roles,
    ...options,
  });
}

export function useAdmin(
  options: Omit<Parameters<typeof admin>[0], "ac" | "roles"> = {}
) {
  return admin({
    ac,
    roles,
    ...options,
  });
}

export function useOrganizationClient(
  options: Omit<Parameters<typeof organizationClient>[0], "ac" | "roles"> = {}
) {
  return organizationClient({
    ac,
    roles,
    ...options,
  });
}

export function useOrganization(
  options: Omit<Parameters<typeof organization>[0], "ac" | "roles"> = {}
) {
  return organization({
    ac,
    roles,
    ...options,
  });
}
